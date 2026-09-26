// Cut-out puppets: bones, slots and drawings that can be swapped. A puppet
// is drawn from a pose, and the pose is a pure function of t, so the picture
// is too. Parts carry color and inner lines only: one outline is inked around
// each group of parts, so where a thigh meets a shin there is no seam, while
// an arm lying over the coat keeps its edge.

import { staticLayer } from './core/layers.ts';
import { rand } from './core/random.ts';

/** A drawing a bone shows. */
export interface PuppetPart {
    /** The picture: a staticLayer canvas, a photo() canvas, or any canvas or image. */
    canvas: CanvasImageSource;
    /** Its size in CSS px. */
    width: number;
    height: number;
    /** The joint it hangs from, in its own px. */
    pivot: [number, number];
    /** Named joints its children hang from, in its own px. */
    sockets?: Record<string, [number, number]>;
    /** Degrees to turn it so it points the way its bone points: a hand drawn on its side, say. */
    angle?: number;
    /** [sx, sy] stretch, for a part a little too long or short for the rest of the puppet. */
    fit?: [number, number];
}

/** One bone: it hangs from its parent's socket and shows a part. */
export interface PuppetBone {
    name: string;
    /** The bone it hangs from. The one bone without a parent is the root. */
    parent?: string;
    /** The socket on the parent's part it hangs from. */
    socket?: string;
    /** The part it shows unless a frame swaps it. */
    part: string;
    /** Drawing order: higher is nearer. Keep a group's bones next to each other. */
    z: number;
    /** Bones in one group share one outline. Default: the bone's own name. */
    group?: string;
}

export interface OutlineOptions {
    /** Line width in CSS px at puppet scale 1. Default 3. */
    width?: number;
    /** Default '#241d1a'. */
    color?: string;
}

export interface PuppetOptions {
    parts: Record<string, PuppetPart>;
    bones: PuppetBone[];
    /** CSS px per part px. Default 1. */
    scale?: number;
    /** One outline around each group, or false for none. Default on. */
    outline?: OutlineOptions | false;
}

/** Angles in degrees added to each bone's rest angle, plus an optional shift of the root. */
export type Pose = Record<string, number>;

export interface PuppetFrame {
    pose?: Pose;
    /** For this frame, bone name to part name. */
    swap?: Record<string, string>;
    /** Face the other way. */
    flip?: boolean;
}

export interface Puppet {
    /** Draw with the root's pivot at (x, y), in the context's CSS px. */
    draw(ctx: CanvasRenderingContext2D, x: number, y: number, frame?: PuppetFrame): void;
    /**
     * Where a point of a bone lands for the same x, y and frame: the bone's
     * pivot, or `at`, a point in its part's px. For props that leave a hand.
     */
    joint(
        bone: string,
        x: number,
        y: number,
        frame?: PuppetFrame,
        at?: [number, number],
    ): { x: number; y: number };
    /**
     * A biped's leg lengths in part px, fit included: `thigh` from the hip to
     * the knee socket, `shin` from the knee to the bottom of the shin part
     * (the sole). Pass them to walk().
     */
    legs(): { thigh: number; shin: number };
}

/** A part drawn by code: `draw` paints it on a canvas of `width` by `height` CSS px, once. */
export function part(
    width: number,
    height: number,
    pivot: [number, number],
    draw: (ctx: CanvasRenderingContext2D) => void,
    options: {
        sockets?: Record<string, [number, number]>;
        angle?: number;
        fit?: [number, number];
    } = {},
): PuppetPart {
    const layer = staticLayer(width, height, draw);
    return { canvas: layer.canvas, width, height, pivot, ...options };
}

interface Buffer {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
}

function buffer(): Buffer {
    const canvas = document.createElement('canvas');
    return { canvas, ctx: canvas.getContext('2d') as CanvasRenderingContext2D };
}

// Every puppet draws through the same two buffers: drawing is synchronous, so
// they are never in use twice at once, and a crowd costs no more memory than one.
let shared: { fill: Buffer; line: Buffer } | null = null;
function buffers(): { fill: Buffer; line: Buffer } {
    shared ??= { fill: buffer(), line: buffer() };
    return shared;
}

