// Audio planning and the audio part of the timeline schema. No browser.
import { describe, expect, it } from 'vitest';
import {
    buildScore,
    chordOf,
    frameSample,
    levelAt,
    PROGRESSION_COUNT,
    PROGRESSIONS,
    parseKey,
    placeNote,
    progressionChords,
    voiceChord,
} from '../src/engine/audioScore.ts';
import { validateTimeline } from '../src/engine/timeline.ts';
import { resolveTimeline, type TimelineV1 } from '../src/engine/timelineResolve.ts';

const base = (): Record<string, unknown> => ({
    version: 1,
    width: 640,
    height: 360,
    fps: 24,
    seed: 3,
    bpm: 120,
    beatsPerBar: 4,
    scenes: [
        { id: 'intro', bars: 1 },
        { id: 'main', bars: 2 },
        { id: 'outro', bars: 1, hold: true },
    ],
    cues: [
        { id: 'hit', scene: 'main', beat: 1, kind: 'sfx', sfx: 'drop' },
        { id: 'bell', scene: 'outro', beat: 0, kind: 'sfx', sfx: 'ding' },
    ],
    audio: { mode: 'preset', preset: 'pluck', key: 'D', progression: 1 },
});

function errorsFor(mutate: (t: Record<string, unknown>) => void) {
    const t = base();
    mutate(t);
    return validateTimeline(t).errors;
}

function audioOf(t: Record<string, unknown>): Record<string, unknown> {
    return t.audio as Record<string, unknown>;
}

describe('audio schema', () => {
    it('accepts presets, keys, progressions and dynamics', () => {
        expect(validateTimeline(base()).errors).toEqual([]);
        const full = errorsFor((t) => {
            t.audio = {
                mode: 'preset',
                preset: 'pad',
                key: 'Bbm',
                progression: PROGRESSION_COUNT - 1,
                dynamics: { intro: 'soft', main: 'full', outro: 'rest' },
            };
        });
        expect(full).toEqual([]);
    });

    it('names the JSON path of every audio error', () => {
        expect(errorsFor((t) => (audioOf(t).preset = 'piano'))[0].path).toBe('$.audio.preset');
        expect(errorsFor((t) => delete audioOf(t).preset)[0].path).toBe('$.audio.preset');
        expect(errorsFor((t) => (audioOf(t).key = 'H'))[0].path).toBe('$.audio.key');
        expect(errorsFor((t) => (audioOf(t).progression = PROGRESSION_COUNT))[0].path).toBe(
            '$.audio.progression',
        );
        expect(errorsFor((t) => (audioOf(t).dynamics = { nope: 'soft' }))[0].path).toBe(
            '$.audio.dynamics.nope',
        );
        expect(errorsFor((t) => (audioOf(t).dynamics = { main: 'loud' }))[0].path).toBe(
            '$.audio.dynamics.main',
        );
        expect(errorsFor((t) => (audioOf(t).extra = 1))[0].path).toBe('$.audio.extra');
    });

    it('keeps each field to the mode that uses it', () => {
        const offset = errorsFor((t) => (audioOf(t).bpmOffset = 0.5));
        expect(offset[0].path).toBe('$.audio.bpmOffset');
        expect(offset[0].message).toContain('"mode": "file"');
        const preset = errorsFor((t) => (t.audio = { mode: 'none', preset: 'pluck' }));
        expect(preset[0].path).toBe('$.audio.preset');
        const dyn = errorsFor((t) => (t.audio = { mode: 'file', file: 'a.wav', dynamics: {} }));
        expect(dyn[0].path).toBe('$.audio.dynamics');
        expect(errorsFor((t) => (t.audio = { mode: 'none', key: 'E' }))).toEqual([]);
        expect(
            errorsFor((t) => (t.audio = { mode: 'file', file: 'm.wav', bpmOffset: 0.2 })),
        ).toEqual([]);
    });

    it('only accepts the synthesized effect names', () => {
        const bad = errorsFor((t) => ((t.cues as { sfx: string }[])[0].sfx = 'tap'));
        expect(bad[0].path).toBe('$.cues[0].sfx');
        expect(bad[0].message).toContain('"paper", "drop", "ding", "sweep"');
    });
});

