import { type Rgb, rgb, rgba, shade } from './color.ts';
import { LAYER_ATTR, setupCanvas } from './core/layers.ts';
import { ihash, vfbm, vnoise } from './hash.ts';

/** Paper colors that read as printed stock. */
export const PAPER = {
    cream: '#efe5d0',
    ivory: '#f5f0e5',
    beige: '#cfbd9f',
    sage: '#b9bca3',
    clay: '#b86b4e',
} as const;

export interface GridOptions {
    /** CSS px between lines. Default 28. */
    spacing?: number;
    /** Every n-th line is heavier. 0 for none. Default 0. */
    major?: number;
    /** Line color. Default: the paper color, darkened. */
    color?: string;
    /** Default 0.4. */
    opacity?: number;
    /** Line width in CSS px. Default 1. */
    width?: number;
    /** Where the first vertical and horizontal line sit. Default half a spacing in. */
    x?: number;
    y?: number;
}

export interface PaperOptions {
    seed?: number;
    /** Base color. Default PAPER.beige. */
    color?: string;
    /** Large soft blotches of lighter and darker stock, 0 to 2. Default 1. */
    mottle?: number;
    /** Short fibers, 0 to 3. Default 1. */
    fibers?: number;
    /** Light and dark specks, 0 to 3. Default 1. */
    specks?: number;
    /** Fine tooth of the stock, 0 to 3. Default 1. 0 renders about twice as fast. */
    grain?: number;
    /** Printed grid lines: true for the defaults. */
    grid?: GridOptions | boolean;
    /** Darker corners, 0 to 1. Default 0. */
    vignette?: number;
}

export interface GrainOptions {
    seed?: number;
    /** Strength of the tooth over everything below it, 0 to 3. Default 1. 0 renders about twice as fast. */
    amount?: number;
    /** Dust specks, 0 to 3. Default 1. */
    dust?: number;
    /** Darker corners over the whole picture, 0 to 1. Default 0. */
    vignette?: number;
    /** Tint of the dark grain and the vignette. Default a warm brown. */
    ink?: string;
}

interface DeviceRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** The device-pixel rectangle that (0, 0, width, height) covers under ctx's transform. */
function deviceRect(ctx: CanvasRenderingContext2D, width: number, height: number): DeviceRect {
    const m = ctx.getTransform();
    const x = Math.round(m.e);
    const y = Math.round(m.f);
    return {
        x,
        y,
        width: Math.max(1, Math.min(ctx.canvas.width - x, Math.round(width * m.a))),
        height: Math.max(1, Math.min(ctx.canvas.height - y, Math.round(height * m.d))),
    };
}

function mottled(base: Rgb, width: number, height: number, seed: number, amount: number) {
    const cell = 6;
    const mw = Math.ceil(width / cell) + 3;
    const mh = Math.ceil(height / cell) + 3;
    const low = document.createElement('canvas');
    low.width = mw;
    low.height = mh;
    const lctx = low.getContext('2d');
    if (!lctx) throw new Error('2D canvas context unavailable');
    const img = lctx.createImageData(mw, mh);
    for (let y = 0; y < mh; y++) {
        for (let x = 0; x < mw; x++) {
            const px = x * cell;
            const py = y * cell;
            const broad = vfbm(px / 420, py / 420, seed, 3) - 0.5;
            const cloud = vfbm(px / 60, py / 60, seed + 17, 3) - 0.5;
            const streak = vnoise(px / 9, py / 90, seed + 29) - 0.5;
            const k = 1 + (broad * 0.06 + cloud * 0.022 + streak * 0.01) * amount;
            const i = (y * mw + x) * 4;
            img.data[i] = base[0] * k;
            img.data[i + 1] = base[1] * k;
            img.data[i + 2] = base[2] * (k * 0.97 + 0.03);
            img.data[i + 3] = 255;
        }
    }
    lctx.putImageData(img, 0, 0);
    return { canvas: low, cell };
}

/** Short curved fibers in a few batched paths, lighter ones outnumbering darker. */
function fibers(
    ctx: CanvasRenderingContext2D,
    base: Rgb,
    width: number,
    height: number,
    seed: number,
    density: number,
) {
    const count = Math.round(((width * height) / 1e6) * 150 * density);
    const styles = [
        { color: rgba(shade(base, 0.5), 0.5), width: 0.9 },
        { color: rgba(shade(base, 0.25), 0.3), width: 1.3 },
        { color: rgba(shade(base, -0.35), 0.12), width: 0.7 },
    ];
    const paths = styles.map(() => new Path2D());
    for (let i = 0; i < count; i++) {
        const h = (k: number) => ihash(i, k, seed ^ 0x5f1b3c);
        const x = h(0) * width;
        const y = h(1) * height;
        const len = 5 + h(2) * h(2) * 24;
        const a = h(3) * Math.PI * 2;
        const bend = (h(4) - 0.5) * len * 0.7;
        const pick = h(5);
        const path = paths[pick < 0.6 ? 0 : pick < 0.88 ? 1 : 2];
        const ex = x + Math.cos(a) * len;
        const ey = y + Math.sin(a) * len;
        const mx = (x + ex) / 2 - Math.sin(a) * bend;
        const my = (y + ey) / 2 + Math.cos(a) * bend;
        path.moveTo(x, y);
        path.quadraticCurveTo(mx, my, ex, ey);
    }
    ctx.lineCap = 'round';
    styles.forEach((style, i) => {
        ctx.strokeStyle = style.color;
        ctx.lineWidth = style.width;
        ctx.stroke(paths[i]);
    });
}

