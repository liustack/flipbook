import { host } from './core/timeline.ts';

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
