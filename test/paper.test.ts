import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CompositionPage } from '../src/engine/page.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps } from './helpers.ts';
import { installHelpers, runtimePage } from './runtimePage.ts';

let page: CompositionPage;

beforeAll(async () => {
    page = await runtimePage(await session(), 960, 540);
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
};

describe('paper', () => {
    it('draws the same stock for the same options, whatever was drawn before', async () => {
        const hashes = await page.page.evaluate(async () => {
            const w = window as unknown as Win;
            const draw = async (options: Record<string, unknown>) => {
                const ctx = w.freshCanvas(960, 540);
                w.rt.drawPaper(ctx, 960, 540, options);
                return w.pixelHash(ctx);
            };
            const grid = { seed: 4, color: w.rt.PAPER.clay, grid: { major: 5 }, vignette: 0.6 };
            const first = await draw({ seed: 4 });
            const gridFirst = await draw(grid);
            const second = await draw({ seed: 4 });
            const gridSecond = await draw(grid);
            const other = await draw({ seed: 5 });
            return { first, second, gridFirst, gridSecond, other };
        });
        expect(hashes.second).toBe(hashes.first);
        expect(hashes.gridSecond).toBe(hashes.gridFirst);
        expect(hashes.other).not.toBe(hashes.first);
        expect(hashes.gridFirst).not.toBe(hashes.first);
    });

    it('draws the same grain overlay for the same options', async () => {
        const [a, b, c] = await page.page.evaluate(async () => {
            const w = window as unknown as Win;
            const draw = async (seed: number) => {
                const ctx = w.freshCanvas(960, 540);
                w.rt.drawGrain(ctx, 960, 540, { seed, vignette: 0.4 });
                return w.pixelHash(ctx);
            };
            return [await draw(9), await draw(9), await draw(10)];
        });
        expect(b).toBe(a);
        expect(c).not.toBe(a);
    });

    it('marks paperLayer and grainLayer as the paper layer, paper first and grain last', async () => {
        const layers = await page.page.evaluate(() => {
            const w = window as unknown as Win;
            const content = document.createElement('div');
            document.body.appendChild(content);
            const paper = w.rt.paperLayer(960, 540, { seed: 2 });
            const grain = w.rt.grainLayer(960, 540, { seed: 2 });
            const kids = Array.from(document.body.children).filter((el) => el.tagName !== 'SCRIPT');
            return {
                paper: paper.getAttribute('data-flipbook-layer'),
                grain: grain.getAttribute('data-flipbook-layer'),
                first: kids[0] === paper,
                last: kids[kids.length - 1] === grain,
            };
        });
        expect(layers).toEqual({ paper: 'paper', grain: 'paper', first: true, last: true });
    });
});
