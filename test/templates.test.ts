// The composition templates and the helpers they share: timing, the camera
// move, text registration while a page turns.
import { afterAll, describe, expect, it } from 'vitest';
import type { RegisteredText } from '../src/engine/host.ts';
import { resolveTimeline } from '../src/engine/timelineResolve.ts';
import { moveCamera } from '../src/runtime/templates/camera.ts';
import { accelerate, beatTimes } from '../src/runtime/templates/timing.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps } from './helpers.ts';
import { installHelpers, runtimePage } from './runtimePage.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

const tl = resolveTimeline({
    version: 1,
    width: 640,
    height: 360,
    fps: 24,
    seed: 1,
    bpm: 120,
    beatsPerBar: 4,
    scenes: [
        { id: 'intro', bars: 1 },
        { id: 'cuts', bars: 4 },
    ],
});

describe('beat and accelerating times', () => {
    it('puts one time every `every` beats, snapped to frames', () => {
        expect(beatTimes(tl, { from: 1, count: 4, every: 0.5 })).toEqual([0.5, 0.75, 1, 1.25]);
        const odd = beatTimes(tl, { from: 0.3, count: 3, every: 1 / 3 });
        for (const t of odd) expect(Math.abs(t * 24 - Math.round(t * 24))).toBeLessThan(1e-9);
    });

    it('fills a scene with shots that shrink by the same factor', () => {
        const times = accelerate(tl, { scene: 'cuts', count: 12, ratio: 0.2 });
        expect(times).toHaveLength(12);
        expect(times[0]).toBe(2);
        const ends = [...times.slice(1), 10];
        const spans = times.map((t, i) => ends[i] - t);
        for (let i = 1; i < spans.length; i++)
            expect(spans[i]).toBeLessThanOrEqual(spans[i - 1] + 1 / 24);
        expect(spans[spans.length - 1] / spans[0]).toBeGreaterThan(0.15);
        expect(spans[spans.length - 1] / spans[0]).toBeLessThan(0.26);
        for (const t of times) expect(Math.abs(t * 24 - Math.round(t * 24))).toBeLessThan(1e-9);
    });

    it('refuses a shot that would get no frame', () => {
        expect(() => accelerate(tl, { scene: 'cuts', count: 120, ratio: 0.05 })).toThrow(
            /gets no frame/,
        );
        expect(() => accelerate(tl, { scene: 'nope', count: 3, ratio: 1 })).toThrow(/No scene/);
    });
});

