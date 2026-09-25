// Page turn: a page curls up from a corner, rolls over a cylinder and lands
// mirrored on the other side of the spine. Drawn with 2D transforms, clips
// and gradients: the flat part of the turned page is a reflection, the curl
// is cut into strips that each get their own squeeze.
import { rgba } from '../color.ts';
import { clamp, type Easing, ease } from '../core/ease.ts';
import type { Box, Point } from '../materials.ts';
import { withoutTextRegistry } from '../text.ts';

/** Draws page `index` at time t, in page units, (0, 0) at the page's top left. */
export type PageDrawer = (ctx: CanvasRenderingContext2D, index: number, t: number) => void;

export interface PageTurnOptions {
    /** Where the page lies on the stage. The spine is its left edge. */
    box: Box;
    /** When each turn starts, in seconds, in page order: page i turns at turns[i]. */
    turns: readonly number[];
    /** Draws the front of each page. Paint the whole page: a background first. */
    front: PageDrawer;
    /** Draws the back of a page as it reads once turned. Default: plain paper. */
    back?: PageDrawer;
    /** Drawing units of a page. Default: the box size. */
    page?: { width: number; height: number };
    /** Seconds a turn takes, one for all or one per turn. Default 0.6. */
    duration?: number | readonly number[];
    /** The corner that leads. Default 'bottom'. */
    corner?: 'bottom' | 'top';
    /** Easing of a turn. Default ease.inOutCubic. */
    ease?: Easing;
    /** Slant of the fold when the corner first lifts, in radians. Default 0.45. */
    tilt?: number;
    /** Radius of the curl at mid-turn, as a share of the page height. Default 0.08. */
    curl?: number;
    /** Keep turned pages lying on the left of the spine, as in an open book. Default false. */
    spread?: boolean;
    /** Color of the back. Default '#f5f0e5'. */
    paper?: string;
    /** Opacity of the front showing through the back, mirrored. Default 0.14. */
    showThrough?: number;
    /** Strength of the shadows, 0 to 1. Default 0.6. */
    shadow?: number;
    /** Pages that turn as stiff boards swinging on the spine, such as a cover. Default none. */
    rigid?: readonly number[];
}

export interface TurningPage {
    index: number;
    /** 0 when the turn starts, 1 once the page lies on the other side. */
    progress: number;
}

export interface PageTurn {
    /** Number of pages: one more than turns. */
    readonly pages: number;
    /** Draw every page for time t. */
    draw(ctx: CanvasRenderingContext2D, t: number): void;
    /** Pages in the middle of a turn at time t, top page first. */
    turning(t: number): TurningPage[];
    /** The page lying flat on top of the unturned stack at time t. */
    top(t: number): number;
}

type Poly = Point[];

/** Keep the part of a convex polygon where sign * (n·p - c) >= 0. */
function clipHalf(poly: Poly, n: Point, c: number, sign: 1 | -1): Poly {
    const out: Poly = [];
    const side = (p: Point) => sign * (p[0] * n[0] + p[1] * n[1] - c);
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const da = side(a);
        const db = side(b);
        if (da >= 0) out.push(a);
        if (da >= 0 !== db >= 0) {
            const u = da / (da - db);
            out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
        }
    }
    return out;
}

function tracePoly(ctx: CanvasRenderingContext2D, poly: Poly): void {
    ctx.beginPath();
    poly.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.closePath();
}

/** The affine map X -> X + (g(s) - s) n with g(s) = alpha + k s and s = n·X - c, as canvas arguments. */
function stripMatrix(
    n: Point,
    c: number,
    k: number,
    alpha: number,
): [number, number, number, number, number, number] {
    const m = k - 1;
    const tx = (alpha - m * c) * n[0];
    const ty = (alpha - m * c) * n[1];
    return [1 + m * n[0] * n[0], m * n[0] * n[1], m * n[0] * n[1], 1 + m * n[1] * n[1], tx, ty];
}

