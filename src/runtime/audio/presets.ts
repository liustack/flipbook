// The three music presets. Each one turns the score (bars, chords, levels)
// into notes on two buses: `main` and `air` (bells and sparkle, sent to the
// reverb harder).
import {
    type Chord,
    type Dynamic,
    levelAt,
    type PresetName,
    placeNote,
    type Score,
    type ScoreBar,
    voiceChord,
} from '../../engine/audioScore.ts';
import { hash32, rand } from '../core/random.ts';
import { type Bus, samples } from './dsp.ts';
import { bell, knock, mallet, pad, pluck, shaker, sub } from './voices.ts';

export interface Arrangement {
    main: Bus;
    air: Bus;
}

export interface MasterSettings {
    /** Reverb length (RT60) in seconds. */
    reverbSec: number;
    /** Reverb send from the main and air buses. */
    sendMain: number;
    sendAir: number;
    /** Reverb return level. */
    wet: number;
    lowpass: number;
}

const VELOCITY: Record<Dynamic, number> = { rest: 0, soft: 0.5, medium: 0.72, full: 0.88 };

interface Ctx {
    score: Score;
    sr: number;
    out: Arrangement;
    seed: number;
}

function at(c: Ctx, beat: number): number {
    return samples(beat * c.score.secondsPerBeat, c.sr);
}

/** A few milliseconds of timing drift and a little velocity spread, fixed per note. */
function human(c: Ctx, ms: number, ...keys: (number | string)[]): { shift: number; vel: number } {
    const a = rand(c.seed, 'time', ...keys);
    const b = rand(c.seed, 'vel', ...keys);
    return { shift: Math.round(((a - 0.5) * 2 * ms * c.sr) / 1000), vel: 1 + (b - 0.5) * 0.12 };
}

function noteSeed(c: Ctx, ...keys: (number | string)[]): number {
    return hash32(c.seed, 'note', ...keys);
}

/** Major or minor pentatonic pitch classes of the key. */
function pentatonic(score: Score): number[] {
    const steps = score.key.minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
    return steps.map((s) => (score.key.tonic + s) % 12);
}

/** Pentatonic notes in [low, high] that do not rub a semitone against the chord. */
function melodyNotes(score: Score, chord: Chord, low: number, high: number): number[] {
    const pcs = pentatonic(score);
    const notes: number[] = [];
    for (let m = low; m <= high; m++) {
        const pc = m % 12;
        if (!pcs.includes(pc)) continue;
        const rub = chord.color.some(
            (t) => t !== pc && (Math.abs(t - pc) === 1 || Math.abs(t - pc) === 11),
        );
        if (!rub || chord.triad.includes(pc)) notes.push(m);
    }
    return notes;
}

function barEnd(c: Ctx, bar: ScoreBar): number {
    return at(c, bar.startBeat + bar.beats);
}

// --- pluck: fingerpicked nylon strings -------------------------------------

