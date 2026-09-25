// Stop-motion helpers: boil (a seeded nudge per held drawing) and motionBlur
// (samples across the shutter, averaged). Both must stay pure functions of t.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CompositionPage } from '../src/engine/page.ts';
import { boil, fall } from '../src/runtime/motion.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps } from './helpers.ts';
import { installHelpers, runtimePage } from './runtimePage.ts';

describe('boil', () => {
    const fps = 24;

    it('holds for the frames of one drawing and moves on the next', () => {
        const a = boil(10 / fps, fps, { seed: 3 });
        expect(boil(11 / fps, fps, { seed: 3 })).toEqual(a);
        expect(boil(12 / fps, fps, { seed: 3 })).not.toEqual(a);
        expect(boil(12 / fps, fps, { seed: 3, every: 3 })).toEqual(
            boil(14 / fps, fps, { seed: 3, every: 3 }),
        );
    });

    it('stays within the amount and turn, and differs by seed', () => {
        for (let frame = 0; frame < 200; frame++) {
            const b = boil(frame / fps, fps, { seed: 'plate', amount: 2, turn: 0.5 });
            expect(Math.hypot(b.x, b.y)).toBeLessThanOrEqual(2 + 1e-9);
            expect(Math.abs(b.rotate)).toBeLessThanOrEqual((0.5 * Math.PI) / 180 + 1e-12);
        }
        expect(boil(1, fps, { seed: 1 })).not.toEqual(boil(1, fps, { seed: 2 }));
    });
});

describe('fall', () => {
    const base = { at: 1, x: 500, y: 100, seed: 'petal' };

    it('rests where it is until it lets go, then drops, sways and tumbles', () => {
        expect(fall(0.5, base)).toMatchObject({ x: 500, y: 100, flip: 1, falling: false });
        let lastY = 100;
        let minX = Infinity;
        let maxX = -Infinity;
        let edgeOn = false;
        for (let t = 1; t < 5; t += 1 / 24) {
            const p = fall(t, base);
            expect(p.y).toBeGreaterThanOrEqual(lastY);
            lastY = p.y;
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            expect(Math.abs(p.flip)).toBeLessThanOrEqual(1);
            if (Math.abs(p.flip) < 0.2) edgeOn = true;
        }
        // It sways sideways and turns edge-on at some point.
        expect(maxX - minX).toBeGreaterThan(40);
        expect(edgeOn).toBe(true);
        expect(lastY).toBeGreaterThan(400);
    });

    it('comes to rest lying flat on the floor', () => {
        const opts = { ...base, floor: 300 };
        const late = fall(20, opts);
        expect(late.y).toBe(300);
        expect(late.falling).toBe(false);
        expect(Math.abs(late.flip)).toBe(1);
        expect(fall(21, opts)).toEqual(late);
    });

    it('falls the same way for the same seed and another way for another', () => {
        expect(fall(2.5, base)).toEqual(fall(2.5, base));
        expect(fall(2.5, base)).not.toEqual(fall(2.5, { ...base, seed: 'leaf' }));
    });
});

let page: CompositionPage;

type Win = {
    rt: typeof import('../src/runtime/index.ts');
    freshCanvas(w: number, h: number): CanvasRenderingContext2D;
    pixelHash(ctx: CanvasRenderingContext2D): Promise<string>;
};

describe('motionBlur', () => {
    beforeAll(async () => {
        page = await runtimePage(await session(), 320, 200);
        await installHelpers(page);
    });

    afterAll(async () => {
        await page?.close();
        await closeSession();
        cleanTemps();
    });

    it('leaves a still picture as it is and smears a moving one, the same way every time', async () => {
        const result = await page.page.evaluate(async () => {
            const w = window as unknown as Win;
            const rt = w.rt;
            const square = (x: number) => (c: CanvasRenderingContext2D) => {
                c.fillStyle = '#c8452d';
                c.fillRect(x, 60, 40, 40);
            };
            const still = w.freshCanvas(320, 200);
            square(100)(still);
            const blurredStill = w.freshCanvas(320, 200);
            rt.motionBlur(blurredStill, 1, (ctx) => square(100)(ctx), { fps: 24 });
            const a = still.getImageData(0, 0, 320, 200).data;
            const b = blurredStill.getImageData(0, 0, 320, 200).data;
            let stillDiff = 0;
            for (let i = 0; i < a.length; i++)
                stillDiff = Math.max(stillDiff, Math.abs(a[i] - b[i]));

            // Moving 480 px a second: 10 px during a half-frame shutter at 24 fps.
            const moving = (c: CanvasRenderingContext2D, t: number) =>
                square(100 + (t - 1) * 480)(c);
            const run = () => {
                const c = w.freshCanvas(320, 200);
                rt.motionBlur(c, 1, (ctx, t) => moving(ctx, t), { fps: 24 });
                return c;
            };
            const first = run();
            const second = run();
            const row = first.getImageData(0, 80, 320, 1).data;
            const partial: number[] = [];
            for (let x = 0; x < 320; x++) {
                const alpha = row[x * 4 + 3];
                if (alpha > 0 && alpha < 250) partial.push(x);
            }
            return {
                stillDiff,
                same: (await w.pixelHash(first)) === (await w.pixelHash(second)),
                partial: partial.length,
            };
        });
        expect(result.stillDiff).toBeLessThanOrEqual(4);
        expect(result.same).toBe(true);
        // A soft edge a shutter's travel wide on each side of the square.
        expect(result.partial).toBeGreaterThanOrEqual(12);
    });
});
