// A score the model writes into timeline.json (`"audio": { "mode": "score" }`):
// checked and expanded into notes on the beat grid. One reader does both, so
// what validation accepts is exactly what gets played. Pure data and math, no
// Node or DOM imports: the Node CLI and the browser audio runtime both bundle
// this file.
import type { ResolvedTimeline } from './timelineResolve.ts';
import { placeNote, voiceChord } from './voicing.ts';

export const INSTRUMENT_NAMES = [
    'piano',
    'celesta',
    'musicbox',
    'bells',
    'marimba',
    'pluck',
    'harp',
    'strings',
    'pad',
    'flute',
    'clarinet',
    'bass',
    'sub',
    'drums',
] as const;
export type InstrumentName = (typeof INSTRUMENT_NAMES)[number];

export const DRUM_PIECES = ['kick', 'snare', 'hat', 'shaker', 'knock', 'clap'] as const;
export type DrumPiece = (typeof DRUM_PIECES)[number];

export const PATTERNS = [
    'hold',
    'pulse',
    'offbeat',
    'arpeggio',
    'broken',
    'strum',
    'root',
    'root-fifth',
    'octaves',
] as const;
export type PatternName = (typeof PATTERNS)[number];

export const ROOMS = ['dry', 'room', 'hall'] as const;
export type Room = (typeof ROOMS)[number];

export const SHEET_LEVELS = ['soft', 'medium', 'full'] as const;
export type SheetLevel = (typeof SHEET_LEVELS)[number];

/** Most parts one score can declare. */
export const MAX_PARTS = 8;

export interface InstrumentInfo {
    /** Lowest and highest MIDI note a written note may use. */
    range: [number, number];
    /** Where chord patterns are voiced. */
    chords: [number, number];
    /** Where root patterns sit. */
    bass: [number, number];
    /** One note at a time: chord patterns play the root. */
    mono: boolean;
    /** Holds its tone while the key is down (strings, winds): arpeggios stay short. */
    sustain: boolean;
    /** Default pan, -1 left to 1 right. */
    pan: number;
}

const info = (
    range: [number, number],
    chords: [number, number],
    bass: [number, number],
    pan: number,
    flags: { mono?: boolean; sustain?: boolean } = {},
): InstrumentInfo => ({
    range,
    chords,
    bass,
    mono: flags.mono ?? false,
    sustain: flags.sustain ?? false,
    pan,
});

export const INSTRUMENTS: Record<InstrumentName, InstrumentInfo> = {
    piano: info([21, 108], [55, 74], [36, 50], 0),
    celesta: info([60, 108], [72, 91], [60, 72], 0.25),
    musicbox: info([60, 103], [72, 91], [60, 72], -0.2),
    bells: info([67, 108], [79, 96], [67, 79], 0.3),
    marimba: info([45, 96], [60, 79], [45, 57], -0.15),
    pluck: info([40, 84], [52, 71], [40, 52], -0.2),
    harp: info([24, 103], [55, 76], [36, 50], 0.2),
    strings: info([36, 96], [55, 76], [36, 50], 0, { sustain: true }),
    pad: info([36, 96], [55, 76], [36, 48], 0, { sustain: true }),
    flute: info([60, 96], [72, 86], [72, 84], 0.15, { mono: true, sustain: true }),
    clarinet: info([50, 91], [60, 74], [55, 67], -0.1, { mono: true, sustain: true }),
    bass: info([28, 60], [36, 50], [36, 47], 0, { mono: true }),
    sub: info([24, 55], [33, 45], [33, 45], 0, { mono: true, sustain: true }),
    drums: info([0, 0], [0, 0], [0, 0], 0),
};

/** Velocity of each level before accents. */
const LEVEL_VELOCITY: Record<SheetLevel, number> = { soft: 0.55, medium: 0.75, full: 0.92 };
/** Seconds between the strings of a strum. */
const STRUM_ROLL_SEC = 0.018;
const EPS = 1e-6;

