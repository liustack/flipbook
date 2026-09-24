// Hand-made surface marks for Canvas 2D. Every function draws the same pixels
// for the same arguments: stroke positions come from integer hashes of grid
// cells, never from the order of random calls, so a mark stays put across
// frames and seeks. Each call batches its marks into one or a few Path2D
// objects and strokes or fills them once.
//
// hatch and crossHatch follow formHatch from alesha-pro/tools and halftone's
// tile cache follows riso-rooms from IshaanKalra2103/creative-skills, both MIT.
// See THIRD_PARTY_NOTICES.md.
import { rgb, rgba } from './color.ts';
import { clamp } from './core/ease.ts';
import { noise1 } from './core/noise.ts';
import { ihash } from './hash.ts';

export type Point = readonly [number, number];

export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** A constant, or a value that depends on the position (CSS px). */
export type Field = number | ((x: number, y: number) => number);

function field(value: Field | undefined, fallback: number): (x: number, y: number) => number {
    if (value === undefined) return () => fallback;
    if (typeof value === 'number') return () => value;
    return value;
}

const INK = '#2b2622';
const GRAPHITE = '#3d3b3c';
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- points

/** Points around an ellipse, for pencil outlines and torn shapes. */
export function ellipsePoints(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rotation = 0,
    steps = 64,
): Point[] {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const out: Point[] = [];
    for (let i = 0; i < steps; i++) {
        const a = (i / steps) * TAU;
        const x = Math.cos(a) * rx;
        const y = Math.sin(a) * ry;
        out.push([cx + x * cos - y * sin, cy + x * sin + y * cos]);
    }
    return out;
}

/** Points along a circular arc from angle a0 to a1 (radians), for curved lines and text paths. */
export function arcPoints(
    cx: number,
    cy: number,
    radius: number,
    a0: number,
    a1: number,
    steps = 48,
): Point[] {
    const out: Point[] = [];
    for (let i = 0; i <= steps; i++) {
        const a = a0 + ((a1 - a0) * i) / steps;
        out.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
    }
    return out;
}

/** Points of a rectangle's outline, clockwise from the top left. */
export function boxPoints(box: Box): Point[] {
    const { x, y, width, height } = box;
    return [
        [x, y],
        [x + width, y],
        [x + width, y + height],
        [x, y + height],
    ];
}

/** The polyline resampled to points `step` px apart along its length. */
export function resample(points: readonly Point[], step: number, closed = false): Point[] {
    if (points.length < 2) return points.map((p) => [p[0], p[1]] as Point);
    const src = closed ? [...points, points[0]] : points;
    const out: Point[] = [[src[0][0], src[0][1]]];
    let carry = 0;
    for (let i = 1; i < src.length; i++) {
        const [ax, ay] = src[i - 1];
        const [bx, by] = src[i];
        const len = Math.hypot(bx - ax, by - ay);
        let d = step - carry;
        while (d <= len) {
            const t = d / len;
            out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
            d += step;
        }
        carry = len - (d - step);
    }
    const last = src[src.length - 1];
    const tail = out[out.length - 1];
    if (!closed && Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.25) {
        out.push([last[0], last[1]]);
    }
    if (closed && out.length > 1) {
        const head = out[0];
        if (Math.hypot(head[0] - tail[0], head[1] - tail[1]) < step * 0.5) out.pop();
    }
    return out;
}

// ---------------------------------------------------------------- pencil

export interface PencilOptions {
    seed?: number;
    /** Line width in CSS px. Default 1.8. */
    width?: number;
    color?: string;
    /** Default 0.85. */
    opacity?: number;
    /** Overlapping passes of the lead, 1 to 4. Default 2. */
    passes?: number;
    /** Slow drift of each pass off the line, in px. Default 1.2. */
    wobble?: number;
    /** How much the paper tooth breaks up the graphite, 0 to 1. Default 0.4. */
    grain?: number;
    closed?: boolean;
}

const TOOTH_TILE = 192;
const TOOTH_STEP = 3;
const toothTiles = new Map<string, HTMLCanvasElement>();

