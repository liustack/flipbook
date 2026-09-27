// Frame-by-frame sprites: a character drawn whole in every pose, one drawing
// per frame of a clip, played at the clip's own rate. Each frame is placed by
// its anchor (the middle of the head across, the sole of the lowest foot
// down), so a drawing that sits a little left or low in its cell still lands
// on the same spot. `flipbook sprite` cuts the frames from a sheet, measures
// the anchors and writes the clips for loadSprite(). The pixel functions work
// on plain arrays, so they run in the page and in tests.

/** One drawing of a clip. */
export interface SpriteFrame {
    /** The picture: a canvas, an image, a photo() canvas. */
    canvas: CanvasImageSource;
    /** Its size in CSS px at scale 1. */
    width: number;
    height: number;
    /** The point placed at (x, y): the middle of the head across, the sole of the lowest foot down, in its own px. */
    anchor: [number, number];
}

/** A run of drawings played in order. */
export interface SpriteClip {
    frames: SpriteFrame[];
    /** Drawings per second. Default 8. */
    fps?: number;
    /** Start over after the last drawing, or hold it. Default false. */
    loop?: boolean;
    /** For a walk: how far the character moves in one pass through the clip, in its own px. */
    stride?: number;
}

export interface SpriteDrawOptions {
    /** The clip to show. */
    clip: string;
    /** Seconds since the clip started. */
    t?: number;
    /** Show this drawing instead of the one for t (0 is the first). */
    frame?: number;
    /** Face the other way: mirrored around x. */
    flip?: boolean;
}

export interface Sprite {
    /** Draw the clip's drawing for t with its anchor at (x, y). */
    draw(ctx: CanvasRenderingContext2D, x: number, y: number, options: SpriteDrawOptions): void;
    /** The drawing shown t seconds into the clip: 0 for the first. */
    frameAt(clip: string, t: number): number;
    /** How far a walk has moved t seconds in, in CSS px: the stride for each pass, counted per drawing, so the feet stay put between drawings. */
    distance(clip: string, t: number): number;
    /** Seconds one pass through the clip takes. */
    duration(clip: string): number;
}

export interface SpriteOptions {
    /** CSS px per sprite px. Default 1. */
    scale?: number;
}

const DEFAULT_FPS = 8;

/**
 * A character drawn frame by frame. Pass the clips from loadSprite(), or
 * frames drawn in code. Every function is a pure function of t.
 */
export function sprite(clips: Record<string, SpriteClip>, options: SpriteOptions = {}): Sprite {
    const scale = options.scale ?? 1;
    for (const [name, c] of Object.entries(clips)) {
        if (c.frames.length === 0) throw new Error(`sprite: clip "${name}" has no frames`);
        if (c.fps !== undefined && !(c.fps > 0 && Number.isFinite(c.fps))) {
            throw new Error(`sprite: clip "${name}" needs fps above 0 (got ${c.fps})`);
        }
    }
    const get = (name: string): SpriteClip => {
        const c = clips[name];
        if (!c) {
            throw new Error(
                `sprite: no clip "${name}" (clips: ${Object.keys(clips).join(', ') || 'none'})`,
            );
        }
        return c;
    };
    // Drawings shown by t, before wrapping or holding: 1e-6 keeps t = n / fps on drawing n.
    const shown = (c: SpriteClip, t: number) =>
        Math.floor(Math.max(0, t) * (c.fps ?? DEFAULT_FPS) + 1e-6);
    const frameAt = (name: string, t: number) => {
        const c = get(name);
        const i = shown(c, t);
        return c.loop ? i % c.frames.length : Math.min(i, c.frames.length - 1);
    };
    return {
        frameAt,
        duration(name) {
            const c = get(name);
            return c.frames.length / (c.fps ?? DEFAULT_FPS);
        },
        distance(name, t) {
            const c = get(name);
            if (c.stride === undefined) {
                throw new Error(`sprite: clip "${name}" has no stride: it is not a walk`);
            }
            const i = c.loop ? shown(c, t) : Math.min(shown(c, t), c.frames.length - 1);
            return ((c.stride * i) / c.frames.length) * scale;
        },
        draw(ctx, x, y, o) {
            const c = get(o.clip);
            const i = o.frame ?? frameAt(o.clip, o.t ?? 0);
            const f = c.frames[i];
            if (!f) {
                throw new Error(
                    `sprite: clip "${o.clip}" has no frame ${i} (0 to ${c.frames.length - 1})`,
                );
            }
            ctx.save();
            ctx.translate(x, y);
            if (o.flip) ctx.scale(-1, 1);
            ctx.drawImage(
                f.canvas,
                -f.anchor[0] * scale,
                -f.anchor[1] * scale,
                f.width * scale,
                f.height * scale,
            );
            ctx.restore();
        },
    };
}