/** audio.score as written in timeline.json (after validation). */
export interface SheetV1 {
    room?: Room;
    instruments: Record<
        string,
        InstrumentName | { instrument: InstrumentName; volume?: number; pan?: number }
    >;
    scenes: Record<
        string,
        {
            level?: SheetLevel;
            chords?: string[];
            play: Record<string, string | string[] | Record<string, string | string[]>>;
        }
    >;
}

export interface SheetPart {
    name: string;
    instrument: InstrumentName;
    volume: number;
    pan: number;
}

export interface SheetNote {
    /** Index into parts. */
    part: number;
    /** Start on the timeline, in beats. */
    beat: number;
    /** How long the key is held, in beats. */
    beats: number;
    midi: number;
    /** 0 to 1. */
    velocity: number;
}

export interface SheetHit {
    part: number;
    piece: DrumPiece;
    beat: number;
    velocity: number;
}

/** A score expanded into notes: what the audio runtime plays. */
export interface SheetPlan {
    room: Room;
    parts: SheetPart[];
    notes: SheetNote[];
    hits: SheetHit[];
}

export interface SheetError {
    path: string;
    message: string;
}

export interface SheetScene {
    id: string;
    startBeat: number;
    beats: number;
}

// --- notes and chords -------------------------------------------------------

