// Frame-by-frame sprites: which drawing shows at t, how far a walk has gone,
// where a figure's head and soles are, and where draw() puts the anchor.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CompositionPage } from '../src/engine/page.ts';
import {
    groundRuns,
    measureFrame,
    plantedWalk,
    readingOrder,
    type SpriteFrame,
    sprite,
    walkStride,
} from '../src/runtime/sprite.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps } from './helpers.ts';
import { installHelpers, runtimePage } from './runtimePage.ts';

const frame = (w = 10): SpriteFrame => ({
    canvas: {} as CanvasImageSource,
    width: w,
    height: 20,
    anchor: [5, 20],
});

describe('sprite', () => {
    const s = sprite(
        {
            walk: { frames: [frame(), frame(), frame(), frame()], fps: 8, loop: true, stride: 100 },
            wave: { frames: [frame(), frame(), frame()] },
        },
        { scale: 2 },
    );

    it('shows one drawing per 1/fps, looping or holding the last', () => {
        expect([0, 0.124, 0.125, 0.375, 0.5, 0.625].map((t) => s.frameAt('walk', t))).toEqual([
            0, 0, 1, 3, 0, 1,
        ]);
        // Default 8 a second, held on the last drawing.
        expect([0, 0.25, 0.375, 5].map((t) => s.frameAt('wave', t))).toEqual([0, 2, 2, 2]);
        expect(s.frameAt('walk', -1)).toBe(0);
        expect(s.duration('walk')).toBe(0.5);
    });

    it('moves a walk by the stride per pass, one drawing at a time', () => {
        // A pass is 4 drawings, 100 px at scale 2: 50 px a drawing.
        expect(s.distance('walk', 0)).toBe(0);
        expect(s.distance('walk', 0.124)).toBe(0);
        expect(s.distance('walk', 0.125)).toBe(50);
        expect(s.distance('walk', 1)).toBe(400);
    });

    it('names what is missing', () => {
        expect(() => s.frameAt('run', 0)).toThrow('no clip "run" (clips: walk, wave)');
        expect(() => s.distance('wave', 1)).toThrow('has no stride');
        expect(() => sprite({ none: { frames: [] } })).toThrow('clip "none" has no frames');
        expect(() => sprite({ bad: { frames: [frame()], fps: 0 } })).toThrow('needs fps above 0');
    });
});

