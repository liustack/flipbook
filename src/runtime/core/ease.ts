export type Easing = (t: number) => number;

export function clamp(value: number, min = 0, max = 1): number {
    return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/** Where `value` sits between `start` and `end`, clamped to [0, 1]. */
export function progress(value: number, start: number, end: number): number {
    if (end === start) return value >= end ? 1 : 0;
    return clamp((value - start) / (end - start));
}

export function remap(
    value: number,
    inMin: number,
    inMax: number,
    outMin: number,
    outMax: number,
): number {
    return lerp(outMin, outMax, progress(value, inMin, inMax));
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
    const t = progress(value, edge0, edge1);
    return t * t * (3 - 2 * t);
}

const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const c4 = (2 * Math.PI) / 3;

function bounceOut(t: number): number {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t - 1.5 / d1) ** 2 + 0.75;
    if (t < 2.5 / d1) return n1 * (t - 2.25 / d1) ** 2 + 0.9375;
    return n1 * (t - 2.625 / d1) ** 2 + 0.984375;
}

/** Standard easing curves on [0, 1]. */
export const ease = {
    linear: (t: number) => t,
    inQuad: (t: number) => t * t,
    outQuad: (t: number) => 1 - (1 - t) * (1 - t),
    inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
    inCubic: (t: number) => t * t * t,
    outCubic: (t: number) => 1 - (1 - t) ** 3,
    inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
    inQuart: (t: number) => t ** 4,
    outQuart: (t: number) => 1 - (1 - t) ** 4,
    inOutQuart: (t: number) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
    inSine: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
    outSine: (t: number) => Math.sin((t * Math.PI) / 2),
    inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
    inExpo: (t: number) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
    outExpo: (t: number) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
    inOutExpo: (t: number) =>
        t === 0
            ? 0
            : t === 1
              ? 1
              : t < 0.5
                ? 2 ** (20 * t - 10) / 2
                : (2 - 2 ** (-20 * t + 10)) / 2,
    inBack: (t: number) => c3 * t * t * t - c1 * t * t,
    outBack: (t: number) => 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2,
    inOutBack: (t: number) =>
        t < 0.5
            ? ((2 * t) ** 2 * ((c2 + 1) * 2 * t - c2)) / 2
            : ((2 * t - 2) ** 2 * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2,
    outElastic: (t: number) =>
        t === 0 ? 0 : t === 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1,
    outBounce: bounceOut,
    inBounce: (t: number) => 1 - bounceOut(1 - t),
} satisfies Record<string, Easing>;

/**
 * Hold each drawing for `n` frames (animating "on twos" when n is 2): the
 * returned time only changes every n frames.
 */
export function onFrames(t: number, fps: number, n = 2): number {
    const frame = Math.round(t * fps);
    return (Math.floor(frame / n) * n) / fps;
}

/** onFrames with n = 2. */
export function onTwos(t: number, fps: number): number {
    return onFrames(t, fps, 2);
}