export interface SpriteFile {
    version: 1;
    /** The height every clip was scaled to: head top to sole, in px. */
    height: number;
    clips: Record<
        string,
        {
            fps: number;
            loop: boolean;
            stride?: number;
            frames: { file: string; width: number; height: number; anchor: [number, number] }[];
        }
    >;
}

/**
 * Load the clips written by `flipbook sprite`, ready for sprite(). `url` is
 * the clips.json path in the composition, such as
 * 'assets/sprites/postman/clips.json'.
 */
export async function loadSprite(url: string): Promise<Record<string, SpriteClip>> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`loadSprite: ${url} answered ${response.status}`);
    const file = (await response.json()) as SpriteFile;
    const clips: Record<string, SpriteClip> = {};
    for (const [name, c] of Object.entries(file.clips)) {
        const frames = await Promise.all(
            c.frames.map(async (f) => {
                const img = new Image();
                img.src = `/${f.file}`;
                await img.decode();
                return { canvas: img, width: f.width, height: f.height, anchor: f.anchor };
            }),
        );
        clips[name] = { frames, fps: c.fps, loop: c.loop, stride: c.stride };
    }
    return clips;
}

/** Alpha above this counts as part of the drawing. */
const SOLID = 128;

export interface FrameMeasure {
    /** First and last rows with ink. */
    top: number;
    base: number;
    /** The middle of the head across: the mean x of the ink in the top 15% of the figure. */
    headX: number;
    /** Leftmost and rightmost ink in the bottom 4% of the figure: where the feet are. */
    feet: [number, number];
}

/** Where a drawn figure's head, soles and feet are. Null for an empty picture. */
export function measureFrame(
    alpha: ArrayLike<number>,
    width: number,
    height: number,
): FrameMeasure | null {
    const rowHas = (y: number) => {
        for (let x = 0; x < width; x++) if (alpha[y * width + x] > SOLID) return true;
        return false;
    };
    let top = 0;
    while (top < height && !rowHas(top)) top++;
    if (top === height) return null;
    let base = height - 1;
    while (base > top && !rowHas(base)) base--;
    const tall = base - top + 1;
    let sum = 0;
    let n = 0;
    const headEnd = top + Math.max(1, Math.round(tall * 0.15));
    for (let y = top; y < headEnd; y++) {
        for (let x = 0; x < width; x++) {
            if (alpha[y * width + x] > SOLID) {
                sum += x;
                n++;
            }
        }
    }
    let left = width;
    let right = -1;
    const footStart = base - Math.max(1, Math.round(tall * 0.04));
    for (let y = footStart; y <= base; y++) {
        for (let x = 0; x < width; x++) {
            if (alpha[y * width + x] > SOLID) {
                left = Math.min(left, x);
                right = Math.max(right, x);
            }
        }
    }
    return { top, base, headX: sum / n, feet: [left, right] };
}

/**
 * Boxes in reading order: rows from the top, each left to right. A box starts
 * a new row when its middle lies below the bottom of the row so far.
 */
export function readingOrder<T extends { x: number; y: number; width: number; height: number }>(
    boxes: T[],
): T[] {
    const byTop = [...boxes].sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2));
    const rows: T[][] = [];
    let bottom = -Infinity;
    for (const b of byTop) {
        if (rows.length === 0 || b.y + b.height / 2 > bottom) {
            rows.push([b]);
            bottom = b.y + b.height;
        } else {
            rows[rows.length - 1].push(b);
            bottom = Math.max(bottom, b.y + b.height);
        }
    }
    return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}