const LETTERS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOTE_PATTERN = /^([A-G])(#|b)?([0-8])$/;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** MIDI number of a scientific pitch name such as C4 (60), F#3 or Bb5, or null. */
export function parseNote(text: string): number | null {
    const m = NOTE_PATTERN.exec(text);
    if (!m) return null;
    const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
    return 12 * (Number(m[3]) + 1) + LETTERS[m[1]] + accidental;
}

export function noteName(midi: number): string {
    return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Chord qualities: intervals above the root, root first. Ninth chords leave out the fifth. */
const QUALITIES: Record<string, number[]> = {
    '': [0, 4, 7],
    m: [0, 3, 7],
    '7': [0, 4, 7, 10],
    m7: [0, 3, 7, 10],
    maj7: [0, 4, 7, 11],
    dim: [0, 3, 6],
    aug: [0, 4, 8],
    sus2: [0, 2, 7],
    sus4: [0, 5, 7],
    add9: [0, 4, 7, 14],
    '6': [0, 4, 7, 9],
    m6: [0, 3, 7, 9],
    '9': [0, 4, 10, 14],
    m9: [0, 3, 10, 14],
};

const CHORD_PATTERN = new RegExp(
    `^([A-G])(#|b)?(${Object.keys(QUALITIES)
        .filter((q) => q !== '')
        .sort((a, b) => b.length - a.length)
        .join('|')})?(?:/([A-G])(#|b)?)?$`,
);

export interface SheetChord {
    /** Pitch class of the root. */
    root: number;
    /** Pitch class of the lowest note: the root, or the note after the slash. */
    bass: number;
    /** Pitch classes, root first. */
    tones: number[];
}

function pitchClass(letter: string, accidental: string | undefined): number {
    return (LETTERS[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0) + 12) % 12;
}

/** A chord symbol such as C, Am, G7, Fmaj7 or C/E, or null. */
export function parseChord(text: string): SheetChord | null {
    const m = CHORD_PATTERN.exec(text);
    if (!m) return null;
    const root = pitchClass(m[1], m[2]);
    const tones = QUALITIES[m[3] ?? ''].map((i) => (root + i) % 12);
    return { root, bass: m[4] ? pitchClass(m[4], m[5]) : root, tones };
}

/** A length in beats: 1, 0.5, .25 or 1/3. */
function parseBeats(text: string): number | null {
    const m = /^(\d+(?:\.\d+)?|\.\d+)(?:\/(\d+))?$/.exec(text);
    if (!m) return null;
    const value = Number(m[1]) / (m[2] ? Number(m[2]) : 1);
    return Number.isFinite(value) && value > 0 ? value : null;
}

function fmt(beats: number): string {
    return Number(beats.toFixed(4)).toString();
}

type Token =
    | { kind: 'note'; midi: number[]; beats: number }
    | { kind: 'rest'; beats: number }
    | { kind: 'tie'; beats: number };

/** One bar of notes, or the first problem in it. */
function parseBar(
    text: string,
    instrument: InstrumentName,
): { tokens: Token[]; sum: number } | { problem: string } {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return { problem: 'is empty, write "-:4" for a bar of rest' };
    const inst = INSTRUMENTS[instrument];
    const tokens: Token[] = [];
    let sum = 0;
    for (const word of words) {
        const colon = word.indexOf(':');
        const head = colon < 0 ? word : word.slice(0, colon);
        let beats = 1;
        if (colon >= 0) {
            const parsed = parseBeats(word.slice(colon + 1));
            if (parsed === null) {
                return {
                    problem: `"${word}" has no length in beats after ":" (such as 1, 0.5 or 1/3)`,
                };
            }
            beats = parsed;
        }
        sum += beats;
        if (head === '-') {
            tokens.push({ kind: 'rest', beats });
            continue;
        }
        if (head === '~') {
            tokens.push({ kind: 'tie', beats });
            continue;
        }
        const pitches = head.split('+');
        const midi: number[] = [];
        for (const pitch of pitches) {
            const m = parseNote(pitch);
            if (m === null) {
                return {
                    problem: `"${pitch}" is not a note such as C4, F#3 or Bb5 (or - for a rest, ~ to hold the note before)`,
                };
            }
            const [low, high] = inst.range;
            if (m < low || m > high) {
                return {
                    problem: `${pitch} is outside the ${instrument}'s range ${noteName(low)} to ${noteName(high)}`,
                };
            }
            midi.push(m);
        }
        if (midi.length > 1 && inst.mono) {
            return { problem: `"${head}": the ${instrument} plays one note at a time` };
        }
        tokens.push({ kind: 'note', midi, beats });
    }
    return { tokens, sum };
}

interface ChordSpan {
    chord: SheetChord | null;
    /** Offset from the bar start, in beats. */
    from: number;
    to: number;
}

/** One bar of chords, or the first problem in it. */
function parseChordBar(
    text: string,
    barBeats: number,
): { spans: ChordSpan[] } | { problem: string } {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return { problem: 'is empty, write "-" for a bar without a chord' };
    const timed = words.filter((w) => w.includes(':')).length;
    if (timed > 0 && timed < words.length) {
        return {
            problem: 'gives some chords a length and not others: give all of them one, or none',
        };
    }
    const spans: ChordSpan[] = [];
    let at = 0;
    for (const word of words) {
        const colon = word.indexOf(':');
        const head = colon < 0 ? word : word.slice(0, colon);
        let beats = barBeats / words.length;
        if (colon >= 0) {
            const parsed = parseBeats(word.slice(colon + 1));
            if (parsed === null) return { problem: `"${word}" has no length in beats after ":"` };
            beats = parsed;
        }
        let chord: SheetChord | null = null;
        if (head !== '-') {
            chord = parseChord(head);
            if (!chord) {
                return {
                    problem: `"${head}" is not a chord such as C, Am, G7, Fmaj7 or C/E (qualities: ${Object.keys(
                        QUALITIES,
                    )
                        .filter((q) => q)
                        .join(', ')})`,
                };
            }
        }
        spans.push({ chord, from: at, to: at + beats });
        at += beats;
    }
    return { spans };
}

// --- reading ----------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
    if (value === undefined) return 'missing';
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'an array';
    if (typeof value === 'object') return 'an object';
    if (typeof value === 'string')
        return `"${value.length > 40 ? `${value.slice(0, 40)}...` : value}"`;
    return String(value);
}

function oneOf(list: readonly string[]): string {
    return list.map((v) => `"${v}"`).join(', ');
}

const PART_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

interface Bar {
    index: number;
    start: number;
    beats: number;
}

function sceneBars(scene: SheetScene, beatsPerBar: number): Bar[] {
    const count = Math.max(1, Math.ceil(scene.beats / beatsPerBar - EPS));
    const bars: Bar[] = [];
    for (let index = 0; index < count; index++) {
        bars.push({
            index,
            start: scene.startBeat + index * beatsPerBar,
            beats: Math.min(beatsPerBar, scene.beats - index * beatsPerBar),
        });
    }
    return bars;
}

/**
 * The beats an item of a repeating per-bar list must add up to: a full bar,
 * or the short last bar when that is the only bar the item lands on.
 */
function allowedSums(bars: Bar[], count: number, item: number, beatsPerBar: number): number[] {
    const lands = bars.filter((bar) => bar.index % count === item).map((bar) => bar.beats);
    const sums = [beatsPerBar];
    if (lands.length > 0 && lands.every((b) => Math.abs(b - lands[0]) < EPS)) sums.push(lands[0]);
    return sums;
}

class Reader {
    readonly errors: SheetError[] = [];
    private readonly seen = new Set<string>();

    fail(path: string, message: string): void {
        const key = `${path}\0${message}`;
        if (this.seen.has(key)) return;
        this.seen.add(key);
        this.errors.push({ path, message });
    }

    keys(obj: Record<string, unknown>, at: string, allowed: readonly string[]): void {
        for (const key of Object.keys(obj)) {
            if (!allowed.includes(key)) {
                this.fail(
                    `${at}.${key}`,
                    `is not a score field (allowed here: ${allowed.join(', ')})`,
                );
            }
        }
    }

    /** A per-bar list: a non-empty array of strings no longer than the scene. */
    list(value: unknown, at: string, bars: Bar[], scene: string, what: string): string[] | null {
        if (!Array.isArray(value) || value.length === 0) {
            this.fail(
                at,
                `must be a non-empty array of ${what}, one per bar (got ${describe(value)})`,
            );
            return null;
        }
        if (value.length > bars.length) {
            this.fail(
                at,
                `has ${value.length} bars, scene "${scene}" has ${bars.length}. A shorter list repeats from its start`,
            );
            return null;
        }
        let ok = true;
        value.forEach((item, i) => {
            if (typeof item !== 'string') {
                this.fail(`${at}[${i}]`, `must be a string of ${what} (got ${describe(item)})`);
                ok = false;
            }
        });
        return ok ? (value as string[]) : null;
    }
}

interface PartState {
    voicing: number[] | null;
    bass: number | null;
}

function velocity(level: SheetLevel, accent: number): number {
    return Number((LEVEL_VELOCITY[level] * accent).toFixed(4));
}

/**
 * Check a score and, when it is valid, expand it into notes. `scenes` are the
 * timeline's scenes in order with their start beats.
 */
export function readSheet(
    value: unknown,
    scenes: SheetScene[],
    beatsPerBar: number,
    secondsPerBeat: number,
): { errors: SheetError[]; plan: SheetPlan | null } {
    const r = new Reader();
    const root = '$.audio.score';
    if (!isObject(value)) {
        r.fail(root, `must be an object with instruments and scenes (got ${describe(value)})`);
        return { errors: r.errors, plan: null };
    }
    r.keys(value, root, ['room', 'instruments', 'scenes']);
    let room: Room = 'room';
    if (value.room !== undefined) {
        if (ROOMS.includes(value.room as Room)) room = value.room as Room;
        else r.fail(`${root}.room`, `must be one of ${oneOf(ROOMS)} (got ${describe(value.room)})`);
    }

    // Parts.
    const parts: SheetPart[] = [];
    const partIndex = new Map<string, number>();
    const declared: string[] = [];
    const instruments = value.instruments;
    if (!isObject(instruments) || Object.keys(instruments).length === 0) {
        r.fail(
            `${root}.instruments`,
            `must map part names to instruments, such as { "keys": "piano", "lead": "flute" } (got ${describe(instruments)})`,
        );
    } else {
        const names = Object.keys(instruments);
        if (names.length > MAX_PARTS) {
            r.fail(`${root}.instruments`, `declares ${names.length} parts, at most ${MAX_PARTS}`);
        }
        for (const name of names) {
            declared.push(name);
            const at = `${root}.instruments.${name}`;
            if (!PART_PATTERN.test(name)) {
                r.fail(at, 'is not a part name: a letter, then letters, digits, - or _');
                continue;
            }
            const entry = instruments[name];
            let instrument: unknown = entry;
            let volume = 1;
            let pan: number | undefined;
            let ok = true;
            let instrumentAt = at;
            if (isObject(entry)) {
                r.keys(entry, at, ['instrument', 'volume', 'pan']);
                instrument = entry.instrument;
                instrumentAt = `${at}.instrument`;
                if (entry.volume !== undefined) {
                    const v = entry.volume;
                    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 2) {
                        r.fail(`${at}.volume`, `must be a number from 0 to 2 (got ${describe(v)})`);
                        ok = false;
                    } else volume = v;
                }
                if (entry.pan !== undefined) {
                    const p = entry.pan;
                    if (typeof p !== 'number' || !Number.isFinite(p) || p < -1 || p > 1) {
                        r.fail(`${at}.pan`, `must be a number from -1 to 1 (got ${describe(p)})`);
                        ok = false;
                    } else pan = p;
                }
            }
            if (!INSTRUMENT_NAMES.includes(instrument as InstrumentName)) {
                r.fail(
                    instrumentAt,
                    `must be one of ${oneOf(INSTRUMENT_NAMES)} (got ${describe(instrument)})`,
                );
                continue;
            }
            if (!ok) continue;
            const name_ = instrument as InstrumentName;
            partIndex.set(name, parts.length);
            parts.push({ name, instrument: name_, volume, pan: pan ?? INSTRUMENTS[name_].pan });
        }
    }

    // Scenes.
    const notes: SheetNote[] = [];
    const hits: SheetHit[] = [];
    const states = parts.map((): PartState => ({ voicing: null, bass: null }));
    const known = scenes.map((s) => s.id);
    const sceneMap = value.scenes;
    if (!isObject(sceneMap) || Object.keys(sceneMap).length === 0) {
        r.fail(
            `${root}.scenes`,
            `must map scene ids to their music, at least one scene (got ${describe(sceneMap)})`,
        );
    } else {
        for (const id of Object.keys(sceneMap)) {
            if (!known.includes(id)) {
                r.fail(
                    `${root}.scenes.${id}`,
                    `names no scene (known: ${known.join(', ') || 'none'})`,
                );
            }
        }
        for (const scene of scenes) {
            if (!(scene.id in sceneMap)) continue;
            readScene(r, sceneMap[scene.id], `${root}.scenes.${scene.id}`, scene, {
                beatsPerBar,
                secondsPerBeat,
                parts,
                partIndex,
                declared,
                states,
                notes,
                hits,
            });
        }
    }
    if (r.errors.length > 0) return { errors: r.errors, plan: null };
    const order = DRUM_PIECES as readonly string[];
    hits.sort(
        (a, b) =>
            a.beat - b.beat || a.part - b.part || order.indexOf(a.piece) - order.indexOf(b.piece),
    );
    return { errors: [], plan: { room, parts, notes, hits } };
}