describe('keys and chords', () => {
    it('parses keys', () => {
        expect(parseKey('C')).toEqual({ name: 'C', tonic: 0, minor: false });
        expect(parseKey('F#')).toEqual({ name: 'F#', tonic: 6, minor: false });
        expect(parseKey('Bbm')).toEqual({ name: 'Bbm', tonic: 10, minor: true });
        expect(parseKey('Cb').tonic).toBe(11);
        expect(() => parseKey('H')).toThrow();
    });

    it('builds diatonic chords in both modes', () => {
        const d = parseKey('D');
        expect(chordOf(d, 'vi').triad).toEqual([11, 2, 6]);
        expect(chordOf(d, 'IV').color).toEqual([7, 11, 2, 9]);
        const am = parseKey('Am');
        expect(chordOf(am, 'V').triad).toEqual([4, 8, 11]);
        expect(chordOf(am, 'iv').color).toEqual([2, 5, 9, 0]);
        expect(PROGRESSIONS.major.length).toBe(PROGRESSIONS.minor.length);
        for (let i = 0; i < PROGRESSION_COUNT; i++) {
            expect(progressionChords(d, i)).toHaveLength(4);
            expect(progressionChords(am, i)).toHaveLength(4);
        }
    });

    it('voices chords inside the range with small moves', () => {
        const c = parseKey('C');
        const first = voiceChord(chordOf(c, 'I').triad, 55, 72, null);
        expect(first.map((m) => m % 12).sort()).toEqual([0, 4, 7]);
        expect(Math.min(...first)).toBeGreaterThanOrEqual(55);
        expect(Math.max(...first)).toBeLessThanOrEqual(72);
        const next = voiceChord(chordOf(c, 'V').triad, 55, 72, first);
        const moved = next.reduce((sum, m, i) => sum + Math.abs(m - first[i]), 0);
        expect(moved).toBeLessThanOrEqual(5);
        expect(placeNote(7, 40, 52, null)).toBe(43);
        expect(placeNote(2, 40, 52, 49)).toBe(50);
    });
});

describe('buildScore', () => {
    const tl = resolveTimeline(base() as unknown as TimelineV1);

    it('lays one chord per bar and ends on the home chord', () => {
        const score = buildScore(tl);
        expect(score.bars).toHaveLength(4);
        expect(score.bars.map((b) => b.chord.symbol)).toEqual(['I', 'vi', 'IV', 'I']);
        expect(score.bars[3].ending).toBe(true);
        expect(score.length).toBe(frameSample(tl.frameCount, tl.fps));
        expect(score.length).toBe(8 * 48000);
    });

    it('puts each effect peak on its cue frame', () => {
        const score = buildScore(tl);
        expect(score.sfx).toEqual([
            { id: 'hit', name: 'drop', frame: 60, sample: 120000 },
            { id: 'bell', name: 'ding', frame: 144, sample: 288000 },
        ]);
    });

    it('reads the level of each scene', () => {
        const t = base();
        audioOf(t).dynamics = { main: 'full', outro: 'rest' };
        const score = buildScore(resolveTimeline(t as unknown as TimelineV1));
        expect(levelAt(score, 0)).toBe('medium');
        expect(levelAt(score, 4)).toBe('full');
        expect(levelAt(score, 11.9)).toBe('full');
        expect(levelAt(score, 12)).toBe('rest');
    });

    it('plans no music outside preset mode', () => {
        const t = base();
        t.audio = { mode: 'none' };
        const score = buildScore(resolveTimeline(t as unknown as TimelineV1));
        expect(score.preset).toBeNull();
        expect(score.sfx).toHaveLength(2);
    });
});