/** The affine matrix a sequence of translate and scale calls builds. */
function recordCamera(
    run: (ctx: CanvasRenderingContext2D) => void,
): (x: number, y: number) => [number, number] {
    let m = [1, 0, 0, 1, 0, 0];
    const ctx = {
        translate(x: number, y: number) {
            m = [m[0], m[1], m[2], m[3], m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
        },
        scale(sx: number, sy: number) {
            m = [m[0] * sx, m[1] * sx, m[2] * sy, m[3] * sy, m[4], m[5]];
        },
    } as unknown as CanvasRenderingContext2D;
    run(ctx);
    return (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

describe('camera', () => {
    const stage = { width: 1920, height: 1080 };
    const whole = { x: 0, y: 0, width: 1920, height: 1080 };
    const page = { x: 960, y: 342, width: 704, height: 396 };

    it('shows `from` at amount 0 and `to` at amount 1, fitted and centered', () => {
        const start = recordCamera((ctx) => moveCamera(ctx, stage, whole, page, 0));
        expect(start(0, 0)[0]).toBeCloseTo(0, 6);
        expect(start(1920, 1080)[1]).toBeCloseTo(1080, 6);
        const done = recordCamera((ctx) => moveCamera(ctx, stage, whole, page, 1));
        const [x0, y0] = done(page.x, page.y);
        const [x1, y1] = done(page.x + page.width, page.y + page.height);
        expect(x0).toBeCloseTo(0, 6);
        expect(y0).toBeCloseTo(0, 6);
        expect(x1).toBeCloseTo(1920, 6);
        expect(y1).toBeCloseTo(1080, 6);
    });

    it('holds one point still while it zooms, and pans when the sizes match', () => {
        const at = (u: number) => recordCamera((ctx) => moveCamera(ctx, stage, whole, page, u));
        const k = 1920 / 704;
        const fixed = [(k * (page.x + 352) - 960) / (k - 1), (k * (page.y + 198) - 540) / (k - 1)];
        for (const u of [0, 0.3, 0.7, 1]) {
            const [x, y] = at(u)(fixed[0], fixed[1]);
            expect(x).toBeCloseTo(fixed[0], 4);
            expect(y).toBeCloseTo(fixed[1], 4);
        }
        const shifted = { ...whole, x: 400 };
        const [px] = recordCamera((ctx) => moveCamera(ctx, stage, whole, shifted, 0.5))(0, 0);
        expect(px).toBeCloseTo(-200, 6);
    });
});

interface PageTurnProbe {
    same: boolean;
    turning: number[];
    texts: string[];
    flat: string[];
}

describe('templates in the browser', () => {
    it('page turn: a turn draws the same pixels in any order and registers only the real text', async () => {
        const page = await runtimePage(await session(), 640, 360);
        try {
            await installHelpers(page);
            const probe = await page.page.evaluate(async (): Promise<PageTurnProbe> => {
                const w = window as unknown as {
                    rt: typeof import('../src/runtime/index.ts');
                    freshCanvas(w: number, h: number): CanvasRenderingContext2D;
                    pixelHash(ctx: CanvasRenderingContext2D): Promise<string>;
                    __flipbookHost: { texts: { text: string }[] };
                };
                const { rt } = w;
                const book = rt.pageTurn({
                    box: { x: 0, y: 0, width: 640, height: 360 },
                    turns: [1, 1.2],
                    duration: 0.8,
                    front(c, i) {
                        c.fillStyle = ['#e9dcc3', '#c9d8c5', '#d9c3c9'][i];
                        c.fillRect(0, 0, 640, 360);
                        c.fillStyle = '#2b2622';
                        c.font = `700 80px "${rt.FONTS.serif}"`;
                        rt.fillText(c, ['一', '二', '三'][i], 280, 220);
                    },
                });
                const a = w.freshCanvas(640, 360);
                const b = w.freshCanvas(640, 360);
                book.draw(a, 1.5);
                for (const t of [0.2, 1.9, 1.1]) book.draw(b, t);
                b.clearRect(0, 0, 640, 360);
                book.draw(b, 1.5);
                const same = (await w.pixelHash(a)) === (await w.pixelHash(b));
                const host = w.__flipbookHost;
                host.texts.length = 0;
                book.draw(w.freshCanvas(640, 360), 1.5);
                const texts = host.texts.map((entry) => entry.text).sort();
                host.texts.length = 0;
                book.draw(w.freshCanvas(640, 360), 0.5);
                const flat = host.texts.map((entry) => entry.text);
                return {
                    same,
                    turning: book.turning(1.5).map((p) => p.index),
                    texts,
                    flat,
                };
            });
            expect(probe.same).toBe(true);
            expect(probe.turning).toEqual([0, 1]);
            expect(probe.texts).toEqual(['一', '三', '二']);
            expect(probe.flat).toEqual(['一']);
        } finally {
            await page.close();
        }
    });

    it('lens: the iris opens inside the ring and the pull-out reaches every corner', async () => {
        const page = await runtimePage(await session(), 640, 360);
        try {
            const probe = await page.page.evaluate(() => {
                const { rt } = window as unknown as {
                    rt: typeof import('../src/runtime/index.ts');
                };
                const view = rt.lens({
                    stage: { width: 640, height: 360 },
                    times: [0, 1, 2],
                    open: 0.5,
                    pullOut: [2.5, 3.5],
                    plate() {},
                });
                return {
                    shut: view.windowAt(0).radius,
                    open: view.windowAt(0.6).radius,
                    full: view.windowAt(3.5).radius,
                    plates: [0.4, 1, 1.99, 9].map((t) => view.plateAt(t)),
                };
            });
            expect(probe.shut).toBe(0);
            expect(probe.open).toBeCloseTo(360 * 0.36, 6);
            expect(probe.full).toBeGreaterThanOrEqual(Math.hypot(320, 180));
            expect(probe.plates).toEqual([0, 1, 1, 2]);
        } finally {
            await page.close();
        }
    });

    it('arc: the arc holds across cuts and a label sits centered on its top', async () => {
        const page = await runtimePage(await session(), 640, 360);
        try {
            await installHelpers(page);
            const probe = await page.page.evaluate(() => {
                const w = window as unknown as {
                    rt: typeof import('../src/runtime/index.ts');
                    freshCanvas(w: number, h: number): CanvasRenderingContext2D;
                    __flipbookHost: { texts: RegisteredText[] };
                };
                const { rt } = w;
                const cuts = rt.arcCuts({
                    stage: { width: 640, height: 360 },
                    times: [0, 1, 1.5],
                    end: 2,
                    apex: 220,
                    rise: 60,
                    push: 0,
                    above() {},
                    below() {},
                });
                const arc = cuts.arcAt(1.2);
                w.__flipbookHost.texts.length = 0;
                const ctx = w.freshCanvas(640, 360);
                ctx.font = `600 40px "${rt.FONTS.serif}"`;
                cuts.label(ctx, 1.2, '发现');
                return {
                    shots: [0.5, 1, 1.7].map((t) => cuts.shotAt(t)),
                    apex: arc.y(320),
                    edge: arc.y(0),
                    texts: w.__flipbookHost.texts.map((entry) => entry.text),
                };
            });
            expect(probe.shots).toEqual([0, 1, 2]);
            expect(probe.apex).toBeCloseTo(220, 6);
            expect(probe.edge).toBeCloseTo(280, 6);
            expect(probe.texts).toEqual(['发现']);
        } finally {
            await page.close();
        }
    });
});