function arrangePluck(c: Ctx): void {
    const { score, sr, out } = c;
    let prevVoicing: number[] | null = null;
    let prevBass: number | null = null;
    for (const bar of score.bars) {
        const voicing = voiceChord(bar.chord.triad, 55, 72, prevVoicing);
        prevVoicing = voicing;
        const root = placeNote(bar.chord.root, 40, 52, prevBass);
        prevBass = root;
        const fifth = placeNote((bar.chord.root + 7) % 12, root, root + 11, root);
        const top = voicing[0] + 12;
        const end = barEnd(c, bar);
        const damp = (from: number) => Math.max(samples(0.5, sr), end - from + samples(0.12, sr));
        if (bar.ending) {
            const level = levelAt(score, bar.startBeat);
            if (level === 'rest') continue;
            const v = VELOCITY[level];
            const start = at(c, bar.startBeat);
            const ring = score.length - start;
            pluck(
                out.main,
                start,
                root,
                {
                    velocity: v * 0.9,
                    pan: -0.1,
                    t60: 7,
                    bright: 0.25,
                    seed: noteSeed(c, bar.index, 'bass'),
                    length: ring,
                },
                sr,
            );
            [...voicing, top].forEach((m, k) => {
                pluck(
                    out.main,
                    start + samples(0.018 * (k + 1), sr),
                    m,
                    {
                        velocity: v * 0.62,
                        pan: -0.3 + k * 0.2,
                        t60: 6,
                        bright: 0.45,
                        seed: noteSeed(c, bar.index, 'end', k),
                        length: ring,
                    },
                    sr,
                );
            });
            continue;
        }
        const arp = [voicing[1], voicing[2], top, voicing[2]];
        for (let k = 0; k < bar.beats; k++) {
            for (let h = 0; h < 2; h++) {
                const beat = bar.startBeat + k + h / 2;
                if (beat >= bar.startBeat + bar.beats) continue;
                const level = levelAt(score, beat);
                if (level === 'rest') continue;
                const v = VELOCITY[level];
                const hm = human(c, 4, bar.index, k, h);
                const start = at(c, beat);
                if (h === 0) {
                    if (k === 0 || (level !== 'soft' && k % 2 === 0)) {
                        const note = k % 4 === 2 ? fifth : root;
                        pluck(
                            out.main,
                            start,
                            note,
                            {
                                velocity: v * 0.85 * hm.vel,
                                pan: -0.1,
                                t60: 1.8,
                                bright: 0.2,
                                seed: noteSeed(c, bar.index, k, 'bass'),
                                length: damp(start),
                            },
                            sr,
                        );
                    }
                    if (level === 'soft' && k > 0) {
                        const m = voicing[(k - 1) % voicing.length];
                        pluck(
                            out.main,
                            start + hm.shift,
                            m,
                            {
                                velocity: v * 0.6 * hm.vel,
                                pan: 0.2,
                                t60: 1.6,
                                bright: 0.35,
                                seed: noteSeed(c, bar.index, k, 's'),
                                length: damp(start),
                            },
                            sr,
                        );
                    }
                    if (level === 'full' && k === 0) {
                        [...voicing, top].forEach((m, j) => {
                            pluck(
                                out.main,
                                start + samples(0.014 * (j + 1), sr),
                                m,
                                {
                                    velocity: v * 0.5,
                                    pan: -0.25 + j * 0.17,
                                    t60: 1.5,
                                    bright: 0.55,
                                    seed: noteSeed(c, bar.index, 'strum', j),
                                    length: damp(start),
                                },
                                sr,
                            );
                        });
                    }
                    if (level === 'full' && k % 2 === 1) {
                        knock(
                            out.main,
                            start,
                            {
                                velocity: 0.22 * hm.vel,
                                pan: 0.05,
                                seed: noteSeed(c, bar.index, k, 'knock'),
                            },
                            sr,
                        );
                    }
                } else if (level !== 'soft') {
                    const m = arp[k % arp.length];
                    pluck(
                        out.main,
                        start + hm.shift,
                        m,
                        {
                            velocity: v * 0.62 * hm.vel,
                            pan: 0.25,
                            t60: 1.5,
                            bright: 0.4,
                            seed: noteSeed(c, bar.index, k, 'arp'),
                            length: damp(start),
                        },
                        sr,
                    );
                }
                if (level === 'full') {
                    shaker(
                        out.main,
                        start + hm.shift,
                        {
                            velocity: (h === 1 ? 0.07 : 0.045) * hm.vel,
                            pan: 0.35,
                            seed: noteSeed(c, bar.index, k, h, 'shake'),
                        },
                        sr,
                    );
                }
            }
        }
        // A small melody on the high strings every other bar when the music is full.
        if (bar.index % 2 === 1 && levelAt(score, bar.startBeat) === 'full') {
            const notes = melodyNotes(score, bar.chord, 72, 86);
            for (let k = 1; k < bar.beats; k++) {
                if (rand(c.seed, 'hook', bar.index, k) < 0.35) continue;
                const m = notes[Math.floor(rand(c.seed, 'hookn', bar.index, k) * notes.length)];
                const start = at(c, bar.startBeat + k);
                pluck(
                    out.air,
                    start,
                    m,
                    {
                        velocity: 0.42,
                        pan: 0.35,
                        t60: 1.8,
                        bright: 0.7,
                        seed: noteSeed(c, bar.index, k, 'hook'),
                        length: damp(start),
                    },
                    sr,
                );
            }
        }
    }
}

// --- marimba: an FM mallet ostinato with a bell line on top ----------------

