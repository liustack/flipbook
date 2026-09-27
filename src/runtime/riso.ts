// Risograph printing: a picture pulled from two or three drums, one spot ink
// each. Every ink is drawn on its own plate, the amount of ink is how opaque
// the drawing is, and at print time each plate is screened, colored, mottled
// and laid down over the paper by multiplying, a little off from the others,
// so where two inks overlap a third color shows and the edges never quite
// meet. Everything is a pure function of what is drawn and t.

import { setupCanvas } from './core/layers.ts';
import { rand } from './core/random.ts';

/**
 * Standard riso inks, as the riso community lists them (Stencil Wiki). The
 * inks are rice based and slightly transparent: these are close, not exact.
 */
export const RISO_INKS = {
    black: '#000000',
    burgundy: '#914E72',
    blue: '#0078BF',
    green: '#00A95C',
    mediumBlue: '#3255A4',
    brightRed: '#F15060',
    purple: '#765BA7',
    teal: '#00838A',
    red: '#FF665E',
    brown: '#925F52',
    yellow: '#FFE800',
    orange: '#FF6C2F',
    fluorescentPink: '#FF48B0',
    lightGray: '#88898A',
    cornflower: '#62A8E5',
    violet: '#9D7AD2',
} as const;

/** How a plate prints a tint: as it is, as dots on a rotated grid, or as fine random grain. */
export type RisoScreen = 'solid' | 'halftone' | 'grain';

export interface RisoInk {
    /** The ink color, such as RISO_INKS.fluorescentPink. */
    color: string;
    /** How tints print. Default 'grain'. Solid areas print the same with every screen. */
    screen?: RisoScreen;
    /** 'halftone': the dot pitch in CSS px. Default 5. */
    cell?: number;
    /** 'halftone': the screen angle in degrees. Default: 15, 75, 45, 0 for the inks in order. */
    angle?: number;
}

export interface RisoOptions {
    /** Ink name to color, or to ink settings. Printed in this order. */
    inks: Record<string, string | RisoInk>;
    /** Picks the misregistration, the jitter and the mottle. Default 1. */
    seed?: number;
    /** The most ink a solid lays down, 0 to 1: the paper always shows through a little. Default 0.85. */
    coverage?: number;
    /** How far each plate sits off true, CSS px, fixed for the run. Default 2.5. */
    misregister?: number;
    /** How far each plate wanders from one printed drawing to the next, CSS px. Default 0.8. */
    jitter?: number;
    /** How uneven the ink lies, 0 (flat) to 1. Default 0.5. */
    mottle?: number;
}

export interface RisoPrintOptions {
    /** The time of the drawing: the jitter and the mottle change when it changes. Pass onTwos(t, fps) to print one drawing per two frames. Default 0. */
    t?: number;
}

export interface Riso {
    /** The ink names, in printing order. */
    readonly inks: string[];
    /**
     * Pull one print onto `ctx`: clear every plate, let `draw` fill them (one
     * context per ink, in CSS px, where only how opaque a mark is counts), then
     * lay each ink down by multiplying. Draw the paper on `ctx` first, or give
     * the canvas `mix-blend-mode: multiply` over the paper layer.
     */
    print(
        ctx: CanvasRenderingContext2D,
        draw: (plates: Record<string, CanvasRenderingContext2D>) => void,
        options?: RisoPrintOptions,
    ): void;
    /** Where plate `ink` sits at time t: its offset from true, in CSS px. */
    offset(ink: string, t?: number): { x: number; y: number };
}

interface Plate {
    name: string;
    color: string;
    screen: RisoScreen;
    cell: number;
    angle: number;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
}

const ANGLES = [15, 75, 45, 0];
/** Mottle textures per ink: each printed drawing uses one, shifted. */
/** The mottle texture's pixels per CSS px: soft blotches need few. */
const MOTTLE_SCALE = 1 / 6;
/** Where the halftone grid starts, in cells: off the pixel centers so no two pixels of a cell tie. */
const GRID_PHASE_U = 0.137;
const GRID_PHASE_V = 0.291;