interface SceneContext {
    beatsPerBar: number;
    secondsPerBeat: number;
    parts: SheetPart[];
    partIndex: Map<string, number>;
    declared: string[];
    states: PartState[];
    notes: SheetNote[];
    hits: SheetHit[];
}

function readScene(
    r: Reader,
    value: unknown,
    at: string,
    scene: SheetScene,
    c: SceneContext,
): void {
    if (!isObject(value)) {
        r.fail(
            at,
            `must be an object with play, and chords and level when needed (got ${describe(value)})`,
        );
        return;
    }
    r.keys(value, at, ['level', 'chords', 'play']);
    let level: SheetLevel = 'medium';
    if (value.level !== undefined) {
        if (SHEET_LEVELS.includes(value.level as SheetLevel)) level = value.level as SheetLevel;
        else
            r.fail(
                `${at}.level`,
                `must be one of ${oneOf(SHEET_LEVELS)} (got ${describe(value.level)})`,
            );
    }
    const bars = sceneBars(scene, c.beatsPerBar);

    // Chords per bar, as spans on the timeline.
    let chordBars: ChordSpan[][] | null = null;
    if (value.chords !== undefined) {
        const list = r.list(value.chords, `${at}.chords`, bars, scene.id, 'chord symbols');
        if (list) {
            const parsed: ChordSpan[][] = [];
            let ok = true;
            list.forEach((text, i) => {
                const sums = allowedSums(bars, list.length, i, c.beatsPerBar);
                const read = parseChordBar(text, sums[sums.length - 1]);
                if ('problem' in read) {
                    r.fail(`${at}.chords[${i}]`, read.problem);
                    ok = false;
                    return;
                }
                const total = read.spans[read.spans.length - 1].to;
                if (!sums.some((s) => Math.abs(s - total) < EPS)) {
                    r.fail(
                        `${at}.chords[${i}]`,
                        `adds up to ${fmt(total)} beats, bars in scene "${scene.id}" hold ${fmt(c.beatsPerBar)}`,
                    );
                    ok = false;
                    return;
                }
                parsed.push(read.spans);
            });
            if (ok) chordBars = parsed;
        }
    }

    const play = value.play;
    if (!isObject(play) || Object.keys(play).length === 0) {
        r.fail(
            `${at}.play`,
            `must map part names to what they play, at least one part (got ${describe(play)})`,
        );
        return;
    }
    for (const [name, what] of Object.entries(play)) {
        const pat = `${at}.play.${name}`;
        if (!c.declared.includes(name)) {
            r.fail(
                pat,
                `names no part in audio.score.instruments (known: ${c.declared.join(', ') || 'none'})`,
            );
            continue;
        }
        const index = c.partIndex.get(name);
        if (index === undefined) continue; // its instrument entry is already wrong
        const part = c.parts[index];
        if (part.instrument === 'drums') {
            readDrums(r, what, pat, bars, scene, index, level, c);
            continue;
        }
        if (typeof what === 'string') {
            if (!PATTERNS.includes(what as PatternName)) {
                r.fail(
                    pat,
                    `must be a pattern (${oneOf(PATTERNS)}) or an array of bars of notes (got ${describe(what)})`,
                );
                continue;
            }
            if (value.chords === undefined) {
                r.fail(
                    pat,
                    `plays the "${what}" pattern, which needs "chords" in scene "${scene.id}"`,
                );
                continue;
            }
            if (!chordBars) continue;
            for (const bar of bars) {
                const spans = chordBars[bar.index % chordBars.length];
                playPattern(what as PatternName, spans, bar, index, part, level, c);
            }
            continue;
        }
        if (!Array.isArray(what)) {
            r.fail(
                pat,
                `the ${part.instrument} plays a pattern name or an array of bars of notes, not drum steps (got ${describe(what)})`,
            );
            continue;
        }
        readNotes(r, what, pat, bars, scene, index, part, level, c);
    }
}

