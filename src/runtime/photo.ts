// photo(): a picture from the composition's assets, cut from its background
// and made into a paper sticker. Transparent files keep their own alpha. A
// scan on light paper loses the paper by color distance: only paper connected
// to the picture's edge goes, so pale areas inside the subject stay, and small
// islands (dust, caption letters) are dropped. The sticker is a border grown
// from the cutout by an exact distance transform, a seeded tilt, a soft
// shadow and a paper grain over everything. All of it runs once, before the
// first frame, on the CPU: the same file gives the same pixels every time.
import { hex, rgb } from './color.ts';
import { hash32, rand } from './core/random.ts';
import { ihash, vnoise } from './hash.ts';

export type CutoutMode = 'auto' | 'alpha' | 'paper' | 'ink' | 'none';

/** A region of the file, each value a fraction of its width or height. */
export interface PhotoCrop {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface PhotoShadowOptions {
    /** Offset in CSS px at scale 1. Default 3, 8. */
    x?: number;
    y?: number;
    /** Blur radius in CSS px. Default 10. */
    blur?: number;
    /** Default a warm dark brown at 32% opacity. */
    color?: string;
}

export interface StickerOptions {
    /** Border width in CSS px. 6 to 12 reads as cut out with scissors. Default 9. */
    border?: number;
    /** Border color. Default '#fbf8f1', an off-white stock. */
    color?: string;
    /** Tilt in degrees. Default: a seeded angle within ±3.5. */
    tilt?: number;
    /** Drop shadow, or false for none. */
    shadow?: PhotoShadowOptions | false;
    /** Paper grain over border and picture, 0 to 2. Default 1. */
    grain?: number;
    /** Seed for the tilt and the grain. Default: from the file name and crop. */
    seed?: number;
}

export interface PhotoOptions {
    /** Take only this part of the file, as fractions of its size. */
    crop?: PhotoCrop;
    /** Long edge of the finished cutout, border not included, in CSS px at scale 1. Default: its size in the file, at most 1200. */
    size?: number;
    /** 'auto' (default): the file's alpha when it has transparent pixels, 'paper' otherwise. */
    cutout?: CutoutMode;
    /** 'paper': color distance (0 to 255, largest channel difference) that still counts as paper. Default 36. */
    threshold?: number;
    /** 'paper': width of the soft edge above the threshold. Default 24. */
    softness?: number;
    /** 'paper': the paper color. Default: measured along the edge of the picture. */
    paper?: string;
    /** 'paper': drop islands smaller than this share of the picture. Default 0.002. */
    despeckle?: number;
    /**
     * 'paper' and 'alpha': 'largest' keeps only the biggest piece, dropping
     * parts of neighbours that came in with the crop. Default 'all'.
     */
    keep?: 'all' | 'largest';
    /**
     * 'paper': also clear ground enclosed by the subject (dark water between
     * tentacles) when a patch covers at least this share of the subject.
     * Default 0 (off): on light paper an enclosed patch is usually a highlight.
     */
    holes?: number;
    /**
     * 'paper' and 'ink': follow paper whose tone drifts across the scan
     * (yellowing, shadow near the gutter) instead of one color. Default true.
     */
    flatten?: boolean;
    /** Border, tilt, shadow and grain, or false for the bare cutout. */
    sticker?: StickerOptions | false;
}

export interface DrawPhotoOptions {
    /** Default 1. */
    scale?: number;
    /** Degrees added to the tilt. */
    rotate?: number;
    /** Default 1. */
    alpha?: number;
    /** 0 lies flat, 1 is lifted off the page: the shadow moves out, spreads and fades. */
    lift?: number;
}

export interface Photo {
    readonly src: string;
    /** How the background went: 'alpha', 'paper' or 'none'. */
    readonly cutout: 'alpha' | 'paper' | 'ink' | 'none';
    /** The paper color removed, or null. */
    readonly paper: string | null;
    /** Size in CSS px at scale 1, border included, before the tilt. */
    readonly width: number;
    readonly height: number;
    /** Degrees. */
    readonly tilt: number;
    /**
     * Sides of the crop the subject touches, so the crop cut through it: pick
     * a bigger crop (specimens() gives one). Empty when nothing was cut.
     */
    readonly clipped: readonly ('top' | 'right' | 'bottom' | 'left')[];
    /** The finished sticker (or bare cutout) in device pixels. */
    readonly canvas: HTMLCanvasElement;
    /** Draw centered at (x, y) in the context's CSS px. */
    draw(ctx: CanvasRenderingContext2D, x: number, y: number, options?: DrawPhotoOptions): void;
}

const images = new Map<string, Promise<HTMLImageElement>>();

function loadImage(src: string): Promise<HTMLImageElement> {
    let pending = images.get(src);
    if (!pending) {
        pending = (async () => {
            const img = new Image();
            img.src = src;
            try {
                await img.decode();
            } catch {
                throw new Error(`photo(): could not load ${src.slice(0, 120)}`);
            }
            return img;
        })();
        images.set(src, pending);
    }
    return pending;
}

function canvasOf(
    width: number,
    height: number,
): {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
} {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas context unavailable');
    return { canvas, ctx };
}

/** Per-channel median of a ring of pixels two percent deep along the edge. */
function edgeMedian(data: Uint8ClampedArray, w: number, h: number): [number, number, number] {
    const depth = Math.max(1, Math.round(Math.min(w, h) * 0.02));
    const channels: number[][] = [[], [], []];
    const take = (x: number, y: number) => {
        const i = (y * w + x) * 4;
        if (data[i + 3] < 250) return;
        for (let c = 0; c < 3; c++) channels[c].push(data[i + c]);
    };
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (x < depth || y < depth || x >= w - depth || y >= h - depth) take(x, y);
        }
    }
    return channels.map((values) => {
        if (values.length === 0) return 255;
        values.sort((a, b) => a - b);
        return values[values.length >> 1];
    }) as [number, number, number];
}