/** A hash in [0, 1) for a device pixel, cheap enough for every pixel of a plate. */
function pixelHash(x: number, y: number, seed: number): number {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

/**
 * The share of a cell within distance r of its middle, the cell one unit wide:
 * how much a dot of radius r covers. Once the dot passes the cell's sides the
 * parts outside are cut off, so the share climbs evenly to 1 at the corners.
 */
export function dotArea(r: number): number {
    if (r <= 0.5) return Math.PI * r * r;
    if (r >= Math.SQRT1_2) return 1;
    const cut = r * r * Math.acos(0.5 / r) - 0.5 * Math.sqrt(r * r - 0.25);
    return Math.PI * r * r - 4 * cut;
}

/**
 * Screen a plate's alpha in place: each device pixel prints fully or not at
 * all, by the density there against the screen's threshold. `cell` and `angle`
 * shape the halftone grid, in device px and degrees.
 */
export function screenPlate(
    alpha: Uint8ClampedArray,
    width: number,
    height: number,
    screen: 'halftone' | 'grain',
    options: { cell?: number; angle?: number; seed?: number } = {},
): void {
    const seed = options.seed ?? 1;
    const cell = options.cell ?? 5;
    const a = ((options.angle ?? 15) * Math.PI) / 180;
    const cos = Math.cos(a) / cell;
    const sin = Math.sin(a) / cell;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4 + 3;
            const d = alpha[i] / 255;
            if (d <= 0) continue;
            if (d >= 1) continue;
            let threshold: number;
            if (screen === 'grain') {
                threshold = pixelHash(x, y, seed);
            } else {
                // A dot grows from the middle of this pixel's cell on the turned
                // grid: the pixel prints once the dot's area passes the density.
                // The grid sits a little off the pixels, so pixels on a grid
                // turned by 0 or 90 degrees are not the same distance from the
                // middle in fours and eights, and print one by one.
                const u = (x + 0.5) * cos + (y + 0.5) * sin + GRID_PHASE_U;
                const v = -(x + 0.5) * sin + (y + 0.5) * cos + GRID_PHASE_V;
                const fu = u - Math.floor(u) - 0.5;
                const fv = v - Math.floor(v) - 0.5;
                threshold = dotArea(Math.sqrt(fu * fu + fv * fv));
            }
            alpha[i] = d > threshold ? 255 : 0;
        }
    }
}

/** A soft mottle, smallest where the ink lies thinnest: alpha from coverage down. */
function mottleTexture(
    width: number,
    height: number,
    coverage: number,
    amount: number,
    seed: number,
): HTMLCanvasElement {
    const w = Math.max(2, Math.ceil(width * MOTTLE_SCALE));
    const h = Math.max(2, Math.ceil(height * MOTTLE_SCALE));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const img = ctx.createImageData(w, h);
    // Two octaves of value noise: broad blotches and a finer cloud.
    const noise = (x: number, y: number, step: number, key: string) => {
        const gx = Math.floor(x / step);
        const gy = Math.floor(y / step);
        const fx = x / step - gx;
        const fy = y / step - gy;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const at = (i: number, j: number) => rand(seed, key, gx + i, gy + j);
        const top = at(0, 0) + (at(1, 0) - at(0, 0)) * sx;
        const bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * sx;
        return top + (bottom - top) * sy;
    };
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const n = 0.65 * noise(x, y, 14, 'broad') + 0.35 * noise(x, y, 4, 'fine');
            const i = (y * w + x) * 4;
            img.data[i] = 0;
            img.data[i + 1] = 0;
            img.data[i + 2] = 0;
            img.data[i + 3] = Math.round(255 * coverage * (1 - amount * 0.35 * n));
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}

/**
 * A riso press for a width by height CSS px picture. Build it once, outside
 * seek(), and call print() every frame.
 */
