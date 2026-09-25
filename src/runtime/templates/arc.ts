// Arc match cut: one arc stays put across every shot while what lies above
// and below it changes at each cut. Words ride along the arc.
import { clamp, progress } from '../core/ease.ts';
import type { Point } from '../materials.ts';
import { type PathTextOptions, type TextBox, textOnPath } from '../text.ts';

/** The arc at one moment, in the coordinates the drawers use. */
export interface ArcGeometry {
    /** Center and radius of the circle the arc belongs to. */
    cx: number;
    cy: number;
    r: number;
    /** Top of the arc. */
    apex: Point;
    /** Height of the arc at x. */
    y(x: number): number;
    /** The arc from the left frame edge (u = 0) to the right one (u = 1). */
    path(u: number): Point;
    /** Length of that stretch of arc. */
    length: number;
    /** Add the arc to the current path, left to right across the frame. */
    trace(ctx: CanvasRenderingContext2D): void;
}

export interface ShotInfo {
    index: number;
    t: number;
    /** Seconds since this shot started. */
    local: number;
    /** Seconds this shot lasts. */
    span: number;
    /** local / span, 0 to 1. */
    progress: number;
    arc: ArcGeometry;
}

/** Draws one side of shot `index`. The template clips it to that side of the arc. */
export type ShotDrawer = (ctx: CanvasRenderingContext2D, index: number, info: ShotInfo) => void;

export interface ArcCutsOptions {
    stage: { width: number; height: number };
    /** When each shot starts, in seconds, rising. */
    times: readonly number[];
    /** What lies above the arc. */
    above: ShotDrawer;
    /** What lies below the arc. */
    below: ShotDrawer;
    /** Drawn last, unclipped: a lit rim, a crust, a glow along the arc. */
    edge?: ShotDrawer;
    /** When the last shot ends. Default one more gap after it. */
    end?: number;
    /** Height of the arc's top. Default 58% of the stage height. */
    apex?: number;
    /** How far the arc drops from its top to the frame edges. Default 16% of the stage height. */
    rise?: number;
    /** How much the arc grows from the first cut to the end, about its top. Default 0.06. */
    push?: number;
}

export interface LabelOptions extends Omit<PathTextOptions, 'offset' | 'align'> {
    /** Slide along the arc from its top, in px, positive to the right. Default 0. */
    shift?: number;
}

export interface ArcCuts {
    draw(ctx: CanvasRenderingContext2D, t: number): void;
    /** Which shot is up at time t. */
    shotAt(t: number): number;
    /** The arc at time t, in stage coordinates. */
    arcAt(t: number): ArcGeometry;
    /**
     * Text along the arc, centered on its top, lifted by `lift` px (default
     * half the font size). Registered with check. Returns its page box.
     */
    label(
        ctx: CanvasRenderingContext2D,
        t: number,
        text: string,
        options?: LabelOptions,
    ): TextBox | null;
}

function geometry(stage: { width: number }, apexY: number, rise: number): ArcGeometry {
    const half = stage.width / 2;
    const r = (half * half + rise * rise) / (2 * rise);
    const cx = half;
    const cy = apexY + r;
    const reach = Math.asin(Math.min(1, half / r));
    const from = -Math.PI / 2 - reach;
    const to = -Math.PI / 2 + reach;
    return {
        cx,
        cy,
        r,
        apex: [cx, apexY],
        y: (x) => cy - Math.sqrt(Math.max(0, r * r - (x - cx) * (x - cx))),
        path: (u) => {
            const a = from + (to - from) * u;
            return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
        },
        length: r * (to - from),
        trace(ctx) {
            ctx.arc(cx, cy, r, from, to);
        },
    };
}

