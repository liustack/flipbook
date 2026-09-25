// Cut and turn times for the templates: evenly on beats, or accelerating.
import type { ResolvedTimeline } from '../core/timeline.ts';

function snap(tl: ResolvedTimeline, seconds: number): number {
    return Math.round(seconds * tl.fps) / tl.fps;
}

export interface BeatTimesOptions {
    /** First time, in beats from the composition start. */
    from: number;
    count: number;
    /** Beats between two times. Default 1. */
    every?: number;
}

/** `count` times one `every` beats apart from beat `from`, in seconds, snapped to frames. */
export function beatTimes(tl: ResolvedTimeline, options: BeatTimesOptions): number[] {
    const every = options.every ?? 1;
    if (!(every > 0)) throw new Error('beatTimes needs a positive `every`');
    const count = Math.max(0, Math.floor(options.count));
    return Array.from({ length: count }, (_, i) =>
        snap(tl, (options.from + i * every) * tl.secondsPerBeat),
    );
}

export interface AccelerateOptions {
    /** Fill this scene. Or give `from` and `to`. */
    scene?: string;
    /** Start of the first shot, in beats from the composition start. Default: the scene start. */
    from?: number;
    /** End of the last shot, in beats. Default: the scene end. */
    to?: number;
    /** How many shots. */
    count: number;
    /** Length of the last shot over the length of the first. 1 keeps them even, 0.2 makes the last a fifth of the first. */
    ratio: number;
}

/**
 * Start times of `count` shots that fill `from` to `to`, each shorter than
 * the one before by the same factor, in seconds snapped to frames. Throws when
 * a shot would get no frame of its own.
 */
export function accelerate(tl: ResolvedTimeline, options: AccelerateOptions): number[] {
    const scene = options.scene ? tl.scenes.find((s) => s.id === options.scene) : undefined;
    if (options.scene && !scene) throw new Error(`No scene "${options.scene}" in timeline.json`);
    const from = options.from ?? scene?.startBeat;
    const to = options.to ?? (scene ? scene.startBeat + scene.beats : undefined);
    if (from === undefined || to === undefined) {
        throw new Error('accelerate needs a `scene`, or `from` and `to` in beats');
    }
    if (!(to > from)) throw new Error('accelerate needs `to` after `from`');
    const count = Math.floor(options.count);
    if (count < 1) throw new Error('accelerate needs at least one shot');
    if (!(options.ratio > 0)) throw new Error('accelerate needs a positive `ratio`');
    const q = count > 1 ? options.ratio ** (1 / (count - 1)) : 1;
    const total = (to - from) * tl.secondsPerBeat;
    const first = Math.abs(q - 1) < 1e-9 ? total / count : (total * (1 - q)) / (1 - q ** count);
    const start = from * tl.secondsPerBeat;
    const times: number[] = [];
    let at = start;
    for (let i = 0; i < count; i++) {
        times.push(snap(tl, at));
        at += first * q ** i;
    }
    const end = snap(tl, start + total);
    for (let i = 0; i < times.length; i++) {
        const next = i + 1 < times.length ? times[i + 1] : end;
        if (next <= times[i]) {
            throw new Error(
                `accelerate: shot ${i + 1} of ${count} gets no frame: lower count, raise ratio or lengthen the span`,
            );
        }
    }
    return times;
}