/** Largest channel difference of every pixel from the paper under it. */
function distances(data: Uint8ClampedArray, field: Float32Array, n: number): Float32Array {
    const dist = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const j = i * 4;
        const k = i * 3;
        dist[i] =
            data[j + 3] < 8
                ? 0
                : Math.max(
                      Math.abs(data[j] - field[k]),
                      Math.abs(data[j + 1] - field[k + 1]),
                      Math.abs(data[j + 2] - field[k + 2]),
                  );
    }
    return dist;
}

/**
 * The paper color under every pixel. With `flatten`, paper that drifts in tone
 * across the scan is followed: the picture is cut into cells, each takes the
 * mean of its pixels loosely near the overall paper color, cells without
 * enough paper borrow from their neighbours, and the grid is smoothed and
 * spread back over the pixels. Without it every pixel gets `paper`.
 */
function paperField(
    data: Uint8ClampedArray,
    w: number,
    h: number,
    paper: [number, number, number],
    threshold: number,
    flatten: boolean,
): Float32Array {
    const n = w * h;
    const field = new Float32Array(n * 3);
    if (!flatten) {
        for (let i = 0; i < n; i++) field.set(paper, i * 3);
        return field;
    }
    const cell = Math.max(8, Math.round(Math.max(w, h) / 40));
    const gw = Math.ceil(w / cell);
    const gh = Math.ceil(h / cell);
    for (let i = 0; i < n; i++) field.set(paper, i * 3);
    // Three rounds: a cell's paper is the mean of its pixels within `threshold`
    // of the paper found so far under them, so a slow drift is followed round
    // by round while a pale subject, a jump away, never joins in.
    for (let round = 0; round < 3; round++) {
        const grid = new Float32Array(gw * gh * 3);
        const known = new Uint8Array(gw * gh);
        for (let gy = 0; gy < gh; gy++) {
            for (let gx = 0; gx < gw; gx++) {
                let r = 0;
                let g = 0;
                let b = 0;
                let count = 0;
                let total = 0;
                for (let y = gy * cell; y < Math.min(h, (gy + 1) * cell); y++) {
                    for (let x = gx * cell; x < Math.min(w, (gx + 1) * cell); x++) {
                        const i = y * w + x;
                        const j = i * 4;
                        total++;
                        if (data[j + 3] < 8) continue;
                        const d = Math.max(
                            Math.abs(data[j] - field[i * 3]),
                            Math.abs(data[j + 1] - field[i * 3 + 1]),
                            Math.abs(data[j + 2] - field[i * 3 + 2]),
                        );
                        if (d >= threshold) continue;
                        r += data[j];
                        g += data[j + 1];
                        b += data[j + 2];
                        count++;
                    }
                }
                const c = gy * gw + gx;
                if (count >= Math.max(4, total * 0.15)) {
                    grid[c * 3] = r / count;
                    grid[c * 3 + 1] = g / count;
                    grid[c * 3 + 2] = b / count;
                    known[c] = 1;
                }
            }
        }
        if (!known.some((v) => v === 1)) return field;
        spreadGrid(grid, known, gw, gh, cell, w, h, field);
    }
    return field;
}