function readNotes(
    r: Reader,
    value: unknown[],
    at: string,
    bars: Bar[],
    scene: SheetScene,
    index: number,
    part: SheetPart,
    level: SheetLevel,
    c: SceneContext,
): void {
    const list = r.list(value, at, bars, scene.id, 'notes');
    if (!list) return;
    const parsed: Token[][] = [];
    let ok = true;
    list.forEach((text, i) => {
        const read = parseBar(text, part.instrument);
        if ('problem' in read) {
            r.fail(`${at}[${i}]`, read.problem);
            ok = false;
            return;
        }
        const sums = allowedSums(bars, list.length, i, c.beatsPerBar);
        if (!sums.some((s) => Math.abs(s - read.sum) < EPS)) {
            r.fail(
                `${at}[${i}]`,
                `adds up to ${fmt(read.sum)} beats, bars in scene "${scene.id}" hold ${fmt(c.beatsPerBar)}`,
            );
            ok = false;
            return;
        }
        parsed.push(read.tokens);
    });
    if (!ok) return;
    let last: SheetNote[] | null = null;
    for (const bar of bars) {
        const item = bar.index % parsed.length;
        const end = bar.start + bar.beats;
        let t = bar.start;
        for (const token of parsed[item]) {
            if (t >= end - EPS) break;
            const beats = Math.min(token.beats, end - t);
            if (token.kind === 'rest') {
                last = null;
            } else if (token.kind === 'tie') {
                if (!last) {
                    r.fail(
                        `${at}[${item}]`,
                        `"~" holds the note before it, but nothing sounds before it in scene "${scene.id}"`,
                    );
                    return;
                }
                for (const note of last) note.beats += beats;
            } else {
                const accent = Math.abs(t - bar.start) < EPS ? 1 : 0.9;
                last = token.midi.map((midi) => ({
                    part: index,
                    beat: t,
                    beats,
                    midi,
                    velocity: velocity(level, accent),
                }));
                c.notes.push(...last);
            }
            t += beats;
        }
    }
}