function fitBuffer(b: Buffer, width: number, height: number): void {
    if (b.canvas.width !== width || b.canvas.height !== height) {
        b.canvas.width = width;
        b.canvas.height = height;
    }
}

/**
 * Offsets that stamp a shape out to `reach` device px in every direction:
 * rings every 1.5 px or less out to the reach, stamps along each ring at most
 * 1.2 px apart, so even a hairline part gets a solid outline, not a ring of copies.
 */
const stampCache = new Map<number, [number, number][]>();
/**
 * The stamp budget per group: past about 24 device px of outline the rings and
 * the stamps spread out together to keep the count near this (rounding lands
 * it at about 1300 at most).
 */
const MAX_STAMPS = 1200;
function stamps(reach: number): [number, number][] {
    const key = Math.round(reach * 100) / 100;
    let out = stampCache.get(key);
    if (out) return out;
    out = [];
    // Rings every 1.5 px with stamps 1.2 px apart cost about pi r^2 / 1.8: spread
    // both out together when that passes the cap.
    const spread = Math.max(1, Math.sqrt((Math.PI * key * key) / 1.8 / MAX_STAMPS));
    const rings = Math.max(1, Math.ceil(key / (1.5 * spread)));
    for (let k = 1; k <= rings; k++) {
        const r = (key * k) / rings;
        const n = Math.max(8, Math.ceil((2 * Math.PI * r) / (1.2 * spread)));
        for (let i = 0; i < n; i++) {
            const a = ((i + (k % 2) / 2) / n) * Math.PI * 2;
            out.push([r * Math.cos(a), r * Math.sin(a)]);
        }
    }
    if (stampCache.size >= 32) stampCache.clear();
    stampCache.set(key, out);
    return out;
}