/** Fill cells without paper from known neighbours, smooth, and spread the grid bilinearly over `field`. */
function spreadGrid(
    grid: Float32Array,
    known: Uint8Array,
    gw: number,
    gh: number,
    cell: number,
    w: number,
    h: number,
    field: Float32Array,
): void {
    // Cells without paper borrow from known neighbours, ring by ring.
    for (let pass = 0; pass < gw + gh && known.some((v) => v === 0); pass++) {
        const next = known.slice();
        for (let c = 0; c < gw * gh; c++) {
            if (known[c]) continue;
            const cx = c % gw;
            const cy = (c - cx) / gw;
            let r = 0;
            let g = 0;
            let b = 0;
            let count = 0;
            for (const [dx, dy] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
            ]) {
                const x = cx + dx;
                const y = cy + dy;
                if (x < 0 || y < 0 || x >= gw || y >= gh || !known[y * gw + x]) continue;
                const k = (y * gw + x) * 3;
                r += grid[k];
                g += grid[k + 1];
                b += grid[k + 2];
                count++;
            }
            if (count > 0) {
                grid[c * 3] = r / count;
                grid[c * 3 + 1] = g / count;
                grid[c * 3 + 2] = b / count;
                next[c] = 1;
            }
        }
        known.set(next);
    }
    // One 3x3 smoothing pass, then bilinear spread over the pixels.
    const smooth = new Float32Array(grid.length);
    for (let cy = 0; cy < gh; cy++) {
        for (let cx = 0; cx < gw; cx++) {
            for (let ch = 0; ch < 3; ch++) {
                let sum = 0;
                let count = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const x = cx + dx;
                        const y = cy + dy;
                        if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
                        sum += grid[(y * gw + x) * 3 + ch];
                        count++;
                    }
                }
                smooth[(cy * gw + cx) * 3 + ch] = sum / count;
            }
        }
    }
    for (let y = 0; y < h; y++) {
        const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / cell - 0.5));
        const y0 = Math.floor(fy);
        const y1 = Math.min(gh - 1, y0 + 1);
        const ty = fy - y0;
        for (let x = 0; x < w; x++) {
            const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / cell - 0.5));
            const x0 = Math.floor(fx);
            const x1 = Math.min(gw - 1, x0 + 1);
            const tx = fx - x0;
            for (let ch = 0; ch < 3; ch++) {
                const a = smooth[(y0 * gw + x0) * 3 + ch];
                const b = smooth[(y0 * gw + x1) * 3 + ch];
                const c = smooth[(y1 * gw + x0) * 3 + ch];
                const d = smooth[(y1 * gw + x1) * 3 + ch];
                field[(y * w + x) * 3 + ch] =
                    (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
            }
        }
    }
}

/**
 * Measure how much of each soft-edge pixel is subject: its color lies on the
 * line from the paper under it to the subject beside it (the mean of opaque
 * pixels within two steps), and its place along that line is its opacity.
 * The ramp from the paper distance only guesses that.
 */
function edgeAlpha(
    data: Uint8ClampedArray,
    alpha: Uint8Array,
    field: Float32Array,
    w: number,
    h: number,
): void {
    const out = alpha.slice();
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            if (alpha[i] === 0 || alpha[i] === 255) continue;
            let r = 0;
            let g = 0;
            let b = 0;
            let count = 0;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    const xx = x + dx;
                    const yy = y + dy;
                    if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
                    const k = yy * w + xx;
                    if (alpha[k] !== 255) continue;
                    r += data[k * 4];
                    g += data[k * 4 + 1];
                    b += data[k * 4 + 2];
                    count++;
                }
            }
            if (count === 0) continue;
            const f = [r / count, g / count, b / count];
            const p = [field[i * 3], field[i * 3 + 1], field[i * 3 + 2]];
            let num = 0;
            let den = 0;
            for (let ch = 0; ch < 3; ch++) {
                const fp = f[ch] - p[ch];
                num += (data[i * 4 + ch] - p[ch]) * fp;
                den += fp * fp;
            }
            if (den < 64) continue;
            out[i] = Math.round(255 * Math.min(1, Math.max(0, num / den)));
        }
    }
    alpha.set(out);
}

/**
 * Take the paper back out of pixels that are part paper: a pixel of opacity a
 * shows a * subject + (1 - a) * paper, so subject = (pixel - (1 - a) * paper) / a.
 * Without this a soft edge keeps a pale rim of the old paper wherever it goes.
 */
function unmix(data: Uint8ClampedArray, alpha: Uint8Array, field: Float32Array, n: number): void {
    for (let i = 0; i < n; i++) {
        const a = alpha[i] / 255;
        if (a <= 0 || a >= 1) continue;
        const a2 = Math.max(a, 0.12);
        for (let ch = 0; ch < 3; ch++) {
            const v = (data[i * 4 + ch] - (1 - a2) * field[i * 3 + ch]) / a2;
            data[i * 4 + ch] = Math.max(0, Math.min(255, Math.round(v)));
        }
    }
}

/**
 * Line art as transparent ink: opacity follows how much darker a pixel is
 * than the paper under it, on a scale from the paper to the darkest ink on
 * the page, so hatching keeps its weight and a gray wash stays half through.
 */
function inkAlpha(data: Uint8ClampedArray, field: Float32Array, n: number): Uint8Array {
    const lum = new Float32Array(n);
    const sorted = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const j = i * 4;
        lum[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
        sorted[i] = lum[i];
    }
    sorted.sort();
    const ink = sorted[Math.floor(n * 0.005)];
    const alpha = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        const k = i * 3;
        const paper = 0.299 * field[k] + 0.587 * field[k + 1] + 0.114 * field[k + 2];
        const span = Math.max(24, paper - ink);
        const a = (paper - lum[i]) / span;
        // Grain in the paper is not ink.
        alpha[i] = a < 0.08 ? 0 : Math.round(255 * Math.min(1, a));
    }
    return alpha;
}

