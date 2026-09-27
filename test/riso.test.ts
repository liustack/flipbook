// Riso printing: tints screened to dots or grain, inks laid down by
// multiplying, never quite full, each plate a little off from the others.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CompositionPage } from '../src/engine/page.ts';
import { dotArea, screenPlate } from '../src/runtime/riso.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps } from './helpers.ts';
import { installHelpers, runtimePage } from './runtimePage.ts';

/** RGBA of a w by h plate at one density, and the share of pixels printed after screening. */
function printed(
    density: number,
    screen: 'halftone' | 'grain',
    seed = 1,
    grid: { cell: number; angle: number } = { cell: 8, angle: 15 },
    side = 200,
    inked?: Uint8Array,
): number {
    const w = side;
    const h = side;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data[i * 4 + 3] = Math.round(density * 255);
    screenPlate(data, w, h, screen, { ...grid, seed });
    // What printed at a lower level stays printed: counted, then checked once.
    if (inked) {
        let lost = 0;
        for (let i = 0; i < w * h; i++) {
            if (inked[i] && data[i * 4 + 3] !== 255) lost++;
            inked[i] = data[i * 4 + 3] === 255 ? 1 : 0;
        }
        expect(lost).toBe(0);
    }
    // Counted, then checked once: an expect per pixel runs millions of times across the levels.
    let on = 0;
    let between = 0;
    for (let i = 0; i < w * h; i++) {
        const a = data[i * 4 + 3];
        if (a === 255) on++;
        else if (a !== 0) between++;
    }
    expect(between).toBe(0);
    return on / (w * h);
}

describe('screening a plate', () => {
    it('prints a tint as the same share of dots or grain, all the way up to solid', () => {
        const tints = [0.2, 0.5, 0.8, 0.9, 0.95, 0.99, 254 / 255];
        for (const d of tints) {
            expect(Math.abs(printed(d, 'grain') - d)).toBeLessThan(0.02);
            for (const angle of [15, 45, 75]) {
                const got = printed(d, 'halftone', 1, { cell: 8, angle });
                expect(Math.abs(got - d), `${d} at ${angle} degrees`).toBeLessThan(0.01);
            }
        }
        // A grid square to the pixels has its pixels at the same spots in every
        // cell, ranked once: at every level it prints within half a pixel of a
        // cell of the density (a fiftieth of a 5 px cell), and no pixel that
        // printed stops printing further up. 10 and 16 are 5 and 8 at DPR 2.
        for (const angle of [0, 90]) {
            for (const cell of [5, 8, 10, 16]) {
                const inked = new Uint8Array(80 * 80);
                for (let level = 1; level < 255; level++) {
                    const d = level / 255;
                    const got = printed(d, 'halftone', 1, { cell, angle }, 80, inked);
                    expect(
                        Math.abs(got - d),
                        `${d} at ${angle} degrees, ${cell} px`,
                    ).toBeLessThanOrEqual(0.5 / (cell * cell) + 1e-9);
                }
            }
        }
    });

    it('ranks a square grid the same for every turn of one angle, whichever a page used first', async () => {
        // The ranking is kept for the page by cell and angle, so 0, 360 and -360
        // degrees share one. Each is ranked here in a module of its own: they
        // must agree, or what prints would hang on which of them came first.
        const side = 80;
        const all = async (angle: number, cell: number) => {
            vi.resetModules();
            const fresh = await import('../src/runtime/riso.ts');
            const out = new Uint8Array(254 * side * side);
            for (let level = 1; level < 255; level++) {
                const data = new Uint8ClampedArray(side * side * 4);
                for (let i = 0; i < side * side; i++) data[i * 4 + 3] = level;
                fresh.screenPlate(data, side, side, 'halftone', { cell, angle });
                for (let i = 0; i < side * side; i++)
                    out[(level - 1) * side * side + i] = data[i * 4 + 3];
            }
            return Buffer.from(out);
        };
        const turns = [
            [0, 360, -360, 720],
            [90, -270, 450],
            [180, -180, 540],
            [270, -90, 630],
        ];
        for (const cell of [8, 10]) {
            for (const [first, ...same] of turns) {
                const want = await all(first, cell);
                for (const angle of same) {
                    expect(
                        (await all(angle, cell)).equals(want),
                        `${angle} and ${first} degrees, ${cell} px`,
                    ).toBe(true);
                }
            }
        }
    });

    it('grows a dot by its area, cut off by the cell once it passes the sides', () => {
        expect(dotArea(0)).toBe(0);
        expect(dotArea(0.5)).toBeCloseTo(Math.PI / 4, 12);
        expect(dotArea(0.5 + 1e-9)).toBeCloseTo(Math.PI / 4, 6);
        expect(dotArea(Math.SQRT1_2)).toBe(1);
        expect(dotArea(Math.SQRT1_2 - 1e-9)).toBeCloseTo(1, 6);
        for (let r = 0.01; r < 0.72; r += 0.01)
            expect(dotArea(r)).toBeGreaterThan(dotArea(r - 0.01));
    });

    it('leaves solids and empty paper alone, and gives the same grain for the same seed', () => {
        expect(printed(1, 'grain')).toBe(1);
        expect(printed(0, 'halftone')).toBe(0);
        expect(printed(0.4, 'grain', 3)).toBe(printed(0.4, 'grain', 3));
        expect(printed(0.4, 'grain', 3)).not.toBe(printed(0.4, 'grain', 4));
    });
});