export function puppet(options: PuppetOptions): Puppet {
    const scale = options.scale ?? 1;
    const bones = options.bones;
    for (const [name, p] of Object.entries(options.parts)) {
        if (!(p.width > 0 && p.height > 0)) {
            throw new Error(
                `puppet: part "${name}" needs a width and height above 0 (got ${p.width} by ${p.height})`,
            );
        }
    }
    const byName = new Map<string, PuppetBone>();
    for (const b of bones) {
        if (byName.has(b.name)) throw new Error(`puppet: two bones are named "${b.name}"`);
        byName.set(b.name, b);
    }
    const roots = bones.filter((b) => !b.parent);
    if (roots.length !== 1) {
        throw new Error(`puppet: exactly one bone may have no parent (found ${roots.length})`);
    }
    for (const b of bones) {
        if (!options.parts[b.part])
            throw new Error(`puppet: bone "${b.name}" shows unknown part "${b.part}"`);
        if (b.parent) {
            const parent = byName.get(b.parent);
            if (!parent)
                throw new Error(`puppet: bone "${b.name}" hangs from unknown bone "${b.parent}"`);
            if (!b.socket || !options.parts[parent.part].sockets?.[b.socket]) {
                throw new Error(
                    `puppet: bone "${b.name}" hangs from socket "${b.socket}", which part "${parent.part}" does not have`,
                );
            }
        }
    }
    // Parents before children, so each world transform can build on its parent's.
    const order: PuppetBone[] = [];
    const visit = (b: PuppetBone) => {
        order.push(b);
        for (const child of bones) if (child.parent === b.name) visit(child);
    };
    visit(roots[0]);
    if (order.length !== bones.length)
        throw new Error('puppet: every bone must hang from the root');
    // Groups in drawing order: by the nearest-to-back bone of each group.
    const drawing = [...bones].sort((a, b) => a.z - b.z);
    const groups: PuppetBone[][] = [];
    const groupOf = new Map<string, PuppetBone[]>();
    for (const b of drawing) {
        const key = b.group ?? b.name;
        let g = groupOf.get(key);
        if (!g) {
            g = [];
            groupOf.set(key, g);
            groups.push(g);
        }
        g.push(b);
    }
    const outline =
        options.outline === false ? null : { width: 3, color: '#241d1a', ...options.outline };

    /** The part a bone shows in this frame: its own, or the one `swap` names. */
    function shown(b: PuppetBone, frame: PuppetFrame): PuppetPart {
        const name = frame.swap?.[b.name] ?? b.part;
        const p = options.parts[name];
        if (!p) throw new Error(`puppet: swap shows unknown part "${name}" on bone "${b.name}"`);
        return p;
    }

    /** Where a point of a part lands in its bone's frame: past its pivot, stretched by fit, turned by angle. */
    function inBone(p: PuppetPart, at: [number, number]): DOMPoint {
        const [fx, fy] = p.fit ?? [1, 1];
        return new DOMMatrix()
            .rotate(p.angle ?? 0)
            .scale(fx, fy)
            .transformPoint(new DOMPoint(at[0] - p.pivot[0], at[1] - p.pivot[1]));
    }

    // Pose keys that name no bone (and are not x or y) are left alone, so a
    // biped pose can drive a puppet with fewer bones.
    function worlds(x: number, y: number, frame: PuppetFrame): Map<string, DOMMatrix> {
        const pose = frame.pose ?? {};
        const out = new Map<string, DOMMatrix>();
        for (const b of order) {
            let m: DOMMatrix;
            if (!b.parent) {
                m = new DOMMatrix()
                    .translate(x + (pose.x ?? 0) * scale, y + (pose.y ?? 0) * scale)
                    .scale(frame.flip ? -scale : scale, scale);
            } else {
                // The child hangs from the socket of the part its parent shows now.
                const parent = byName.get(b.parent) as PuppetBone;
                const p = shown(parent, frame);
                const socket = p.sockets?.[b.socket as string];
                if (!socket) {
                    throw new Error(
                        `puppet: bone "${b.name}" hangs from socket "${b.socket}", which the part shown on "${parent.name}" (${frame.swap?.[parent.name] ?? parent.part}) does not have`,
                    );
                }
                const off = inBone(p, socket);
                m = (out.get(b.parent) as DOMMatrix).translate(off.x, off.y);
            }
            out.set(b.name, m.rotate(pose[b.name] ?? 0));
        }
        return out;
    }

    function partMatrix(base: DOMMatrix, world: DOMMatrix, p: PuppetPart): DOMMatrix {
        const [fx, fy] = p.fit ?? [1, 1];
        return base
            .multiply(world)
            .rotate(p.angle ?? 0)
            .scale(fx, fy);
    }

    function paint(ctx: CanvasRenderingContext2D, m: DOMMatrix, p: PuppetPart): void {
        ctx.setTransform(m);
        ctx.drawImage(p.canvas, -p.pivot[0], -p.pivot[1], p.width, p.height);
    }

    return {
        legs() {
            const thigh = byName.get('thighFront');
            const shin = byName.get('shinFront');
            if (!thigh || !shin || shin.parent !== thigh.name) {
                throw new Error('puppet: legs() needs a biped: bones thighFront and shinFront');
            }
            const t = options.parts[thigh.part];
            const knee = inBone(
                t,
                (t.sockets as Record<string, [number, number]>)[shin.socket as string],
            );
            const s = options.parts[shin.part];
            const sole = inBone(s, [s.pivot[0], s.height]);
            return { thigh: Math.hypot(knee.x, knee.y), shin: Math.hypot(sole.x, sole.y) };
        },
        joint(bone, x, y, frame = {}, at) {
            const b = byName.get(bone);
            if (!b) throw new Error(`puppet: no bone "${bone}"`);
            const p = shown(b, frame);
            const q = (worlds(x, y, frame).get(bone) as DOMMatrix).transformPoint(
                at ? inBone(p, at) : new DOMPoint(0, 0),
            );
            return { x: q.x, y: q.y };
        },
        draw(ctx, x, y, frame = {}) {
            const base = ctx.getTransform();
            const world = worlds(x, y, frame);
            if (!outline) {
                for (const b of drawing) {
                    const p = shown(b, frame);
                    paint(ctx, partMatrix(base, world.get(b.name) as DOMMatrix, p), p);
                }
                ctx.setTransform(base);
                return;
            }
            const W = ctx.canvas.width;
            const H = ctx.canvas.height;
            const { fill, line } = buffers();
            fitBuffer(fill, W, H);
            fitBuffer(line, W, H);
            // Outline width in device px: the part scale times the context's own scale.
            const reach = outline.width * scale * Math.hypot(base.a, base.b);
            for (const group of groups) {
                // The group's box on the canvas, padded for the outline.
                let x0 = Infinity;
                let y0 = Infinity;
                let x1 = -Infinity;
                let y1 = -Infinity;
                const placed = group.map((b) => {
                    const p = shown(b, frame);
                    const m = partMatrix(base, world.get(b.name) as DOMMatrix, p);
                    for (const [cx, cy] of [
                        [-p.pivot[0], -p.pivot[1]],
                        [p.width - p.pivot[0], -p.pivot[1]],
                        [-p.pivot[0], p.height - p.pivot[1]],
                        [p.width - p.pivot[0], p.height - p.pivot[1]],
                    ]) {
                        const q = m.transformPoint(new DOMPoint(cx, cy));
                        x0 = Math.min(x0, q.x);
                        y0 = Math.min(y0, q.y);
                        x1 = Math.max(x1, q.x);
                        y1 = Math.max(y1, q.y);
                    }
                    return { m, p };
                });
                const pad = Math.ceil(reach) + 2;
                const bx = Math.max(0, Math.floor(x0) - pad);
                const by = Math.max(0, Math.floor(y0) - pad);
                const bw = Math.min(W, Math.ceil(x1) + pad) - bx;
                const bh = Math.min(H, Math.ceil(y1) + pad) - by;
                if (bw <= 0 || bh <= 0) continue;
                // Clear the whole buffers, not just the box: stamping at fractional
                // offsets samples a little past the box, where an earlier frame's
                // pixels would otherwise leak into this one.
                const f = fill.ctx;
                f.setTransform(1, 0, 0, 1, 0, 0);
                f.clearRect(0, 0, W, H);
                for (const { m, p } of placed) paint(f, m, p);
                const l = line.ctx;
                l.setTransform(1, 0, 0, 1, 0, 0);
                l.globalCompositeOperation = 'source-over';
                l.clearRect(0, 0, W, H);
                if (reach > 0) {
                    for (const [dx, dy] of stamps(reach)) {
                        l.drawImage(fill.canvas, bx, by, bw, bh, bx + dx, by + dy, bw, bh);
                    }
                    l.globalCompositeOperation = 'source-in';
                    l.fillStyle = outline.color;
                    l.fillRect(bx, by, bw, bh);
                    l.globalCompositeOperation = 'source-over';
                }
                l.drawImage(fill.canvas, bx, by, bw, bh, bx, by, bw, bh);
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.drawImage(line.canvas, bx, by, bw, bh, bx, by, bw, bh);
            }
            ctx.setTransform(base);
        },
    };
}