/** Pixels of the soft rim: this many steps out from the removed paper. */
const RIM = 2;

/**
 * Alpha for a paper cutout. Paper (closer than `threshold` to the paper
 * color) reachable from the picture's edge goes. Colors a little further
 * off, up to `threshold + softness`, fade out only on a rim two pixels deep
 * along that paper: the flood never crosses them, so a pale subject in that
 * range stays opaque, and so does pale paper color enclosed by the subject.
 */
function paperAlpha(
    data: Uint8ClampedArray,
    w: number,
    h: number,
    field: Float32Array,
    threshold: number,
    softness: number,
): { alpha: Uint8Array; dist: Float32Array } {
    const n = w * h;
    const dist = distances(data, field, n);
    // 0: kept, 1: paper, 2 and up: rim steps away from the paper.
    const state = new Uint8Array(n);
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    const flood = (i: number) => {
        if (state[i] === 0 && dist[i] < threshold) {
            state[i] = 1;
            queue[tail++] = i;
        }
    };
    for (let x = 0; x < w; x++) {
        flood(x);
        flood((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
        flood(y * w);
        flood(y * w + w - 1);
    }
    while (head < tail) {
        const i = queue[head++];
        const x = i % w;
        if (x > 0) flood(i - 1);
        if (x < w - 1) flood(i + 1);
        if (i >= w) flood(i - w);
        if (i < n - w) flood(i + w);
    }
    const hi = threshold + softness;
    for (let step = 1; step <= RIM; step++) {
        const reached: number[] = [];
        for (let i = 0; i < n; i++) {
            if (state[i] !== 0 || dist[i] >= hi) continue;
            const x = i % w;
            if (
                (x > 0 && state[i - 1] === step) ||
                (x < w - 1 && state[i + 1] === step) ||
                (i >= w && state[i - w] === step) ||
                (i < n - w && state[i + w] === step)
            ) {
                reached.push(i);
            }
        }
        for (const i of reached) state[i] = step + 1;
    }
    const alpha = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        if (state[i] === 0) alpha[i] = 255;
        else if (state[i] > 1) {
            const ramp = (dist[i] - threshold) / Math.max(1, softness);
            alpha[i] = Math.round(255 * Math.min(1, Math.max(0, ramp)));
        }
    }
    return { alpha, dist };
}

/** 8-connected islands of alpha > 0: a label per pixel (0 for none) and each island's size, from label 1. */
function islands(alpha: Uint8Array, w: number, h: number): { label: Int32Array; sizes: number[] } {
    const n = w * h;
    const label = new Int32Array(n);
    const queue = new Int32Array(n);
    const sizes = [0];
    for (let start = 0; start < n; start++) {
        if (alpha[start] === 0 || label[start] !== 0) continue;
        const id = sizes.length;
        let head = 0;
        let tail = 0;
        label[start] = id;
        queue[tail++] = start;
        while (head < tail) {
            const i = queue[head++];
            const x = i % w;
            const y = (i - x) / w;
            for (let dy = -1; dy <= 1; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= h) continue;
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = x + dx;
                    if (xx < 0 || xx >= w) continue;
                    const k = yy * w + xx;
                    if (alpha[k] !== 0 && label[k] === 0) {
                        label[k] = id;
                        queue[tail++] = k;
                    }
                }
            }
        }
        sizes.push(tail);
    }
    return { label, sizes };
}

/** Zero every island but the biggest. */
function keepLargest(alpha: Uint8Array, w: number, h: number): void {
    const { label, sizes } = islands(alpha, w, h);
    let best = 0;
    for (let id = 1; id < sizes.length; id++) if (best === 0 || sizes[id] > sizes[best]) best = id;
    for (let i = 0; i < alpha.length; i++) if (label[i] !== best) alpha[i] = 0;
}

/**
 * Clear patches of ground-colored pixels inside the subject (closer than
 * `threshold` to the paper, 4-connected) that cover at least `share` of it.
 */
function clearHoles(
    alpha: Uint8Array,
    dist: Float32Array,
    w: number,
    h: number,
    threshold: number,
    share: number,
): void {
    const n = w * h;
    let area = 0;
    for (let i = 0; i < n; i++) if (alpha[i] > 0) area++;
    const minArea = Math.max(1, share * area);
    const seen = new Uint8Array(n);
    const queue = new Int32Array(n);
    for (let start = 0; start < n; start++) {
        if (seen[start] || alpha[start] === 0 || dist[start] >= threshold) continue;
        let head = 0;
        let tail = 0;
        seen[start] = 1;
        queue[tail++] = start;
        while (head < tail) {
            const i = queue[head++];
            const x = i % w;
            const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
            for (const k of next) {
                if (k < 0 || k >= n || seen[k] || alpha[k] === 0 || dist[k] >= threshold) continue;
                seen[k] = 1;
                queue[tail++] = k;
            }
        }
        if (tail >= minArea) for (let q = 0; q < tail; q++) alpha[queue[q]] = 0;
    }
}

