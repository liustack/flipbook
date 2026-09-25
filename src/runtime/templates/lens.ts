// Lens montage: plates seen through a round eyepiece, cut on the beat, then
// the window opens until it fills the frame.
import { clamp, ease, lerp, progress } from '../core/ease.ts';
import type { Point } from '../materials.ts';

export interface PlateInfo {
    index: number;
    t: number;
    /** Seconds since this plate came up. */
    local: number;
    /** Seconds this plate stays up. */
    span: number;
    /** local / span, 0 to 1. */
    progress: number;
    /** 0 before the pull-out, 1 once the window fills the frame. */
    pull: number;
    center: Point;
    /** Radius of the window at this moment. */
    radius: number;
}

/** Draws plate `index` in stage coordinates. The lens clips it to the window. */
export type PlateDrawer = (ctx: CanvasRenderingContext2D, index: number, info: PlateInfo) => void;

export interface LensTicks {
    /** Ticks around the rim. Default 72. */
    count?: number;
    /** Every n-th tick is long. Default 6. */
    major?: number;
    /** Default a pale ivory. */
    color?: string;
}

export interface LensOptions {
    stage: { width: number; height: number };
    /** When each plate comes up, in seconds: plate i from times[i]. */
    times: readonly number[];
    plate: PlateDrawer;
    /** When the last plate ends, for its progress. Default: the pull-out end, or one more gap. */
    end?: number;
    /** Default the stage center. */
    center?: Point;
    /** Window radius. Default 36% of the shorter stage side. */
    radius?: number;
    /** Seconds the iris takes to open inside the ring, starting at times[0]. Default 0: open from the start. */
    open?: number;
    /** [start, end] seconds over which the window grows until it fills the frame. */
    pullOut?: readonly [number, number];
    /** Width of the eyepiece ring as a share of the radius. Default 0.22. */
    rim?: number;
    /** Color around the eyepiece. Default '#0d0c0b'. */
    surround?: string;
    /** Darkening at the window edge, 0 to 1. Default 0.6. */
    vignette?: number;
    /** Scale marks inside the rim. Default none. */
    ticks?: boolean | LensTicks;
    /** Warm and cool color fringes at the window edge, 0 to 1. Default 0.4. */
    fringe?: number;
    /** Seconds each plate takes to come into focus after its cut. Default 0.2. 0 for sharp cuts. */
    refocus?: number;
    /** Blur at the cut, in px. Default 6. */
    blur?: number;
}

export interface LensMontage {
    /** Draw the eyepiece and the plate for time t. */
    draw(ctx: CanvasRenderingContext2D, t: number): void;
    /** Which plate is up at time t. */
    plateAt(t: number): number;
    /** Window center and radius at time t. */
    windowAt(t: number): { center: Point; radius: number };
}

function deviceScale(ctx: CanvasRenderingContext2D): number {
    const m = ctx.getTransform();
    return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
}