function readDrums(
    r: Reader,
    value: unknown,
    at: string,
    bars: Bar[],
    scene: SheetScene,
    index: number,
    level: SheetLevel,
    c: SceneContext,
): void {
    if (!isObject(value)) {
        r.fail(
            at,
            `the drums play steps per piece, such as { "kick": "x...x...", "hat": "..x...x." } (got ${describe(value)})`,
        );
        return;
    }
    for (const [piece, steps] of Object.entries(value)) {
        const pat = `${at}.${piece}`;
        if (!DRUM_PIECES.includes(piece as DrumPiece)) {
            r.fail(pat, `must be one of ${oneOf(DRUM_PIECES)}`);
            continue;
        }
        const list = typeof steps === 'string' ? [steps] : steps;
        const read = r.list(list, pat, bars, scene.id, 'steps');
        if (!read) continue;
        const bad = read.findIndex((s) => !/^[xX.]{1,64}$/.test(s));
        if (bad >= 0) {
            r.fail(
                typeof steps === 'string' ? pat : `${pat}[${bad}]`,
                `must be 1 to 64 steps of x (hit), X (accent) or . (silent), such as "x...x..." (got ${describe(read[bad])})`,
            );
            continue;
        }
        for (const bar of bars) {
            const text = read[bar.index % read.length];
            const step = c.beatsPerBar / text.length;
            for (let k = 0; k < text.length; k++) {
                const offset = k * step;
                if (offset >= bar.beats - EPS) break;
                if (text[k] === '.') continue;
                c.hits.push({
                    part: index,
                    piece: piece as DrumPiece,
                    beat: bar.start + offset,
                    velocity: velocity(level, text[k] === 'X' ? 1 : 0.72),
                });
            }
        }
    }
}