/** Zero every 8-connected island of alpha > 0 smaller than minArea pixels. */
function despeckle(alpha: Uint8Array, w: number, h: number, minArea: number): void {
    if (minArea <= 1) return;
    const n = w * h;
    const label = new Int32Array(n);
    const queue = new Int32Array(n);
    let next = 0;
    for (let start = 0; start < n; start++) {
        if (alpha[start] === 0 || label[start] !== 0) continue;
        next++;
        let head = 0;
        let tail = 0;
        label[start] = next;
        queue[tail++] = start;
        while (head < tail) {
            const i = queue[head++];
            const x = i % w;
            const y = (i - x) / w;
            for (let dy = -1; dy <= 1; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= h) continue;
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = x + dx;
                    if (xx < 0 || xx >= w) continue;
                    const k = yy * w + xx;
                    if (alpha[k] !== 0 && label[k] === 0) {
                        label[k] = next;
                        queue[tail++] = k;
                    }
                }
            }
        }
        if (tail < minArea) {
            for (let q = 0; q < tail; q++) alpha[queue[q]] = 0;
        }
    }
}

/** Squared Euclidean distance transform of a 1D sampled function (Felzenszwalb and Huttenlocher). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
    let k = 0;
    v[0] = 0;
    z[0] = Number.NEGATIVE_INFINITY;
    z[1] = Number.POSITIVE_INFINITY;
    for (let q = 1; q < n; q++) {
        let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= z[k]) {
            k--;
            s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        }
        k++;
        v[k] = q;
        z[k] = s;
        z[k + 1] = Number.POSITIVE_INFINITY;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
        while (z[k + 1] < q) k++;
        d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
}

/** Distance in pixels from each pixel to the nearest pixel where `inside` is set. */
function distanceTo(inside: Uint8Array, w: number, h: number): Float64Array {
    const INF = 1e20;
    const grid = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) grid[i] = inside[i] ? 0 : INF;
    const len = Math.max(w, h);
    const f = new Float64Array(len);
    const d = new Float64Array(len);
    const v = new Int32Array(len);
    const z = new Float64Array(len + 1);
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
        edt1d(f, h, d, v, z);
        for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
        edt1d(f, w, d, v, z);
        for (let x = 0; x < w; x++) grid[y * w + x] = Math.sqrt(d[x]);
    }
    return grid;
}

function checkCrop(crop: PhotoCrop): void {
    const ok =
        [crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) &&
        crop.x >= 0 &&
        crop.y >= 0 &&
        crop.width > 0 &&
        crop.height > 0 &&
        crop.x + crop.width <= 1.0001 &&
        crop.y + crop.height <= 1.0001;
    if (!ok) {
        throw new Error(
            'photo(): crop takes fractions of the image, { x, y, width, height } each within 0 to 1',
        );
    }
}

/** RGBA pixels scaled to another size by the canvas, smoothing on. */
function resample(
    pixels: ImageDataArray,
    w: number,
    h: number,
    nw: number,
    nh: number,
): ImageDataArray {
    const from = canvasOf(w, h);
    from.ctx.putImageData(new ImageData(pixels, w, h), 0, 0);
    const to = canvasOf(nw, nh);
    to.ctx.imageSmoothingQuality = 'high';
    to.ctx.drawImage(from.canvas, 0, 0, nw, nh);
    return to.ctx.getImageData(0, 0, nw, nh).data;
}

const WORK_EDGE = 2400;
const DEFAULT_SHADOW = { x: 3, y: 8, blur: 10, color: 'rgba(38, 28, 18, 0.32)' };

/**
 * Load a picture from the composition directory (such as `assets/eggs.jpg`),
 * cut it from its background and make it a sticker. Await it at module level
 * or in setup, never in seek.
 */