function arrangeMarimba(c: Ctx): void {
    const { score, sr, out } = c;
    const eighths = score.beatsPerBar * 2;
    const mask: boolean[] = [];
    for (let e = 0; e < eighths; e++) {
        mask.push(e === 0 || rand(c.seed, 'mask', e) < (e % 2 === 0 ? 0.8 : 0.5));
    }
    const steps: number[] = [];
    let pos = 2;
    for (let e = 0; e < eighths; e++) {
        steps.push(pos);
        const move = Math.floor(rand(c.seed, 'walk', e) * 5) - 2;
        pos = Math.min(4, Math.max(0, pos + (move === 0 ? 1 : move)));
    }
    let prevVoicing: number[] | null = null;
    let prevBass: number | null = null;
    for (const bar of score.bars) {
        const voicing = voiceChord(bar.chord.triad, 60, 79, prevVoicing);
        prevVoicing = voicing;
        const tones = [voicing[0], voicing[1], voicing[2], voicing[0] + 12, voicing[1] + 12];
        const root = placeNote(bar.chord.root, 45, 57, prevBass);
        prevBass = root;
        if (bar.ending) {
            const level = levelAt(score, bar.startBeat);
            if (level === 'rest') continue;
            const v = VELOCITY[level];
            const start = at(c, bar.startBeat);
            mallet(out.main, start, root, { velocity: v * 0.9, pan: -0.15, hardness: 0.5 }, sr);
            const rollSec = Math.min(1.8, bar.beats * score.secondsPerBeat);
            const strokes = Math.max(1, Math.floor(rollSec * 13));
            for (let s = 0; s < strokes; s++) {
                const fade = 1 - (s / strokes) * 0.75;
                voicing.forEach((m, j) => {
                    const t = start + samples(s / 13 + j * 0.021, sr);
                    mallet(
                        out.main,
                        t,
                        m,
                        {
                            velocity: v * 0.38 * fade,
                            pan: -0.3 + j * 0.3,
                            hardness: 0.35,
                            length: samples(0.25, sr),
                        },
                        sr,
                    );
                });
            }
            const last = start + samples(strokes / 13, sr);
            voicing.forEach((m, j) => {
                mallet(
                    out.main,
                    last + samples(j * 0.02, sr),
                    m,
                    { velocity: v * 0.5, pan: -0.3 + j * 0.3, hardness: 0.4 },
                    sr,
                );
            });
            bell(
                out.air,
                start,
                placeNote(score.key.tonic, 79, 91, null),
                { velocity: 0.35 * v, pan: 0.3 },
                sr,
            );
            continue;
        }
        for (let e = 0; e < bar.beats * 2; e++) {
            const beat = bar.startBeat + e / 2;
            const level = levelAt(score, beat);
            if (level === 'rest') continue;
            const v = VELOCITY[level];
            const hm = human(c, 3, bar.index, e);
            const start = at(c, beat);
            const onBeat = e % 2 === 0;
            const k = e / 2;
            if (
                onBeat &&
                (k === 0 || (level !== 'soft' && k === Math.floor(score.beatsPerBar / 2)))
            ) {
                mallet(
                    out.main,
                    start,
                    k === 0 ? root : placeNote((bar.chord.root + 7) % 12, root, root + 11, root),
                    { velocity: v * 0.85 * hm.vel, pan: -0.15, hardness: 0.45 },
                    sr,
                );
            }
            const e8 = e % eighths;
            let play = mask[e8];
            if (level === 'soft') play = onBeat && mask[e8];
            if (level === 'full' && !play) play = true;
            if (!play) continue;
            const accent = mask[e8] ? 1 : 0.6;
            const m = tones[steps[e8]];
            mallet(
                out.main,
                start + hm.shift,
                m,
                {
                    velocity: v * 0.62 * accent * hm.vel,
                    pan: 0.15 + (steps[e8] - 2) * 0.1,
                    hardness: level === 'full' ? 0.75 : 0.55,
                },
                sr,
            );
        }
        if (levelAt(score, bar.startBeat) === 'full') {
            const notes = melodyNotes(score, bar.chord, 79, 91);
            for (let k = 0; k < bar.beats; k++) {
                if (rand(c.seed, 'bell', bar.index, k) < 0.4) continue;
                const m = notes[Math.floor(rand(c.seed, 'belln', bar.index, k) * notes.length)];
                bell(out.air, at(c, bar.startBeat + k), m, { velocity: 0.3, pan: 0.35 }, sr);
            }
        }
    }
}