// --- patterns ---------------------------------------------------------------

/** Positions on a grid of `step` beats from the bar start that fall inside [from, to). */
function grid(bar: Bar, step: number, phase: number, from: number, to: number): number[] {
    const out: number[] = [];
    for (let k = 0; ; k++) {
        const t = bar.start + phase + k * step;
        if (t >= to - EPS) break;
        if (t >= from - EPS) out.push(t);
    }
    return out;
}

function playPattern(
    pattern: PatternName,
    spans: ChordSpan[],
    bar: Bar,
    index: number,
    part: SheetPart,
    level: SheetLevel,
    c: SceneContext,
): void {
    const inst = INSTRUMENTS[part.instrument];
    const state = c.states[index];
    const barEnd = bar.start + bar.beats;
    const middle = bar.start + c.beatsPerBar / 2;
    const inRange = (m: number) => {
        let n = m;
        while (n > inst.range[1]) n -= 12;
        while (n < inst.range[0]) n += 12;
        return n;
    };
    const add = (beat: number, beats: number, midi: number, accent: number) => {
        if (beats <= EPS) return;
        c.notes.push({
            part: index,
            beat,
            beats,
            midi: inRange(midi),
            velocity: velocity(level, accent),
        });
    };
    const accentAt = (t: number) => (Math.abs(t - bar.start) < EPS ? 1 : 0.82);
    for (const span of spans) {
        const from = bar.start + span.from;
        const to = Math.min(barEnd, bar.start + span.to);
        if (!span.chord || from >= barEnd - EPS) continue;
        const chord = span.chord;
        const voicing = voiceChord(chord.tones, inst.chords[0], inst.chords[1], state.voicing, 19);
        state.voicing = voicing;
        const bass = placeNote(chord.bass, inst.bass[0], inst.bass[1], state.bass);
        state.bass = bass;
        const chordNotes = inst.mono ? [bass] : voicing;
        const top = voicing[voicing.length - 1];
        const ring = (t: number, step: number) => (inst.sustain ? Math.min(step, to - t) : to - t);
        switch (pattern) {
            case 'hold':
                for (const m of chordNotes) add(from, to - from, m, accentAt(from));
                break;
            case 'pulse':
                for (const t of grid(bar, 1, 0, from, to))
                    for (const m of chordNotes) add(t, Math.min(1, to - t), m, accentAt(t));
                break;
            case 'offbeat':
                for (const t of grid(bar, 1, 0.5, from, to))
                    for (const m of chordNotes) add(t, Math.min(0.5, to - t), m, 0.8);
                break;
            case 'arpeggio': {
                const up = [...voicing, voicing[0] + 12];
                const cycle = [...up, ...up.slice(1, -1).reverse()];
                grid(bar, 0.5, 0, from, to).forEach((t, k) => {
                    add(t, ring(t, 0.5), cycle[k % cycle.length], accentAt(t) * 0.9);
                });
                break;
            }
            case 'broken': {
                const cycle = [voicing[0], top, voicing[1], top];
                grid(bar, 0.5, 0, from, to).forEach((t, k) => {
                    add(t, ring(t, 0.5), cycle[k % cycle.length], accentAt(t) * 0.9);
                });
                break;
            }
            case 'strum': {
                const strikes = [from];
                if (c.beatsPerBar >= 2 && middle > from + EPS && middle < to - EPS)
                    strikes.push(middle);
                const roll = STRUM_ROLL_SEC / c.secondsPerBeat;
                strikes.forEach((t, s) => {
                    const until = strikes[s + 1] ?? to;
                    chordNotes.forEach((m, k) => {
                        add(t + k * roll, until - t - k * roll, m, (s === 0 ? 1 : 0.85) * 0.9);
                    });
                });
                break;
            }
            case 'root':
                add(from, to - from, bass, accentAt(from));
                break;
            case 'root-fifth': {
                const split = middle > from + EPS && middle < to - EPS;
                add(from, (split ? middle : to) - from, bass, accentAt(from));
                if (split) {
                    const fifth = placeNote((chord.root + 7) % 12, bass, bass + 11, bass);
                    add(middle, to - middle, fifth, 0.85);
                }
                break;
            }
            case 'octaves':
                grid(bar, 0.5, 0, from, to).forEach((t, k) => {
                    add(
                        t,
                        Math.min(0.5, to - t),
                        k % 2 === 0 ? bass : bass + 12,
                        accentAt(t) * 0.9,
                    );
                });
                break;
        }
    }
}

/** Expand a validated score for a resolved timeline. */
export function expandSheet(sheet: SheetV1, tl: ResolvedTimeline): SheetPlan {
    const read = readSheet(
        sheet,
        tl.scenes.map((s) => ({ id: s.id, startBeat: s.startBeat, beats: s.beats })),
        tl.beatsPerBar,
        tl.secondsPerBeat,
    );
    if (!read.plan) {
        const first = read.errors[0];
        throw new Error(`invalid audio.score: ${first.path} ${first.message}`);
    }
    return read.plan;
}