export async function photo(src: string, options: PhotoOptions = {}): Promise<Photo> {
    const img = await loadImage(src);
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) {
        throw new Error(`photo(): ${src.slice(0, 120)} has no size. Give an SVG width and height.`);
    }
    const crop = options.crop ?? { x: 0, y: 0, width: 1, height: 1 };
    checkCrop(crop);
    const sx = crop.x * nw;
    const sy = crop.y * nh;
    const sw = Math.min(nw - sx, crop.width * nw);
    const sh = Math.min(nh - sy, crop.height * nh);
    const dpr = window.devicePixelRatio || 1;
    // The cutout runs at the file's own resolution, at most 2400 px on the long edge.
    const k = Math.min(1, WORK_EDGE / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * k));
    const h = Math.max(1, Math.round(sh * k));

    const work = canvasOf(w, h);
    work.ctx.imageSmoothingQuality = 'high';
    work.ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    const pixels = work.ctx.getImageData(0, 0, w, h);
    const data = pixels.data;

    let mode: Photo['cutout'];
    if (!options.cutout || options.cutout === 'auto') {
        mode = 'paper';
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] < 250) {
                mode = 'alpha';
                break;
            }
        }
    } else {
        mode = options.cutout;
    }
    let paper: string | null = null;
    let alpha: Uint8Array;
    if (mode === 'paper' || mode === 'ink') {
        const color = options.paper ? rgb(options.paper) : edgeMedian(data, w, h);
        paper = hex(color);
        const threshold = options.threshold ?? 36;
        const field = paperField(data, w, h, color, threshold, options.flatten ?? true);
        if (mode === 'ink') {
            alpha = inkAlpha(data, field, w * h);
            despeckle(alpha, w, h, Math.round((options.despeckle ?? 0.002) * w * h));
            if (options.keep === 'largest') keepLargest(alpha, w, h);
        } else {
            const cut = paperAlpha(data, w, h, field, threshold, options.softness ?? 24);
            alpha = cut.alpha;
            despeckle(alpha, w, h, Math.round((options.despeckle ?? 0.002) * w * h));
            if (options.keep === 'largest') keepLargest(alpha, w, h);
            if (options.holes) {
                clearHoles(alpha, cut.dist, w, h, threshold, options.holes);
                despeckle(alpha, w, h, Math.round((options.despeckle ?? 0.002) * w * h));
            }
            edgeAlpha(data, alpha, field, w, h);
        }
        unmix(data, alpha, field, w * h);
    } else {
        alpha = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) alpha[i] = mode === 'alpha' ? data[i * 4 + 3] : 255;
        if (mode === 'alpha' && options.keep === 'largest') keepLargest(alpha, w, h);
    }

    // Trim to what is left.
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (alpha[y * w + x] < 16) continue;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
        }
    }
    if (x1 < 0) {
        throw new Error(
            `photo(): nothing is left of ${src.slice(0, 120)} after the ${mode} cutout. Lower threshold, pass paper, or use cutout: 'none'.`,
        );
    }
    const clipped: ('top' | 'right' | 'bottom' | 'left')[] = [];
    if (mode !== 'none') {
        if (y0 === 0) clipped.push('top');
        if (x1 === w - 1) clipped.push('right');
        if (y1 === h - 1) clipped.push('bottom');
        if (x0 === 0) clipped.push('left');
    }
    const tw = x1 - x0 + 1;
    const th = y1 - y0 + 1;
    const trimmed = new Uint8ClampedArray(tw * th * 4);
    for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
            const from = (y + y0) * w + (x + x0);
            const to = y * tw + x;
            trimmed[to * 4] = data[from * 4];
            trimmed[to * 4 + 1] = data[from * 4 + 1];
            trimmed[to * 4 + 2] = data[from * 4 + 2];
            trimmed[to * 4 + 3] = alpha[from];
        }
    }
    // Then it is scaled so its long edge is `size` CSS px: the border is added
    // at the size the cutout will be drawn at.
    const natural = Math.max(tw, th) / k;
    const target = Math.max(1, Math.round((options.size ?? Math.min(1200, natural)) * dpr));
    const ratio = target / Math.max(tw, th);
    const cw = ratio === 1 ? tw : Math.max(1, Math.round(tw * ratio));
    const ch = ratio === 1 ? th : Math.max(1, Math.round(th * ratio));
    const cut = ratio === 1 ? trimmed : resample(trimmed, tw, th, cw, ch);

    const sticker = options.sticker === false ? null : (options.sticker ?? {});
    const seed = sticker?.seed ?? hash32(src, JSON.stringify(crop));
    const tilt = sticker ? (sticker.tilt ?? (rand(seed, 'tilt') * 2 - 1) * 3.5) : 0;

    let out: HTMLCanvasElement;
    if (!sticker) {
        const bare = canvasOf(cw, ch);
        bare.ctx.putImageData(new ImageData(cut, cw, ch), 0, 0);
        out = bare.canvas;
    } else {
        const border = Math.max(0, Math.round((sticker.border ?? 9) * dpr));
        const bw = cw + border * 2;
        const bh = ch + border * 2;
        const inside = new Uint8Array(bw * bh);
        for (let y = 0; y < ch; y++) {
            for (let x = 0; x < cw; x++) {
                if (cut[(y * cw + x) * 4 + 3] >= 64) inside[(y + border) * bw + x + border] = 1;
            }
        }
        const dist = distanceTo(inside, bw, bh);
        const [br, bg, bb] = rgb(sticker.color ?? '#fbf8f1');
        const grain = sticker.grain ?? 1;
        const px = new Uint8ClampedArray(bw * bh * 4);
        const mottle = 18 * dpr;
        for (let y = 0; y < bh; y++) {
            for (let x = 0; x < bw; x++) {
                const i = y * bw + x;
                const ba = Math.min(1, Math.max(0, border + 1 - dist[i]));
                const cx = x - border;
                const cy = y - border;
                let pr = 0;
                let pg = 0;
                let pb = 0;
                let pa = 0;
                if (cx >= 0 && cy >= 0 && cx < cw && cy < ch) {
                    const j = (cy * cw + cx) * 4;
                    pr = cut[j];
                    pg = cut[j + 1];
                    pb = cut[j + 2];
                    pa = cut[j + 3] / 255;
                }
                const a = pa + ba * (1 - pa);
                if (a <= 0) continue;
                let r = (pr * pa + br * ba * (1 - pa)) / a;
                let g = (pg * pa + bg * ba * (1 - pa)) / a;
                let b = (pb * pa + bb * ba * (1 - pa)) / a;
                if (grain > 0) {
                    const tooth = (ihash(x, y, seed) - 0.5) * 7;
                    const cloud = (vnoise(x / mottle, y / mottle, seed + 7) - 0.5) * 10;
                    const shift = grain * (tooth + cloud);
                    r += shift;
                    g += shift;
                    b += shift * 0.9;
                }
                const o = i * 4;
                px[o] = r;
                px[o + 1] = g;
                px[o + 2] = b;
                px[o + 3] = Math.round(a * 255);
            }
        }
        const done = canvasOf(bw, bh);
        done.ctx.putImageData(new ImageData(px, bw, bh), 0, 0);
        out = done.canvas;
    }

    const shadowOptions =
        sticker && sticker.shadow !== false
            ? { ...DEFAULT_SHADOW, ...(sticker.shadow ?? {}) }
            : null;
    let shadow: HTMLCanvasElement | null = null;
    let pad = 0;
    if (shadowOptions) {
        pad = Math.ceil(shadowOptions.blur * dpr * 2) + 2;
        const tint = canvasOf(out.width, out.height);
        tint.ctx.drawImage(out, 0, 0);
        tint.ctx.globalCompositeOperation = 'source-in';
        tint.ctx.fillStyle = shadowOptions.color;
        tint.ctx.fillRect(0, 0, out.width, out.height);
        const blurred = canvasOf(out.width + pad * 2, out.height + pad * 2);
        blurred.ctx.filter = `blur(${shadowOptions.blur * dpr}px)`;
        blurred.ctx.drawImage(tint.canvas, pad, pad);
        shadow = blurred.canvas;
    }

    const width = out.width / dpr;
    const height = out.height / dpr;
    return {
        src,
        cutout: mode,
        paper,
        width,
        height,
        tilt,
        clipped,
        canvas: out,
        draw(ctx, x, y, drawOptions = {}) {
            const scale = drawOptions.scale ?? 1;
            const angle = ((tilt + (drawOptions.rotate ?? 0)) * Math.PI) / 180;
            const alphaNow = drawOptions.alpha ?? 1;
            const lift = Math.min(1, Math.max(0, drawOptions.lift ?? 0));
            const previous = ctx.globalAlpha;
            if (shadow && shadowOptions) {
                const reach = 1 + lift * 2;
                const spread = scale * (1 + lift * 0.08);
                const sw2 = (shadow.width / dpr) * spread;
                const sh2 = (shadow.height / dpr) * spread;
                ctx.save();
                ctx.translate(
                    x + shadowOptions.x * reach * scale,
                    y + shadowOptions.y * reach * scale,
                );
                ctx.rotate(angle);
                ctx.globalAlpha = previous * alphaNow * (1 - lift * 0.45);
                ctx.drawImage(shadow, -sw2 / 2, -sh2 / 2, sw2, sh2);
                ctx.restore();
            }
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angle);
            ctx.globalAlpha = previous * alphaNow;
            ctx.drawImage(
                out,
                (-width * scale) / 2,
                (-height * scale) / 2,
                width * scale,
                height * scale,
            );
            ctx.restore();
        },
    };
}

