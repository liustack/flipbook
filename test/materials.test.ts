import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CompositionPage } from '../src/engine/page.ts';
import { ellipsePoints, resample } from '../src/runtime/materials.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps } from './helpers.ts';
import { installHelpers, runtimePage } from './runtimePage.ts';

let page: CompositionPage;

beforeAll(async () => {
    page = await runtimePage(await session(), 1920, 1080);
    await installHelpers(page);
});

afterAll(async () => {
    await page?.close();
    await closeSession();
    cleanTemps();
});

type Win = {
    rt: typeof import('../src/runtime/index.ts');
    freshCanvas(w: number, h: number): CanvasRenderingContext2D;
    pixelHash(ctx: CanvasRenderingContext2D): Promise<string>;
    realNow(): number;
};

const MATERIALS = ['pencil', 'hatch', 'crossHatch', 'halftone', 'halftoneField', 'torn', 'stipple'];

describe('materials are pure functions of their arguments', () => {
    it('gives identical pixels for identical calls, in either call order', async () => {
        const result = await page.page.evaluate(async (names) => {
            const w = window as unknown as Win;
            const rt = w.rt;
            const box = { x: 20, y: 20, width: 440, height: 280 };
            const draws: Record<string, (ctx: CanvasRenderingContext2D, seed: number) => void> = {
                pencil: (ctx, seed) =>
                    rt.pencil(ctx, rt.ellipsePoints(240, 160, 200, 120, 0.3), {
                        seed,
                        closed: true,
                        passes: 3,
                    }),
                hatch: (ctx, seed) =>
                    rt.hatch(ctx, box, { seed, tone: (x: number) => x / 480, angle: 0.4 }),
                crossHatch: (ctx, seed) =>
                    rt.crossHatch(ctx, box, { seed, layers: 3, tone: (_x, y) => y / 320 }),
                halftone: (ctx, seed) => rt.halftone(ctx, box, { seed, tone: 0.35 }),
                halftoneField: (ctx, seed) =>
                    rt.halftone(ctx, box, { seed, tone: (x: number) => x / 480, jitter: 0.3 }),
                torn: (ctx, seed) => rt.tornPaper(ctx, box, { seed, roughness: 7 }),
                stipple: (ctx, seed) =>
                    rt.stipple(ctx, box, { seed, tone: (x: number, y: number) => (x + y) / 800 }),
            };
            const hashOf = async (name: string, seed: number) => {
                const ctx = w.freshCanvas(480, 320);
                draws[name](ctx, seed);
                return w.pixelHash(ctx);
            };
            const forward: Record<string, string> = {};
            for (const name of names) forward[name] = await hashOf(name, 7);
            const backward: Record<string, string> = {};
            for (const name of [...names].reverse()) backward[name] = await hashOf(name, 7);
            const reseeded: Record<string, string> = {};
            for (const name of names) reseeded[name] = await hashOf(name, 8);
            const blank = await w.pixelHash(w.freshCanvas(480, 320));
            return { forward, backward, reseeded, blank };
        }, MATERIALS);
        for (const name of MATERIALS) {
            expect(result.forward[name], name).not.toBe(result.blank);
            expect(result.backward[name], name).toBe(result.forward[name]);
        }
        for (const name of ['pencil', 'hatch', 'crossHatch', 'halftoneField', 'torn', 'stipple']) {
            expect(result.reseeded[name], name).not.toBe(result.forward[name]);
        }
    });

    it('keeps a stroke in place when the hatched box grows around it', async () => {
        const same = await page.page.evaluate(async () => {
            const w = window as unknown as Win;
            const inner = { x: 100, y: 100, width: 120, height: 80 };
            const clip = new Path2D();
            clip.rect(inner.x, inner.y, inner.width, inner.height);
            const small = w.freshCanvas(400, 300);
            w.rt.hatch(small, inner, { seed: 3, clip });
            const large = w.freshCanvas(400, 300);
            w.rt.hatch(large, { x: 0, y: 0, width: 400, height: 300 }, { seed: 3, clip });
            return (await w.pixelHash(small)) === (await w.pixelHash(large));
        });
        expect(same).toBe(true);
    });
});

describe('materials are fast enough for a frame', () => {
    it('hatches 3000 strokes over a 1080p canvas within 40 ms', async () => {
        const runs = await page.page.evaluate(() => {
            const w = window as unknown as Win;
            const ctx = w.rt.setupCanvas(document.createElement('canvas'), 1920, 1080);
            const box = { x: 0, y: 0, width: 1920, height: 1080 };
            const out: { ms: number; strokes: number }[] = [];
            for (let i = 0; i < 7; i++) {
                ctx.clearRect(0, 0, 1920, 1080);
                const start = w.realNow();
                const strokes = w.rt.hatch(ctx, box, {
                    seed: i + 1,
                    spacing: 25,
                    length: 22,
                    tone: 0.95,
                    angle: (x: number, y: number) => -0.9 + (x + y) / 4000,
                });
                ctx.getImageData(0, 0, 1, 1);
                out.push({ ms: w.realNow() - start, strokes });
            }
            return out;
        });
        for (const run of runs) expect(run.strokes).toBeGreaterThanOrEqual(3000);
        const sorted = runs.map((r) => r.ms).sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        process.stderr.write(`hatch 3000 strokes at 1080p: median ${median.toFixed(1)} ms\n`);
        expect(median, `per-run ms: ${sorted.map((ms) => ms.toFixed(1)).join(', ')}`).toBeLessThan(
            40,
        );
    });
});

describe('point helpers', () => {
    it('resamples a polyline to even steps and closes loops without a duplicate', () => {
        const line = resample(
            [
                [0, 0],
                [10, 0],
            ],
            2.5,
        );
        expect(line.map((p) => p[0])).toEqual([0, 2.5, 5, 7.5, 10]);
        const loop = resample(ellipsePoints(0, 0, 50, 30, 0, 32), 4, true);
        const first = loop[0];
        const last = loop[loop.length - 1];
        expect(Math.hypot(first[0] - last[0], first[1] - last[1])).toBeGreaterThan(2);
    });
});