function specks(
    ctx: CanvasRenderingContext2D,
    base: Rgb,
    width: number,
    height: number,
    seed: number,
    density: number,
) {
    const count = Math.round(((width * height) / 1e6) * 110 * density);
    const styles = [
        rgba(shade(base, 0.7), 0.85),
        rgba(shade(base, 0.5), 0.5),
        rgba(shade(base, -0.55), 0.45),
        rgba(shade(base, -0.7), 0.7),
    ];
    const paths = styles.map(() => new Path2D());
    for (let i = 0; i < count; i++) {
        const h = (k: number) => ihash(i, k, seed ^ 0x2a77c1);
        const x = h(0) * width;
        const y = h(1) * height;
        const pick = h(2);
        const bucket = pick < 0.45 ? 0 : pick < 0.8 ? 1 : pick < 0.95 ? 2 : 3;
        const r = bucket === 3 ? 0.35 + h(3) * 0.5 : 0.4 + h(3) * h(3) * 1.4;
        paths[bucket].moveTo(x + r, y);
        paths[bucket].ellipse(x, y, r, r * (0.6 + h(4) * 0.4), h(5) * Math.PI, 0, Math.PI * 2);
    }
    styles.forEach((color, i) => {
        ctx.fillStyle = color;
        ctx.fill(paths[i]);
    });
}

function grid(
    ctx: CanvasRenderingContext2D,
    base: Rgb,
    width: number,
    height: number,
    options: GridOptions,
) {
    const spacing = options.spacing ?? 28;
    if (!(spacing > 2)) throw new Error('grid spacing must be more than 2 px');
    const major = options.major ?? 0;
    const color = options.color ?? shade(base, -0.38);
    const opacity = options.opacity ?? 0.4;
    const lineWidth = options.width ?? 1;
    const ox = options.x ?? spacing / 2;
    const oy = options.y ?? spacing / 2;
    const minor = new Path2D();
    const heavy = new Path2D();
    const first = (origin: number) => origin - Math.floor(origin / spacing) * spacing;
    const x0 = first(ox);
    const y0 = first(oy);
    const index = (value: number, origin: number) => Math.round((value - origin) / spacing);
    for (let x = x0; x <= width; x += spacing) {
        const path = major > 0 && index(x, ox) % major === 0 ? heavy : minor;
        path.moveTo(x, 0);
        path.lineTo(x, height);
    }
    for (let y = y0; y <= height; y += spacing) {
        const path = major > 0 && index(y, oy) % major === 0 ? heavy : minor;
        path.moveTo(0, y);
        path.lineTo(width, y);
    }
    ctx.strokeStyle = rgba(color, opacity);
    ctx.lineWidth = lineWidth;
    ctx.stroke(minor);
    if (major > 0) {
        ctx.strokeStyle = rgba(color, Math.min(1, opacity * 1.6));
        ctx.lineWidth = lineWidth * 1.6;
        ctx.stroke(heavy);
    }
}