function applyMatrix(m: [number, number, number, number, number, number], [x, y]: Point): Point {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Device pixels per unit of the context's current transform. */
function deviceScale(ctx: CanvasRenderingContext2D): number {
    const m = ctx.getTransform();
    return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
}

interface Scratch {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
}

function makeScratch(): Scratch {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    return { canvas, ctx };
}

/**
 * Build a page turn. Page 0 lies on top; each entry of `turns` turns the next
 * page over. Call it in setup or at module level, draw in seek.
 */
export function pageTurn(options: PageTurnOptions): PageTurn {
    const { box, front, back } = options;
    const W = box.width;
    const H = box.height;
    const unit = options.page ?? { width: W, height: H };
    const sx = W / unit.width;
    const sy = H / unit.height;
    const turns = [...options.turns];
    for (let i = 1; i < turns.length; i++) {
        if (turns[i] < turns[i - 1]) throw new Error('pageTurn needs turns in time order');
    }
    const given = options.duration ?? 0.6;
    const durations = typeof given === 'number' ? turns.map(() => given) : [...given];
    if (durations.length !== turns.length) {
        throw new Error(`pageTurn got ${turns.length} turns and ${durations.length} durations`);
    }
    if (!durations.every((d) => d > 0)) throw new Error('pageTurn needs positive durations');
    const easing = options.ease ?? ease.inOutCubic;
    const tilt = options.tilt ?? 0.45;
    const curl = (options.curl ?? 0.08) * H;
    const spread = options.spread ?? false;
    const paper = options.paper ?? '#f5f0e5';
    const showThrough = options.showThrough ?? 0.14;
    const shadow = clamp(options.shadow ?? 0.6);
    const bottom = (options.corner ?? 'bottom') === 'bottom';
    const rigid = new Set(options.rigid ?? []);
    const rect: Poly = [
        [0, 0],
        [W, 0],
        [W, H],
        [0, H],
    ];
    const scratches: Scratch[] = [];

    const turning = (t: number): TurningPage[] => {
        const out: TurningPage[] = [];
        for (let i = 0; i < turns.length; i++) {
            if (t >= turns[i] && t < turns[i] + durations[i]) {
                out.push({ index: i, progress: (t - turns[i]) / durations[i] });
            }
        }
        return out;
    };
    const top = (t: number) => turns.filter((start) => t >= start).length;

    /** Render a page (front or back) into a scratch canvas at the resolution the stage needs. */
    const render = (slot: number, res: number, draw: PageDrawer, index: number, t: number) => {
        scratches[slot] ??= makeScratch();
        const s = scratches[slot];
        const w = Math.max(1, Math.ceil(W * res));
        const h = Math.max(1, Math.ceil(H * res));
        if (s.canvas.width !== w || s.canvas.height !== h) {
            s.canvas.width = w;
            s.canvas.height = h;
        }
        s.ctx.setTransform(1, 0, 0, 1, 0, 0);
        s.ctx.clearRect(0, 0, w, h);
        s.ctx.setTransform(res * sx, 0, 0, res * sy, 0, 0);
        withoutTextRegistry(() => draw(s.ctx, index, t));
        return s.canvas;
    };

    /** Page `index`'s drawer on the stage context, clipped to `poly`, in page units. */
    const direct = (
        ctx: CanvasRenderingContext2D,
        draw: PageDrawer,
        index: number,
        t: number,
        poly: Poly,
    ) => {
        ctx.save();
        tracePoly(ctx, poly);
        ctx.clip();
        ctx.scale(sx, sy);
        draw(ctx, index, t);
        ctx.restore();
    };

    /** A turned page lying flat, mirrored across the spine. */
    const drawLanded = (ctx: CanvasRenderingContext2D, index: number, t: number, res: number) => {
        const mirrored: Poly = [
            [-W, 0],
            [0, 0],
            [0, H],
            [-W, H],
        ];
        ctx.save();
        tracePoly(ctx, mirrored);
        ctx.fillStyle = paper;
        ctx.fill();
        if (back) {
            ctx.save();
            ctx.translate(-W, 0);
            direct(ctx, back, index, t, rect);
            ctx.restore();
        }
        if (showThrough > 0 && !rigid.has(index)) {
            const image = render(0, res, front, index, t);
            tracePoly(ctx, mirrored);
            ctx.clip();
            ctx.globalAlpha *= showThrough;
            ctx.scale(-1, 1);
            ctx.drawImage(image, 0, 0, W, H);
        }
        ctx.restore();
    };

    /**
     * A stiff board swinging on the spine, seen from above: it narrows toward
     * the spine, its free edge grows as it rises toward the eye, and it shows
     * its back once past upright.
     */
    const drawRigid = (
        ctx: CanvasRenderingContext2D,
        index: number,
        p: number,
        t: number,
        res: number,
        px: number,
    ) => {
        const angle = Math.PI * easing(clamp(p));
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const reach = W * cos;
        // Shadow on the page underneath, beyond the board.
        if (shadow > 0 && sin > 0.01) {
            const from = Math.max(0, reach);
            const g = ctx.createLinearGradient(from, 0, from + W * 0.45 * sin, 0);
            g.addColorStop(0, `rgba(30, 20, 10, ${0.5 * shadow * sin})`);
            g.addColorStop(1, 'rgba(30, 20, 10, 0)');
            ctx.save();
            tracePoly(ctx, rect);
            ctx.clip();
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, W, H);
            ctx.restore();
        }
        if (Math.abs(cos) < 0.004) return;
        const showsFront = cos > 0;
        const image = showsFront
            ? render(0, res, front, index, t)
            : back
              ? render(1, res, back, index, t)
              : null;
        const strips = 24;
        const lift = 0.07 * sin;
        ctx.save();
        for (let i = 0; i < strips; i++) {
            const x0 = (W * i) / strips;
            const x1 = (W * (i + 1)) / strips + 0.75;
            const grow = 1 + lift * ((x0 + x1) / 2 / W);
            const top = H / 2 - (H / 2) * grow;
            ctx.save();
            ctx.beginPath();
            ctx.rect(Math.min(x0 * cos, x1 * cos), top, Math.abs((x1 - x0) * cos), H * grow);
            ctx.clip();
            ctx.transform(cos, 0, 0, grow, 0, top);
            if (image && showsFront) {
                ctx.drawImage(image, 0, 0, W, H);
            } else {
                ctx.fillStyle = paper;
                ctx.fillRect(0, 0, W, H);
                if (image) {
                    ctx.transform(-1, 0, 0, 1, W, 0);
                    ctx.drawImage(image, 0, 0, W, H);
                }
            }
            ctx.restore();
        }
        // Darker as the board turns away from the light.
        const outline: Poly = [
            [0, 0],
            [reach, H / 2 - (H / 2) * (1 + lift)],
            [reach, H / 2 + (H / 2) * (1 + lift)],
            [0, H],
        ];
        tracePoly(ctx, outline);
        ctx.fillStyle = `rgba(20, 14, 8, ${0.5 * sin * sin})`;
        ctx.fill();
        ctx.strokeStyle = rgba('#3c2a18', 0.3);
        ctx.lineWidth = 1 / px;
        ctx.stroke();
        ctx.restore();
    };

    const drawTurning = (
        ctx: CanvasRenderingContext2D,
        index: number,
        p: number,
        t: number,
        res: number,
        px: number,
    ) => {
        const e = easing(clamp(p));
        const phi = tilt * (1 - e);
        const n: Point = [Math.cos(phi), bottom ? Math.sin(phi) : -Math.sin(phi)];
        const q: Point = [W * (1 - e), bottom ? H : 0];
        const c = q[0] * n[0] + q[1] * n[1];
        const R = curl * Math.sin(Math.PI * e);
        const rolled = R > 0.5;
        // Projected distance from the fold line for paper at distance s along the page.
        const f = (s: number) =>
            !rolled ? -s : s <= Math.PI * R ? R * Math.sin(s / R) : Math.PI * R - s;
        const origin: Point = [c * n[0], c * n[1]];
        const at = (v: number): Point => [origin[0] + v * n[0], origin[1] + v * n[1]];
        const strength = shadow * Math.sin(Math.PI * e) ** 0.6;
        const stay = clipHalf(rect, n, c, -1);
        const lifted = clipHalf(rect, n, c, 1);

        // Shadow the curl throws on the page underneath.
        if (lifted.length > 2 && strength > 0) {
            const reach = R * 1.2 + H * 0.05;
            const g = ctx.createLinearGradient(...at(R), ...at(R + reach));
            g.addColorStop(0, `rgba(30, 20, 10, ${0.45 * strength})`);
            g.addColorStop(0.35, `rgba(30, 20, 10, ${0.18 * strength})`);
            g.addColorStop(1, 'rgba(30, 20, 10, 0)');
            ctx.save();
            tracePoly(ctx, lifted);
            ctx.clip();
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, W, H);
            ctx.restore();
        }

        // The part still lying flat.
        if (stay.length > 2) direct(ctx, front, index, t, stay);
        if (lifted.length < 3) return;

        const frontImage = render(0, res, front, index, t);
        const backImage = back ? render(1, res, back, index, t) : null;
        const strips = 6;

        // The rising half of the curl shows the front, squeezed toward the fold.
        if (rolled) {
            const half = (Math.PI * R) / 2;
            for (let i = 0; i < strips; i++) {
                const a = (half * i) / strips;
                const b = (half * (i + 1)) / strips;
                const region = clipHalf(clipHalf(rect, n, c + a, 1), n, c + b + 0.75, -1);
                if (region.length < 3) continue;
                const k = (f(b) - f(a)) / (b - a);
                const m = stripMatrix(n, c, k, f(a) - k * a);
                ctx.save();
                tracePoly(
                    ctx,
                    region.map((pt) => applyMatrix(m, pt)),
                );
                ctx.clip();
                ctx.transform(...m);
                ctx.drawImage(frontImage, 0, 0, W, H);
                ctx.restore();
            }
            ctx.save();
            const band = clipHalf(clipHalf(rect, n, c, 1), n, c + half, -1).map((pt) => {
                const s = pt[0] * n[0] + pt[1] * n[1] - c;
                return [pt[0] + (f(s) - s) * n[0], pt[1] + (f(s) - s) * n[1]] as Point;
            });
            if (band.length > 2) {
                tracePoly(ctx, band);
                const g = ctx.createLinearGradient(...at(0), ...at(R));
                g.addColorStop(0, 'rgba(20, 12, 6, 0)');
                g.addColorStop(1, 'rgba(20, 12, 6, 0.35)');
                ctx.fillStyle = g;
                ctx.fill();
            }
            ctx.restore();
        }

        // The back: the top of the curl and the flat part folded over.
        const start = rolled ? (Math.PI * R) / 2 : 0;
        const source = clipHalf(rect, n, c + start, 1);
        if (source.length < 3) return;
        const outline: Poly = [];
        for (let i = 0; i < source.length; i++) {
            const a = source[i];
            const b = source[(i + 1) % source.length];
            const pieces = rolled ? 24 : 1;
            for (let j = 0; j < pieces; j++) {
                const u = j / pieces;
                const x = a[0] + (b[0] - a[0]) * u;
                const y = a[1] + (b[1] - a[1]) * u;
                const s = x * n[0] + y * n[1] - c;
                const d = f(s) - s;
                outline.push([x + d * n[0], y + d * n[1]]);
            }
        }
        ctx.save();
        tracePoly(ctx, outline);
        ctx.fillStyle = paper;
        if (strength > 0) {
            ctx.shadowColor = `rgba(30, 20, 10, ${0.4 * strength})`;
            ctx.shadowBlur = (4 + R * 0.6) * px;
            ctx.shadowOffsetX = (2 + R * 0.25) * px;
            ctx.shadowOffsetY = (3 + R * 0.35) * px;
        }
        ctx.fill();
        ctx.restore();

        ctx.save();
        tracePoly(ctx, outline);
        ctx.clip();
        // Pieces of the back: [from s, to s] with the linear map each uses.
        const pieces: { a: number; b: number; k: number; alpha: number }[] = [];
        if (rolled) {
            const half = (Math.PI * R) / 2;
            for (let i = 0; i < strips; i++) {
                const a = half + (half * i) / strips;
                const b = half + (half * (i + 1)) / strips;
                const k = (f(b) - f(a)) / (b - a);
                pieces.push({ a, b, k, alpha: f(a) - k * a });
            }
            pieces.push({ a: Math.PI * R, b: Number.POSITIVE_INFINITY, k: -1, alpha: Math.PI * R });
        } else {
            pieces.push({ a: 0, b: Number.POSITIVE_INFINITY, k: -1, alpha: 0 });
        }
        for (const piece of pieces) {
            let region = clipHalf(rect, n, c + piece.a - (piece.a > start ? 0.75 : 0), 1);
            if (Number.isFinite(piece.b)) region = clipHalf(region, n, c + piece.b, -1);
            if (region.length < 3) continue;
            const m = stripMatrix(n, c, piece.k, piece.alpha);
            ctx.save();
            tracePoly(
                ctx,
                region.map((pt) => applyMatrix(m, pt)),
            );
            ctx.clip();
            ctx.transform(...m);
            if (backImage) {
                ctx.save();
                ctx.transform(-1, 0, 0, 1, W, 0);
                ctx.drawImage(backImage, 0, 0, W, H);
                ctx.restore();
            }
            if (showThrough > 0) {
                ctx.globalAlpha *= showThrough;
                ctx.drawImage(frontImage, 0, 0, W, H);
            }
            ctx.restore();
        }
        // Light across the back: dark where the curl turns away, a highlight on its top.
        if (rolled) {
            const g = ctx.createLinearGradient(...at(R), ...at(-R * 2));
            g.addColorStop(0, 'rgba(25, 15, 8, 0.32)');
            g.addColorStop(0.1, 'rgba(25, 15, 8, 0.12)');
            g.addColorStop(0.24, 'rgba(255, 252, 244, 0.26)');
            g.addColorStop(0.34, 'rgba(255, 252, 244, 0.08)');
            g.addColorStop(0.5, 'rgba(255, 252, 244, 0)');
            g.addColorStop(1, 'rgba(25, 15, 8, 0.05)');
            ctx.fillStyle = g;
            ctx.fillRect(-W * 2, -H * 2, W * 5, H * 5);
        }
        ctx.restore();
        ctx.save();
        tracePoly(ctx, outline);
        ctx.strokeStyle = rgba('#3c2a18', 0.22);
        ctx.lineWidth = 1 / px;
        ctx.stroke();
        ctx.restore();
    };

    return {
        pages: turns.length + 1,
        turning,
        top,
        draw(ctx, t) {
            ctx.save();
            ctx.translate(box.x, box.y);
            const px = deviceScale(ctx);
            const res = Math.min(4, px);
            const flying = turning(t);
            const started = top(t);
            if (spread) {
                let landed = -1;
                for (let i = 0; i < turns.length; i++) {
                    if (t >= turns[i] + durations[i]) landed = i;
                }
                if (landed >= 0) drawLanded(ctx, landed, t, res);
            }
            direct(ctx, front, started, t, rect);
            for (let i = flying.length - 1; i >= 0; i--) {
                const { index, progress } = flying[i];
                if (rigid.has(index)) drawRigid(ctx, index, progress, t, res, px);
                else drawTurning(ctx, index, progress, t, res, px);
            }
            ctx.restore();
        },
    };
}
