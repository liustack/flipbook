/** Attribute that marks the paper layer; everything else is content. */
export const LAYER_ATTR = 'data-flipbook-layer';
/** Attribute on <html>: "off" hides every layer except the paper layer. */
export const CONTENT_ATTR = 'data-flipbook-content';

const STYLE_ID = '__flipbook-content-style';

function ensureStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
        `html[${CONTENT_ATTR}="off"] body * { visibility: hidden !important; }` +
        `html[${CONTENT_ATTR}="off"] [${LAYER_ATTR}="paper"],` +
        `html[${CONTENT_ATTR}="off"] [${LAYER_ATTR}="paper"] * { visibility: visible !important; }`;
    (document.head ?? document.documentElement).appendChild(style);
}

/** Show or hide the content layer. Hidden leaves only elements marked data-flipbook-layer="paper". */
export function setContentLayer(visible: boolean): void {
    ensureStyle();
    if (visible) document.documentElement.removeAttribute(CONTENT_ATTR);
    else document.documentElement.setAttribute(CONTENT_ATTR, 'off');
}

export function isContentLayerOn(): boolean {
    return document.documentElement.getAttribute(CONTENT_ATTR) !== 'off';
}

/**
 * Size a canvas for CSS size width x height at the device pixel ratio and
 * return a 2D context that draws in CSS pixels.
 */
export function setupCanvas(
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
): CanvasRenderingContext2D {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
}

export interface StaticLayer {
    readonly canvas: HTMLCanvasElement;
    readonly width: number;
    readonly height: number;
    /** Copy the cached drawing onto `target` at (x, y). */
    blit(target: CanvasRenderingContext2D, x?: number, y?: number): void;
}

/**
 * Draw something once into an offscreen canvas and reuse it every frame.
 * Call it in setup so the drawing is ready before the first seek.
 */
export function staticLayer(
    width: number,
    height: number,
    draw: (ctx: CanvasRenderingContext2D) => void,
): StaticLayer {
    const canvas = document.createElement('canvas');
    const ctx = setupCanvas(canvas, width, height);
    draw(ctx);
    return {
        canvas,
        width,
        height,
        blit(target, x = 0, y = 0) {
            target.drawImage(canvas, x, y, width, height);
        },
    };
}
