// Puppets from pictures: find the round joint tabs on cut parts, measure and
// shave their printed outline, and load the rig `flipbook puppet` writes.
// The pixel functions work on plain arrays, so they run in the page and in tests.

import type { PuppetBone, PuppetPart } from './puppet.ts';

export type Side = 'top' | 'bottom' | 'left' | 'right';

/** Alpha above this counts as part of the picture. */
const SOLID = 128;
/** The smallest tab radius told apart from a corner, in px. */
const MIN_TAB = 4;

/** The opaque run in row `line` of `mask` that holds `cx`, or the nearest one. */
function runAt(mask: (i: number) => boolean, length: number, cx: number): [number, number] | null {
    let best: [number, number] | null = null;
    let bestGap = Infinity;
    let start = -1;
    for (let i = 0; i <= length; i++) {
        const on = i < length && mask(i);
        if (on && start < 0) start = i;
        if (!on && start >= 0) {
            const end = i - 1;
            const gap = cx < start ? start - cx : cx > end ? cx - end : 0;
            if (gap < bestGap) {
                best = [start, end];
                bestGap = gap;
            }
            start = -1;
        }
    }
    return best;
}

/**
 * The round tab at one end of a part: walk in from `side`, following the run
 * of pixels that touches the one before, and stop where the chord across the
 * run is no wider than twice the depth. For a disc of radius r that happens at
 * depth r, on its center. The rows above must then trace a circle of that
 * radius, with their middles on one line: a square, slanted, pointed or
 * ragged end does not. Returns null when no round end shows before a third of
 * the way in: give the point by hand. Tabs under about 8 px across are too
 * small to tell apart from a corner, and are left to hand too.
 */
export function findTab(
    alpha: ArrayLike<number>,
    width: number,
    height: number,
    side: Side,
): { x: number; y: number; r: number } | null {
    const across = side === 'top' || side === 'bottom' ? width : height;
    const along = side === 'top' || side === 'bottom' ? height : width;
    const at = (a: number, b: number) => {
        // a runs across the side, b walks in from it.
        const x = side === 'top' || side === 'bottom' ? a : side === 'left' ? b : width - 1 - b;
        const y = side === 'left' || side === 'right' ? a : side === 'top' ? b : height - 1 - b;
        return alpha[y * width + x] > SOLID;
    };
    let start = -1;
    for (let b = 0; b < along && start < 0; b++) {
        for (let a = 0; a < across; a++) {
            if (at(a, b)) {
                start = b;
                break;
            }
        }
    }
    if (start < 0) return null;
    let run = runAt((a) => at(a, start), across, across / 2);
    if (!run) return null;
    let cx = (run[0] + run[1]) / 2;
    const chords = [run[1] - run[0] + 1];
    const middles = [cx];
    for (let d = 1; start + d < along && d < along / 3; d++) {
        run = runAt((a) => at(a, start + d), across, cx);
        if (!run) return null;
        cx = (run[0] + run[1]) / 2;
        const chord = run[1] - run[0] + 1;
        chords.push(chord);
        middles.push(cx);
        if (chord <= 2 * d) {
            // Too shallow to judge: a speck at the tip, or a wobble. Keep going.
            if (d < MIN_TAB) continue;
            // Every row above must be about as wide as a circle of radius d is
            // there, and centered where this one is. Near the tip a point is much
            // narrower than a circle (it widens evenly, a circle fast at first):
            // hand-drawn tabs come out as wide or wider there.
            let off = 0;
            let drift = 0;
            let narrow = 0;
            const tip = Math.max(1, Math.ceil(d / 4));
            for (let k = 1; k < d; k++) {
                const expected = 2 * Math.sqrt(d * d - (d - k) * (d - k));
                off += Math.abs(chords[k] - expected);
                if (k <= tip) narrow += (expected - chords[k]) / expected;
                if (k >= d / 3) drift = Math.max(drift, Math.abs(middles[k] - cx));
            }
            if (off / (d - 1) > 0.2 * 2 * d || narrow / tip > 0.2) return null;
            if (drift > Math.max(1.5, 0.25 * d)) return null;
            const depth = start + d;
            const point =
                side === 'top'
                    ? { x: cx, y: depth }
                    : side === 'bottom'
                      ? { x: cx, y: height - 1 - depth }
                      : side === 'left'
                        ? { x: depth, y: cx }
                        : { x: width - 1 - depth, y: cx };
            return { ...point, r: d };
        }
    }
    return null;
}

/**
 * Width in px of a printed outline: along rows and columns through the middle
 * of the picture (away from the ends, where a walk would run along the border
 * itself), the dark pixels met walking in from the edge, the median of the runs
 * found, rounded up. A soft pixel on either side of the ink, half ink and half
 * paper or fill, counts as half. A run only counts when lighter fill follows
 * it and it is at most a quarter of the picture's shorter side: a part that is dark all
 * through (a boot, a silhouette) has no outline to measure. 0 when no edge
 * is an outline: nothing to shave.
 */