/** Build an arc match cut. Call it in setup or at module level, draw in seek. */
export function arcCuts(options: ArcCutsOptions): ArcCuts {
    const { stage, above, below, edge } = options;
    const times = [...options.times];
    if (times.length === 0) throw new Error('arcCuts needs at least one shot time');
    for (let i = 1; i < times.length; i++) {
        if (times[i] <= times[i - 1]) throw new Error('arcCuts needs shot times in rising order');
    }
    const lastGap = times.length > 1 ? times[times.length - 1] - times[times.length - 2] : 1;
    const end = options.end ?? times[times.length - 1] + lastGap;
    const apexY = options.apex ?? stage.height * 0.58;
    const rise = options.rise ?? stage.height * 0.16;
    if (!(rise > 0)) throw new Error('arcCuts needs a positive rise');
    const push = options.push ?? 0.06;
    const arc = geometry(stage, apexY, rise);

    const shotAt = (t: number) => {
        let index = 0;
        for (let i = 0; i < times.length; i++) if (t >= times[i]) index = i;
        return index;
    };
    // A steady push, so the picture never settles into a still.
    const scaleAt = (t: number) => 1 + push * progress(t, times[0], end);
    /** Grow the picture about the arc's top. */
    const pushIn = (ctx: CanvasRenderingContext2D, t: number) => {
        const s = scaleAt(t);
        ctx.translate(arc.apex[0], arc.apex[1]);
        ctx.scale(s, s);
        ctx.translate(-arc.apex[0], -arc.apex[1]);
    };
    // The stage in the pushed coordinates, with a margin so no edge shows.
    const cover = { x: -stage.width, y: -stage.height, w: stage.width * 3, h: stage.height * 3 };

    return {
        shotAt,
        arcAt(t) {
            const s = scaleAt(t);
            const [ax, ay] = arc.apex;
            const map = ([x, y]: Point): Point => [ax + (x - ax) * s, ay + (y - ay) * s];
            return {
                cx: ax + (arc.cx - ax) * s,
                cy: ay + (arc.cy - ay) * s,
                r: arc.r * s,
                apex: [ax, ay],
                y: (x) => ay + (arc.y(ax + (x - ax) / s) - ay) * s,
                path: (u) => map(arc.path(u)),
                length: arc.length * s,
                trace(ctx) {
                    ctx.save();
                    ctx.translate(ax, ay);
                    ctx.scale(s, s);
                    ctx.translate(-ax, -ay);
                    arc.trace(ctx);
                    ctx.restore();
                },
            };
        },
        draw(ctx, t) {
            const index = shotAt(t);
            const since = Math.max(0, t - times[index]);
            const span = (index + 1 < times.length ? times[index + 1] : end) - times[index];
            const info: ShotInfo = {
                index,
                t,
                local: since,
                span,
                progress: span > 0 ? clamp(since / span) : 1,
                arc,
            };
            ctx.save();
            pushIn(ctx, t);
            ctx.save();
            ctx.beginPath();
            ctx.rect(cover.x, cover.y, cover.w, cover.h);
            ctx.arc(arc.cx, arc.cy, arc.r, 0, Math.PI * 2);
            ctx.clip('evenodd');
            above(ctx, index, info);
            ctx.restore();
            ctx.save();
            ctx.beginPath();
            ctx.arc(arc.cx, arc.cy, arc.r, 0, Math.PI * 2);
            ctx.clip();
            below(ctx, index, info);
            ctx.restore();
            if (edge) {
                ctx.save();
                edge(ctx, index, info);
                ctx.restore();
            }
            ctx.restore();
        },
        label(ctx, t, text, labelOptions = {}) {
            const { shift = 0, ...rest } = labelOptions;
            const size = /(\d+(?:\.\d+)?)px/.exec(rest.font ?? '')?.[1];
            const lift = rest.lift ?? (size ? Number(size) * 0.5 : 24);
            ctx.save();
            pushIn(ctx, t);
            const box = textOnPath(ctx, text, arc.path, {
                ...rest,
                lift,
                align: 'center',
                offset: arc.length / 2 + shift,
            });
            ctx.restore();
            return box;
        },
    };
}
