import {
    type ResolvedCue,
    type ResolvedScene,
    type ResolvedTimeline,
    resolveTimeline,
    type TimelineV1,
} from '../../engine/timelineResolve.ts';
import { progress } from './ease.ts';

export type { ResolvedCue, ResolvedScene, ResolvedTimeline };

interface HostLike {
    render: true;
    timeline: ResolvedTimeline;
    registerText(entry: unknown): void;
}

/** The renderer's host object, present only when flipbook drives the page. */
export function host(): HostLike | null {
    const value = (window as unknown as { __flipbookHost?: HostLike }).__flipbookHost;
    return value?.render ? value : null;
}

/** True while check, snapshot or render drives the page. */
export function isRendering(): boolean {
    return host() !== null;
}

let cached: ResolvedTimeline | null = null;

/**
 * The resolved timeline (seconds and frames for every scene and cue). Under
 * the renderer it comes from the host; otherwise from ./timeline.json.
 */
export async function timeline(): Promise<ResolvedTimeline> {
    if (cached) return cached;
    const fromHost = host();
    if (fromHost) {
        cached = fromHost.timeline;
        return cached;
    }
    const response = await fetch('./timeline.json');
    if (!response.ok) throw new Error(`timeline.json: HTTP ${response.status}`);
    cached = resolveTimeline((await response.json()) as TimelineV1);
    return cached;
}

export interface SceneState {
    scene: ResolvedScene;
    index: number;
    /** Seconds since the scene started. */
    local: number;
    /** 0 at the scene start, 1 at its end. */
    progress: number;
    /** Beats since the composition started. */
    beat: number;
    /** Beats since the scene started. */
    localBeat: number;
}

/** Which scene plays at time t, and how far into it. */
export function sceneAt(tl: ResolvedTimeline, t: number): SceneState {
    let scene = tl.scenes[tl.scenes.length - 1];
    for (const candidate of tl.scenes) {
        if (t < candidate.end) {
            scene = candidate;
            break;
        }
    }
    const local = Math.max(0, t - scene.start);
    const beat = t / tl.secondsPerBeat;
    return {
        scene,
        index: scene.index,
        local,
        progress: progress(t, scene.start, scene.end),
        beat,
        localBeat: beat - scene.startBeat,
    };
}

/** 0 before the scene starts, 1 after it ends. */
export function sceneProgress(tl: ResolvedTimeline, t: number, sceneId: string): number {
    const scene = tl.scenes.find((s) => s.id === sceneId);
    if (!scene) throw new Error(`No scene "${sceneId}" in timeline.json`);
    return progress(t, scene.start, scene.end);
}

export function cue(tl: ResolvedTimeline, id: string): ResolvedCue {
    const found = tl.cues.find((c) => c.id === id);
    if (!found) throw new Error(`No cue "${id}" in timeline.json`);
    return found;
}

/**
 * Progress of a cue: 0 at its time, 1 once it settles (settleBeats later), or
 * over `beats` beats when given.
 */
export function cueProgress(tl: ResolvedTimeline, t: number, id: string, beats?: number): number {
    const c = cue(tl, id);
    const span = (beats ?? (c.settleBeats || 1)) * tl.secondsPerBeat;
    return progress(t, c.time, c.time + span);
}

/**
 * Cross-fade weight between a scene and the next one: 0 until `beats` before
 * the scene ends, rising to 1 at the cut.
 */
export function transitionOut(tl: ResolvedTimeline, t: number, sceneId: string, beats = 1): number {
    const scene = tl.scenes.find((s) => s.id === sceneId);
    if (!scene) throw new Error(`No scene "${sceneId}" in timeline.json`);
    return progress(t, scene.end - beats * tl.secondsPerBeat, scene.end);
}
