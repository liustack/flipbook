// photo(): the paper and alpha cutouts, trimming, the sticker border and
// shadow, and determinism, on images drawn in the page itself.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CompositionPage } from '../src/engine/page.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps } from './helpers.ts';
import { installHelpers, runtimePage } from './runtimePage.ts';

let page: CompositionPage;

beforeAll(async () => {
    page = await runtimePage(await session(), 640, 360);
    await installHelpers(page);
    await page.page.addScriptTag({
        content: `
// A scanned plate: warm paper with a little grain, one dark egg with a pale
// highlight inside it, a speck of dirt and a thin caption line.
window.plate = () => {
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = 180;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#efe6d2';
    ctx.fillRect(0, 0, 240, 180);
    for (let i = 0; i < 400; i++) {
        const x = window.rt.rand(1, i, 'x') * 240;
        const y = window.rt.rand(1, i, 'y') * 180;
        ctx.fillStyle = 'rgba(120, 100, 70, 0.08)';
        ctx.fillRect(x, y, 1, 1);
    }
    ctx.fillStyle = '#6b4a2e';
    ctx.beginPath();
    ctx.ellipse(120, 90, 60, 40, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#efe6d2';
    ctx.beginPath();
    ctx.arc(120, 90, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3a2a1a';
    ctx.fillRect(20, 20, 3, 3);
    return c.toDataURL('image/png');
};
// A transparent PNG: an opaque 80x50 block in the middle of 200x100.
window.cutPng = () => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 100;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#2a6f97';
    ctx.fillRect(60, 25, 80, 50);
    return c.toDataURL('image/png');
};
window.alphaAt = (canvas, x, y) =>
    canvas.getContext('2d').getImageData(x, y, 1, 1).data[3];
window.rgbaAt = (canvas, x, y) =>
    Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data);
`,
    });
});

afterAll(async () => {
    await page?.close();
    await closeSession();
    cleanTemps();
});

type Rt = typeof import('../src/runtime/index.ts');
type Win = {
    rt: Rt;
    plate(): string;
    cutPng(): string;
    alphaAt(canvas: HTMLCanvasElement, x: number, y: number): number;
    rgbaAt(canvas: HTMLCanvasElement, x: number, y: number): number[];
    freshCanvas(w: number, h: number): CanvasRenderingContext2D;
    pixelHash(ctx: CanvasRenderingContext2D): Promise<string>;
};

