// The pixel work behind flipbook puppet: finding round joint tabs, measuring
// a printed outline and shaving it off. Plain arrays, no browser.
import { describe, expect, it } from 'vitest';
import { findTab, outlineWidth, shave } from '../src/runtime/rig.ts';

/** Alpha of a vertical bar `w` wide with round ends, in a `w + 2 * pad` by `h` picture. */
function bar(
    w: number,
    h: number,
    pad = 3,
): { alpha: Uint8ClampedArray; width: number; height: number } {
    const width = w + 2 * pad;
    const alpha = new Uint8ClampedArray(width * h);
    const r = w / 2;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < width; x++) {
            const cx = pad + r;
            const cy = Math.min(Math.max(y, pad + r), h - pad - r);
            if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) alpha[y * width + x] = 255;
        }
    }
    return { alpha, width, height: h };
}

describe('findTab', () => {
    it('finds the center of a round end from each side', () => {
        const b = bar(40, 160);
        const top = findTab(b.alpha, b.width, b.height, 'top');
        expect(top?.x).toBe(22.5);
        expect(top?.y).toBeGreaterThan(20);
        expect(top?.y).toBeLessThan(26);
        const bottom = findTab(b.alpha, b.width, b.height, 'bottom');
        expect(bottom?.y).toBeGreaterThan(160 - 26);
        expect(bottom?.y).toBeLessThan(160 - 20);
        // Lying on its side, the same bar has its tabs left and right.
        const t = new Uint8ClampedArray(b.alpha.length);
        for (let y = 0; y < b.height; y++)
            for (let x = 0; x < b.width; x++) t[x * b.height + y] = b.alpha[y * b.width + x];
        const left = findTab(t, b.height, b.width, 'left');
        expect(left?.y).toBe(22.5);
        expect(left?.x).toBeGreaterThan(20);
        expect(left?.x).toBeLessThan(26);
    });

    it('gives up on a slanted, pointed or ragged end: only a round one is a tab', () => {
        const width = 50;
        const height = 150;
        /** A bar 50 wide whose top edge, row by row, starts at `top(x)`. */
        const shaped = (top: (x: number) => number) => {
            const alpha = new Uint8ClampedArray(width * height);
            for (let y = 0; y < height; y++)
                for (let x = 0; x < width; x++) if (y >= top(x)) alpha[y * width + x] = 255;
            return alpha;
        };
        const slanted = shaped((x) => 5 + (width - x) * 0.8);
        const ragged = shaped((x) => 5 + ((x * 7) % 11));
        // Pointed ends of every slope, and a point off the pixel grid.
        const pointed = [0.5, 0.8, 1, 1.2, 2].map((s) => shaped((x) => 5 + Math.abs(x - 24.5) * s));
        const offGrid = shaped((x) => 5.4 + Math.abs(x - 24.1) * 0.6);
        for (const alpha of [slanted, ragged, offGrid, ...pointed]) {
            expect(findTab(alpha, width, height, 'top')).toBeNull();
        }
        // The same bar with a round top is found, and so is a flattened one, and
        // one with a hand's wobble along its edge.
        const circle = (x: number) => Math.sqrt(Math.max(0, 25 * 25 - (x + 0.5 - 25) ** 2));
        const round = shaped((x) => 30 - circle(x));
        const flattened = shaped((x) => 30 - 0.7 * circle(x));
        const wobbly = shaped((x) => 30 - circle(x) + Math.sin(x));
        for (const alpha of [round, flattened, wobbly]) {
            expect(findTab(alpha, width, height, 'top')?.x).toBeCloseTo(24.5, 0);
        }
    });

    it('gives up on a square end instead of guessing', () => {
        const width = 60;
        const height = 120;
        const alpha = new Uint8ClampedArray(width * height).fill(255);
        expect(findTab(alpha, width, height, 'top')).toBeNull();
        expect(findTab(new Uint8ClampedArray(width * height), width, height, 'top')).toBeNull();
    });
});

describe('outline', () => {
    /** RGBA of a filled rectangle with a dark border `k` px wide, inside a transparent margin. */
    function framed(k: number): { rgba: Uint8ClampedArray; width: number; height: number } {
        const width = 80;
        const height = 60;
        const rgba = new Uint8ClampedArray(width * height * 4);
        for (let y = 5; y < 55; y++) {
            for (let x = 5; x < 75; x++) {
                const edge = x < 5 + k || x >= 75 - k || y < 5 + k || y >= 55 - k;
                rgba.set(edge ? [20, 20, 20, 255] : [53, 80, 122, 255], (y * width + x) * 4);
            }
        }
        return { rgba, width, height };
    }

    it('measures a printed outline, and nothing where the edge is not dark', () => {
        for (const k of [3, 6, 9]) {
            const f = framed(k);
            expect(outlineWidth(f.rgba, f.width, f.height)).toBe(k);
        }
        const plain = framed(0);
        expect(outlineWidth(plain.rgba, plain.width, plain.height)).toBe(0);
    });

    it('counts a soft pixel on each side of the ink as half, as cutout leaves a 5 px line', () => {
        // Cut out, a 5 px line shows 4 px of ink between two blended pixels.
        const f = framed(6);
        const { rgba, width } = f;
        for (let y = 5; y < 55; y++) {
            for (let x = 5; x < 75; x++) {
                const ring = Math.min(x - 5, 74 - x, y - 5, 54 - y);
                if (ring === 0) rgba.set([102, 100, 98, 255], (y * width + x) * 4);
                if (ring === 5) rgba.set([83, 80, 90, 255], (y * width + x) * 4);
            }
        }
        expect(outlineWidth(rgba, width, f.height)).toBe(5);
    });

    it('shaves k px off every edge, the picture border counting as empty', () => {
        const width = 20;
        const height = 10;
        const alpha = new Uint8ClampedArray(width * height).fill(255);
        const out = shave(alpha, width, height, 2);
        expect(out[0]).toBe(0);
        expect(out[2 * width + 2]).toBe(255);
        expect(out[1 * width + 10]).toBe(0);
        expect(out[5 * width + 17]).toBe(255);
        expect(out[5 * width + 18]).toBe(0);
        expect(shave(alpha, width, height, 0)).toEqual(alpha);
    });
});
