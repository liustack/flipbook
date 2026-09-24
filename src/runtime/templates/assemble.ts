// Assemble a glyph from objects: N pieces fly in one after another and land
// on slots packed inside a character, landing on beats or on mark cues.
import { rgba } from '../color.ts';
import { clamp, type Easing, ease, lerp } from '../core/ease.ts';
import type { ResolvedTimeline } from '../core/timeline.ts';
import { ihash } from '../hash.ts';
import type { Box, Point } from '../materials.ts';

// ---------------------------------------------------------------- mask

/** Which cells of a grid laid over the stage lie inside a shape. */
export interface Mask {
    /** Stage position of cell (0, 0)'s top left corner, in CSS px. */
    x: number;
    y: number;
    /** Cell pitch in CSS px. */
    cell: number;
    cols: number;
    rows: number;
    /** 1 inside, 0 outside, row by row. */
    inside: Uint8Array;
}

export interface GlyphMaskOptions {
    /** One character or a short word. */
    text: string;
    /** Where the glyph goes on the stage. It is scaled to fit, centered, proportions kept. */
    box: Box;
    /** CSS font with a flipbook family. The size is ignored. Default heavy Noto Serif SC. */
    font?: string;
    /** Sampling pitch in CSS px. Default 4. */
    cell?: number;
    /** Thicken every stroke by this many px on each side, with round corners. Default 0. */
    grow?: number;
}

function familyPart(font: string): { style: string; family: string } {
    const match = /^(.*?)(\d+(?:\.\d+)?)px(?:\/\S+)?\s+(.+)$/.exec(font.trim());
    if (!match) throw new Error(`Give the font as "<weight> <size>px <family>": "${font}"`);
    return { style: match[1].trim(), family: match[3] };
}

/**
 * Rasterize text with a flipbook font into a mask fitted to `box`. Needs the
 * font loaded, so call it in setup.
 */
export function glyphMask(options: GlyphMaskOptions): Mask {
    const cell = options.cell ?? 4;
    const { box } = options;
    const grow = Math.max(0, options.grow ?? 0);
    const { style, family } = familyPart(options.font ?? '900 100px "Noto Serif SC"');
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(box.width));
    canvas.height = Math.max(1, Math.ceil(box.height));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas context unavailable');
    const probeSize = 200;
    ctx.font = `${style} ${probeSize}px ${family}`.trim();
    const m = ctx.measureText(options.text);
    const gw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const gh = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    if (!(gw > 0 && gh > 0)) throw new Error(`"${options.text}" has no visible glyph`);
    const scale = Math.min((box.width - grow * 2) / gw, (box.height - grow * 2) / gh);
    if (!(scale > 0)) throw new Error('glyphMask: the box is too small for this grow');
    ctx.font = `${style} ${probeSize * scale}px ${family}`.trim();
    ctx.fillStyle = '#000';
    const left = (box.width - gw * scale) / 2 + m.actualBoundingBoxLeft * scale;
    const top = (box.height - gh * scale) / 2 + m.actualBoundingBoxAscent * scale;
    ctx.fillText(options.text, left, top);
    if (grow > 0) {
        ctx.strokeStyle = '#000';
        ctx.lineWidth = grow * 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeText(options.text, left, top);
    }
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const cols = Math.max(1, Math.floor(box.width / cell));
    const rows = Math.max(1, Math.floor(box.height / cell));
    const inside = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const px = Math.min(canvas.width - 1, Math.floor((c + 0.5) * cell));
            const py = Math.min(canvas.height - 1, Math.floor((r + 0.5) * cell));
            inside[r * cols + c] = data[(py * canvas.width + px) * 4 + 3] >= 128 ? 1 : 0;
        }
    }
    return { x: box.x, y: box.y, cell, cols, rows, inside };
}

/** A mask from any test of stage coordinates, for shapes that are not text. */
export function shapeMask(box: Box, contains: (x: number, y: number) => boolean, cell = 4): Mask {
    const cols = Math.max(1, Math.floor(box.width / cell));
    const rows = Math.max(1, Math.floor(box.height / cell));
    const inside = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            inside[r * cols + c] = contains(box.x + (c + 0.5) * cell, box.y + (r + 0.5) * cell)
                ? 1
                : 0;
        }
    }
    return { x: box.x, y: box.y, cell, cols, rows, inside };
}