export function outlineWidth(rgba: ArrayLike<number>, width: number, height: number): number {
    const runs: number[] = [];
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
    const value = (x: number, y: number) => {
        const i = (y * width + x) * 4;
        return Math.max(rgba[i], rgba[i + 1], rgba[i + 2]);
    };
    const solid = (x: number, y: number) => rgba[(y * width + x) * 4 + 3] > SOLID;
    const dark = (x: number, y: number) => solid(x, y) && value(x, y) < 80;
    const walk = (x0: number, y0: number, dx: number, dy: number) => {
        let x = x0;
        let y = y0;
        while (inside(x, y) && !solid(x, y)) {
            x += dx;
            y += dy;
        }
        let n = 0;
        let soft = 0;
        let fill = false;
        while (inside(x, y) && solid(x, y)) {
            if (dark(x, y)) n += 1;
            else if (n === 0 && soft < 2) soft += 1;
            else {
                fill = n > 0;
                break;
            }
            x += dx;
            y += dy;
        }
        if (!fill || n > Math.min(width, height) / 4) return;
        // The pixel after the ink is soft when it is darker than the fill beyond it.
        const fx = x + 2 * dx;
        const fy = y + 2 * dy;
        if (inside(x, y) && inside(fx, fy) && solid(fx, fy) && value(x, y) < value(fx, fy) - 20)
            soft += 1;
        runs.push(n + soft / 2);
    };
    const step = Math.max(1, Math.floor(Math.min(width, height) / 40));
    for (let y = Math.floor(height * 0.2); y < height * 0.8; y += step) {
        walk(0, y, 1, 0);
        walk(width - 1, y, -1, 0);
    }
    for (let x = Math.floor(width * 0.2); x < width * 0.8; x += step) {
        walk(x, 0, 0, 1);
        walk(x, height - 1, 0, -1);
    }
    if (runs.length < 8) return 0;
    runs.sort((a, b) => a - b);
    return Math.ceil(runs[Math.floor(runs.length / 2)]);
}

/**
 * Alpha with `k` px shaved off every edge: a square erosion, treating
 * everything past the picture's border as empty, so a part that touches the
 * border of its file loses its outline there too.
 */
export function shave(
    alpha: ArrayLike<number>,
    width: number,
    height: number,
    k: number,
): Uint8ClampedArray {
    if (!Number.isInteger(k) || k < 0)
        throw new Error(`shave: k must be a whole number, 0 or more (got ${k})`);
    const out = new Uint8ClampedArray(width * height);
    if (k === 0) {
        for (let i = 0; i < out.length; i++) out[i] = alpha[i];
        return out;
    }
    // Rows, then columns: the minimum over a (2k + 1) square is separable.
    const rows = new Uint8ClampedArray(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let m = 255;
            for (let dx = -k; dx <= k && m > 0; dx++) {
                const xx = x + dx;
                m = xx < 0 || xx >= width ? 0 : Math.min(m, alpha[y * width + xx]);
            }
            rows[y * width + x] = m;
        }
    }
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            let m = 255;
            for (let dy = -k; dy <= k && m > 0; dy++) {
                const yy = y + dy;
                m = yy < 0 || yy >= height ? 0 : Math.min(m, rows[yy * width + x]);
            }
            out[y * width + x] = m;
        }
    }
    return out;
}

export interface RigFile {
    version: 1;
    parts: Record<
        string,
        {
            file: string;
            width: number;
            height: number;
            pivot: [number, number];
            sockets?: Record<string, [number, number]>;
            angle?: number;
            fit?: [number, number];
        }
    >;
    bones: PuppetBone[];
}

/**
 * Load a rig written by `flipbook puppet`: its parts, ready for puppet(), and
 * its bones. `url` is the rig.json path in the composition, such as
 * 'assets/puppets/postman/rig.json'.
 */
export async function loadRig(
    url: string,
): Promise<{ parts: Record<string, PuppetPart>; bones: PuppetBone[] }> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`loadRig: ${url} answered ${response.status}`);
    const rig = (await response.json()) as RigFile;
    const parts: Record<string, PuppetPart> = {};
    await Promise.all(
        Object.entries(rig.parts).map(async ([name, p]) => {
            const img = new Image();
            img.src = `/${p.file}`;
            await img.decode();
            parts[name] = {
                canvas: img,
                width: p.width,
                height: p.height,
                pivot: p.pivot,
                sockets: p.sockets,
                angle: p.angle,
                fit: p.fit,
            };
        }),
    );
    return { parts, bones: rig.bones };
}