// --- pad: held chords, a sub bass and a few bell sparkles -----------------

const PAD_CUTOFF: Record<Dynamic, number> = { rest: 0, soft: 700, medium: 1100, full: 1800 };

function arrangePad(c: Ctx): void {
    const { score, sr, out } = c;
    let prevVoicing: number[] | null = null;
    let prevBass: number | null = null;
    let prevLevel: Dynamic = 'rest';
    for (const bar of score.bars) {
        const level = levelAt(score, bar.startBeat);
        const voicing = voiceChord(bar.chord.color, 55, 76, prevVoicing, 19);
        prevVoicing = voicing;
        const root = placeNote(bar.chord.root, 36, 47, prevBass);
        prevBass = root;
        const start = at(c, bar.startBeat);
        const hold = bar.ending ? score.length - start : barEnd(c, bar) - start;
        const fresh = prevLevel === 'rest';
        prevLevel = level;
        if (level === 'rest') continue;
        const v = VELOCITY[level];
        const attack = fresh
            ? Math.min(samples(1.2, sr), Math.round(hold * 0.6))
            : Math.min(samples(0.35, sr), Math.round(hold * 0.4));
        const release = bar.ending ? samples(0.1, sr) : samples(1.2, sr);
        voicing.forEach((m, j) => {
            pad(
                out.main,
                start,
                m,
                {
                    velocity: v * 0.34,
                    pan: -0.45 + j * 0.3,
                    hold,
                    attack,
                    release,
                    cutoff: PAD_CUTOFF[level],
                    spread: 0.5,
                    seed: noteSeed(c, bar.index, j, 'pad'),
                },
                sr,
            );
        });
        sub(
            out.main,
            start,
            root,
            {
                velocity: v * (level === 'soft' ? 0.25 : 0.4),
                pan: 0,
                hold,
                attack: samples(0.08, sr),
                release: samples(0.4, sr),
            },
            sr,
        );
        if (bar.ending) {
            bell(
                out.air,
                start,
                placeNote(score.key.tonic, 79, 91, null),
                { velocity: 0.4 * v, pan: 0.25 },
                sr,
            );
            continue;
        }
        const notes = melodyNotes(score, bar.chord, 76, 91);
        const chance = level === 'full' ? 0.6 : level === 'medium' ? 0.3 : 0;
        for (let k = 0; k < bar.beats; k++) {
            if (rand(c.seed, 'twinkle', bar.index, k) >= chance) continue;
            const m = notes[Math.floor(rand(c.seed, 'twinklen', bar.index, k) * notes.length)];
            const pan = (rand(c.seed, 'twinklep', bar.index, k) - 0.5) * 1.2;
            bell(out.air, at(c, bar.startBeat + k), m, { velocity: 0.28, pan }, sr);
        }
        if (level === 'full') {
            const arp = voiceChord(bar.chord.triad, 67, 84, null);
            for (let e = 0; e < bar.beats * 2; e++) {
                const m = arp[e % arp.length];
                const hm = human(c, 3, bar.index, e, 'pulse');
                mallet(
                    out.main,
                    at(c, bar.startBeat + e / 2) + hm.shift,
                    m,
                    { velocity: 0.16 * hm.vel, pan: e % 2 === 0 ? -0.3 : 0.3, hardness: 0.3 },
                    sr,
                );
            }
        }
    }
}

export const MASTER: Record<PresetName, MasterSettings> = {
    pluck: { reverbSec: 1.6, sendMain: 0.3, sendAir: 0.6, wet: 0.35, lowpass: 9000 },
    marimba: { reverbSec: 1.9, sendMain: 0.3, sendAir: 0.7, wet: 0.38, lowpass: 12000 },
    pad: { reverbSec: 3.2, sendMain: 0.45, sendAir: 0.85, wet: 0.5, lowpass: 12000 },
};

export function arrange(score: Score, preset: PresetName, out: Arrangement, sr: number): void {
    const c: Ctx = { score, sr, out, seed: hash32(score.seed, 'music', preset) };
    if (preset === 'pluck') arrangePluck(c);
    else if (preset === 'marimba') arrangeMarimba(c);
    else arrangePad(c);
}
