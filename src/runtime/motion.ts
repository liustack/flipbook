// Stop-motion helpers. boil nudges a held drawing a little on every new
// drawing, as paper does under a rostrum camera. motionBlur draws a moving
// picture at several moments across the shutter and averages them. Both are
// pure functions of t.

import { rand } from './core/random.ts';
import { withoutTextRegistry } from './text.ts';

export interface BoilOptions {
    /** Frames each drawing is held, as in onFrames. Default 2. */
    every?: number;
    /** Largest shift in CSS px. Default 1.5. */
    amount?: number;
    /** Largest turn in degrees. Default 0.3. */
    turn?: number;
    /** Different seeds boil differently. Default 0. */
    seed?: number | string;
}

export interface Boil {
    x: number;
    y: number;
    /** Radians. */
    rotate: number;
}

/**
 * A small seeded shift and turn that holds for `every` frames and jumps on
 * the next drawing. Apply it with ctx.translate and ctx.rotate around the
 * thing that boils.
 */
export function boil(t: number, fps: number, options: BoilOptions = {}): Boil {
    const every = Math.max(1, Math.round(options.every ?? 2));
    const amount = options.amount ?? 1.5;
    const turn = ((options.turn ?? 0.3) * Math.PI) / 180;
    const seed = String(options.seed ?? 0);
    const step = Math.floor(Math.round(t * fps) / every);
    const angle = rand(0, 'boil-angle', seed, step) * Math.PI * 2;
    const reach = Math.sqrt(rand(0, 'boil-reach', seed, step)) * amount;
    return {
        x: Math.cos(angle) * reach,
        y: Math.sin(angle) * reach,
        rotate: (rand(0, 'boil-turn', seed, step) * 2 - 1) * turn,
    };
}

export interface MotionBlurOptions {
    fps: number;
    /** Share of a frame the shutter stays open. Default 0.5 (a 180 degree shutter). */
    shutter?: number;
    /** Moments drawn and averaged. Default 8. */
    samples?: number;
}

interface Buffer {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
}

const buffers: Buffer[] = [];

function buffer(slot: number, width: number, height: number): Buffer {
    let b = buffers[slot];
    if (!b) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('2D canvas context unavailable');
        b = { canvas, ctx };
        buffers[slot] = b;
    }
    if (b.canvas.width !== width || b.canvas.height !== height) {
        b.canvas.width = width;
        b.canvas.height = height;
    }
    b.ctx.setTransform(1, 0, 0, 1, 0, 0);
    b.ctx.globalAlpha = 1;
    b.ctx.globalCompositeOperation = 'source-over';
    b.ctx.clearRect(0, 0, width, height);
    return b;
}

/**
 * Draw `draw(ctx, time)` blurred along its motion: it is called `samples`
 * times, from half a shutter before t up to t, into a scratch canvas with
 * ctx's current transform, and the average lands on ctx. The call at t is the
 * only one whose canvas text reaches the text checks. A still picture comes
 * out as it went in.
 */
export function motionBlur(
    ctx: CanvasRenderingContext2D,
    t: number,
    draw: (ctx: CanvasRenderingContext2D, time: number) => void,
    options: MotionBlurOptions,
): void {
    const samples = Math.max(1, Math.round(options.samples ?? 8));
    if (samples === 1) {
        draw(ctx, t);
        return;
    }
    const open = (options.shutter ?? 0.5) / options.fps;
    const { width, height } = ctx.canvas;
    const transform = ctx.getTransform();
    const sum = buffer(0, width, height);
    const one = buffer(1, width, height);
    sum.ctx.globalCompositeOperation = 'lighter';
    sum.ctx.globalAlpha = 1 / samples;
    for (let i = 0; i < samples; i++) {
        const time = t - open * (1 - i / (samples - 1));
        if (i > 0) {
            one.ctx.setTransform(1, 0, 0, 1, 0, 0);
            one.ctx.clearRect(0, 0, width, height);
        }
        one.ctx.setTransform(transform);
        if (i === samples - 1) draw(one.ctx, time);
        else withoutTextRegistry(() => draw(one.ctx, time));
        sum.ctx.drawImage(one.canvas, 0, 0);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(sum.canvas, 0, 0);
    ctx.restore();
}