// ---------------------------------------------------------------------------
// A standard biped, facing right in profile. Limbs hang down, so swinging a
// limb forward is a negative angle.

/** Bone names of the standard biped. */
export const BIPED = [
    'torso',
    'head',
    'armBack',
    'foreBack',
    'handBack',
    'thighBack',
    'shinBack',
    'thighFront',
    'shinFront',
    'armFront',
    'foreFront',
    'handFront',
] as const;

/**
 * The bones of a profile biped. Parts are named like the bones; a part can be
 * shared, as in `{ armBack: 'arm', armFront: 'arm' }`. The torso needs sockets
 * `neck`, `shoulder` and `hip`, upper arms `elbow`, forearms `wrist`, thighs `knee`.
 */
export function biped(parts: Partial<Record<(typeof BIPED)[number], string>> = {}): PuppetBone[] {
    const p = (name: (typeof BIPED)[number]) => parts[name] ?? name;
    return [
        {
            name: 'armBack',
            parent: 'torso',
            socket: 'shoulder',
            part: p('armBack'),
            z: 12,
            group: 'armBack',
        },
        {
            name: 'foreBack',
            parent: 'armBack',
            socket: 'elbow',
            part: p('foreBack'),
            z: 11,
            group: 'armBack',
        },
        {
            name: 'handBack',
            parent: 'foreBack',
            socket: 'wrist',
            part: p('handBack'),
            z: 10,
            group: 'armBack',
        },
        {
            name: 'thighBack',
            parent: 'torso',
            socket: 'hip',
            part: p('thighBack'),
            z: 21,
            group: 'legBack',
        },
        {
            name: 'shinBack',
            parent: 'thighBack',
            socket: 'knee',
            part: p('shinBack'),
            z: 20,
            group: 'legBack',
        },
        {
            name: 'thighFront',
            parent: 'torso',
            socket: 'hip',
            part: p('thighFront'),
            z: 31,
            group: 'legFront',
        },
        {
            name: 'shinFront',
            parent: 'thighFront',
            socket: 'knee',
            part: p('shinFront'),
            z: 30,
            group: 'legFront',
        },
        { name: 'head', parent: 'torso', socket: 'neck', part: p('head'), z: 45, group: 'body' },
        { name: 'torso', part: p('torso'), z: 50, group: 'body' },
        {
            name: 'armFront',
            parent: 'torso',
            socket: 'shoulder',
            part: p('armFront'),
            z: 72,
            group: 'armFront',
        },
        {
            name: 'foreFront',
            parent: 'armFront',
            socket: 'elbow',
            part: p('foreFront'),
            z: 71,
            group: 'armFront',
        },
        {
            name: 'handFront',
            parent: 'foreFront',
            socket: 'wrist',
            part: p('handFront'),
            z: 70,
            group: 'armFront',
        },
    ];
}

