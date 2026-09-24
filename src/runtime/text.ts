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
    const width = options.maxWidth !== undefined ? Math.min(m.width, options.maxWidth) : m.width;
    const transform = ctx.getTransform();
    const dpr = window.devicePixelRatio || 1;
    const left = x - m.actualBoundingBoxLeft;
    const top = y - m.actualBoundingBoxAscent;
    const height = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    const point = new DOMPoint(left, top).matrixTransform(transform);
    const canvasRect =
        ctx.canvas instanceof HTMLCanvasElement ? ctx.canvas.getBoundingClientRect() : null;
    const box: TextBox = {
        x: (canvasRect?.left ?? 0) + point.x / dpr,
        y: (canvasRect?.top ?? 0) + point.y / dpr,
        width: (width * transform.a) / dpr,
        height: (height * transform.d) / dpr,
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