/** A seamless tile of graphite on paper tooth: the color with a broken, grainy alpha. */
function toothTile(color: string, grain: number): HTMLCanvasElement {
    const level = Math.round(grain * 20);
    const key = `${color}|${level}`;
    const hit = toothTiles.get(key);
    if (hit) return hit;
    const canvas = document.createElement('canvas');
    canvas.width = TOOTH_TILE;
    canvas.height = TOOTH_TILE;
    const c = canvas.getContext('2d');
    if (!c) throw new Error('2D canvas context unavailable');
    const img = c.createImageData(TOOTH_TILE, TOOTH_TILE);
    const [r, g, b] = rgb(color);
    const period = TOOTH_TILE / TOOTH_STEP;
    const lattice = (x: number, y: number) =>
        ihash(((x % period) + period) % period, ((y % period) + period) % period, 0x70074);
    const g01 = level / 20;
    for (let y = 0; y < TOOTH_TILE; y++) {
        for (let x = 0; x < TOOTH_TILE; x++) {
            const fx = x / TOOTH_STEP;
            const fy = y / TOOTH_STEP;
            const x0 = Math.floor(fx);
            const y0 = Math.floor(fy);
            const sx = (fx - x0) * (fx - x0) * (3 - 2 * (fx - x0));
            const sy = (fy - y0) * (fy - y0) * (3 - 2 * (fy - y0));
            const top = lattice(x0, y0) + (lattice(x0 + 1, y0) - lattice(x0, y0)) * sx;
            const bottom =
                lattice(x0, y0 + 1) + (lattice(x0 + 1, y0 + 1) - lattice(x0, y0 + 1)) * sx;
            const n = top + (bottom - top) * sy;
            const fine = ihash(x, y, 0x70075);
            const alpha = clamp(1 - g01 * 0.35 + (n - 0.5) * g01 * 1.9 + (fine - 0.5) * g01 * 0.7);
            const i = (y * TOOTH_TILE + x) * 4;
            img.data[i] = r;
            img.data[i + 1] = g;
            img.data[i + 2] = b;
            img.data[i + 3] = alpha * 255;
        }
    }
    c.putImageData(img, 0, 0);
    toothTiles.set(key, canvas);
    return canvas;
}

/**
 * A graphite line along `points`: a few drifting passes, thinner at the ends,
 * textured by the paper tooth. The texture is fixed to the canvas, so a line
 * redrawn in place keeps its grain.
 */
export function pencil(
    ctx: CanvasRenderingContext2D,
    points: readonly Point[],
    options: PencilOptions = {},
): void {
    const seed = options.seed ?? 1;
    const width = options.width ?? 1.8;
    const passes = clamp(Math.round(options.passes ?? 2), 1, 4);
    const wobble = options.wobble ?? 1.2;
    const grain = clamp(options.grain ?? 0.4, 0, 1);
    const closed = options.closed ?? false;
    const pts = resample(points, 3, closed);
    if (pts.length < 2) return;
    const n = pts.length;
    const count = closed ? n : n - 1;
    const pattern = ctx.createPattern(toothTile(options.color ?? GRAPHITE, grain), 'repeat');
    if (!pattern) throw new Error('could not create the pencil texture');
    pattern.setTransform(new DOMMatrix().scaleSelf(0.5));
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = pattern;
    for (let p = 0; p < passes; p++) {
        const body = new Path2D();
        const tips = new Path2D();
        const offset = (i: number): Point => {
            const k = i % n;
            const a = closed ? pts[(k - 1 + n) % n] : pts[Math.max(0, k - 1)];
            const b = closed ? pts[(k + 1) % n] : pts[Math.min(n - 1, k + 1)];
            const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
            const tx = (b[0] - a[0]) / tl;
            const ty = (b[1] - a[1]) / tl;
            const drift =
                (noise1(seed + p * 31, (k * 3) / 38) - 0.5) * 2 * wobble +
                (ihash(k, p, seed + 7) - 0.5) * 0.3 * wobble;
            return [pts[k][0] - ty * drift, pts[k][1] + tx * drift];
        };
        let current: Path2D | null = null;
        for (let i = 0; i < count; i++) {
            const along = i / count;
            const path = !closed && (along < 0.06 || along > 0.94) ? tips : body;
            const a = offset(i);
            const b = offset(i + 1);
            if (current !== path) {
                path.moveTo(a[0], a[1]);
                current = path;
            }
            path.lineTo(b[0], b[1]);
        }
        ctx.globalAlpha = (options.opacity ?? 0.85) * (p === 0 ? 1 : 0.5);
        ctx.lineWidth = width * (1 - p * 0.2);
        ctx.stroke(body);
        ctx.lineWidth = width * (1 - p * 0.2) * 0.55;
        ctx.stroke(tips);
    }
    ctx.restore();
}

// ---------------------------------------------------------------- hatching