/** Blend two poses. An angle missing from one counts as 0. */
export function blendPose(a: Pose, b: Pose, u: number): Pose {
    const out: Pose = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        out[k] = (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * u;
    }
    return out;
}

export interface WalkOptions {
    /** Steps a second. Default 1.8. */
    cadence?: number;
    /** Hip to knee, part px. Take it and `shin` from the puppet's legs(). */
    thigh?: number;
    /** Knee to sole, part px. */
    shin?: number;
    /** Hip to sole, part px, split evenly when thigh and shin are not given. Default 300. */
    leg?: number;
    /** One step, heel to heel, part px. Default 0.55 of the leg, at most 1.6 of it. */
    step?: number;
    /** How high the swinging foot rises, part px. Default 0.1 of the leg. */
    lift?: number;
    /** Arm swing each way, degrees. Default 22. */
    arm?: number;
    /** Forward lean of the torso, degrees. Default 3. */
    lean?: number;
    /**
     * Stop after this many steps, a whole number: in one more step's time the
     * hips slow to a halt over the front foot and the back foot comes up beside
     * it, and from walkTime() seconds (`(steps + 1) / cadence`) the puppet
     * stands still with its feet together. Default: never stop.
     */
    steps?: number;
}

/** Longest step for a leg, as a share of the leg: past it the hips sink too low. */
const MAX_STEP = 1.6;

function walkSettings(options: WalkOptions) {
    const cadence = options.cadence ?? 1.8;
    const thigh = options.thigh ?? (options.leg ?? 300) / 2;
    const shin = options.shin ?? (options.leg ?? 300) / 2;
    const leg = thigh + shin;
    const step = options.step ?? 0.55 * leg;
    const lift = options.lift ?? 0.1 * leg;
    const bad = (what: string) => {
        throw new Error(`walk: ${what}`);
    };
    if (!(cadence > 0 && Number.isFinite(cadence))) bad(`cadence must be above 0 (got ${cadence})`);
    if (!(thigh > 0 && shin > 0 && Number.isFinite(thigh) && Number.isFinite(shin))) {
        bad(`thigh and shin must be finite and above 0 (got ${thigh} and ${shin})`);
    }
    if (!(step > 0)) bad(`step must be above 0 (got ${step})`);
    if (step > MAX_STEP * leg) {
        bad(
            `a step of ${step} is too long for legs of ${leg}: at most ${MAX_STEP} times the leg (${MAX_STEP * leg})`,
        );
    }
    if (!(lift >= 0 && Number.isFinite(lift))) bad(`lift must be finite, 0 or more (got ${lift})`);
    const stop = options.steps;
    if (stop !== undefined && !(Number.isInteger(stop) && stop >= 0)) {
        bad(`steps must be a whole number, 0 or more (got ${stop})`);
    }
    return {
        cadence,
        thigh,
        shin,
        leg,
        step,
        lift,
        stop,
        arm: options.arm ?? 22,
        lean: options.lean ?? 3,
    };
}

