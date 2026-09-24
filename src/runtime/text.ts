import { clamp, ease } from './core/ease.ts';
import { host } from './core/timeline.ts';
import { ihash } from './hash.ts';
import type { Point } from './materials.ts';

export interface TextBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface TextEntry {
    id?: string;
    text: string;
    /** CSS font shorthand the text was drawn with. */
    font: string;
    box: TextBox;
    /** Exempt from the frame-edge and safe-area checks. */
    allowOverflow?: boolean;
}

/**
 * Report text drawn outside the DOM (canvas, WebGL) so check can verify its
 * glyphs and font. Call it from seek for every visible piece of such text.
 */
export function registerText(entry: TextEntry): void {
    host()?.registerText(entry);
}

export interface FillTextOptions {
    id?: string;
    maxWidth?: number;
    /** Exempt from the frame-edge and safe-area checks. */
    allowOverflow?: boolean;
}

/**
 * ctx.fillText that also registers the drawn text and its box. Uses the
 * context's current font, alignment and baseline.
 */
export function fillText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    options: FillTextOptions = {},
): TextBox {
    ctx.fillText(text, x, y, options.maxWidth);
    const m = ctx.measureText(text);
    // maxWidth squeezes the line around its alignment point.
    const squeeze =
        options.maxWidth !== undefined && m.width > options.maxWidth
            ? options.maxWidth / m.width
            : 1;
    const left = x - m.actualBoundingBoxLeft * squeeze;
    const right = x + m.actualBoundingBoxRight * squeeze;
    const top = y - m.actualBoundingBoxAscent;
    const bottom = y + m.actualBoundingBoxDescent;
    // All four corners through the full transform (rotation, skew, mirroring), then their bounds.
    const transform = ctx.getTransform();
    const corners = [
        [left, top],
        [right, top],
        [left, bottom],
        [right, bottom],
    ].map(([px, py]) => new DOMPoint(px, py).matrixTransform(transform));
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    // Canvas pixels to page CSS pixels, from the canvas's laid-out size.
    const canvas = ctx.canvas;
    const rect = canvas instanceof HTMLCanvasElement ? canvas.getBoundingClientRect() : null;
    const dpr = window.devicePixelRatio || 1;
    const sx = rect && canvas.width > 0 ? rect.width / canvas.width : 1 / dpr;
    const sy = rect && canvas.height > 0 ? rect.height / canvas.height : 1 / dpr;
    const box: TextBox = {
        x: (rect?.left ?? 0) + Math.min(...xs) * sx,
        y: (rect?.top ?? 0) + Math.min(...ys) * sy,
        width: (Math.max(...xs) - Math.min(...xs)) * sx,
        height: (Math.max(...ys) - Math.min(...ys)) * sy,
    };
    registerText({
        id: options.id,
        text,
        font: ctx.font,
        box,
        allowOverflow: options.allowOverflow,
    });
    return box;
}

// ---------------------------------------------------------------- shared

const HAND_FONT = '400 48px "LXGW WenKai"';
const SERIF_FONT = '500 48px "Noto Serif SC"';

/** Grows `acc` to cover the page-space box of a local rectangle drawn under ctx's transform. */
class PageBounds {
    private x0 = Number.POSITIVE_INFINITY;
    private y0 = Number.POSITIVE_INFINITY;
    private x1 = Number.NEGATIVE_INFINITY;
    private y1 = Number.NEGATIVE_INFINITY;
    private readonly dpr = window.devicePixelRatio || 1;
    private readonly left: number;
    private readonly top: number;

    constructor(private readonly ctx: CanvasRenderingContext2D) {
        const rect =
            ctx.canvas instanceof HTMLCanvasElement ? ctx.canvas.getBoundingClientRect() : null;
        this.left = rect?.left ?? 0;
        this.top = rect?.top ?? 0;
    }

    /** Add the rectangle (x, y, w, h) in the context's current user space. */
    add(x: number, y: number, w: number, h: number): void {
        const m = this.ctx.getTransform();
        for (const [px, py] of [
            [x, y],
            [x + w, y],
            [x, y + h],
            [x + w, y + h],
        ]) {
            const p = new DOMPoint(px, py).matrixTransform(m);
            const gx = this.left + p.x / this.dpr;
            const gy = this.top + p.y / this.dpr;
            this.x0 = Math.min(this.x0, gx);
            this.y0 = Math.min(this.y0, gy);
            this.x1 = Math.max(this.x1, gx);
            this.y1 = Math.max(this.y1, gy);
        }
    }