/**
 * Where a drawing touches the ground: runs of ink across its lowest `band`
 * rows, as [left, right] in its own px, gaps of 2 px or less closed, runs
 * under 3 px dropped.
 */
export function groundRuns(
    alpha: ArrayLike<number>,
    width: number,
    height: number,
    band: number,
): [number, number][] {
    let base = height - 1;
    const rowHas = (y: number) => {
        for (let x = 0; x < width; x++) if (alpha[y * width + x] > SOLID) return true;
        return false;
    };
    while (base > 0 && !rowHas(base)) base--;
    const runs: [number, number][] = [];
    for (let x = 0; x < width; x++) {
        let on = false;
        for (let y = Math.max(0, base - band + 1); y <= base && !on; y++) {
            on = alpha[y * width + x] > SOLID;
        }
        if (!on) continue;
        const last = runs[runs.length - 1];
        if (last && x - last[1] <= 3) last[1] = x;
        else runs.push([x, x]);
    }
    return runs.filter(([l, r]) => r - l >= 2);
}

/**
 * A walk's even advance per drawing, and the sideways nudge per drawing that
 * keeps the planted foot where it landed. `runs[i]` are drawing i's ground
 * runs relative to its anchor. Between two drawings the planted foot is a
 * pair of runs, one in each, that moved back by at most 0.4 of `height` (or
 * forward by a hair, 0.05 of it, for noise) and changed width by at most a
 * fifth of it. Of those, the ones whose width changed least, give or take
 * 0.05 of `height`, and of these the one that moved back furthest. A walk
 * whose feet do not move back on the whole (a hop on the spot, a walk
 * backward) gives null too. Drawings rarely move that foot evenly, so each is
 * shifted to make the advance the same every time: the feet stay put, the
 * body sways a little. Null when some pair shows no such foot.
 */
export function plantedWalk(
    runs: [number, number][][],
    height: number,
    loop = true,
): { advance: number; nudges: number[] } | null {
    const n = runs.length;
    const pairs = loop ? n : n - 1;
    if (pairs < 1) return null;
    const moved: number[] = [];
    for (let i = 0; i < pairs; i++) {
        const j = (i + 1) % n;
        const candidates: { cost: number; d: number }[] = [];
        for (const r of runs[i]) {
            for (const q of runs[j]) {
                const d = (r[0] + r[1]) / 2 - (q[0] + q[1]) / 2;
                const cost = Math.abs(r[1] - r[0] - (q[1] - q[0]));
                if (d < -0.05 * height || d > 0.4 * height || cost > 0.2 * height) continue;
                candidates.push({ cost, d });
            }
        }
        if (candidates.length === 0) return null;
        // Of the pairs that keep their width about the same, the planted foot is the
        // one that moved back furthest: the other foot lifts off or lands.
        const least = Math.min(...candidates.map((c) => c.cost));
        const close = candidates.filter((c) => c.cost <= least + 0.05 * height);
        moved.push(Math.max(...close.map((c) => c.d)));
    }
    const advance = moved.reduce((a, b) => a + b, 0) / pairs;
    if (!(advance > 0)) return null;
    // Shifting drawing i by e changes what its foot shows by -e: e[i + 1] - e[i] = advance - moved[i].
    const nudges = [0];
    for (let i = 0; i < n - 1; i++) nudges.push(nudges[i] + (advance - (moved[i] ?? advance)));
    const mean = nudges.reduce((a, b) => a + b, 0) / n;
    return { advance, nudges: nudges.map((e) => e - mean) };
}

/**
 * A guess at how far a walk moves in one pass through its drawings (a whole
 * cycle, two steps), for when the planted foot cannot be followed: a step is
 * how far apart the feet are at their widest (the contact drawing) less how
 * far at their closest (the passing drawing, about one foot long).
 */
export function walkStride(feet: [number, number][]): number {
    const spans = feet.map(([l, r]) => r - l);
    return 2 * (Math.max(...spans) - Math.min(...spans));
}