export interface HatchOptions {
    seed?: number;
    /** Grid pitch in px: one stroke per cell at most. Default 8. */
    spacing?: number;
    /** Stroke length in px. Default 16. */
    length?: number;
    /** Stroke direction in radians, or a direction field. Default -0.9. */
    angle?: Field;
    /** Share of cells that carry a stroke, 0 to 1, or a tone field. Default 0.5. */
    tone?: Field;
    /** Line width in px. Default 1. */
    width?: number;
    color?: string;
    /** Default 0.7. */
    opacity?: number;
    /** How far a stroke may sit off its cell center, as a share of spacing. Default 0.6. */
    jitter?: number;
    /** Bend as a share of the length. Default 0.1. */
    curve?: number;
    /** Only draw inside this path. */
    clip?: Path2D;
}

/**
 * The strokes of a hatch over `box`, as two paths (thin and full width). A
 * stroke belongs to a grid cell of the whole plane: whether it exists, where
 * it sits and how long it is come from the cell's id, so moving or resizing
 * the box never reshuffles the strokes inside it.
 */
export function hatchPaths(
    box: Box,
    options: HatchOptions = {},
): { thin: Path2D; full: Path2D; strokes: number } {
    const seed = options.seed ?? 1;
    const spacing = options.spacing ?? 8;
    const length = options.length ?? 16;
    if (!(spacing > 0 && length > 0)) throw new Error('hatch needs a positive spacing and length');
    const angle = field(options.angle, -0.9);
    const tone = field(options.tone, 0.5);
    const jitter = options.jitter ?? 0.6;
    const curve = options.curve ?? 0.1;
    const thin = new Path2D();
    const full = new Path2D();
    let strokes = 0;
    const pad = length;
    const ix0 = Math.floor((box.x - pad) / spacing);
    const ix1 = Math.ceil((box.x + box.width + pad) / spacing);
    const iy0 = Math.floor((box.y - pad) / spacing);
    const iy1 = Math.ceil((box.y + box.height + pad) / spacing);
    for (let iy = iy0; iy <= iy1; iy++) {
        for (let ix = ix0; ix <= ix1; ix++) {
            const cx = (ix + 0.5 + (ihash(ix, iy, seed) - 0.5) * jitter) * spacing;
            const cy = (iy + 0.5 + (ihash(ix, iy, seed + 1) - 0.5) * jitter) * spacing;
            if (ihash(ix, iy, seed + 2) >= clamp(tone(cx, cy))) continue;
            const a = angle(cx, cy);
            const len = length * (0.65 + ihash(ix, iy, seed + 3) * 0.55);
            const dx = (Math.cos(a) * len) / 2;
            const dy = (Math.sin(a) * len) / 2;
            const x0 = cx - dx;
            const y0 = cy - dy;
            const x1 = cx + dx;
            const y1 = cy + dy;
            const bend = (ihash(ix, iy, seed + 4) - 0.5) * 2 * curve * len;
            const reach = Math.abs(bend) / 2 + (options.width ?? 1);
            if (
                Math.max(x0, x1) + reach < box.x ||
                Math.min(x0, x1) - reach > box.x + box.width ||
                Math.max(y0, y1) + reach < box.y ||
                Math.min(y0, y1) - reach > box.y + box.height
            ) {
                continue;
            }
            const path = ihash(ix, iy, seed + 5) < 0.35 ? thin : full;
            path.moveTo(x0, y0);
            path.quadraticCurveTo(cx - Math.sin(a) * bend, cy + Math.cos(a) * bend, x1, y1);
            strokes++;
        }
    }
    return { thin, full, strokes };
}

/** Short parallel strokes over `box`, denser where the tone is higher. Returns the stroke count. */
export function hatch(ctx: CanvasRenderingContext2D, box: Box, options: HatchOptions = {}): number {
    const { thin, full, strokes } = hatchPaths(box, options);
    const width = options.width ?? 1;
    ctx.save();
    if (options.clip) ctx.clip(options.clip);
    ctx.lineCap = 'round';
    ctx.strokeStyle = options.color ?? INK;
    ctx.globalAlpha *= options.opacity ?? 0.7;
    ctx.lineWidth = width;
    ctx.stroke(full);
    ctx.lineWidth = width * 0.6;
    ctx.stroke(thin);
    ctx.restore();
    return strokes;
}

export interface CrossHatchOptions extends HatchOptions {
    /** Layers of strokes, 2 or 3. Default 2. */
    layers?: number;
    /** Turn between layers in radians. Default 1.1. */
    turn?: number;
}