/** Grow alpha > 0 by r pixels (a square neighbourhood), as a 0/255 mask. */
function dilate(alpha: Uint8Array, w: number, h: number, r: number): Uint8Array {
    const row = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        let last = -Infinity;
        for (let x = 0; x < w; x++) {
            if (alpha[y * w + x] > 0) last = x;
            if (x - last <= r) row[y * w + x] = 255;
        }
        last = Infinity;
        for (let x = w - 1; x >= 0; x--) {
            if (alpha[y * w + x] > 0) last = x;
            if (last - x <= r) row[y * w + x] = 255;
        }
    }
    const out = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) {
        let last = -Infinity;
        for (let y = 0; y < h; y++) {
            if (row[y * w + x] > 0) last = y;
            if (y - last <= r) out[y * w + x] = 255;
        }
        last = Infinity;
        for (let y = h - 1; y >= 0; y--) {
            if (row[y * w + x] > 0) last = y;
            if (last - y <= r) out[y * w + x] = 255;
        }
    }
    return out;
}

export interface SpecimenOptions {
    /** The ground color. Default: measured along the edge of the picture. */
    paper?: string;
    /** How far from the ground a color may be and still count as ground, 0 to 255. Default 36. */
    threshold?: number;
    /** Pieces smaller than this share of the picture are dust, captions or plate numbers. Default 0.003. */
    minArea?: number;
    /** Pieces closer than this share of the long edge are one specimen (antennae, a stalk). Default 0.012. */
    gap?: number;
    /** Room left around each specimen, as a share of the long edge. Default 0.015. */
    margin?: number;
}