/** Squared Euclidean distance transform along one line (Felzenszwalb and Huttenlocher). */
function edt1(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
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

/**
 * Distance in CSS px from each inside cell to the nearest outside cell (the
 * grid border counts as outside). 0 for outside cells.
 */
export function distanceField(mask: Mask): Float32Array {
    const W = mask.cols + 2;
    const H = mask.rows + 2;
    const INF = 1e12;
    const grid = new Float64Array(W * H);
    for (let r = 0; r < H; r++) {
        for (let c = 0; c < W; c++) {
            const inner = r > 0 && c > 0 && r <= mask.rows && c <= mask.cols;
            grid[r * W + c] = inner && mask.inside[(r - 1) * mask.cols + (c - 1)] ? INF : 0;
        }
    }
    const n = Math.max(W, H);
    const f = new Float64Array(n);
    const d = new Float64Array(n);
    const v = new Int32Array(n);
    const z = new Float64Array(n + 1);
    for (let c = 0; c < W; c++) {
        for (let r = 0; r < H; r++) f[r] = grid[r * W + c];
        edt1(f, H, d, v, z);
        for (let r = 0; r < H; r++) grid[r * W + c] = d[r];
    }
    for (let r = 0; r < H; r++) {
        for (let c = 0; c < W; c++) f[c] = grid[r * W + c];
        edt1(f, W, d, v, z);
        for (let c = 0; c < W; c++) grid[r * W + c] = d[c];
    }
    const out = new Float32Array(mask.cols * mask.rows);
    for (let r = 0; r < mask.rows; r++) {
        for (let c = 0; c < mask.cols; c++) {
            const i = r * mask.cols + c;
            out[i] = mask.inside[i]
                ? (Math.sqrt(grid[(r + 1) * W + (c + 1)]) - 0.5) * mask.cell
                : 0;
        }
    }
    return out;
}

// ---------------------------------------------------------------- slots

/** Where one piece lands: center, the radius of free room, and the direction of the stroke there. */
export interface Slot {
    x: number;
    y: number;
    r: number;
    /** Direction along the stroke at this point, in radians. */
    angle: number;
}

export interface PackOptions {
    /** How many pieces. */
    count: number;
    seed?: number;
    /** Smallest and largest piece radius in px. Default: sized so `count` pieces fill the shape. */
    minRadius?: number;
    maxRadius?: number;
    /** Room between pieces in px. Default 8% of the mean radius. */
    gap?: number;
    /** How far the angle strays from the stroke direction, radians. Default 0.35. */
    wander?: number;
}

function strokeAngle(mask: Mask, dist: Float32Array, c: number, r: number, h: number): number {
    const at = (cc: number, rr: number) =>
        cc < 0 || rr < 0 || cc >= mask.cols || rr >= mask.rows ? 0 : dist[rr * mask.cols + cc];
    const gx = at(c + 1, r) - at(c - 1, r);
    const gy = at(c, r + 1) - at(c, r - 1);
    if (Math.hypot(gx, gy) < mask.cell * 0.4) return h * Math.PI;
    return Math.atan2(gy, gx) + Math.PI / 2;
}

function fill(
    mask: Mask,
    dist: Float32Array,
    options: { seed: number; minR: number; maxR: number; gap: number; wander: number; cap: number },
): Slot[] {
    const free = Float32Array.from(dist);
    const slots: Slot[] = [];
    const { seed, minR, maxR, gap, wander, cap } = options;
    const cells = mask.cols * mask.rows;
    for (let i = 0; i < cap; i++) {
        const u = ihash(i, 11, seed);
        let target = minR + (maxR - minR) * u ** 1.5;
        let best = -1;
        let bestKey = Number.POSITIVE_INFINITY;
        let widest = -1;
        let widestAt = -1;
        const slack = target * 0.4;
        for (let k = 0; k < cells; k++) {
            const room = free[k];
            if (room > widest) {
                widest = room;
                widestAt = k;
            }
            if (room < target) continue;
            const key = room < target + slack ? ihash(k, i, seed + 3) : 1 + room;
            if (key < bestKey) {
                bestKey = key;
                best = k;
            }
        }
        if (best < 0) {
            if (widest < minR) break;
            target = widest;
            best = widestAt;
        }
        const c = best % mask.cols;
        const r = Math.floor(best / mask.cols);
        const x = mask.x + (c + 0.5) * mask.cell;
        const y = mask.y + (r + 0.5) * mask.cell;
        const h = ihash(i, 12, seed);
        const angle = strokeAngle(mask, dist, c, r, h) + (ihash(i, 13, seed) - 0.5) * 2 * wander;
        slots.push({ x, y, r: target, angle });
        for (let k = 0; k < cells; k++) {
            if (free[k] <= 0) continue;
            const kx = mask.x + ((k % mask.cols) + 0.5) * mask.cell;
            const ky = mask.y + (Math.floor(k / mask.cols) + 0.5) * mask.cell;
            const room = Math.hypot(kx - x, ky - y) - target - gap;
            if (room < free[k]) free[k] = room;
        }
    }
    return slots;
}

/**
 * Pack `count` round slots of varied size inside the mask, each placed where
 * a slot of its size fits snugly, turned along the stroke. Same mask and
 * options, same slots. Throws when the mask cannot hold `count`.
 */
export function packSlots(mask: Mask, options: PackOptions): Slot[] {
    const seed = options.seed ?? 1;
    const count = Math.max(1, Math.round(options.count));
    const dist = distanceField(mask);
    let area = 0;
    for (const v of mask.inside) area += v;
    area *= mask.cell * mask.cell;
    if (area === 0) throw new Error('The mask is empty: nothing to pack into');
    const wander = options.wander ?? 0.35;
    const mean = Math.sqrt((area * 0.58) / (Math.PI * count));
    if (options.minRadius !== undefined || options.maxRadius !== undefined) {
        const minR = options.minRadius ?? (options.maxRadius as number) * 0.4;
        const maxR = options.maxRadius ?? minR * 2.5;
        const gap = options.gap ?? ((minR + maxR) / 2) * 0.08;
        return enough(fill(mask, dist, { seed, minR, maxR, gap, wander, cap: count }), count);
    }
    // Scale the size range until filling the shape to the brim takes `count` pieces.
    let lo = 0.3;
    let hi = 3;
    let best: Slot[] = [];
    for (let step = 0; step < 12; step++) {
        const k = Math.sqrt(lo * hi);
        const minR = mean * 0.55 * k;
        const maxR = mean * 1.5 * k;
        const gap = options.gap ?? mean * k * 0.08;
        const slots = fill(mask, dist, { seed, minR, maxR, gap, wander, cap: count * 3 });
        const better =
            best.length === 0 ||
            (slots.length >= count && (best.length < count || slots.length < best.length)) ||
            (slots.length < count && best.length < count && slots.length > best.length);
        if (better) best = slots;
        if (slots.length === count) break;
        if (slots.length > count) lo = k;
        else hi = k;
    }
    return enough(best, count).slice(0, count);
}

function enough(slots: Slot[], count: number): Slot[] {
    if (slots.length < count) {
        throw new Error(
            `packSlots fit ${slots.length} of ${count} slots: lower count or minRadius, or raise grow or the box`,
        );
    }
    return slots;
}

export interface GridSlotOptions {
    /** Distance between neighbors in px. */
    spacing: number;
    seed?: number;
    /** Position noise as a share of the spacing. Default 0.25. */
    jitter?: number;
}

/** Slots on a hexagonal grid inside the mask, for evenly sized pieces. */
export function gridSlots(mask: Mask, options: GridSlotOptions): Slot[] {
    const seed = options.seed ?? 1;
    const spacing = options.spacing;
    if (!(spacing > 0)) throw new Error('gridSlots needs a positive spacing');
    const jitter = options.jitter ?? 0.25;
    const rowStep = (spacing * Math.sqrt(3)) / 2;
    const slots: Slot[] = [];
    const x1 = mask.x + mask.cols * mask.cell;
    const y1 = mask.y + mask.rows * mask.cell;
    let row = 0;
    for (let y = mask.y + rowStep / 2; y < y1; y += rowStep, row++) {
        let col = 0;
        for (let x = mask.x + (row % 2 ? spacing : spacing / 2); x < x1; x += spacing, col++) {
            const px = x + (ihash(col, row, seed) - 0.5) * jitter * spacing;
            const py = y + (ihash(col, row, seed + 1) - 0.5) * jitter * spacing;
            const c = Math.floor((px - mask.x) / mask.cell);
            const r = Math.floor((py - mask.y) / mask.cell);
            if (c < 0 || r < 0 || c >= mask.cols || r >= mask.rows) continue;
            if (!mask.inside[r * mask.cols + c]) continue;
            slots.push({
                x: px,
                y: py,
                r: spacing / 2,
                angle: (ihash(col, row, seed + 2) - 0.5) * 0.6,
            });
        }
    }
    return slots;
}

export type SlotOrder = 'random' | 'reading' | 'size' | 'radial';

/**
 * The slots in landing order: 'random' (seeded), 'reading' (top to bottom,
 * left to right in bands), 'size' (largest first), 'radial' (center out).
 */
export function orderSlots(slots: readonly Slot[], order: SlotOrder, seed = 1): Slot[] {
    const out = [...slots];
    if (order === 'random') {
        for (let i = out.length - 1; i > 0; i--) {
            const j = Math.floor(ihash(i, 21, seed) * (i + 1));
            [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
    }
    if (order === 'size') return out.sort((a, b) => b.r - a.r || a.y - b.y || a.x - b.x);
    if (order === 'reading') {
        const band = Math.max(1, (out.reduce((s, p) => s + p.r, 0) / out.length) * 2);
        return out.sort((a, b) => Math.floor(a.y / band) - Math.floor(b.y / band) || a.x - b.x);
    }
    const cx = out.reduce((s, p) => s + p.x, 0) / out.length;
    const cy = out.reduce((s, p) => s + p.y, 0) / out.length;
    return out.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
}

// ---------------------------------------------------------------- timing

/**
 * Landing times from mark cues: the cues whose id starts with `prefix`, in
 * time order, each snapped to its frame. One cue per piece keeps every
 * landing on the timeline for sound effects.
 */
export function markTimes(tl: ResolvedTimeline, prefix: string): number[] {
    const times = tl.cues
        .filter((c) => c.kind === 'mark' && c.id.startsWith(prefix))
        .map((c) => c.frame / tl.fps)
        .sort((a, b) => a - b);
    if (times.length === 0) throw new Error(`No mark cues with ids starting "${prefix}"`);
    return times;
}

export interface PaceOptions {
    count: number;
    /** First landing, in beats from the start of the composition. */
    from: number;
    /** Last landing, in beats. */
    to: number;
    /** Maps the share of pieces landed to the share of time used. Default: sparse, then quicker. */
    pacing?: Easing;
    /** Snap every landing to this beat division. 0 for none. Default 0.25. */
    grid?: number;
}

/** Landing beats spread from `from` to `to`, snapped to a beat grid. */
export function paceBeats(options: PaceOptions): number[] {
    const { count, from, to } = options;
    const pacing = options.pacing ?? ((u: number) => 1 - (1 - u) ** 1.7);
    const grid = options.grid ?? 0.25;
    return Array.from({ length: count }, (_, i) => {
        const beat = lerp(from, to, pacing(count === 1 ? 0 : i / (count - 1)));
        return grid > 0 ? Math.round(beat / grid) * grid : beat;
    });
}

/** paceBeats converted to seconds and snapped to frames. */
export function paceTimes(tl: ResolvedTimeline, options: PaceOptions): number[] {
    return paceBeats(options).map((b) => Math.round(b * tl.secondsPerBeat * tl.fps) / tl.fps);
}

// ---------------------------------------------------------------- assembly

export interface Piece {
    index: number;
    slot: Slot;
    /** Length along the piece's own x axis, and width. */
    width: number;
    height: number;
    seed: number;
    /** Unit vector toward the light, in the piece's own coordinates. */
    light: Point;
}

/** Draws one piece centered on (0, 0), its length along x. Runs once per piece, in setup. */
export type PieceDrawer = (ctx: CanvasRenderingContext2D, piece: Piece) => void;

export interface ShadowOptions {
    color?: string;
    /** Blur in px when landed. Default 3. */
    blur?: number;
    /** Offset in px when landed. Default [2, 3]. */
    offset?: Point;
    /** Default 0.35. */
    opacity?: number;
}

export interface AssembleOptions {
    /** Slots in landing order. */
    slots: readonly Slot[];
    /** Landing time of each slot in seconds, as many as slots. */
    times: readonly number[];
    /** One drawer, or several picked per piece by seed. */
    draw: PieceDrawer | readonly PieceDrawer[];
    stage: { width: number; height: number };
    seed?: number;
    /** Piece size from its slot. Default length 2.2 r, width 1.7 r. */
    size?: (slot: Slot, index: number) => { width: number; height: number };
    /** Seconds from entering the frame to landing. Default 0.6. */
    flight?: number;
    /** Where pieces come from. 'outside' flies in from past the nearest frame edge. Default 'outside'. */
    from?: 'outside' | 'above' | ((slot: Slot, index: number) => Point);
    /** Extra turn at the start of the flight, radians. Default 0.7. */
    spin?: number;
    /** Sideways bow of the flight path as a share of its length. Default 0.12. */
    bow?: number;
    ease?: Easing;
    /** Rocking after landing, radians. Default 0.05. */
    settle?: number;
    /** Direction toward the light on the stage. Default up and to the left. */
    light?: Point;
    shadow?: ShadowOptions | false;
    /** Sprite resolution over the device pixel ratio. Default 1.5. */
    oversample?: number;
}

export interface Placement {
    index: number;
    x: number;
    y: number;
    angle: number;
    scale: number;
    /** 1 when the flight starts, 0 once landed. */
    lift: number;
    landed: boolean;
}

export interface Assembly {
    readonly pieces: readonly Piece[];
    readonly times: readonly number[];
    /** Every piece in the frame at time t, drawn order first to last. */
    at(t: number): Placement[];
    /** Draw the pieces for time t. */
    draw(ctx: CanvasRenderingContext2D, t: number): void;
    /** How many pieces have landed by time t. */
    landed(t: number): number;
}

interface Sprite {
    canvas: HTMLCanvasElement;
    shadow: HTMLCanvasElement | null;
    /** Sprite size in CSS px. */
    width: number;
    height: number;
    pad: number;
}

function makeCanvas(
    width: number,
    height: number,
): {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
} {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width));
    canvas.height = Math.max(1, Math.ceil(height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    return { canvas, ctx };
}

function startPoint(
    from: AssembleOptions['from'],
    slot: Slot,
    index: number,
    center: Point,
    stage: { width: number; height: number },
    reach: number,
    seed: number,
): Point {
    if (typeof from === 'function') return from(slot, index);
    const drift = (ihash(index, 31, seed) - 0.5) * 2;
    if (from === 'above') return [slot.x + drift * stage.width * 0.08, -reach];
    let dx = slot.x - center[0];
    let dy = slot.y - center[1];
    const len = Math.hypot(dx, dy);
    const turn = drift * 0.5;
    if (len < 1) {
        dx = Math.cos(turn - Math.PI / 2);
        dy = Math.sin(turn - Math.PI / 2);
    } else {
        const c = Math.cos(turn);
        const s = Math.sin(turn);
        [dx, dy] = [(dx / len) * c - (dy / len) * s, (dx / len) * s + (dy / len) * c];
    }
    const tx = dx > 0 ? (stage.width + reach - slot.x) / dx : dx < 0 ? (-reach - slot.x) / dx : 1e9;
    const ty =
        dy > 0 ? (stage.height + reach - slot.y) / dy : dy < 0 ? (-reach - slot.y) / dy : 1e9;
    const t = Math.min(tx, ty);
    return [slot.x + dx * t, slot.y + dy * t];
}

/**
 * Build the assembly: draws every piece once into a cached sprite (and its
 * shadow), then places pieces from t alone. Call it in setup.
 */
export function assemble(options: AssembleOptions): Assembly {
    const { slots, times, stage } = options;
    if (times.length !== slots.length) {
        throw new Error(`assemble got ${slots.length} slots and ${times.length} landing times`);
    }
    const seed = options.seed ?? 1;
    const drawers = typeof options.draw === 'function' ? [options.draw] : [...options.draw];
    if (drawers.length === 0) throw new Error('assemble needs at least one piece drawer');
    const size = options.size ?? ((slot: Slot) => ({ width: slot.r * 2.2, height: slot.r * 1.7 }));
    const flight = options.flight ?? 0.6;
    const spin = options.spin ?? 0.7;
    const bow = options.bow ?? 0.12;
    const easing = options.ease ?? ease.outCubic;
    const settle = options.settle ?? 0.05;
    const lightDir = options.light ?? [-0.55, -0.83];
    const shadow = options.shadow === false ? null : (options.shadow ?? {});
    const dpr = (window.devicePixelRatio || 1) * (options.oversample ?? 1.5);
    const center: Point = [
        slots.reduce((s, p) => s + p.x, 0) / Math.max(1, slots.length),
        slots.reduce((s, p) => s + p.y, 0) / Math.max(1, slots.length),
    ];

    const pieces: Piece[] = slots.map((slot, index) => {
        const { width, height } = size(slot, index);
        const c = Math.cos(-slot.angle);
        const s = Math.sin(-slot.angle);
        return {
            index,
            slot,
            width,
            height,
            seed: Math.floor(ihash(index, 41, seed) * 2 ** 31),
            light: [lightDir[0] * c - lightDir[1] * s, lightDir[0] * s + lightDir[1] * c],
        };
    });

    const blur = shadow?.blur ?? 3;
    const sprites: Sprite[] = pieces.map((piece) => {
        const drawer = drawers[Math.floor(ihash(piece.index, 42, seed) * drawers.length)];
        const pad = Math.ceil(Math.max(piece.width, piece.height) * 0.12 + 4);
        const w = piece.width + pad * 2;
        const h = piece.height + pad * 2;
        const { canvas, ctx } = makeCanvas(w * dpr, h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, (w * dpr) / 2, (h * dpr) / 2);
        drawer(ctx, piece);
        let shadowCanvas: HTMLCanvasElement | null = null;
        if (shadow) {
            const spread = Math.ceil(blur * 4 + 2);
            const sh = makeCanvas((w + spread * 2) * dpr, (h + spread * 2) * dpr);
            sh.ctx.filter = `blur(${blur * dpr}px)`;
            sh.ctx.drawImage(canvas, spread * dpr, spread * dpr);
            sh.ctx.filter = 'none';
            sh.ctx.globalCompositeOperation = 'source-in';
            sh.ctx.fillStyle = rgba(shadow.color ?? '#3a2a18', 1);
            sh.ctx.fillRect(0, 0, sh.canvas.width, sh.canvas.height);
            shadowCanvas = sh.canvas;
        }
        return { canvas, shadow: shadowCanvas, width: w, height: h, pad };
    });

    const reach = Math.max(...pieces.map((p) => Math.max(p.width, p.height))) + 20;
    const starts = slots.map((slot, i) =>
        startPoint(options.from, slot, i, center, stage, reach, seed),
    );

    const at = (t: number): Placement[] => {
        const out: Placement[] = [];
        for (let i = 0; i < slots.length; i++) {
            const land = times[i];
            const start = land - flight;
            if (t < start) continue;
            const slot = slots[i];
            const u = clamp((t - start) / flight);
            const e = easing(u);
            const [sx, sy] = starts[i];
            const dx = slot.x - sx;
            const dy = slot.y - sy;
            const side = ihash(i, 43, seed) < 0.5 ? -1 : 1;
            const arc = Math.sin(Math.PI * e) * bow * side;
            const x = sx + dx * e - dy * arc;
            const y = sy + dy * e + dx * arc;
            const since = t - land;
            const rock =
                since >= 0 ? settle * Math.exp(-since * 7) * Math.sin(since * Math.PI * 2 * 3) : 0;
            const angle = slot.angle + spin * side * (1 - e) + rock * side;
            const lift = 1 - e;
            out.push({ index: i, x, y, angle, scale: 1 + lift * 0.06, lift, landed: t >= land });
        }
        return out.sort(
            (a, b) => Number(b.landed) - Number(a.landed) || times[a.index] - times[b.index],
        );
    };

    return {
        pieces,
        times: [...times],
        at,
        landed: (t) => times.filter((time) => t >= time).length,
        draw(ctx, t) {
            const placements = at(t);
            const [ox, oy] = shadow?.offset ?? [2, 3];
            const opacity = shadow?.opacity ?? 0.35;
            for (const p of placements) {
                const sprite = sprites[p.index];
                ctx.save();
                if (sprite.shadow) {
                    const lift = p.lift;
                    const spread = (sprite.shadow.width / dpr - sprite.width) / 2;
                    ctx.save();
                    ctx.translate(p.x + ox * (1 + lift * 5), p.y + oy * (1 + lift * 5));
                    ctx.rotate(p.angle);
                    const grow = p.scale * (1 + lift * 0.08);
                    ctx.scale(grow, grow);
                    ctx.globalAlpha *= opacity * (1 - lift * 0.55);
                    ctx.drawImage(
                        sprite.shadow,
                        -sprite.width / 2 - spread,
                        -sprite.height / 2 - spread,
                        sprite.width + spread * 2,
                        sprite.height + spread * 2,
                    );
                    ctx.restore();
                }
                ctx.translate(p.x, p.y);
                ctx.rotate(p.angle);
                ctx.scale(p.scale, p.scale);
                ctx.drawImage(
                    sprite.canvas,
                    -sprite.width / 2,
                    -sprite.height / 2,
                    sprite.width,
                    sprite.height,
                );
                ctx.restore();
            }
        },
    };
}