/** Build a lens montage. Call it in setup or at module level, draw in seek. */
export function lens(options: LensOptions): LensMontage {
    const { stage, plate } = options;
    const times = [...options.times];
    if (times.length === 0) throw new Error('lens needs at least one plate time');
    for (let i = 1; i < times.length; i++) {
        if (times[i] <= times[i - 1]) throw new Error('lens needs plate times in rising order');
    }
    const center: Point = options.center ?? [stage.width / 2, stage.height / 2];
    const radius = options.radius ?? Math.min(stage.width, stage.height) * 0.36;
    const rim = options.rim ?? 0.22;
    const surround = options.surround ?? '#0d0c0b';
    const vignette = clamp(options.vignette ?? 0.6);
    const fringe = clamp(options.fringe ?? 0.4);
    const refocus = options.refocus ?? 0.2;
    const blur = options.blur ?? 6;
    const open = options.open ?? 0;
    const pullOut = options.pullOut;
    const lastGap = times.length > 1 ? times[times.length - 1] - times[times.length - 2] : 1;
    const end = options.end ?? (pullOut ? pullOut[1] : times[times.length - 1] + lastGap);
    const ticks =
        options.ticks === true ? {} : options.ticks === false ? null : (options.ticks ?? null);
    const full =
        Math.max(
            ...[
                [0, 0],
                [stage.width, 0],
                [0, stage.height],
                [stage.width, stage.height],
            ].map(([x, y]) => Math.hypot(x - center[0], y - center[1])),
        ) + 2;

    const plateAt = (t: number) => {
        let index = 0;
        for (let i = 0; i < times.length; i++) if (t >= times[i]) index = i;
        return index;
    };
    const pullAt = (t: number) =>
        pullOut ? ease.inOutCubic(progress(t, pullOut[0], pullOut[1])) : 0;
    /** Inner edge of the eyepiece ring: grows during the pull-out. */
    const ringAt = (t: number) => lerp(radius, full, pullAt(t));
    /** The open part of the iris inside the ring. */
    const windowAt = (t: number) => {
        const opening = open > 0 ? ease.outCubic(progress(t, times[0], times[0] + open)) : 1;
        return ringAt(t) * opening;
    };

    const drawEyepiece = (ctx: CanvasRenderingContext2D, R: number, win: number, px: number) => {
        const [cx, cy] = center;
        const outer = R * (1 + rim);
        ctx.save();
        ctx.beginPath();
        ctx.rect(-stage.width, -stage.height, stage.width * 3, stage.height * 3);
        if (win > 0.5) ctx.arc(cx, cy, win, 0, Math.PI * 2);
        ctx.fillStyle = surround;
        ctx.fill('evenodd');
        if (win > 0.5 && win < R - 0.5) {
            // The edge of the iris leaves.
            ctx.beginPath();
            ctx.arc(cx, cy, win + 0.5 / px, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 248, 235, 0.12)';
            ctx.lineWidth = 1 / px;
            ctx.stroke();
        }
        const g = ctx.createRadialGradient(cx, cy, R, cx, cy, outer);
        g.addColorStop(0, '#46413b');
        g.addColorStop(0.08, '#2a2724');
        g.addColorStop(0.45, '#1a1816');
        g.addColorStop(1, surround);
        ctx.beginPath();
        ctx.arc(cx, cy, outer, 0, Math.PI * 2);
        ctx.arc(cx, cy, R, 0, Math.PI * 2, true);
        ctx.fillStyle = g;
        ctx.fill();
        // Knurled grip: fine radial ribs across the ring.
        const ribs = 240;
        ctx.lineWidth = Math.max(0.6, R * 0.006);
        for (let i = 0; i < ribs; i++) {
            const a = (i / ribs) * Math.PI * 2;
            const c = Math.cos(a);
            const s = Math.sin(a);
            ctx.strokeStyle = i % 2 ? 'rgba(255, 245, 230, 0.07)' : 'rgba(0, 0, 0, 0.35)';
            ctx.beginPath();
            ctx.moveTo(cx + c * R * (1 + rim * 0.12), cy + s * R * (1 + rim * 0.12));
            ctx.lineTo(cx + c * R * (1 + rim * 0.78), cy + s * R * (1 + rim * 0.78));
            ctx.stroke();
        }
        // Barrel steps beyond the ring.
        for (const [k, alpha] of [
            [1.1, 0.07],
            [1.24, 0.05],
        ] as const) {
            ctx.beginPath();
            ctx.arc(cx, cy, outer * k, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 245, 230, ${alpha})`;
            ctx.lineWidth = Math.max(1, R * 0.012);
            ctx.stroke();
        }
        // The lit lip of the ring.
        ctx.beginPath();
        ctx.arc(cx, cy, R + 1 / px, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 248, 235, 0.16)';
        ctx.lineWidth = 1.5 / px;
        ctx.stroke();
        ctx.restore();
    };

    return {
        plateAt,
        windowAt: (t) => ({ center, radius: windowAt(t) }),
        draw(ctx, t) {
            const px = deviceScale(ctx);
            const index = plateAt(t);
            const pull = pullAt(t);
            const ring = ringAt(t);
            const R = windowAt(t);
            const [cx, cy] = center;
            const since = Math.max(0, t - times[index]);
            const span = (index + 1 < times.length ? times[index + 1] : end) - times[index];
            const info: PlateInfo = {
                index,
                t,
                local: since,
                span,
                progress: span > 0 ? clamp(since / span) : 1,
                pull,
                center,
                radius: R,
            };
            if (R > 0.5) {
                const focus = refocus > 0 ? blur * (1 - ease.outCubic(clamp(since / refocus))) : 0;
                ctx.save();
                ctx.beginPath();
                ctx.arc(cx, cy, R, 0, Math.PI * 2);
                ctx.clip();
                if (focus > 0.05) ctx.filter = `blur(${(focus * px).toFixed(2)}px)`;
                plate(ctx, index, info);
                ctx.filter = 'none';
                const fade = 1 - pull;
                if (vignette > 0 && fade > 0) {
                    const g = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R);
                    g.addColorStop(0, 'rgba(8, 6, 4, 0)');
                    g.addColorStop(0.7, `rgba(8, 6, 4, ${0.25 * vignette * fade})`);
                    g.addColorStop(1, `rgba(8, 6, 4, ${0.85 * vignette * fade})`);
                    ctx.fillStyle = g;
                    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
                }
                if (fringe > 0 && fade > 0) {
                    ctx.lineWidth = Math.max(1, R * 0.008);
                    ctx.strokeStyle = `rgba(255, 110, 60, ${0.35 * fringe * fade})`;
                    ctx.beginPath();
                    ctx.arc(cx, cy, R - ctx.lineWidth * 0.5, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.strokeStyle = `rgba(70, 150, 255, ${0.25 * fringe * fade})`;
                    ctx.beginPath();
                    ctx.arc(cx, cy, R - ctx.lineWidth * 2, 0, Math.PI * 2);
                    ctx.stroke();
                }
                if (ticks && fade > 0) {
                    const count = ticks.count ?? 72;
                    const major = ticks.major ?? 6;
                    ctx.strokeStyle = ticks.color ?? 'rgba(245, 238, 222, 0.55)';
                    ctx.globalAlpha *= fade;
                    ctx.lineWidth = Math.max(1, R * 0.004);
                    for (let i = 0; i < count; i++) {
                        const a = (i / count) * Math.PI * 2 - Math.PI / 2;
                        const inner = R * (i % major === 0 ? 0.93 : 0.965);
                        const outer = R * 0.985;
                        ctx.beginPath();
                        ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
                        ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
                        ctx.stroke();
                    }
                }
                ctx.restore();
            }
            if (R < full) drawEyepiece(ctx, ring, R, px);
        },
    };
}