export function riso(width: number, height: number, options: RisoOptions): Riso {
    const names = Object.keys(options.inks);
    if (names.length === 0) throw new Error('riso: give at least one ink');
    const seed = options.seed ?? 1;
    const coverage = Math.min(1, Math.max(0, options.coverage ?? 0.85));
    const misregister = options.misregister ?? 2.5;
    const jitter = options.jitter ?? 0.8;
    const mottle = Math.min(1, Math.max(0, options.mottle ?? 0.5));
    const plates: Plate[] = names.map((name, i) => {
        const raw = options.inks[name];
        const ink = typeof raw === 'string' ? { color: raw } : raw;
        if (!/^#[0-9a-fA-F]{6}$/.test(ink.color)) {
            throw new Error(`riso: ink "${name}" needs a color as #rrggbb (got ${ink.color})`);
        }
        const canvas = document.createElement('canvas');
        return {
            name,
            color: ink.color,
            screen: ink.screen ?? 'grain',
            cell: ink.cell ?? 5,
            angle: ink.angle ?? ANGLES[i % ANGLES.length],
            canvas,
            ctx: setupCanvas(canvas, width, height),
        };
    });
    // The mottle is made small and scaled up to device pixels once: scaling it
    // at every print was most of the print's time. One sheet serves every ink,
    // each ink and drawing taking it from a spot of its own.
    let sheet: HTMLCanvasElement | undefined;
    const sheetAt = (dpr: number) => {
        if (!sheet) {
            const small = mottleTexture(
                width * 1.25,
                height * 1.25,
                coverage,
                mottle,
                Math.floor(rand(seed, 'mottle') * 2 ** 31),
            );
            sheet = document.createElement('canvas');
            sheet.width = Math.ceil(width * 1.25 * dpr);
            sheet.height = Math.ceil(height * 1.25 * dpr);
            const g = sheet.getContext('2d') as CanvasRenderingContext2D;
            g.imageSmoothingEnabled = true;
            g.imageSmoothingQuality = 'high';
            g.drawImage(small, 0, 0, sheet.width, sheet.height);
        }
        return sheet;
    };
    // Which drawing t belongs to, for the jitter and the mottle: t to the millisecond.
    const drawingOf = (t: number) => Math.round(t * 1000);
    const offset = (name: string, t = 0) => {
        if (!names.includes(name))
            throw new Error(`riso: no ink "${name}" (inks: ${names.join(', ')})`);
        const k = drawingOf(t);
        const a = rand(seed, 'misregister-angle', name) * Math.PI * 2;
        const r = misregister * (0.5 + 0.5 * rand(seed, 'misregister', name));
        return {
            x: r * Math.cos(a) + jitter * (rand(seed, 'jitter-x', name, k) * 2 - 1),
            y: r * Math.sin(a) + jitter * (rand(seed, 'jitter-y', name, k) * 2 - 1),
        };
    };
    return {
        inks: names,
        offset,
        print(ctx, draw, printOptions = {}) {
            const t = printOptions.t ?? 0;
            const k = drawingOf(t);
            const byName: Record<string, CanvasRenderingContext2D> = {};
            for (const p of plates) {
                p.ctx.save();
                p.ctx.setTransform(1, 0, 0, 1, 0, 0);
                p.ctx.globalCompositeOperation = 'source-over';
                p.ctx.globalAlpha = 1;
                p.ctx.clearRect(0, 0, p.canvas.width, p.canvas.height);
                p.ctx.restore();
                p.ctx.save();
                // The path is not part of save() and restore(): start each plate empty.
                p.ctx.beginPath();
                byName[p.name] = p.ctx;
            }
            try {
                draw(byName);
            } finally {
                for (const p of plates) p.ctx.restore();
            }
            const dpr = plates[0].canvas.width / width;
            for (const p of plates) {
                const c = p.ctx;
                c.save();
                c.setTransform(1, 0, 0, 1, 0, 0);
                if (p.screen !== 'solid') {
                    const img = c.getImageData(0, 0, p.canvas.width, p.canvas.height);
                    screenPlate(img.data, p.canvas.width, p.canvas.height, p.screen, {
                        cell: p.cell * dpr,
                        angle: p.angle,
                        seed: Math.floor(rand(seed, 'grain', p.name) * 2 ** 31),
                    });
                    c.putImageData(img, 0, 0);
                }
                // The ink's color where the plate has ink.
                c.globalCompositeOperation = 'source-in';
                c.fillStyle = p.color;
                c.fillRect(0, 0, p.canvas.width, p.canvas.height);
                // Uneven ink, never quite full: a mottle texture, a different one and
                // shifted for each drawing, as each sheet takes the ink its own way.
                const sx = Math.round(rand(seed, 'texture-x', p.name, k) * width * 0.2 * dpr);
                const sy = Math.round(rand(seed, 'texture-y', p.name, k) * height * 0.2 * dpr);
                c.globalCompositeOperation = 'destination-in';
                c.drawImage(sheetAt(dpr), -sx, -sy);
                c.restore();
                // Set off by whole device pixels: a plate moved by a fraction is
                // resampled, which blurs its dots and grain (and takes longer).
                const o = offset(p.name, t);
                ctx.save();
                ctx.globalCompositeOperation = 'multiply';
                ctx.drawImage(
                    p.canvas,
                    Math.round(o.x * dpr) / dpr,
                    Math.round(o.y * dpr) / dpr,
                    width,
                    height,
                );
                ctx.restore();
            }
        },
    };
}
