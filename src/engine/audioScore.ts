// The score: what the audio runtime plays, planned from the resolved
// timeline. Pure data and math, no Node or DOM imports: the Node CLI and the
// browser audio runtime both bundle this file.
import type { ResolvedTimeline } from './timelineResolve.ts';

export const SAMPLE_RATE = 48000;
export const SCORE_VERSION = 1;

export const PRESETS = ['pluck', 'marimba', 'pad'] as const;
export type PresetName = (typeof PRESETS)[number];

export const SFX_NAMES = ['paper', 'drop', 'ding', 'sweep'] as const;
export type SfxName = (typeof SFX_NAMES)[number];

export const DYNAMICS = ['rest', 'soft', 'medium', 'full'] as const;
export type Dynamic = (typeof DYNAMICS)[number];

export const DEFAULT_KEY = 'C';
export const DEFAULT_PROGRESSION = 0;
export const DEFAULT_DYNAMIC: Dynamic = 'medium';

/** Key names: a letter, an optional sharp or flat, an optional m for minor. */
export const KEY_PATTERN = /^[A-G](#|b)?m?$/;

export type ChordQuality = 'maj' | 'min';

/** A chord as a scale step: semitones above the tonic and major or minor. */
interface ChordStep {
    symbol: string;
    offset: number;
    quality: ChordQuality;
}

const MAJOR_STEPS: Record<string, ChordStep> = {
    I: { symbol: 'I', offset: 0, quality: 'maj' },
    ii: { symbol: 'ii', offset: 2, quality: 'min' },
    iii: { symbol: 'iii', offset: 4, quality: 'min' },
    IV: { symbol: 'IV', offset: 5, quality: 'maj' },
    V: { symbol: 'V', offset: 7, quality: 'maj' },
    vi: { symbol: 'vi', offset: 9, quality: 'min' },
};

const MINOR_STEPS: Record<string, ChordStep> = {
    i: { symbol: 'i', offset: 0, quality: 'min' },
    III: { symbol: 'III', offset: 3, quality: 'maj' },
    iv: { symbol: 'iv', offset: 5, quality: 'min' },
    V: { symbol: 'V', offset: 7, quality: 'maj' },
    VI: { symbol: 'VI', offset: 8, quality: 'maj' },
    VII: { symbol: 'VII', offset: 10, quality: 'maj' },
};

/** Chord progressions, one chord per bar, numbered from 0. Same count in both modes. */
export const PROGRESSIONS: { major: string[][]; minor: string[][] } = {
    major: [
        ['I', 'V', 'vi', 'IV'],
        ['I', 'vi', 'IV', 'V'],
        ['vi', 'IV', 'I', 'V'],
        ['I', 'IV', 'vi', 'V'],
        ['IV', 'V', 'iii', 'vi'],
        ['ii', 'V', 'I', 'vi'],
    ],
    minor: [
        ['i', 'VI', 'III', 'VII'],
        ['i', 'iv', 'VI', 'V'],
        ['i', 'VII', 'VI', 'VII'],
        ['i', 'VI', 'iv', 'V'],
        ['VI', 'VII', 'i', 'i'],
        ['i', 'iv', 'VII', 'III'],
    ],
};

export const PROGRESSION_COUNT = PROGRESSIONS.major.length;

const LETTERS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export interface Key {
    name: string;
    /** Pitch class of the tonic, 0 = C. */
    tonic: number;
    minor: boolean;
}

export function parseKey(name: string): Key {
    if (!KEY_PATTERN.test(name)) throw new Error(`"${name}" is not a key such as C, F# or Bbm`);
    let tonic = LETTERS[name[0]];
    if (name[1] === '#') tonic += 1;
    if (name[1] === 'b') tonic -= 1;
    return { name, tonic: (tonic + 12) % 12, minor: name.endsWith('m') };
}

export interface Chord {
    /** Roman numeral, e.g. vi. */
    symbol: string;
    /** Pitch class of the root. */
    root: number;
    quality: ChordQuality;
    /** Triad pitch classes, root first. */
    triad: number[];
    /** Four-note color chord (add9 on major, minor seventh on minor), root first. */
    color: number[];
}

export function chordOf(key: Key, symbol: string): Chord {
    const step = (key.minor ? MINOR_STEPS : MAJOR_STEPS)[symbol];
    if (!step) throw new Error(`No chord ${symbol} in ${key.minor ? 'minor' : 'major'} keys`);
    const root = (key.tonic + step.offset) % 12;
    const third = step.quality === 'maj' ? 4 : 3;
    const pc = (semis: number) => (root + semis) % 12;
    return {
        symbol,
        root,
        quality: step.quality,
        triad: [root, pc(third), pc(7)],
        color: step.quality === 'maj' ? [root, pc(4), pc(7), pc(2)] : [root, pc(3), pc(7), pc(10)],
    };
}

export function tonicChord(key: Key): Chord {
    return chordOf(key, key.minor ? 'i' : 'I');
}

/** The chords of a progression in a key. */
export function progressionChords(key: Key, index: number): Chord[] {
    const table = key.minor ? PROGRESSIONS.minor : PROGRESSIONS.major;
    const symbols = table[index];
    if (!symbols) throw new Error(`progression must be 0 to ${table.length - 1}`);
    return symbols.map((symbol) => chordOf(key, symbol));
}

/**
 * Place pitch classes as MIDI notes inside [low, high], one note per pitch
 * class, moving as little as possible from `previous` (or sitting near the
 * middle of the range when there is none). Returns the notes sorted low to high.
 */
export function voiceChord(
    pitchClasses: number[],
    low: number,
    high: number,
    previous: number[] | null,
    maxSpan = 16,
): number[] {
    const options = pitchClasses.map((pc) => {
        const notes: number[] = [];
        for (let m = low; m <= high; m++) if (((m % 12) + 12) % 12 === pc) notes.push(m);
        return notes;
    });
    if (options.some((o) => o.length === 0)) {
        throw new Error(`range ${low}..${high} cannot hold every pitch class`);
    }
    const center = (low + high) / 2;
    let best: number[] | null = null;
    let bestCost = Number.POSITIVE_INFINITY;
    const pick: number[] = [];
    const walk = (i: number) => {
        if (i === options.length) {
            const sorted = [...pick].sort((a, b) => a - b);
            for (let k = 1; k < sorted.length; k++) if (sorted[k] === sorted[k - 1]) return;
            const span = sorted[sorted.length - 1] - sorted[0];
            if (span > maxSpan) return;
            let cost: number;
            if (previous && previous.length === sorted.length) {
                cost = sorted.reduce((sum, m, k) => sum + Math.abs(m - previous[k]), 0);
            } else {
                const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
                cost = Math.abs(mean - center) * sorted.length;
            }
            // Ties go to the lower voicing, so the choice never depends on search order.
            cost += span * 0.01 + sorted[0] * 0.0001;
            if (cost < bestCost) {
                bestCost = cost;
                best = sorted;
            }
            return;
        }
        for (const m of options[i]) {
            pick.push(m);
            walk(i + 1);
            pick.pop();
        }
    };
    walk(0);
    if (!best)
        throw new Error(`no voicing of ${pitchClasses.join(',')} within ${maxSpan} semitones`);
    return best;
}

/**
 * One MIDI note of pitch class `pc` in [low, high]: the one nearest to
 * `previous`, or the lowest when there is none. Ties go to the lower note.
 */
export function placeNote(pc: number, low: number, high: number, previous: number | null): number {
    let best: number | null = null;
    for (let m = low; m <= high; m++) {
        if (((m % 12) + 12) % 12 !== pc) continue;
        if (best === null) best = m;
        else if (previous !== null && Math.abs(m - previous) < Math.abs(best - previous)) best = m;
        if (previous === null) break;
    }
    if (best === null) throw new Error(`range ${low}..${high} has no pitch class ${pc}`);
    return best;
}

export interface ScoreBar {
    index: number;
    startBeat: number;
    /** Beats in this bar; the last bar can be shorter than beatsPerBar. */
    beats: number;
    start: number;
    chord: Chord;
    /** The last bar: the home chord, left to ring. */
    ending: boolean;
}

export interface ScoreSection {
    scene: string;
    startBeat: number;
    endBeat: number;
    level: Dynamic;
}

export interface ScoreSfx {
    id: string;
    name: SfxName;
    frame: number;
    /** Where the effect's loudest sample lands: the cue frame on the 48 kHz grid. */
    sample: number;
}

export interface Score {
    version: typeof SCORE_VERSION;
    sampleRate: number;
    /** Length in samples, equal to the picture length. */
    length: number;
    durationSec: number;
    fps: number;
    bpm: number;
    beatsPerBar: number;
    secondsPerBeat: number;
    totalBeats: number;
    seed: number;
    /** Null when no music is synthesized (mode file or none). */
    preset: PresetName | null;
    key: Key;
    progression: number;
    bars: ScoreBar[];
    sections: ScoreSection[];
    sfx: ScoreSfx[];
}

/** Sample index of a frame on the 48 kHz grid. */
export function frameSample(frame: number, fps: number, sampleRate = SAMPLE_RATE): number {
    return Math.round((frame * sampleRate) / fps);
}

/** The audio length for a timeline: exactly the picture length, rounded to samples. */
export function scoreLength(tl: ResolvedTimeline, sampleRate = SAMPLE_RATE): number {
    return frameSample(tl.frameCount, tl.fps, sampleRate);
}

/** Plan the music and effects for a validated, resolved timeline. */
export function buildScore(tl: ResolvedTimeline, sampleRate = SAMPLE_RATE): Score {
    const audio = tl.audio;
    const key = parseKey(audio.key ?? DEFAULT_KEY);
    const progression = audio.progression ?? DEFAULT_PROGRESSION;
    const preset = audio.mode === 'preset' ? (audio.preset as PresetName) : null;
    const chords = progressionChords(key, progression);
    const barCount = Math.max(1, Math.ceil(tl.totalBeats / tl.beatsPerBar - 1e-9));
    const bars: ScoreBar[] = [];
    for (let index = 0; index < barCount; index++) {
        const startBeat = index * tl.beatsPerBar;
        const ending = index === barCount - 1;
        bars.push({
            index,
            startBeat,
            beats: Math.min(tl.beatsPerBar, tl.totalBeats - startBeat),
            start: startBeat * tl.secondsPerBeat,
            chord: ending ? tonicChord(key) : chords[index % chords.length],
            ending,
        });
    }
    const dynamics = audio.dynamics ?? {};
    const sections: ScoreSection[] = tl.scenes.map((scene) => ({
        scene: scene.id,
        startBeat: scene.startBeat,
        endBeat: scene.startBeat + scene.beats,
        level: (dynamics[scene.id] as Dynamic | undefined) ?? DEFAULT_DYNAMIC,
    }));
    const sfx: ScoreSfx[] = tl.cues
        .filter((cue) => cue.kind === 'sfx' && cue.sfx !== undefined)
        .map((cue) => ({
            id: cue.id,
            name: cue.sfx as SfxName,
            frame: cue.frame,
            sample: frameSample(cue.frame, tl.fps, sampleRate),
        }));
    return {
        version: SCORE_VERSION,
        sampleRate,
        length: scoreLength(tl, sampleRate),
        durationSec: tl.durationSec,
        fps: tl.fps,
        bpm: tl.bpm,
        beatsPerBar: tl.beatsPerBar,
        secondsPerBeat: tl.secondsPerBeat,
        totalBeats: tl.totalBeats,
        seed: tl.seed,
        preset,
        key,
        progression,
        bars,
        sections,
        sfx,
    };
}

/** The dynamic level at a beat. Beats past the end take the last section's level. */
export function levelAt(score: Score, beat: number): Dynamic {
    for (const section of score.sections) {
        if (beat < section.endBeat - 1e-9) return section.level;
    }
    return score.sections[score.sections.length - 1]?.level ?? DEFAULT_DYNAMIC;
}

export function midiToHz(midi: number): number {
    return 440 * 2 ** ((midi - 69) / 12);
}