    box(): TextBox | null {
        if (!Number.isFinite(this.x0)) return null;
        return { x: this.x0, y: this.y0, width: this.x1 - this.x0, height: this.y1 - this.y0 };
    }
}

const graphemer = new Intl.Segmenter('zh', { granularity: 'grapheme' });
const worder = new Intl.Segmenter('zh', { granularity: 'word' });

/** Split into user-perceived characters. */
export function graphemes(text: string): string[] {
    return Array.from(graphemer.segment(text), (s) => s.segment);
}

const OPENING = /^[\s]*[「『（(“‘《〈【[{]+$/u;
const TRAILING = /^[\s\p{P}\p{S}]+$/u;

/**
 * Split into the units that appear one by one: Chinese words from the
 * segmenter, Latin words with their trailing space, punctuation attached to
 * its neighbor.
 */
export function words(text: string): string[] {
    const out: string[] = [];
    let pending = '';
    for (const { segment } of worder.segment(text)) {
        if (OPENING.test(segment)) {
            pending += segment;
        } else if (TRAILING.test(segment) && out.length > 0 && pending === '') {
            out[out.length - 1] += segment;
        } else {
            out.push(pending + segment);
            pending = '';
        }
    }
    if (pending) out.push(pending);
    return out;
}

function fontSize(font: string): number {
    const match = /(\d+(?:\.\d+)?)px/.exec(font);
    if (!match) throw new Error(`Give the font size in px: "${font}"`);
    return Number(match[1]);
}

// ---------------------------------------------------------------- typesetting

export interface TypesetOptions {
    /** CSS font shorthand with the size in px. Default `400 48px "LXGW WenKai"`. */
    font?: string;
    /** Wrap lines at this width. Default: no wrapping. */
    maxWidth?: number;
    /** Line height as a multiple of the font size. Default 1.4. */
    lineHeight?: number;
    /** Where x sits on each line. Default 'left'. */
    align?: 'left' | 'center' | 'right';
}

export interface PlacedWord {
    text: string;
    /** Left edge of the word. */
    x: number;
    /** Alphabetic baseline. */
    y: number;
    width: number;
    line: number;
    index: number;
}

export interface TextLayout {
    font: string;
    size: number;
    ascent: number;
    descent: number;
    words: PlacedWord[];
    lines: { text: string; x: number; y: number; width: number }[];
    /** The block, in the context's user space. */
    box: TextBox;
}

/**
 * Lay out text in lines: word wrap at maxWidth (Chinese breaks between words,
 * a word too wide for a line breaks between characters), explicit newlines,
 * alignment around x. y is the top of the block. Measures only, draws nothing.
 */
export function typeset(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    options: TypesetOptions = {},
): TextLayout {
    const font = options.font ?? HAND_FONT;
    const size = fontSize(font);
    const lineHeight = (options.lineHeight ?? 1.4) * size;
    const align = options.align ?? 'left';
    const maxWidth = options.maxWidth ?? Number.POSITIVE_INFINITY;
    ctx.save();
    ctx.font = font;
    const probe = ctx.measureText('Hg国');
    const ascent = probe.fontBoundingBoxAscent;
    const descent = probe.fontBoundingBoxDescent;
    const measure = (s: string) => ctx.measureText(s).width;
    const rows: string[][] = [];
    for (const paragraph of text.split('\n')) {
        let row: string[] = [];
        let width = 0;
        const units = words(paragraph).flatMap((w) =>
            measure(w.trimEnd()) > maxWidth ? graphemes(w) : [w],
        );
        for (const unit of units) {
            const w = measure(unit);
            if (row.length > 0 && width + measure(unit.trimEnd()) > maxWidth) {
                rows.push(row);
                row = [];
                width = 0;
            }
            row.push(unit);
            width += w;
        }
        rows.push(row);
    }
    const placed: PlacedWord[] = [];
    const lines: TextLayout['lines'] = [];
    let index = 0;
    rows.forEach((row, line) => {
        const joined = row.join('');
        const width = measure(joined.trimEnd());
        const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
        const baseline = y + line * lineHeight + (lineHeight - (ascent + descent)) / 2 + ascent;
        let prefix = '';
        for (const unit of row) {
            placed.push({
                text: unit,
                x: left + measure(prefix),
                y: baseline,
                width: measure(unit.trimEnd()),
                line,
                index: index++,
            });
            prefix += unit;
        }
        lines.push({ text: joined, x: left, y: baseline, width });
    });
    ctx.restore();
    const lefts = lines.map((l) => l.x);
    const rights = lines.map((l) => l.x + l.width);
    const box: TextBox = {
        x: Math.min(...lefts),
        y,
        width: Math.max(...rights) - Math.min(...lefts),
        height: rows.length * lineHeight,
    };
    return { font, size, ascent, descent, words: placed, lines, box };
}

export interface WriteOptions extends TypesetOptions {
    id?: string;
    /** Exempt from the frame-edge and safe-area checks. */
    allowOverflow?: boolean;
    /** Fill color. Default: the context's fillStyle. */
    color?: string;
    /** 0 to 1: words appear one after another. Default 1, all shown. */
    progress?: number;
    /** How many words fade in at once. Default 2. */
    overlap?: number;
    /** How far a word rises while it appears, in px. Default a fifth of the font size. */
    rise?: number;
    /** Hand wobble: each character shifts, turns and scales a little. 0 for none. */
    wobble?: number;
    seed?: number;
}

/** Opacity of word i of n at progress p, the stagger writeText uses. */
export function wordReveal(p: number, i: number, n: number, overlap = 2): number {
    if (p >= 1) return 1;
    if (p <= 0) return 0;
    const span = Math.max(1, overlap);
    return clamp((p * (n + span - 1) - i) / span);
}

/**
 * Typeset and draw text, optionally revealing it word by word and with a hand
 * wobble per character. Registers what is visible with check and returns its
 * page box, or null when nothing is visible yet.
 */
export function writeText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    options: WriteOptions = {},
): TextBox | null {
    const layout = typeset(ctx, text, x, y, options);
    const progress = options.progress ?? 1;
    const rise = options.rise ?? layout.size * 0.2;
    const wobble = options.wobble ?? 0;
    const seed = options.seed ?? 1;
    const bounds = new PageBounds(ctx);
    let shown = '';
    ctx.save();
    ctx.font = layout.font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    if (options.color) ctx.fillStyle = options.color;
    const base = ctx.globalAlpha;
    const n = layout.words.length;
    for (const word of layout.words) {
        const a = ease.outCubic(wordReveal(progress, word.index, n, options.overlap));
        if (a <= 0) continue;
        shown += word.text;
        const dy = (1 - a) * rise;
        ctx.globalAlpha = base * a;
        const pad = wobble * layout.size * 0.06;
        bounds.add(
            word.x - pad,
            word.y - layout.ascent + dy - pad,
            word.width + pad * 2,
            layout.ascent + layout.descent + pad * 2,
        );
        if (wobble <= 0) {
            ctx.fillText(word.text.trimEnd(), word.x, word.y + dy);
            continue;
        }
        let prefix = '';
        graphemes(word.text.trimEnd()).forEach((g, k) => {
            const gx = word.x + ctx.measureText(prefix).width;
            const gw = ctx.measureText(g).width;
            prefix += g;
            const h = (salt: number) => ihash(word.index * 97 + k, salt, seed) - 0.5;
            ctx.save();
            ctx.translate(gx + gw / 2, word.y + dy + h(1) * wobble * layout.size * 0.06);
            ctx.rotate(h(2) * wobble * 0.09);
            const s = 1 + h(3) * wobble * 0.05;
            ctx.scale(s, s);
            ctx.fillText(g, -gw / 2, 0);
            ctx.restore();
        });
    }
    ctx.restore();
    const box = bounds.box();
    if (box && shown.trim()) {
        registerText({
            id: options.id,
            text: shown,
            font: layout.font,
            box,
            allowOverflow: options.allowOverflow,
        });
    }
    return box;
}

/**
 * writeText in the handwriting face (LXGW WenKai) with a light wobble. Pass
 * `wobble: 0` for clean type.
 */
export function handText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    options: WriteOptions = {},
): TextBox | null {
    return writeText(ctx, text, x, y, { font: HAND_FONT, wobble: 1, ...options });
}

// ---------------------------------------------------------------- text on a path

export interface PathTextOptions {
    /** CSS font shorthand with the size in px. Default `500 48px "Noto Serif SC"`. */
    font?: string;
    id?: string;
    /** Exempt from the frame-edge and safe-area checks. */
    allowOverflow?: boolean;
    color?: string;
    /** Distance along the path where the text is anchored, in px. Default 0. */
    offset?: number;
    /** What the offset anchors. Default 'start'. */
    align?: 'start' | 'center' | 'end';
    /** Extra space between characters, in px. Default 0. */
    spacing?: number;
    /** Baseline distance from the path, toward the left of its direction. Default 0. */
    lift?: number;
    /** 0 to 1: characters appear one after another. Default 1. */
    progress?: number;
}

function samplePath(path: readonly Point[] | ((u: number) => Point)): Point[] {
    if (typeof path !== 'function') return [...path];
    const out: Point[] = [];
    for (let i = 0; i <= 256; i++) out.push(path(i / 256));
    return out;
}

/**
 * Draw text along a polyline (or a function of u from 0 to 1), each character
 * turned to the path's direction. Registers the visible characters with check
 * and returns their page box, or null when none is visible.
 */
export function textOnPath(
    ctx: CanvasRenderingContext2D,
    text: string,
    path: readonly Point[] | ((u: number) => Point),
    options: PathTextOptions = {},
): TextBox | null {
    const pts = samplePath(path);
    if (pts.length < 2) throw new Error('textOnPath needs a path of at least two points');
    const cumulative = [0];
    for (let i = 1; i < pts.length; i++) {
        cumulative.push(
            cumulative[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]),
        );
    }
    const total = cumulative[cumulative.length - 1];
    const at = (s: number): { x: number; y: number; angle: number } => {
        let i = 1;
        if (s >= total) i = pts.length - 1;
        else if (s > 0) {
            let lo = 1;
            let hi = pts.length - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (cumulative[mid] < s) lo = mid + 1;
                else hi = mid;
            }
            i = lo;
        }
        const a = pts[i - 1];
        const b = pts[i];
        const seg = cumulative[i] - cumulative[i - 1] || 1;
        const t = (s - cumulative[i - 1]) / seg;
        return {
            x: a[0] + (b[0] - a[0]) * t,
            y: a[1] + (b[1] - a[1]) * t,
            angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
        };
    };
    const font = options.font ?? SERIF_FONT;
    const spacing = options.spacing ?? 0;
    const lift = options.lift ?? 0;
    const bounds = new PageBounds(ctx);
    ctx.save();
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    if (options.color) ctx.fillStyle = options.color;
    const probe = ctx.measureText('Hg国');
    const ascent = probe.fontBoundingBoxAscent;
    const descent = probe.fontBoundingBoxDescent;
    const chars = graphemes(text);
    const starts: number[] = [];
    const widths: number[] = [];
    let prefix = '';
    chars.forEach((g, k) => {
        starts.push(ctx.measureText(prefix).width + k * spacing);
        widths.push(ctx.measureText(g).width);
        prefix += g;
    });
    const length = chars.length > 0 ? starts[chars.length - 1] + widths[chars.length - 1] : 0;
    const align = options.align ?? 'start';
    const origin =
        (options.offset ?? 0) - (align === 'center' ? length / 2 : align === 'end' ? length : 0);
    const progress = options.progress ?? 1;
    const base = ctx.globalAlpha;
    let shown = '';
    chars.forEach((g, k) => {
        const a = progress >= 1 ? 1 : clamp(progress * (chars.length + 1) - k);
        if (a <= 0 || !g.trim()) {
            if (a > 0) shown += g;
            return;
        }
        shown += g;
        const w = widths[k];
        const p = at(origin + starts[k] + w / 2);
        ctx.save();
        ctx.translate(p.x + Math.sin(p.angle) * lift, p.y - Math.cos(p.angle) * lift);
        ctx.rotate(p.angle);
        ctx.globalAlpha = base * a;
        ctx.fillText(g, -w / 2, 0);
        bounds.add(-w / 2, -ascent, w, ascent + descent);
        ctx.restore();
    });
    ctx.restore();
    const box = bounds.box();
    if (box && shown.trim()) {
        registerText({
            id: options.id,
            text: shown,
            font,
            box,
            allowOverflow: options.allowOverflow,
        });
    }
    return box;
}