describe('measuring drawings', () => {
    it('finds the head, the soles and the feet of a figure', () => {
        // A 20 x 40 picture: head rows 2 to 7 at x 8 to 11, body, feet at x 3 and 15 on row 37.
        const w = 20;
        const h = 40;
        const alpha = new Uint8ClampedArray(w * h);
        const fill = (x0: number, y0: number, x1: number, y1: number) => {
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) alpha[y * w + x] = 255;
        };
        fill(8, 2, 11, 7);
        fill(9, 8, 10, 30);
        fill(3, 31, 5, 37);
        fill(15, 31, 17, 37);
        expect(measureFrame(alpha, w, h)).toEqual({ top: 2, base: 37, headX: 9.5, feet: [3, 17] });
        expect(measureFrame(new Uint8ClampedArray(w * h), w, h)).toBeNull();
    });

    it('puts boxes in reading order, row by row', () => {
        const box = (id: string, x: number, y: number) => ({ id, x, y, width: 10, height: 20 });
        const shuffled = [box('d', 30, 42), box('b', 30, 1), box('a', 0, 3), box('c', 2, 40)];
        expect(readingOrder(shuffled).map((b) => b.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('guesses two steps a cycle from the feet when the planted foot cannot be followed', () => {
        expect(
            walkStride([
                [0, 60],
                [10, 30],
                [0, 58],
                [12, 32],
            ]),
        ).toBe(80);
    });

    it('finds where a drawing touches the ground', () => {
        // 30 wide, 10 tall: a foot at x 2 to 8 on the bottom rows, another at 20 to 27 two rows up.
        const w = 30;
        const h = 10;
        const alpha = new Uint8ClampedArray(w * h);
        for (let x = 2; x <= 8; x++) alpha[9 * w + x] = 255;
        for (let x = 20; x <= 27; x++) alpha[7 * w + x] = 255;
        expect(groundRuns(alpha, w, h, 3)).toEqual([
            [2, 8],
            [20, 27],
        ]);
        expect(groundRuns(alpha, w, h, 1)).toEqual([[2, 8]]);
    });
});

describe('plantedWalk', () => {
    // Feet relative to the head, drawing by drawing: the planted foot moves back
    // 16 px a drawing, the other swings forward (lifted, so not on the ground).
    const even: [number, number][][] = [
        [
            [-24, -8],
            [8, 24],
        ],
        [[-8, 8]],
        [
            [-24, -8],
            [8, 24],
        ],
        [[-8, 8]],
    ];

    it('gives the even advance and no nudge when the drawings keep the foot in step', () => {
        const walk = plantedWalk(even, 100) as { advance: number; nudges: number[] };
        expect(walk.advance).toBe(16);
        for (const e of walk.nudges) expect(Math.abs(e)).toBeLessThan(1e-9);
    });

    it('shifts a drawing that puts the planted foot off, so the foot stays put', () => {
        // Drawing 2 draws its planted foot 12 px too far back.
        const off = even.map((runs, i) =>
            runs.map(([l, r]) => (i === 1 ? [l - 12, r - 12] : [l, r]) as [number, number]),
        );
        const walk = plantedWalk(off, 100) as { advance: number; nudges: number[] };
        expect(walk.advance).toBe(16);
        // After shifting, the foot moves back exactly the advance each time.
        const fixed = off.map((runs, i) =>
            runs.map(([l, r]) => [l - walk.nudges[i], r - walk.nudges[i]]),
        );
        const mid = (run: number[]) => (run[0] + run[1]) / 2;
        expect(mid(fixed[0][1]) - mid(fixed[1][0])).toBeCloseTo(16, 9);
        expect(mid(fixed[1][0]) - mid(fixed[2][0])).toBeCloseTo(16, 9);
        expect(walk.nudges[1] - walk.nudges[0]).toBeCloseTo(-12, 9);
    });

    it('gives up when no foot could be the planted one, or the feet do not move back', () => {
        expect(plantedWalk([[[0, 10]], [[60, 70]]], 100)).toBeNull();
        // A sole that turns from 10 px to 40 px wide is not the same foot.
        expect(plantedWalk([[[0, 10]], [[-20, 20]]], 100, false)).toBeNull();
        // Feet moving forward a little each drawing: a walk backward, not followed.
        expect(plantedWalk([[[0, 10]], [[4, 14]], [[8, 18]]], 100, false)).toBeNull();
    });
});

describe('sprite in the page', () => {
    let page: CompositionPage;

    beforeAll(async () => {
        page = await runtimePage(await session(), 200, 100);
        await installHelpers(page);
    });

    afterAll(async () => {
        await page?.close();
        await closeSession();
        cleanTemps();
    });

    it('puts the anchor at (x, y), and mirrors around x when flipped', async () => {
        const result = (await page.page.evaluate(`(() => {
            // A 20 x 30 drawing: red on the left half, blue on the right, anchor at its bottom middle.
            const pic = document.createElement('canvas');
            pic.width = 20;
            pic.height = 30;
            const g = pic.getContext('2d');
            g.fillStyle = '#ff0000';
            g.fillRect(0, 0, 10, 30);
            g.fillStyle = '#0000ff';
            g.fillRect(10, 0, 10, 30);
            const s = rt.sprite({ still: { frames: [{ canvas: pic, width: 20, height: 30, anchor: [10, 30] }] } }, { scale: 2 });
            const at = (flip) => {
                const ctx = freshCanvas(200, 100);
                s.draw(ctx, 100, 80, { clip: 'still', t: 0, flip });
                const px = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
                return [px(85, 50), px(115, 50), px(100, 15), px(100, 85)];
            };
            return [at(false), at(true)];
        })()`)) as number[][][];
        // Scale 2: 40 x 60 from x 80 to 120, y 20 to 80.
        expect(result[0]).toEqual([
            [255, 0, 0],
            [0, 0, 255],
            [0, 0, 0],
            [0, 0, 0],
        ]);
        expect(result[1].slice(0, 2)).toEqual([
            [0, 0, 255],
            [255, 0, 0],
        ]);
    });
});