/**
 * Hatching in layers at turning angles: the first layer covers the light
 * tones, each further layer only adds strokes where the tone is darker.
 * Returns the stroke count.
 */
export function crossHatch(
    ctx: CanvasRenderingContext2D,
    box: Box,
    options: CrossHatchOptions = {},
): number {
    const layers = clamp(Math.round(options.layers ?? 2), 1, 4);
    const turn = options.turn ?? 1.1;
    const tone = field(options.tone, 0.6);
    const angle = field(options.angle, -0.9);
    const seed = options.seed ?? 1;
    let strokes = 0;
    for (let k = 0; k < layers; k++) {
        strokes += hatch(ctx, box, {
            ...options,
            seed: seed + k * 101,
            angle: (x, y) => angle(x, y) + k * turn,
            tone: (x, y) => clamp(tone(x, y) * layers - k),
        });
    }
    return strokes;
}

// ---------------------------------------------------------------- halftone

export interface HalftoneOptions {
    seed?: number;
    /** Dot pitch in px. Default 6. */
    cell?: number;
    /** Screen angle in radians. Default 0.26 (15 degrees). */
    angle?: number;
    /** Ink coverage 0 to 1, or a tone field. Default 0.4. */
    tone?: Field;
    color?: string;
    /** Default 1. */
    opacity?: number;
    /** Dot position noise as a share of the pitch. Default 0.08. */
    jitter?: number;
    /** Only print inside this path. */
    clip?: Path2D;
}

const SS = 4;
const TILE = 8;
const LEVELS = 32;
const tiles = new Map<string, HTMLCanvasElement>();

/** One repeat of a flat-tone screen, drawn once per color, pitch and tone level. */
function screenTile(color: string, cell: number, level: number, seed: number): HTMLCanvasElement {
    const key = `${color}|${cell}|${level}|${seed}`;
    const hit = tiles.get(key);
    if (hit) return hit;
    const pitch = cell * SS;
    const size = Math.ceil(pitch * TILE);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const c = canvas.getContext('2d');
    if (!c) throw new Error('2D canvas context unavailable');
    c.fillStyle = color;
    const tone = level / LEVELS;
    if (level >= LEVELS) {
        c.fillRect(0, 0, size, size);
    } else if (tone <= 0.5) {
        c.beginPath();
        for (let y = 0; y < TILE; y++) {
            for (let x = 0; x < TILE; x++) {
                const r = pitch * Math.sqrt(tone / Math.PI) * (0.92 + ihash(x, y, seed) * 0.16);
                const px = (x + 0.5) * pitch;
                const py = (y + 0.5) * pitch;
                c.moveTo(px + r, py);
                c.arc(px, py, r, 0, TAU);
            }
        }
        c.fill();
    } else {
        c.fillRect(0, 0, size, size);
        c.globalCompositeOperation = 'destination-out';
        c.beginPath();
        for (let y = 0; y <= TILE; y++) {
            for (let x = 0; x <= TILE; x++) {
                const r =
                    pitch *
                    Math.sqrt((1 - tone) / Math.PI) *
                    (0.92 + ihash(x % TILE, y % TILE, seed) * 0.16);
                c.moveTo(x * pitch + r, y * pitch);
                c.arc(x * pitch, y * pitch, r, 0, TAU);
            }
        }
        c.fill();
    }
    tiles.set(key, canvas);
    return canvas;
}

/**
 * Halftone dots over `box` on a screen anchored at the canvas origin, so the
 * screen stays on the paper while shapes move under it. A constant tone
 * prints from a cached screen tile. A tone field places every dot. Returns the
 * number of dots placed (0 for the cached tile).
 */