describe('photo cutout', () => {
    it('removes light paper around the subject, keeps pale areas inside it and drops specks', async () => {
        const out = await page.page.evaluate(async () => {
            const w = window as unknown as Win;
            const p = await w.rt.photo(w.plate(), { sticker: false });
            const c = p.canvas;
            return {
                cutout: p.cutout,
                width: p.width,
                height: p.height,
                canvas: [c.width, c.height],
                center: w.alphaAt(c, Math.round(c.width / 2), Math.round(c.height / 2)),
                corner: w.alphaAt(c, 0, 0),
                paper: p.paper,
            };
        });
        expect(out.cutout).toBe('paper');
        // Trimmed to the egg: 120 x 80, give or take the soft edge.
        expect(out.width).toBeGreaterThanOrEqual(118);
        expect(out.width).toBeLessThanOrEqual(124);
        expect(out.height).toBeGreaterThanOrEqual(78);
        expect(out.height).toBeLessThanOrEqual(84);
        expect(out.canvas).toEqual([out.width, out.height]);
        expect(out.center).toBe(255);
        expect(out.corner).toBe(0);
        expect(out.paper).toMatch(/^#e[c-f]e[3-7]d[0-3]$/);
    });

    it('keeps a pale subject opaque when its color falls in the soft edge band', async () => {
        const out = await page.page.evaluate(async () => {
            const w = window as unknown as Win;
            const c = document.createElement('canvas');
            c.width = 200;
            c.height = 160;
            const ctx = c.getContext('2d') as CanvasRenderingContext2D;
            ctx.fillStyle = '#efe6d2';
            ctx.fillRect(0, 0, 200, 160);
            // 54 levels from the paper: above the threshold, below threshold + softness.
            ctx.fillStyle = '#b9c7b0';
            ctx.fillRect(50, 40, 100, 80);
            ctx.fillStyle = '#e8eee2';
            ctx.fillRect(90, 70, 20, 20);
            const p = await w.rt.photo(c.toDataURL('image/png'), { sticker: false });
            return {
                size: [p.width, p.height],
                body: w.alphaAt(p.canvas, 10, 10),
                highlight: w.alphaAt(p.canvas, 50, 40),
            };
        });
        expect(out.size).toEqual([100, 80]);
        expect(out.body).toBe(255);
        expect(out.highlight).toBe(255);
    });

    it('uses the file transparency when there is any', async () => {
        const out = await page.page.evaluate(async () => {
            const w = window as unknown as Win;
            const p = await w.rt.photo(w.cutPng(), { sticker: false });
            return { cutout: p.cutout, width: p.width, height: p.height, paper: p.paper };
        });
        expect(out).toEqual({ cutout: 'alpha', width: 80, height: 50, paper: null });
    });

    it('keeps the whole rectangle with cutout none', async () => {
        const out = await page.page.evaluate(async () => {
            const w = window as unknown as Win;
            const p = await w.rt.photo(w.plate(), { cutout: 'none', sticker: false });
            return { width: p.width, height: p.height, corner: w.alphaAt(p.canvas, 0, 0) };
        });
        expect(out).toEqual({ width: 240, height: 180, corner: 255 });
    });

    it('scales the finished cutout so its long edge is size', async () => {
        const out = await page.page.evaluate(async () => {
            const w = window as unknown as Win;
            const p = await w.rt.photo(w.plate(), { size: 60, sticker: false });
            return { width: p.width, height: p.height };
        });
        expect(out.width).toBe(60);
        expect(out.height).toBeGreaterThanOrEqual(39);
        expect(out.height).toBeLessThanOrEqual(42);
    });

    it('cuts a region out of a larger plate first', async () => {
        const out = await page.page.evaluate(async () => {
            const w = window as unknown as Win;
            const p = await w.rt.photo(w.plate(), {
                crop: { x: 0, y: 0, width: 0.5, height: 1 },
                sticker: false,
            });
            return { width: p.width, height: p.height };
        });
        // The left half of the egg, 60 x 80.
        expect(out.width).toBeGreaterThanOrEqual(58);
        expect(out.width).toBeLessThanOrEqual(63);
        expect(out.height).toBeGreaterThanOrEqual(78);
    });
});

describe('photo sticker', () => {
    it('grows a border of the given width around the cutout', async () => {
        const out = await page.page.evaluate(async () => {
            const w = window as unknown as Win;
            const bare = await w.rt.photo(w.plate(), { sticker: false });
            const p = await w.rt.photo(w.plate(), {
                sticker: { border: 10, color: '#ffffff', tilt: 0, shadow: false, grain: 0 },
            });
            const c = p.canvas;
            const midY = Math.round(c.height / 2);
            // Walk in from the left edge to the first opaque border pixel.
            let edge = 0;
            while (edge < c.width && w.alphaAt(c, edge, midY) < 128) edge++;
            return {
                bare: [bare.width, bare.height],
                size: [p.width, p.height],
                tilt: p.tilt,
                edge,
                border: w.rgbaAt(c, edge + 4, midY),
                photo: w.rgbaAt(c, edge + 16, midY),
            };
        });
        expect(out.size).toEqual([out.bare[0] + 20, out.bare[1] + 20]);
        expect(out.tilt).toBe(0);
        expect(out.edge).toBeLessThanOrEqual(1);
        expect(out.border).toEqual([255, 255, 255, 255]);
        expect(out.photo[0]).toBeLessThan(140);
    });

    it('prepares the same pixels for the same options, and other grain for another seed', async () => {
        const out = await page.page.evaluate(async () => {
            const w = window as unknown as Win;
            const hash = async (seed: number) => {
                const p = await w.rt.photo(w.plate(), { sticker: { seed } });
                return {
                    hash: await w.pixelHash(p.canvas.getContext('2d') as CanvasRenderingContext2D),
                    tilt: p.tilt,
                };
            };
            return [await hash(3), await hash(3), await hash(4)];
        });
        expect(out[1]).toEqual(out[0]);
        expect(out[2].hash).not.toBe(out[0].hash);
        expect(Math.abs(out[0].tilt)).toBeLessThanOrEqual(4);
    });

    it('draws centered at a point with its tilt and a shadow below', async () => {
        const out = await page.page.evaluate(async () => {
            const w = window as unknown as Win;
            const p = await w.rt.photo(w.plate(), {
                sticker: { tilt: 0, shadow: { x: 0, y: 12, blur: 4 }, grain: 0 },
            });
            const ctx = w.freshCanvas(400, 300);
            p.draw(ctx, 200, 150);
            const at = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
            const half = p.height / 2;
            return {
                center: at(200, 150),
                above: at(200, Math.floor(150 - half - 8)),
                shadow: at(200, Math.ceil(150 + half + 4)),
                far: at(5, 5),
            };
        });
        expect(out.center[3]).toBe(255);
        expect(out.above[3]).toBe(0);
        expect(out.shadow[3]).toBeGreaterThan(20);
        expect(out.far[3]).toBe(0);
    });
});
