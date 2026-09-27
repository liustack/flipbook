// The pixel skin: a small grid of cells drawn with a few colors, blown up by
// a whole number onto the stage. Every cell ends up one color from the
// palette, so edges stay hard and nothing in between leaks into the film.

import type { SpriteFrame } from './sprite.ts';
import { registerText } from './text.ts';

type Rgb = [number, number, number];

function parseColor(color: string, what: string): Rgb {
    const m = /^#([0-9a-fA-F]{6})$/.exec(color);
    if (!m) throw new Error(`${what}: a color must be #rrggbb (got ${color})`);
    const n = Number.parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A color on the grid: its place in the palette, or a #rrggbb color from it. */
export type PixelColor = number | string;

export interface PixelOptions {
    /** The colors, 2 to 64, as #rrggbb. The first is the ground: the margin around the picture and any cell left empty. */
    palette: string[];
    /** Cells across. Default 320. */
    cols?: number;
    /** Cells down. Default: cols times the stage's height over its width, rounded. */
    rows?: number;
}

export interface PixelTextOptions {
    /** CSS font shorthand, its size in cells. Default: the pixel font at 12 cells, one of its pixels a cell. */
    font?: string;
    /** Which end of the line x is. Default 'left'. */
    align?: 'left' | 'center' | 'right';
    /** Names the text in check's findings. */
    id?: string;
    /** Let the words run off the grid, which cuts them: for words sliding in or out. */
    allowOverflow?: boolean;
    /**
     * Blow the letters up by a whole number after they are inked, each cell
     * becoming scale by scale cells around (x, y): the same pixels, bigger.
     * Default 1.
     */
    scale?: number;
}

/** Cells on the grid: the ones a piece of text inked. */
export interface PixelBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

const TEXT_FONT = '12px "Fusion Pixel 12px Prop zh-Hans"';

/** A drawing made of cells, from pixelArt(). */
export interface PixelArt {
    readonly width: number;
    readonly height: number;
    readonly canvas: HTMLCanvasElement;
    /** This drawing as a sprite() frame, anchored at `anchor` (default: the middle of its bottom row). */
    frame(anchor?: [number, number]): SpriteFrame;
}

export interface Pixel {
    /** The grid's size in cells. */
    readonly cols: number;
    readonly rows: number;
    /** The grid's own context: one unit is one cell, smoothing off. Draw rectangles on whole cells. */
    readonly ctx: CanvasRenderingContext2D;
    /** Fill every cell with `color`, default the ground (the palette's first). */
    clear(color?: PixelColor): void;
    rect(x: number, y: number, width: number, height: number, color: PixelColor): void;
    dot(x: number, y: number, color: PixelColor): void;
    /** A one-cell line from (x0, y0) to (x1, y1), both ends included. */
    line(x0: number, y0: number, x1: number, y1: number, color: PixelColor): void;
    /** A one-cell ring of radius r around (cx, cy). */
    circle(cx: number, cy: number, r: number, color: PixelColor): void;
    /** A filled disc of radius r around (cx, cy). */
    disc(cx: number, cy: number, r: number, color: PixelColor): void;
    /** Put a drawing's top left corner on cell (x, y), mirrored when flip is true. */
    draw(art: PixelArt, x: number, y: number, options?: { flip?: boolean }): void;
    /**
     * Words on the grid, the top of the line on row y: drawn in `font` (its size
     * in cells) and inked on every cell the letters cover at least half of, in
     * one color, so they have the same hard edges and the same cells as the
     * rest. Words that would run off the grid are refused, since the grid cuts
     * them, unless allowOverflow says so. present() registers the whole line
     * for check (glyphs, font, place in the frame). Returns the cells inked,
     * which may lie past the grid with allowOverflow, or null when the letters
     * are too thin to ink any.
     */
    text(
        text: string,
        x: number,
        y: number,
        color: PixelColor,
        options?: PixelTextOptions,
    ): PixelBox | null;
    /** How many device px one cell takes on a stage of the size the grid was made for. */
    readonly scale: number;
    /**
     * Snap every cell to its nearest palette color and blow the grid up onto
     * `ctx` by a whole number, centered, the margin filled with the ground.
     */
    present(ctx: CanvasRenderingContext2D): void;
}

/**
 * A drawing from rows of characters: each character is a key into `keys`
 * (a #rrggbb color), and '.' or ' ' is empty.
 */
export function pixelArt(rows: string[], keys: Record<string, string>): PixelArt {
    if (rows.length === 0) throw new Error('pixelArt: give at least one row');
    // Counted in characters as drawn, not UTF-16 units: an emoji key is one cell.
    const width = Math.max(...rows.map((r) => [...r].length));
    const height = rows.length;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const img = ctx.createImageData(width, height);
    const colors = new Map<string, Rgb>();
    rows.forEach((row, y) => {
        [...row].forEach((ch, x) => {
            if (ch === '.' || ch === ' ') return;
            let c = colors.get(ch);
            if (!c) {
                const hex = keys[ch];
                if (hex === undefined) {
                    throw new Error(
                        `pixelArt: row ${y + 1} uses "${ch}", which keys does not name`,
                    );
                }
                c = parseColor(hex, `pixelArt key "${ch}"`);
                colors.set(ch, c);
            }
            const i = (y * width + x) * 4;
            img.data[i] = c[0];
            img.data[i + 1] = c[1];
            img.data[i + 2] = c[2];
            img.data[i + 3] = 255;
        });
    });
    ctx.putImageData(img, 0, 0);
    return {
        width,
        height,
        canvas,
        frame(anchor) {
            return { canvas, width, height, anchor: anchor ?? [Math.floor(width / 2), height] };
        },
    };
}

/**
 * A pixel grid for a width by height CSS px stage. Build it once, outside
 * seek(), draw on it every frame, and present() it onto the stage canvas.
 */
export function pixel(width: number, height: number, options: PixelOptions): Pixel {
    const palette = options.palette.map((c, i) => parseColor(c, `pixel palette[${i}]`));
    if (palette.length < 2 || palette.length > 64) {
        throw new Error(`pixel: the palette needs 2 to 64 colors (got ${palette.length})`);
    }
    const cols = options.cols ?? 320;
    const rows = options.rows ?? Math.round((cols * height) / width);
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 8 || rows < 8) {
        throw new Error(
            `pixel: cols and rows must be whole numbers of at least 8 (got ${cols} by ${rows})`,
        );
    }
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    if (cols > width * dpr || rows > height * dpr) {
        throw new Error(
            `pixel: a grid of ${cols} by ${rows} cells does not fit a ${width} by ${height} px stage: every cell needs at least one device pixel, so use fewer cols`,
        );
    }
    const hex = options.palette.map((c) => c.toLowerCase());
    const grid = document.createElement('canvas');
    grid.width = cols;
    grid.height = rows;
    const ctx = grid.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.imageSmoothingEnabled = false;
    const out = document.createElement('canvas');
    out.width = cols;
    out.height = rows;
    const outCtx = out.getContext('2d') as CanvasRenderingContext2D;
    const nearest = new Map<number, number>();
    const index = (r: number, g: number, b: number): number => {
        const key = (r << 16) | (g << 8) | b;
        let best = nearest.get(key);
        if (best !== undefined) return best;
        best = 0;
        let bestD = Infinity;
        palette.forEach(([pr, pg, pb], i) => {
            const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        });
        nearest.set(key, best);
        return best;
    };
    const fillOf = (color: PixelColor): string => {
        if (typeof color === 'number') {
            const c = hex[color];
            if (c === undefined) {
                throw new Error(`pixel: no color ${color} in the palette (0 to ${hex.length - 1})`);
            }
            return c;
        }
        parseColor(color, 'pixel');
        return color;
    };
    const cell = (x: number, y: number) => ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    // Letters are drawn here first, then kept only where they cover half a cell.
    const scratch = document.createElement('canvas');
    scratch.width = cols;
    scratch.height = rows;
    const scratchCtx = scratch.getContext('2d', {
        willReadFrequently: true,
    }) as CanvasRenderingContext2D;
    const words: {
        text: string;
        font: string;
        id?: string;
        box: PixelBox;
        allowOverflow?: boolean;
    }[] = [];
    const scale = Math.max(1, Math.floor(Math.min((width * dpr) / cols, (height * dpr) / rows)));
    return {
        cols,
        rows,
        ctx,
        scale,
        clear(color = 0) {
            words.length = 0;
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = fillOf(color);
            ctx.fillRect(0, 0, cols, rows);
            ctx.restore();
        },
        rect(x, y, w, h, color) {
            ctx.fillStyle = fillOf(color);
            ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
        },
        dot(x, y, color) {
            ctx.fillStyle = fillOf(color);
            cell(x, y);
        },
        line(x0, y0, x1, y1, color) {
            ctx.fillStyle = fillOf(color);
            let x = Math.round(x0);
            let y = Math.round(y0);
            const xe = Math.round(x1);
            const ye = Math.round(y1);
            const dx = Math.abs(xe - x);
            const dy = -Math.abs(ye - y);
            const sx = x < xe ? 1 : -1;
            const sy = y < ye ? 1 : -1;
            let err = dx + dy;
            for (;;) {
                cell(x, y);
                if (x === xe && y === ye) break;
                const e2 = 2 * err;
                if (e2 >= dy) {
                    err += dy;
                    x += sx;
                }
                if (e2 <= dx) {
                    err += dx;
                    y += sy;
                }
            }
        },
        circle(cx, cy, r, color) {
            ctx.fillStyle = fillOf(color);
            const x0 = Math.round(cx);
            const y0 = Math.round(cy);
            let x = Math.round(r);
            let y = 0;
            let err = 1 - x;
            while (x >= y) {
                for (const [a, b] of [
                    [x, y],
                    [y, x],
                    [-y, x],
                    [-x, y],
                    [-x, -y],
                    [-y, -x],
                    [y, -x],
                    [x, -y],
                ]) {
                    cell(x0 + a, y0 + b);
                }
                y += 1;
                if (err < 0) err += 2 * y + 1;
                else {
                    x -= 1;
                    err += 2 * (y - x) + 1;
                }
            }
        },
        disc(cx, cy, r, color) {
            ctx.fillStyle = fillOf(color);
            const x0 = Math.round(cx);
            const y0 = Math.round(cy);
            const rr = Math.round(r);
            for (let dy = -rr; dy <= rr; dy++) {
                const half = Math.floor(Math.sqrt(rr * rr + rr - dy * dy));
                ctx.fillRect(x0 - half, y0 + dy, 2 * half + 1, 1);
            }
        },
        draw(art, x, y, o = {}) {
            ctx.save();
            ctx.translate(Math.round(x), Math.round(y));
            if (o.flip) {
                ctx.translate(art.width, 0);
                ctx.scale(-1, 1);
            }
            ctx.drawImage(art.canvas, 0, 0);
            ctx.restore();
        },
        text(text, x, y, color, o = {}) {
            const [r, gr, b] = parseColor(fillOf(color), 'pixel text');
            if (o.scale !== undefined && !(Number.isInteger(o.scale) && o.scale >= 1)) {
                throw new Error(
                    `pixel text: scale must be a whole number of at least 1 (got ${o.scale})`,
                );
            }
            const font = o.font ?? TEXT_FONT;
            const align = o.align ?? 'left';
            const ax = Math.round(x);
            const ay = Math.round(y);
            const sc = scratchCtx;
            const setup = () => {
                sc.setTransform(1, 0, 0, 1, 0, 0);
                sc.font = font;
                sc.textBaseline = 'top';
                sc.textAlign = align;
            };
            setup();
            // The whole line on a scratch of its own size, wherever it lands, so
            // what would run off the grid is measured instead of lost.
            const m = sc.measureText(text);
            const left = Math.floor(ax - m.actualBoundingBoxLeft) - 1;
            const top = Math.floor(ay - m.actualBoundingBoxAscent) - 1;
            const sw = Math.max(1, Math.ceil(ax + m.actualBoundingBoxRight) + 1 - left);
            const sh = Math.max(1, Math.ceil(ay + m.actualBoundingBoxDescent) + 1 - top);
            if (scratch.width !== sw || scratch.height !== sh) {
                scratch.width = sw;
                scratch.height = sh;
                setup();
            }
            sc.clearRect(0, 0, sw, sh);
            sc.fillStyle = '#000000';
            sc.fillText(text, ax - left, ay - top);
            const img = sc.getImageData(0, 0, sw, sh);
            const d = img.data;
            let x0 = sw;
            let y0 = sh;
            let x1 = -1;
            let y1 = -1;
            for (let cy = 0; cy < sh; cy++) {
                for (let cx = 0; cx < sw; cx++) {
                    const i = (cy * sw + cx) * 4;
                    if (d[i + 3] < 128) {
                        d[i + 3] = 0;
                        continue;
                    }
                    d[i] = r;
                    d[i + 1] = gr;
                    d[i + 2] = b;
                    d[i + 3] = 255;
                    if (cx < x0) x0 = cx;
                    if (cx > x1) x1 = cx;
                    if (cy < y0) y0 = cy;
                    if (cy > y1) y1 = cy;
                }
            }
            if (x1 < 0) return null;
            // Scaled about the anchor, each cell of the letters becoming k by k.
            const k = o.scale ?? 1;
            const at = (v: number, anchor: number) => anchor + (v - anchor) * k;
            const box = {
                x: at(left + x0, ax),
                y: at(top + y0, ay),
                width: (x1 - x0 + 1) * k,
                height: (y1 - y0 + 1) * k,
            };
            // The grid cuts what runs off it: refuse that unless it is meant.
            const off =
                box.x < 0 || box.y < 0 || box.x + box.width > cols || box.y + box.height > rows;
            if (off && !o.allowOverflow) {
                throw new Error(
                    `pixel text "${text}" runs off the ${cols} by ${rows} grid (cells ${box.x} to ${box.x + box.width - 1} across, ${box.y} to ${box.y + box.height - 1} down), which would cut it: move it in, shorten it or set it smaller, or pass allowOverflow when it slides in or out on purpose`,
                );
            }
            sc.putImageData(img, 0, 0);
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(scratch, at(left, ax), at(top, ay), sw * k, sh * k);
            ctx.restore();
            words.push({ text, font, id: o.id, box, allowOverflow: o.allowOverflow });
            return box;
        },
        present(target) {
            const img = ctx.getImageData(0, 0, cols, rows);
            const d = img.data;
            for (let i = 0; i < d.length; i += 4) {
                // An empty cell is ground.
                const p = palette[d[i + 3] < 128 ? 0 : index(d[i], d[i + 1], d[i + 2])];
                d[i] = p[0];
                d[i + 1] = p[1];
                d[i + 2] = p[2];
                d[i + 3] = 255;
            }
            outCtx.putImageData(img, 0, 0);
            const tw = target.canvas.width;
            const th = target.canvas.height;
            const k = Math.max(1, Math.floor(Math.min(tw / cols, th / rows)));
            const ox = Math.floor((tw - cols * k) / 2);
            const oy = Math.floor((th - rows * k) / 2);
            target.save();
            target.setTransform(1, 0, 0, 1, 0, 0);
            target.globalAlpha = 1;
            target.globalCompositeOperation = 'source-over';
            target.fillStyle = hex[0];
            target.fillRect(0, 0, tw, th);
            target.imageSmoothingEnabled = false;
            target.drawImage(out, 0, 0, cols, rows, ox, oy, cols * k, rows * k);
            target.restore();
            // The words drawn this frame, in page CSS px, for check.
            const canvas = target.canvas;
            const rect =
                canvas instanceof HTMLCanvasElement ? canvas.getBoundingClientRect() : null;
            const sx = rect && tw > 0 ? rect.width / tw : 1 / dpr;
            const sy = rect && th > 0 ? rect.height / th : 1 / dpr;
            for (const w of words) {
                registerText({
                    id: w.id,
                    text: w.text,
                    font: w.font,
                    allowOverflow: w.allowOverflow,
                    box: {
                        x: (rect?.left ?? 0) + (ox + w.box.x * k) * sx,
                        y: (rect?.top ?? 0) + (oy + w.box.y * k) * sy,
                        width: w.box.width * k * sx,
                        height: w.box.height * k * sy,
                    },
                });
            }
            words.length = 0;
        },
    };
}