/** Seconds from the start of a walk with `steps` until it stands still. */
export function walkTime(options: WalkOptions): number {
    const s = walkSettings(options);
    if (s.stop === undefined) throw new Error('walk: walkTime() needs steps');
    return (s.stop + 1) / s.cadence;
}

export interface Walk {
    /** The legs, arms, torso and head, plus `y`: how far the hips sink, in part px. */
    pose: Pose;
    /** How far the hips have moved forward, in part px (times the puppet's scale for CSS px). */
    distance: number;
    /** True once a walk with `steps` has come to a stop. */
    standing: boolean;
}

/**
 * A profile walk facing right. Draw the puppet with its root (the hip) at
 * leg length above the floor, plus `distance` along it: one foot is planted
 * on the floor at every moment and stays where it landed while the hips pass
 * over it, and the other swings forward in an arc. The legs are solved from
 * the feet (the knee bending forward), so give the real `thigh` and `shin`.
 */
export function walk(t: number, options: WalkOptions = {}): Walk {
    const { cadence, thigh, shin, leg, step, lift, stop, arm, lean } = walkSettings(options);
    // Time in steps. Past the stop, the closing step, then standing.
    const n = Math.max(0, t) * cadence;
    const ease = (u: number) => (1 - Math.cos(Math.PI * u)) / 2;
    let hip: number;
    let planted: number;
    let swing: { x: number; y: number };
    let standing = false;
    // How much of the walk's lean and arm swing is left: all of it, then
    // easing out over the closing step.
    let moving = 1;
    // Step k: the leg that landed at k * step + step / 2 carries the hips from
    // k * step to (k + 1) * step, while the other swings from half a step behind
    // the hips to half a step ahead of where they end.
    let k: number;
    if (stop === undefined || n < stop) {
        k = Math.floor(n);
        const u = n - k;
        hip = step * n;
        planted = step * k + step / 2;
        swing = { x: step * k - step / 2 + 2 * step * ease(u), y: -lift * Math.sin(Math.PI * u) };
    } else {
        // The closing step: the hips slow from walking speed to a halt over the
        // front foot, half a step on. The back foot lifts off at once, as in a
        // step, comes up beside the front one and sets down gently (no speed
        // left as it lands) at 0.6 of the way, so the knee straightens smoothly
        // instead of snapping.
        k = stop;
        const u = Math.min(1, n - stop);
        standing = u >= 1;
        moving = 1 - ease(u);
        hip = step * stop + step * (u - (u * u) / 2);
        planted = step * stop + step / 2;
        const v = Math.min(1, u / 0.6);
        swing = {
            x: step * stop - step / 2 + step * ease(v),
            // Lifting off as fast as in a step: 0.6 * v = u near the start.
            y: -0.6 * lift * Math.sin(Math.PI * v) * (1 - v),
        };
    }
    // The hips ride over the planted leg, kept a hair short of straight.
    const dx = hip - planted;
    const height = Math.sqrt(Math.max(0, leg * leg - dx * dx)) * (1 - 0.002 * moving);
    const tilt = lean * moving;
    const solve = (footX: number, footY: number) => {
        // Hip at (0, -height), foot at (footX - hip, footY): angles from straight down, forward positive.
        const fx = footX - hip;
        const fy = footY + height;
        const d = Math.min(Math.max(Math.hypot(fx, fy), Math.abs(thigh - shin) + 1e-6), leg - 1e-9);
        const toward = Math.atan2(fx, fy);
        const atHip = Math.acos(
            Math.min(1, Math.max(-1, (thigh * thigh + d * d - shin * shin) / (2 * thigh * d))),
        );
        const atKnee = Math.acos(
            Math.min(1, Math.max(-1, (thigh * thigh + shin * shin - d * d) / (2 * thigh * shin))),
        );
        const deg = 180 / Math.PI;
        // Forward is a negative angle, and the thighs hang from the leaning torso.
        return { thigh: -(toward + atHip) * deg - tilt, shin: (Math.PI - atKnee) * deg };
    };
    const onFloor = solve(planted, 0);
    const inAir = solve(swing.x, swing.y);
    // Even steps plant the front leg, odd steps the back one.
    const frontPlanted = k % 2 === 0;
    const front = frontPlanted ? onFloor : inAir;
    const back = frontPlanted ? inAir : onFloor;
    // Arms swing against the legs: the front arm goes back as the front foot goes forward.
    const ph = Math.PI * n;
    return {
        pose: {
            y: leg - height,
            torso: tilt,
            head: (-lean * 0.6 + 1.5 * Math.sin(ph * 2)) * moving,
            thighFront: front.thigh,
            shinFront: front.shin,
            thighBack: back.thigh,
            shinBack: back.shin,
            armFront: arm * Math.cos(ph) * moving,
            foreFront: -14 * moving,
            armBack: -arm * Math.cos(ph - 0.25) * moving,
            foreBack: -14 * moving,
        },
        distance: hip,
        standing,
    };
}

