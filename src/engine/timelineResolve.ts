// Pure timeline math, shared by the Node CLI and the browser runtime. No Node
// or DOM imports here: the runtime bundles this file as is.

export const TIMELINE_VERSION = 1;
export const PROTOCOL_VERSION = 1;

export type CueKind = 'text' | 'sfx' | 'mark';
export type AudioMode = 'preset' | 'file' | 'none';

export interface SceneV1 {
    id: string;
    bars: number;
    hold?: boolean;
}

export interface CueV1 {
    id: string;
    scene: string;
    beat: number;
    kind: CueKind;
    text?: string;
    settleBeats?: number;
    sfx?: string;
}

export interface AudioV1 {
    mode: AudioMode;
    preset?: string;
    key?: string;
    progression?: number;
    file?: string;
    bpmOffset?: number;
}

export interface TimelineV1 {
    version: 1;
    width: number;
    height: number;
    fps: number;
    seed: number;
    bpm: number;
    beatsPerBar: number;
    scenes: SceneV1[];
    cues?: CueV1[];
    audio?: AudioV1;
}

export interface ResolvedScene {
    id: string;
    index: number;
    bars: number;
    hold: boolean;
    startBeat: number;
    beats: number;
    start: number;
    end: number;
    startFrame: number;
    endFrame: number;
}

export interface ResolvedCue {
    id: string;
    scene: string;
    kind: CueKind;
    beat: number;
    absBeat: number;
    time: number;
    frame: number;
    settleBeats: number;
    settleTime: number;
    settleFrame: number;
    text?: string;
    sfx?: string;
}

export interface ResolvedTimeline {
    version: 1;
    protocol: typeof PROTOCOL_VERSION;
    width: number;
    height: number;
    fps: number;
    seed: number;
    bpm: number;
    beatsPerBar: number;
    secondsPerBeat: number;
    totalBeats: number;
    durationSec: number;
    frameCount: number;
    scenes: ResolvedScene[];
    cues: ResolvedCue[];
    audio: AudioV1;
}

/** Frame index for a time, on the frame grid. */
export function frameAt(time: number, fps: number): number {
    return Math.round(time * fps);
}

/**
 * First frame whose time is at or after `settleTime`: the first frame where a
 * cue's cueProgress is 1. It is not clipped to the scene; validation requires
 * it to fall inside the cue's scene.
 */
export function settleFrameAt(settleTime: number, fps: number): number {
    let frame = Math.max(0, Math.ceil(settleTime * fps - 1e-6));
    while (frame / fps < settleTime) frame += 1;
    return frame;
}

/**
 * Seconds and frames for every scene and cue. Expects a timeline that passed
 * validation: scene references resolve and numbers are in range.
 */
export function resolveTimeline(timeline: TimelineV1): ResolvedTimeline {
    const secondsPerBeat = 60 / timeline.bpm;
    const fps = timeline.fps;
    const frameCount = Math.round(
        timeline.scenes.reduce((sum, scene) => sum + scene.bars, 0) *
            timeline.beatsPerBar *
            secondsPerBeat *
            fps,
    );
    let beat = 0;
    const scenes: ResolvedScene[] = timeline.scenes.map((scene, index) => {
        const beats = scene.bars * timeline.beatsPerBar;
        const startBeat = beat;
        beat += beats;
        const start = startBeat * secondsPerBeat;
        const end = beat * secondsPerBeat;
        return {
            id: scene.id,
            index,
            bars: scene.bars,
            hold: scene.hold === true,
            startBeat,
            beats,
            start,
            end,
            startFrame: Math.min(frameAt(start, fps), frameCount),
            endFrame: Math.min(frameAt(end, fps), frameCount),
        };
    });
    const byId = new Map(scenes.map((scene) => [scene.id, scene]));
    const lastFrame = Math.max(0, frameCount - 1);
    const cues: ResolvedCue[] = (timeline.cues ?? []).map((cue) => {
        const scene = byId.get(cue.scene) as ResolvedScene;
        const absBeat = scene.startBeat + cue.beat;
        const time = absBeat * secondsPerBeat;
        const settleBeats = cue.settleBeats ?? 0;
        const settleTime = time + settleBeats * secondsPerBeat;
        const resolved: ResolvedCue = {
            id: cue.id,
            scene: cue.scene,
            kind: cue.kind,
            beat: cue.beat,
            absBeat,
            time,
            frame: Math.min(frameAt(time, fps), lastFrame),
            settleBeats,
            settleTime,
            settleFrame: settleFrameAt(settleTime, fps),
        };
        if (cue.text !== undefined) resolved.text = cue.text;
        if (cue.sfx !== undefined) resolved.sfx = cue.sfx;
        return resolved;
    });
    return {
        version: 1,
        protocol: PROTOCOL_VERSION,
        width: timeline.width,
        height: timeline.height,
        fps,
        seed: timeline.seed,
        bpm: timeline.bpm,
        beatsPerBar: timeline.beatsPerBar,
        secondsPerBeat,
        totalBeats: beat,
        durationSec: frameCount / fps,
        frameCount,
        scenes,
        cues,
        audio: timeline.audio ?? { mode: 'none' },
    };
}

/** The scene playing at frame `frame`. */
export function sceneAtFrame(timeline: ResolvedTimeline, frame: number): ResolvedScene {
    for (const scene of timeline.scenes) {
        if (frame < scene.endFrame) return scene;
    }
    return timeline.scenes[timeline.scenes.length - 1];
}