export function halftone(
    ctx: CanvasRenderingContext2D,
    box: Box,
    options: HalftoneOptions = {},
): number {
    const seed = options.seed ?? 1;
    const cell = options.cell ?? 6;
    if (!(cell > 0)) throw new Error('halftone needs a positive cell');
    const angle = options.angle ?? 0.26;
    const color = options.color ?? INK;
    const jitter = options.jitter ?? 0.08;
    const tone = options.tone ?? 0.4;
    ctx.save();
    if (options.clip) ctx.clip(options.clip);
    ctx.globalAlpha *= options.opacity ?? 1;
    let dots = 0;
    if (typeof tone === 'number') {
        const level = Math.round(clamp(tone) * LEVELS);
        if (level > 0) {
            const pattern = ctx.createPattern(screenTile(color, cell, level, seed), 'repeat');
            if (!pattern) throw new Error('could not create the halftone pattern');
            pattern.setTransform(
                new DOMMatrix().rotateSelf((angle * 180) / Math.PI).scaleSelf(1 / SS),
            );
            ctx.fillStyle = pattern;
            ctx.fillRect(box.x, box.y, box.width, box.height);
        }
    } else {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const corners = [
            [box.x, box.y],
            [box.x + box.width, box.y],
            [box.x, box.y + box.height],
            [box.x + box.width, box.y + box.height],
        ];
        const us = corners.map(([x, y]) => (x * cos + y * sin) / cell);
        const vs = corners.map(([x, y]) => (-x * sin + y * cos) / cell);
        const path = new Path2D();
        for (let v = Math.floor(Math.min(...vs)) - 1; v <= Math.ceil(Math.max(...vs)) + 1; v++) {
            for (
                let u = Math.floor(Math.min(...us)) - 1;
                u <= Math.ceil(Math.max(...us)) + 1;
                u++
            ) {
                const su = (u + 0.5 + (ihash(u, v, seed) - 0.5) * jitter) * cell;
                const sv = (v + 0.5 + (ihash(u, v, seed + 1) - 0.5) * jitter) * cell;
                const x = su * cos - sv * sin;
                const y = su * sin + sv * cos;
                if (x < box.x || y < box.y || x > box.x + box.width || y > box.y + box.height) {
                    continue;
                }
                const t = clamp(tone(x, y));
                if (t <= 0.01) continue;
                const r = cell * 0.62 * Math.sqrt(t);
                path.moveTo(x + r, y);
                path.arc(x, y, r, 0, TAU);
                dots++;
            }
        }
        ctx.fillStyle = color;
        ctx.fill(path);
    }
    ctx.restore();
    return dots;
}

// ---------------------------------------------------------------- torn paper

export interface TornOptions {
    seed?: number;
    /** How far the edge wanders, in px. Default 5. */
    roughness?: number;
    /** Spacing of edge points, in px. Default 3. */
    detail?: number;
}

function tornPoints(points: readonly Point[], options: TornOptions, salt: number): Point[] {
    const seed = (options.seed ?? 1) + salt;
    const rough = options.roughness ?? 5;
    const pts = resample(points, options.detail ?? 3, true);
    const n = pts.length;
    let area = 0;
    for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        area += a[0] * b[1] - b[0] * a[1];
    }
    const outward = area > 0 ? 1 : -1;
    return pts.map((p, i) => {
        const a = pts[(i - 1 + n) % n];
        const b = pts[(i + 1) % n];
        let nx = b[1] - a[1];
        let ny = a[0] - b[0];
        const len = Math.hypot(nx, ny) || 1;
        nx = (nx / len) * outward;
        ny = (ny / len) * outward;
        const slow = (noise1(seed, i / 9) - 0.5) * 2;
        const mid = (noise1(seed + 5, i / 2.5) - 0.5) * 2;
        const jag = (ihash(i, 0, seed) - 0.5) * 2;
        const d = rough * (slow * 0.55 + mid * 0.3 + jag * 0.15);
        return [p[0] + nx * d, p[1] + ny * d] as Point;
    });
}

function toPath(points: readonly Point[]): Path2D {
    const path = new Path2D();
    points.forEach(([x, y], i) => {
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
    });
    path.closePath();
    return path;
}

/** A closed outline with a torn edge. */
export function tornPath(points: readonly Point[], options: TornOptions = {}): Path2D {
    return toPath(tornPoints(points, options, 0));
}

export interface TornPaperOptions extends TornOptions {
    /** Color of the scrap. Default '#f3ecdc'. */
    fill?: string;
    /** The paper core that shows along the tear. Default '#fbf7ee'. */
    rim?: string;
    /** Width of the core along the tear, in px. Default 2.5. */
    rimWidth?: number;
    /** Drop shadow strength, 0 to 1. Default 0.35. */
    shadow?: number;
}

/**
 * A scrap of paper with torn edges: soft shadow, a pale fibrous core showing
 * along the tear, then the face. Returns the face outline, for clipping what
 * is drawn on the scrap.
 */