export interface Specimen {
    /** A crop for photo(), fractions of the file, the specimen with room around it. */
    crop: PhotoCrop;
    /** The specimen's share of the picture's area. */
    area: number;
}

/**
 * Find the separate specimens on a plate: every patch of the picture that is
 * not ground, pieces close together counted as one, biggest first. Pass a
 * specimen's crop to photo() instead of guessing one, so the crop neither
 * cuts through it nor brings in half a neighbour.
 */
export async function specimens(src: string, options: SpecimenOptions = {}): Promise<Specimen[]> {
    const img = await loadImage(src);
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) throw new Error(`specimens(): ${src.slice(0, 120)} has no size.`);
    const k = Math.min(1, 1200 / Math.max(nw, nh));
    const w = Math.max(1, Math.round(nw * k));
    const h = Math.max(1, Math.round(nh * k));
    const work = canvasOf(w, h);
    work.ctx.imageSmoothingQuality = 'high';
    work.ctx.drawImage(img, 0, 0, w, h);
    const data = work.ctx.getImageData(0, 0, w, h).data;
    const color = options.paper ? rgb(options.paper) : edgeMedian(data, w, h);
    // Ground is every pixel near the ground color, wherever it lies: scanned
    // pages print the plate inside a margin, so the ground need not reach the
    // edge. What touches the edge is that margin, its caption or the scan's
    // own border, never a specimen, and is dropped below.
    const threshold = options.threshold ?? 36;
    const paperUnder = paperField(data, w, h, color, threshold, true);
    const dist = distances(data, paperUnder, w * h);
    const alpha = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) alpha[i] = dist[i] >= threshold ? 255 : 0;
    // The printed field is the bounding box of the largest stretch of ground.
    // Everything outside it (the page margin, the caption, the scan's border)
    // counts as ground, so a specimen near the field's edge does not join it.
    const ground = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) ground[i] = alpha[i] === 0 ? 255 : 0;
    const field = islands(ground, w, h);
    let biggest = 1;
    for (let id = 2; id < field.sizes.length; id++)
        if (field.sizes[id] > field.sizes[biggest]) biggest = id;
    let fx0 = w;
    let fy0 = h;
    let fx1 = -1;
    let fy1 = -1;
    for (let i = 0; i < w * h; i++) {
        if (field.label[i] !== biggest) continue;
        const x = i % w;
        const y = (i - x) / w;
        if (x < fx0) fx0 = x;
        if (x > fx1) fx1 = x;
        if (y < fy0) fy0 = y;
        if (y > fy1) fy1 = y;
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (x <= fx0 || x >= fx1 || y <= fy0 || y >= fy1) alpha[y * w + x] = 0;
        }
    }
    const fieldArea = Math.max(1, (fx1 - fx0 + 1) * (fy1 - fy0 + 1));
    despeckle(alpha, w, h, Math.round((options.minArea ?? 0.003) * w * h));
    // Pieces closer than `gap` belong to one specimen (antennae, a stalk, a
    // highlight splitting a wing): group them by growing every piece by the
    // gap and labeling what joins up. Distance counts, not bounding boxes, so
    // a rule drawn around the whole plate does not swallow what it frames.
    const r = Math.max(1, Math.round((options.gap ?? 0.012) * Math.max(w, h)));
    const grown = dilate(alpha, w, h, r);
    const { label, sizes } = islands(grown, w, h);
    const boxes = sizes.map(() => ({ x0: w, y0: h, x1: -1, y1: -1, area: 0 }));
    for (let i = 0; i < label.length; i++) {
        if (alpha[i] === 0) continue;
        const b = boxes[label[i]];
        const x = i % w;
        const y = (i - x) / w;
        if (x < b.x0) b.x0 = x;
        if (x > b.x1) b.x1 = x;
        if (y < b.y0) b.y0 = y;
        if (y > b.y1) b.y1 = y;
        b.area++;
    }
    const found = boxes.filter((b) => {
        if (b.area === 0) return false;
        // The page margin, its caption and the scan's border reach the edge.
        if (b.x0 === 0 || b.y0 === 0 || b.x1 === w - 1 || b.y1 === h - 1) return false;
        // A rule around the plate: a big, nearly empty ring.
        const boxArea = (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1);
        if (boxArea > 0.25 * w * h && b.area < 0.08 * boxArea) return false;
        // Specimens joined by spines or tentacles into one group spanning
        // much of the plate cannot be told apart by color: not a specimen.
        return boxArea <= 0.4 * fieldArea;
    });
    const margin = (options.margin ?? 0.015) * Math.max(w, h);
    return found
        .sort((a, b) => b.area - a.area)
        .map((b) => {
            const x0 = Math.max(0, b.x0 - margin);
            const y0 = Math.max(0, b.y0 - margin);
            const x1 = Math.min(w, b.x1 + 1 + margin);
            const y1 = Math.min(h, b.y1 + 1 + margin);
            return {
                crop: { x: x0 / w, y: y0 / h, width: (x1 - x0) / w, height: (y1 - y0) / h },
                area: b.area / (w * h),
            };
        });
}
