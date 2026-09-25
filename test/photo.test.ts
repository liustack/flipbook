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
// A dark plate with three specimens: a thick ring that encloses a patch of
// the ground (like tentacles around dark water), a disc, and a small square.
window.specimenPlate = () => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 200;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0d3a12';
    ctx.fillRect(0, 0, 320, 200);
    ctx.strokeStyle = '#e8d8b0';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.arc(90, 100, 50, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#d9a441';
    ctx.beginPath();
    ctx.arc(220, 70, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c8452d';
    ctx.fillRect(250, 140, 24, 24);
    return c.toDataURL('image/png');
};
// The same plate printed inside a cream page margin with a caption, as scans of
// books come: the ground color is nowhere on the picture's edge.
window.framedPlate = () => {
    const inner = new Image();
    return new Promise((resolve) => {
        inner.onload = () => {
            const c = document.createElement('canvas');
            c.width = 360;
            c.height = 260;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#f1e7cf';
            ctx.fillRect(0, 0, 360, 260);
            ctx.drawImage(inner, 20, 20);
            // A thin rule around the printed field, as plates have.
            ctx.strokeStyle = '#6a7a50';
            ctx.lineWidth = 2;
            ctx.strokeRect(24, 24, 312, 192);
            ctx.fillStyle = '#3a2a1a';
            ctx.fillRect(120, 236, 120, 6);
            resolve(c.toDataURL('image/png'));
        };
        inner.src = window.specimenPlate();
    });
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
    specimenPlate(): string;
    framedPlate(): Promise<string>;
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

describe('photo on a crowded plate', () => {
    it('finds each specimen with a margin, largest first', async () => {
        const found = await page.page.evaluate(async () => {
            const w = window as unknown as Win;
            return w.rt.specimens(w.specimenPlate(), { paper: '#0d3a12' });
        });
        expect(found).toHaveLength(3);
        const px = found.map((f) => ({
            x0: f.crop.x * 320,
            y0: f.crop.y * 200,
            x1: (f.crop.x + f.crop.width) * 320,
            y1: (f.crop.y + f.crop.height) * 200,
        }));
        // The ring spans 32..148 x 42..158, the disc 190..250 x 40..100, the square 250..274 x 140..164.
        expect(px[0].x0).toBeLessThan(32);
        expect(px[0].x1).toBeGreaterThan(148);
        expect(px[0].y0).toBeLessThan(42);
        expect(px[0].y1).toBeGreaterThan(158);
        expect(px[0].x1).toBeLessThan(190);
        expect(px[1].x0).toBeLessThan(190);
        expect(px[1].x1).toBeGreaterThan(250);
        expect(px[2].x0).toBeLessThan(250);
        expect(px[2].y1).toBeGreaterThan(164);
        expect(found[0].area).toBeGreaterThan(found[1].area);
        expect(found[1].area).toBeGreaterThan(found[2].area);
    });

    it('finds them inside a page margin too, where the ground is not on the edge', async () => {
        const found = await page.page.evaluate(async () => {
            const w = window as unknown as Win;
            return w.rt.specimens(await w.framedPlate(), { paper: '#0d3a12' });
        });
        expect(found).toHaveLength(3);
        // The ring, now at 52..168 x 62..178 on a 360 x 260 page.
        expect(found[0].crop.x * 360).toBeLessThan(52);
        expect((found[0].crop.x + found[0].crop.width) * 360).toBeGreaterThan(168);
        expect((found[0].crop.x + found[0].crop.width) * 360).toBeLessThan(210);
    });

    it('returns nothing for a plate whose specimens are all joined up', async () => {
        const found = await page.page.evaluate(async () => {
            const w = window as unknown as Win;
            const c = document.createElement('canvas');
            c.width = 320;
            c.height = 200;
            const ctx = c.getContext('2d') as CanvasRenderingContext2D;
            ctx.fillStyle = '#0d3a12';
            ctx.fillRect(0, 0, 320, 200);
            // Spines from a middle body reaching every shell around it.
            ctx.strokeStyle = '#e8d8b0';
            ctx.lineWidth = 3;
            for (let a = 0; a < 12; a++) {
                ctx.beginPath();
                ctx.moveTo(160, 100);
                ctx.lineTo(160 + Math.cos(a) * 140, 100 + Math.sin(a) * 90);
                ctx.stroke();
            }
            ctx.fillStyle = '#e8d8b0';
            for (let a = 0; a < 12; a++) {
                ctx.beginPath();
                ctx.arc(160 + Math.cos(a) * 140, 100 + Math.sin(a) * 90, 10, 0, Math.PI * 2);
                ctx.fill();
            }
            return w.rt.specimens(c.toDataURL('image/png'), { paper: '#0d3a12' });
        });
        expect(found).toEqual([]);
    });

    it('says which sides of the crop cut through the subject', async () => {
        const out = await page.page.evaluate(async () => {
            const w = window as unknown as Win;
            const plate = w.specimenPlate();
            const [ring] = await w.rt.specimens(plate, { paper: '#0d3a12' });
            const whole = await w.rt.photo(plate, {
                crop: ring.crop,
                paper: '#0d3a12',
                sticker: false,
            });
            const cut = await w.rt.photo(plate, {
                crop: { x: 0.05, y: 0.05, width: 0.35, height: 0.9 },
                paper: '#0d3a12',
                sticker: false,
            });
            return { whole: whole.clipped, cut: cut.clipped };
        });
        expect(out.whole).toEqual([]);
        expect(out.cut).toEqual(['right']);
    });

    it('keeps only the largest piece, and clears ground enclosed by the subject', async () => {
        const out = await page.page.evaluate(async () => {
            const w = window as unknown as Win;
            const plate = w.specimenPlate();
            // The ring plus a slice of the disc beside it.
            const crop = { x: 0.05, y: 0.05, width: 0.65, height: 0.9 };
            const all = await w.rt.photo(plate, { crop, paper: '#0d3a12', sticker: false });
            const largest = await w.rt.photo(plate, {
                crop,
                paper: '#0d3a12',
                sticker: false,
                keep: 'largest',
            });
            const hollow = await w.rt.photo(plate, {
                crop,
                paper: '#0d3a12',
                sticker: false,
                keep: 'largest',
                holes: 0.05,
            });
            return {
                allWidth: all.width,
                largestWidth: largest.width,
                filledCenter: w.alphaAt(
                    largest.canvas,
                    Math.round(largest.width / 2),
                    Math.round(largest.height / 2),
                ),
                hollowCenter: w.alphaAt(
                    hollow.canvas,
                    Math.round(hollow.width / 2),
                    Math.round(hollow.height / 2),
                ),
            };
        });
        expect(out.allWidth).toBeGreaterThan(150);
        expect(out.largestWidth).toBeGreaterThanOrEqual(114);
        expect(out.largestWidth).toBeLessThanOrEqual(120);
        expect(out.filledCenter).toBe(255);
        expect(out.hollowCenter).toBe(0);
    });
});