export function tornPaper(
    ctx: CanvasRenderingContext2D,
    shape: readonly Point[] | Box,
    options: TornPaperOptions = {},
): Path2D {
    const points = Array.isArray(shape) ? (shape as readonly Point[]) : boxPoints(shape as Box);
    const rough = options.roughness ?? 5;
    const rimWidth = options.rimWidth ?? 2.5;
    const seed = options.seed ?? 1;
    const faceOutline = tornPoints(points, options, 0);
    const rimOutline = tornPoints(points, { ...options, roughness: rough * 1.1 }, 37).map(
        ([x, y], i) => {
            const f = faceOutline[i % faceOutline.length];
            const dx = x - f[0];
            const dy = y - f[1];
            const spread = rimWidth * (0.4 + ihash(i, 1, seed) * 1.2);
            const len = Math.hypot(dx, dy) || 1;
            return [x + (dx / len) * spread * 0.5, y + (dy / len) * spread * 0.5] as Point;
        },
    );
    const face = toPath(faceOutline);
    const rim = toPath(rimOutline);
    const shadow = options.shadow ?? 0.35;
    ctx.save();
    if (shadow > 0) {
        ctx.save();
        ctx.shadowColor = `rgba(40, 28, 16, ${0.45 * shadow})`;
        ctx.shadowBlur = 6;
        ctx.shadowOffsetX = 1.5;
        ctx.shadowOffsetY = 3;
        ctx.fillStyle = options.rim ?? '#fbf7ee';
        ctx.fill(rim);
        ctx.restore();
    }
    ctx.fillStyle = options.rim ?? '#fbf7ee';
    ctx.fill(rim);
    const hairs = new Path2D();
    rimOutline.forEach(([x, y], i) => {
        if (ihash(i, 2, seed) > 0.18) return;
        const a = ihash(i, 3, seed) * TAU;
        const l = 1.5 + ihash(i, 4, seed) * rimWidth * 1.6;
        hairs.moveTo(x, y);
        hairs.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    });
    ctx.strokeStyle = rgba(options.rim ?? '#fbf7ee', 0.9);
    ctx.lineWidth = 0.6;
    ctx.stroke(hairs);
    ctx.fillStyle = options.fill ?? '#f3ecdc';
    ctx.fill(face);
    ctx.restore();
    return face;
}

// ---------------------------------------------------------------- stipple

export interface StippleOptions {
    seed?: number;
    /** Pitch of the grid of candidate dots in px: one dot per cell at most. Default 3. */
    cell?: number;
    /** Share of cells that get a dot, 0 to 1, or a tone field. Default 0.3. */
    tone?: Field;
    /** Dot radius range in px. Darker tones get the larger dots. Default [0.4, 0.9]. */
    size?: [number, number];
    color?: string;
    /** Default 0.8. */
    opacity?: number;
    /** Only dot inside this path. */
    clip?: Path2D;
}

/**
 * Engraver's stipple: dots scattered at random inside a grid of cells, more
 * and larger where the tone is darker. Each dot belongs to its cell, so the
 * dots hold still while the tone changes around them. Returns the dot count.
 */
export function stipple(
    ctx: CanvasRenderingContext2D,
    box: Box,
    options: StippleOptions = {},
): number {
    const seed = options.seed ?? 1;
    const cell = options.cell ?? 3;
    if (!(cell > 0)) throw new Error('stipple needs a positive cell');
    const tone = field(options.tone, 0.3);
    const [min, max] = options.size ?? [0.4, 0.9];
    const path = new Path2D();
    let dots = 0;
    const ix0 = Math.floor(box.x / cell);
    const ix1 = Math.ceil((box.x + box.width) / cell);
    const iy0 = Math.floor(box.y / cell);
    const iy1 = Math.ceil((box.y + box.height) / cell);
    for (let iy = iy0; iy < iy1; iy++) {
        for (let ix = ix0; ix < ix1; ix++) {
            const x = (ix + ihash(ix, iy, seed)) * cell;
            const y = (iy + ihash(ix, iy, seed + 1)) * cell;
            if (x < box.x || y < box.y || x > box.x + box.width || y > box.y + box.height) continue;
            const t = clamp(tone(x, y));
            if (ihash(ix, iy, seed + 2) >= t) continue;
            const r = min + (max - min) * Math.sqrt(t) * (0.5 + ihash(ix, iy, seed + 3) * 0.5);
            path.moveTo(x + r, y);
            path.arc(x, y, r, 0, TAU);
            dots++;
        }
    }
    ctx.save();
    if (options.clip) ctx.clip(options.clip);
    ctx.globalAlpha *= options.opacity ?? 0.8;
    ctx.fillStyle = options.color ?? INK;
    ctx.fill(path);
    ctx.restore();
    return dots;
}