/** Standing, breathing a little. */
export function idle(t: number): Pose {
    const b = Math.sin(t * 2.4);
    return {
        y: -2 * b,
        torso: 1 + 0.8 * b,
        head: -0.5 * b,
        armFront: 2,
        foreFront: -8,
        armBack: -3,
        foreBack: -10,
        shinFront: 3,
        shinBack: 3,
    };
}

export interface WaveOptions {
    /** Seconds the arm takes to rise and to fall. Default 0.45. */
    rise?: number;
    /** Waves a second. Default 2.2. */
    rate?: number;
    /** Upper arm angle when raised. Default -100 (forward and up). */
    reach?: number;
    /** Forearm angle when raised, around which it waves. Default -60. */
    elbow?: number;
    /** Forearm swing each way. Default 16. */
    swing?: number;
}

/**
 * The front arm waving from `start` to `end` seconds. Returns angles to lay
 * over a pose (`{ ...pose, ...w.pose }` while `w.raised` is above 0) and
 * `raised`, 0 to 1: swap in an open hand once it passes 0.5.
 */
export function wave(
    t: number,
    start: number,
    end: number,
    options: WaveOptions = {},
): { pose: Pose; raised: number } {
    const rise = options.rise ?? 0.45;
    const up = Math.min(1, Math.max(0, (t - start) / rise));
    const down = Math.min(1, Math.max(0, (t - (end - rise)) / rise));
    const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
    const raised = ease(up) * (1 - ease(down));
    const flap =
        t > start + rise && t < end - rise
            ? Math.sin(Math.PI * 2 * (options.rate ?? 2.2) * (t - start - rise))
            : 0;
    return {
        pose: {
            armFront: (options.reach ?? -100) * raised,
            foreFront: ((options.elbow ?? -60) + (options.swing ?? 16) * flap) * raised,
        },
        raised,
    };
}

/**
 * Whether the eyes are shut at t: a blink of `length` seconds every 2.5 to 5.5
 * seconds, at times picked by `seed`. Swap in a closed-eyes head when true.
 */
export function blink(
    t: number,
    options: { seed?: number | string; length?: number } = {},
): boolean {
    const seed = String(options.seed ?? 0);
    const length = options.length ?? 0.12;
    let at = 0.8 + rand(0, 'blink', seed, 0) * 1.5;
    for (let i = 1; at <= t; i++) {
        if (t < at + length) return true;
        at += 2.5 + rand(0, 'blink', seed, i) * 3;
    }
    return false;
}

/**
 * Whether the mouth is open at t while speaking from `start` to `end`:
 * syllables of 0.12 to 0.22 seconds, open and shut in turn, picked by `seed`.
 */
export function talk(
    t: number,
    start: number,
    end: number,
    options: { seed?: number | string } = {},
): boolean {
    if (t < start || t >= end) return false;
    const seed = String(options.seed ?? 0);
    let at = start;
    for (let i = 0; at <= t; i++) {
        const next = at + 0.12 + rand(0, 'talk', seed, i) * 0.1;
        if (t < next) return i % 2 === 0;
        at = next;
    }
    return false;
}

/**
 * The head angle, in degrees, that turns a profile head at `from` toward
 * `target`, limited to `limit` degrees each way. Positive tilts the face down.
 */
export function lookAt(from: [number, number], target: [number, number], limit = 25): number {
    const angle = (Math.atan2(target[1] - from[1], Math.abs(target[0] - from[0])) * 180) / Math.PI;
    return Math.max(-limit, Math.min(limit, angle));
}