describe('riso in the page', () => {
    let page: CompositionPage;

    beforeAll(async () => {
        page = await runtimePage(await session(), 200, 120);
        await installHelpers(page);
    });

    afterAll(async () => {
        await page?.close();
        await closeSession();
        cleanTemps();
    });

    it('multiplies overlapping inks and never lays a solid down full', async () => {
        const result = (await page.page.evaluate(`(() => {
            const flat = { mottle: 0, misregister: 0, jitter: 0 };
            const inks = { pink: { color: '#FF48B0', screen: 'solid' }, blue: { color: '#0078BF', screen: 'solid' } };
            const px = (ctx, x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
            const pull = (coverage) => {
                const ctx = freshCanvas(200, 120);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, 200, 120);
                rt.riso(200, 120, { ...flat, coverage, inks }).print(ctx, (p) => {
                    p.pink.fillRect(20, 20, 100, 80);
                    p.blue.fillRect(80, 20, 100, 80);
                });
                return { pink: px(ctx, 40, 60), both: px(ctx, 100, 60), blue: px(ctx, 160, 60), paper: px(ctx, 190, 110) };
            };
            return { full: pull(1), capped: pull(0.8) };
        })()`)) as Record<string, Record<string, number[]>>;
        const near = (a: number[], b: number[]) => {
            for (const [i, v] of a.entries()) expect(Math.abs(v - b[i])).toBeLessThanOrEqual(3);
        };
        near(result.full.pink, [255, 72, 176]);
        near(result.full.blue, [0, 120, 191]);
        // Where both print: the product of the two inks.
        near(result.full.both, [0, Math.round((72 * 120) / 255), Math.round((176 * 191) / 255)]);
        near(result.full.paper, [255, 255, 255]);
        // At 80% the paper shows through a fifth of the way.
        near(result.capped.pink, [
            255,
            Math.round(255 - 0.8 * (255 - 72)),
            Math.round(255 - 0.8 * (255 - 176)),
        ]);
    });

    it('sets each plate off by its own fixed amount, wandering a little with each drawing', async () => {
        const r = (await page.page.evaluate(`(() => {
            const press = rt.riso(200, 120, { seed: 4, misregister: 3, jitter: 1, inks: { a: '#FF48B0', b: '#0078BF' } });
            const other = rt.riso(200, 120, { seed: 4, misregister: 3, jitter: 0, inks: { a: '#FF48B0', b: '#0078BF' } });
            return {
                a0: press.offset('a', 0), a0again: press.offset('a', 0), a1: press.offset('a', 0.5),
                b0: press.offset('b', 0), still0: other.offset('a', 0), still1: other.offset('a', 2),
            };
        })()`)) as Record<string, { x: number; y: number }>;
        expect(r.a0again).toEqual(r.a0);
        expect(r.a1).not.toEqual(r.a0);
        expect(r.b0).not.toEqual(r.a0);
        expect(r.still0).toEqual(r.still1);
        const off = Math.hypot(r.still0.x, r.still0.y);
        expect(off).toBeGreaterThanOrEqual(1.5);
        expect(off).toBeLessThanOrEqual(3);
        expect(Math.hypot(r.a1.x - r.still0.x, r.a1.y - r.still0.y)).toBeLessThanOrEqual(
            Math.SQRT2,
        );
    });

    it('prints the same pixels for the same drawing and t, whatever it printed before', async () => {
        const same = await page.page.evaluate(`(async () => {
            const press = rt.riso(200, 120, { seed: 2, inks: { pink: '#FF48B0', blue: { color: '#0078BF', screen: 'halftone' } } });
            const ctx = freshCanvas(200, 120);
            const pull = async (t, x) => {
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.fillStyle = '#f4efe4';
                ctx.fillRect(0, 0, 200, 120);
                press.print(ctx, (p) => {
                    p.pink.globalAlpha = 0.5;
                    p.pink.fillRect(x, 10, 80, 90);
                    p.blue.arc(120, 60, 40, 0, Math.PI * 2);
                    p.blue.fill();
                    // No beginPath: the press hands each plate over with an empty path.
                    p.pink.rect(x, 100, 20, 10);
                    p.pink.fill();
                }, { t });
                return pixelHash(ctx);
            };
            const first = await pull(1, 30);
            await pull(2, 60);
            await pull(0.25, 10);
            return first === (await pull(1, 30));
        })()`);
        expect(same).toBe(true);
    });

    it('names what is wrong', async () => {
        const errors = (await page.page.evaluate(`(() => {
            const tries = [
                () => rt.riso(10, 10, { inks: {} }),
                () => rt.riso(10, 10, { inks: { pink: 'hotpink' } }),
                () => rt.riso(10, 10, { inks: { pink: '#FF48B0' } }).offset('blue'),
            ];
            return tries.map((f) => { try { f(); return 'ok'; } catch (e) { return e.message; } });
        })()`)) as string[];
        expect(errors[0]).toContain('at least one ink');
        expect(errors[1]).toContain('ink "pink" needs a color as #rrggbb');
        expect(errors[2]).toContain('no ink "blue" (inks: pink)');
    });
});