function vignette(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    strength: number,
    ink: string | Rgb,
) {
    if (strength <= 0) return;
    const diag = Math.hypot(width, height) / 2;
    const g = ctx.createRadialGradient(
        width / 2,
        height / 2,
        diag * 0.42,
        width / 2,
        height / 2,
        diag * 1.05,
    );
    g.addColorStop(0, rgba(ink, 0));
    g.addColorStop(1, rgba(ink, 0.6 * Math.min(1, strength)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
}

/**
 * Paper stock filling (0, 0, width, height) in CSS px, nothing outside it: mottled base color,
 * fibers, specks, optional grid, per-pixel tooth, optional vignette. The same
 * options always give the same pixels. Draw it once, in setup.
 */
export function drawPaper(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    options: PaperOptions = {},
): void {
    const seed = options.seed ?? 1;
    const base = rgb(options.color ?? PAPER.beige);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    const mottle = mottled(base, width, height, seed, options.mottle ?? 1);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
        mottle.canvas,
        -mottle.cell,
        -mottle.cell,
        mottle.canvas.width * mottle.cell,
        mottle.canvas.height * mottle.cell,
    );
    fibers(ctx, base, width, height, seed, options.fibers ?? 1);
    if (options.grid) {
        grid(ctx, base, width, height, options.grid === true ? {} : options.grid);
    }
    const amount = options.grain ?? 1;
    if (amount > 0) {
        const r = deviceRect(ctx, width, height);
        const scale = r.width / width;
        const img = ctx.getImageData(r.x, r.y, r.width, r.height);
        const d = img.data;
        for (let y = 0; y < r.height; y++) {
            for (let x = 0; x < r.width; x++) {
                const tooth = vnoise(x / (2.2 * scale), y / (2.2 * scale), seed + 1) - 0.5;
                const v = tooth * 6 * amount;
                const i = (y * r.width + x) * 4;
                d[i] += v;
                d[i + 1] += v;
                d[i + 2] += v * 0.92;
            }
        }
        ctx.putImageData(img, r.x, r.y);
    }
    specks(ctx, base, width, height, seed, options.specks ?? 1);
    vignette(ctx, width, height, options.vignette ?? 0, shade(base, -0.75));
    ctx.restore();
}

/**
 * A transparent overlay of paper tooth and dust for the top of the stack, so
 * everything drawn below it looks printed on the same stock. Same options,
 * same pixels.
 */
export function drawGrain(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    options: GrainOptions = {},
): void {
    const seed = options.seed ?? 1;
    const amount = options.amount ?? 1;
    const ink = rgb(options.ink ?? '#3a2a18');
    const r = deviceRect(ctx, width, height);
    ctx.save();
    if (amount > 0) {
        const layer = document.createElement('canvas');
        layer.width = r.width;
        layer.height = r.height;
        const lctx = layer.getContext('2d');
        if (!lctx) throw new Error('2D canvas context unavailable');
        const scale = r.width / width;
        const img = lctx.createImageData(r.width, r.height);
        const d = img.data;
        for (let y = 0; y < r.height; y++) {
            for (let x = 0; x < r.width; x++) {
                const g = (vnoise(x / (1.8 * scale), y / (1.8 * scale), seed + 101) - 0.5) * 1.4;
                const i = (y * r.width + x) * 4;
                if (g > 0) {
                    d[i] = 255;
                    d[i + 1] = 250;
                    d[i + 2] = 238;
                    d[i + 3] = g * 22 * amount;
                } else {
                    d[i] = ink[0];
                    d[i + 1] = ink[1];
                    d[i + 2] = ink[2];
                    d[i + 3] = -g * 26 * amount;
                }
            }
        }
        lctx.putImageData(img, 0, 0);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(layer, r.x, r.y);
        ctx.restore();
        ctx.save();
    }
    const dust = options.dust ?? 1;
    if (dust > 0) {
        const count = Math.round(((width * height) / 1e6) * 40 * dust);
        const light = new Path2D();
        const dark = new Path2D();
        for (let i = 0; i < count; i++) {
            const h = (k: number) => ihash(i, k, seed ^ 0x7d0d);
            const x = h(0) * width;
            const y = h(1) * height;
            const rad = 0.4 + h(2) * h(2) * 1.3;
            const path = h(3) < 0.7 ? light : dark;
            path.moveTo(x + rad, y);
            path.arc(x, y, rad, 0, Math.PI * 2);
        }
        ctx.fillStyle = 'rgba(255, 252, 244, 0.55)';
        ctx.fill(light);
        ctx.fillStyle = rgba(ink, 0.35);
        ctx.fill(dark);
    }
    vignette(ctx, width, height, options.vignette ?? 0, ink);
    ctx.restore();
}

function layerCanvas(
    width: number,
    height: number,
): {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
} {
    const canvas = document.createElement('canvas');
    canvas.setAttribute(LAYER_ATTR, 'paper');
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.pointerEvents = 'none';
    const ctx = setupCanvas(canvas, width, height);
    return { canvas, ctx };
}

/**
 * A paper canvas marked data-flipbook-layer="paper", inserted as the first
 * child of `parent` (default body) and drawn once. Call it in setup.
 */
export function paperLayer(
    width: number,
    height: number,
    options: PaperOptions & { parent?: Element } = {},
): HTMLCanvasElement {
    const { canvas, ctx } = layerCanvas(width, height);
    drawPaper(ctx, width, height, options);
    const parent = options.parent ?? document.body;
    parent.insertBefore(canvas, parent.firstChild);
    return canvas;
}

/**
 * A grain overlay canvas marked data-flipbook-layer="paper", appended as the
 * last child of `parent` (default body) and drawn once. Call it in setup,
 * after the content elements exist.
 */
export function grainLayer(
    width: number,
    height: number,
    options: GrainOptions & { parent?: Element } = {},
): HTMLCanvasElement {
    const { canvas, ctx } = layerCanvas(width, height);
    drawGrain(ctx, width, height, options);
    (options.parent ?? document.body).appendChild(canvas);
    return canvas;
}
