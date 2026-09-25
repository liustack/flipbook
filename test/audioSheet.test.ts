// A score the model writes (audio.mode "score"): its schema, and how it
// expands into notes on the beat grid. No browser.
import { describe, expect, it } from 'vitest';
import { buildScore } from '../src/engine/audioScore.ts';
import {
    expandSheet,
    INSTRUMENTS,
    parseChord,
    parseNote,
    type SheetV1,
} from '../src/engine/audioSheet.ts';
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
    cues: [{ id: 'bell', scene: 'outro', beat: 0, kind: 'sfx', sfx: 'ding' }],
    audio: {
        mode: 'score',
        key: 'Dm',
        score: {
            room: 'hall',
            instruments: {
                keys: 'piano',
                lead: { instrument: 'flute', volume: 0.8, pan: 0.2 },
                low: 'bass',
                beat: 'drums',
            },
            scenes: {
                intro: { level: 'soft', chords: ['Dm'], play: { keys: 'hold' } },
                main: {
                    chords: ['Gm', 'A7'],
                    play: {
                        keys: 'arpeggio',
                        low: 'root-fifth',
                        lead: ['D5 F5:0.5 A5:0.5 G5:2', 'E5:2 C#5 ~'],
                        beat: { kick: 'x...x...', hat: '..x...X.' },
                    },
                },
                outro: { level: 'soft', chords: ['Dm'], play: { keys: 'hold', lead: ['D5:4'] } },
            },
        },
    },
});

function scoreOf(t: Record<string, unknown>): Record<string, unknown> {
    return (t.audio as { score: Record<string, unknown> }).score;
}

function sceneOf(t: Record<string, unknown>, id: string): Record<string, unknown> {
    return (scoreOf(t).scenes as Record<string, Record<string, unknown>>)[id];
}

function playOf(t: Record<string, unknown>, id: string): Record<string, unknown> {
    return sceneOf(t, id).play as Record<string, unknown>;
}

function errorsFor(mutate: (t: Record<string, unknown>) => void) {
    const t = base();
    mutate(t);
    return validateTimeline(t).errors;
}

function firstError(mutate: (t: Record<string, unknown>) => void) {
    const errors = errorsFor(mutate);
    expect(errors.length, 'expected an error').toBeGreaterThan(0);
    return errors[0];
}

function plan(t: Record<string, unknown> = base()) {
    const tl = resolveTimeline(t as unknown as TimelineV1);
    return expandSheet(tl.audio.score as SheetV1, tl);
}

describe('score schema', () => {
    it('accepts a full score', () => {
        expect(validateTimeline(base()).errors).toEqual([]);
    });

    it('needs a score object in score mode and nowhere else', () => {
        expect(firstError((t) => delete (t.audio as Record<string, unknown>).score).path).toBe(
            '$.audio.score',
        );
        const other = firstError((t) => {
            t.audio = { mode: 'none', score: {} };
        });
        expect(other.path).toBe('$.audio.score');
        expect(other.message).toContain('"mode": "score"');
        const dyn = firstError((t) => {
            (t.audio as Record<string, unknown>).dynamics = { intro: 'soft' };
        });
        expect(dyn.path).toBe('$.audio.dynamics');
        expect(firstError((t) => (scoreOf(t).tempo = 90)).path).toBe('$.audio.score.tempo');
    });

    it('names the path of instrument errors', () => {
        const bad = firstError(
            (t) => ((scoreOf(t).instruments as Record<string, unknown>).lead = 'violin'),
        );
        expect(bad.path).toBe('$.audio.score.instruments.lead');
        expect(bad.message).toContain('"piano"');
        expect(bad.message).toContain('"violin"');
        expect(
            firstError(
                (t) =>
                    ((scoreOf(t).instruments as Record<string, unknown>).lead = {
                        instrument: 'flute',
                        volume: 3,
                    }),
            ).path,
        ).toBe('$.audio.score.instruments.lead.volume');
        expect(firstError((t) => (scoreOf(t).instruments = {})).path).toBe(
            '$.audio.score.instruments',
        );
        expect(firstError((t) => (scoreOf(t).room = 'cave')).path).toBe('$.audio.score.room');
    });

    it('names the path of scene errors', () => {
        const unknown = firstError((t) => {
            (scoreOf(t).scenes as Record<string, unknown>).verse = { chords: ['C'] };
        });
        expect(unknown.path).toBe('$.audio.score.scenes.verse');
        expect(unknown.message).toContain('intro, main, outro');
        expect(firstError((t) => (sceneOf(t, 'main').level = 'loud')).path).toBe(
            '$.audio.score.scenes.main.level',
        );
        const part = firstError((t) => (playOf(t, 'main').violin = 'hold'));
        expect(part.path).toBe('$.audio.score.scenes.main.play.violin');
        expect(part.message).toContain('keys, lead, low, beat');
    });

    it('checks chords', () => {
        const bad = firstError((t) => (sceneOf(t, 'main').chords = ['Gm', 'Hm']));
        expect(bad.path).toBe('$.audio.score.scenes.main.chords[1]');
        expect(bad.message).toContain('"Hm"');
        const long = firstError((t) => (sceneOf(t, 'main').chords = ['Gm', 'A', 'Dm']));
        expect(long.path).toBe('$.audio.score.scenes.main.chords');
        expect(long.message).toContain('has 3 bars, scene "main" has 2');
        const sum = firstError((t) => (sceneOf(t, 'main').chords = ['Gm:3 C:2', 'A']));
        expect(sum.path).toBe('$.audio.score.scenes.main.chords[0]');
        expect(sum.message).toContain('adds up to 5 beats');
        const pattern = firstError((t) => delete sceneOf(t, 'main').chords);
        expect(pattern.path).toBe('$.audio.score.scenes.main.play.keys');
        expect(pattern.message).toContain('chords');
    });

    it('checks every bar of notes', () => {
        const short = firstError((t) => (playOf(t, 'main').lead = ['D5 F5 A5', 'E5:4']));
        expect(short.path).toBe('$.audio.score.scenes.main.play.lead[0]');
        expect(short.message).toContain('adds up to 3 beats');
        expect(short.message).toContain('4');
        const note = firstError((t) => (playOf(t, 'main').lead = ['H5:4']));
        expect(note.path).toBe('$.audio.score.scenes.main.play.lead[0]');
        expect(note.message).toContain('"H5"');
        const range = firstError((t) => (playOf(t, 'main').lead = ['G7:4']));
        expect(range.message).toContain('flute');
        expect(range.message).toContain('C4 to C7');
        const mono = firstError((t) => (playOf(t, 'main').lead = ['D5+F5:4']));
        expect(mono.message).toContain('one note at a time');
        const tie = firstError((t) => (playOf(t, 'intro').lead = ['~:4']));
        expect(tie.path).toBe('$.audio.score.scenes.intro.play.lead[0]');
        const zero = firstError((t) => (playOf(t, 'main').lead = ['D5:0 E5:4']));
        expect(zero.path).toBe('$.audio.score.scenes.main.play.lead[0]');
        expect(firstError((t) => (playOf(t, 'main').lead = 'swing')).path).toBe(
            '$.audio.score.scenes.main.play.lead',
        );
    });

    it('keeps drums and pitched parts apart', () => {
        const drumsPattern = firstError((t) => (playOf(t, 'main').beat = 'pulse'));
        expect(drumsPattern.path).toBe('$.audio.score.scenes.main.play.beat');
        const piece = firstError((t) => (playOf(t, 'main').beat = { cowbell: 'x...' }));
        expect(piece.path).toBe('$.audio.score.scenes.main.play.beat.cowbell');
        expect(piece.message).toContain('"kick"');
        const steps = firstError((t) => (playOf(t, 'main').beat = { kick: 'x-x-' }));
        expect(steps.path).toBe('$.audio.score.scenes.main.play.beat.kick');
        const drumsOnPiano = firstError((t) => (playOf(t, 'main').keys = { kick: 'x...' }));
        expect(drumsOnPiano.path).toBe('$.audio.score.scenes.main.play.keys');
    });
});

describe('notes and chords', () => {
    it('parses scientific pitch names', () => {
        expect(parseNote('C4')).toBe(60);
        expect(parseNote('A4')).toBe(69);
        expect(parseNote('F#3')).toBe(54);
        expect(parseNote('Bb5')).toBe(82);
        expect(parseNote('Cb4')).toBe(59);
        expect(parseNote('H4')).toBeNull();
        expect(parseNote('C')).toBeNull();
    });

    it('parses chord symbols', () => {
        expect(parseChord('C')).toEqual({ root: 0, bass: 0, tones: [0, 4, 7] });
        expect(parseChord('Am')).toEqual({ root: 9, bass: 9, tones: [9, 0, 4] });
        expect(parseChord('G7')).toEqual({ root: 7, bass: 7, tones: [7, 11, 2, 5] });
        expect(parseChord('Fmaj7')?.tones).toEqual([5, 9, 0, 4]);
        expect(parseChord('C/E')).toEqual({ root: 0, bass: 4, tones: [0, 4, 7] });
        expect(parseChord('Bbsus4')?.tones).toEqual([10, 3, 5]);
        expect(parseChord('Hm')).toBeNull();
        expect(parseChord('Cmaj13')).toBeNull();
    });

    it('lists every instrument with a range', () => {
        for (const [name, info] of Object.entries(INSTRUMENTS)) {
            if (name === 'drums') continue;
            expect(info.range[0], name).toBeLessThan(info.range[1]);
        }
        expect(Object.keys(INSTRUMENTS)).toHaveLength(14);
    });
});

describe('expandSheet', () => {
    it('puts written notes on the beat grid', () => {
        const p = plan();
        const lead = p.parts.findIndex((part) => part.name === 'lead');
        const notes = p.notes.filter((n) => n.part === lead);
        // main starts at beat 4; bar 2 of main at beat 8; outro at beat 12.
        expect(notes.map((n) => [n.beat, n.midi, n.beats])).toEqual([
            [4, 74, 1],
            [5, 77, 0.5],
            [5.5, 81, 0.5],
            [6, 79, 2],
            [8, 76, 2],
            [10, 73, 2],
            [12, 74, 4],
        ]);
        expect(p.parts[lead]).toMatchObject({ instrument: 'flute', volume: 0.8, pan: 0.2 });
        expect(p.room).toBe('hall');
    });

    it('repeats short lists over the scene', () => {
        const t = base();
        sceneOf(t, 'main').chords = ['Gm'];
        playOf(t, 'main').lead = ['D5:4'];
        const p = plan(t);
        const lead = p.parts.findIndex((part) => part.name === 'lead');
        expect(p.notes.filter((n) => n.part === lead && n.beat < 12).map((n) => n.beat)).toEqual([
            4, 8,
        ]);
        const low = p.parts.findIndex((part) => part.name === 'low');
        const bass = p.notes.filter((n) => n.part === low);
        // root-fifth on Gm: G on beats 4 and 8, D at the middle of each bar.
        expect(bass.map((n) => [n.beat, n.midi % 12])).toEqual([
            [4, 7],
            [6, 2],
            [8, 7],
            [10, 2],
        ]);
    });

    it('splits a bar between chords and restarts held patterns on each chord', () => {
        const t = base();
        sceneOf(t, 'intro').chords = ['Dm:3 A7:1'];
        const p = plan(t);
        const keys = p.parts.findIndex((part) => part.name === 'keys');
        const intro = p.notes.filter((n) => n.part === keys && n.beat < 4);
        const onsets = [...new Set(intro.map((n) => n.beat))];
        expect(onsets).toEqual([0, 3]);
        expect(
            intro
                .filter((n) => n.beat === 0)
                .map((n) => n.midi % 12)
                .sort(),
        ).toEqual([2, 5, 9]);
        expect(
            intro
                .filter((n) => n.beat === 3)
                .map((n) => n.midi % 12)
                .sort((a, b) => a - b),
        ).toEqual([1, 4, 7, 9]);
        expect(intro.every((n) => n.beat + n.beats <= 4 + 1e-9)).toBe(true);
    });

    it('plays drum steps', () => {
        const p = plan();
        const beat = p.parts.findIndex((part) => part.name === 'beat');
        const hits = p.hits.filter((h) => h.part === beat);
        expect(hits.map((h) => [h.piece, h.beat])).toEqual([
            ['kick', 4],
            ['hat', 5],
            ['kick', 6],
            ['hat', 7],
            ['kick', 8],
            ['hat', 9],
            ['kick', 10],
            ['hat', 11],
        ]);
        const accent = hits.find((h) => h.piece === 'hat' && h.beat === 7);
        const plain = hits.find((h) => h.piece === 'hat' && h.beat === 5);
        expect(accent?.velocity).toBeGreaterThan(plain?.velocity ?? 1);
    });

    it('keeps notes inside the instrument and the chord', () => {
        const p = plan();
        for (const note of p.notes) {
            const part = p.parts[note.part];
            const [low, high] = INSTRUMENTS[part.instrument].range;
            expect(note.midi, `${part.name} at ${note.beat}`).toBeGreaterThanOrEqual(low);
            expect(note.midi, `${part.name} at ${note.beat}`).toBeLessThanOrEqual(high);
        }
        const keys = p.parts.findIndex((part) => part.name === 'keys');
        // arpeggio over Gm in bar 1 of main: only G, Bb and D.
        const arp = p.notes.filter((n) => n.part === keys && n.beat >= 4 && n.beat < 8);
        expect(arp).toHaveLength(8);
        expect(new Set(arp.map((n) => n.midi % 12))).toEqual(new Set([7, 10, 2]));
    });

    it('cuts a bar short at the end of a scene with part of a bar', () => {
        const t = base();
        (t.scenes as { id: string; bars: number }[])[2].bars = 0.5;
        playOf(t, 'outro').lead = ['D5:1 E5:1 F5:2'];
        const p = plan(t);
        const lead = p.parts.findIndex((part) => part.name === 'lead');
        const outro = p.notes.filter((n) => n.part === lead && n.beat >= 12);
        expect(outro.map((n) => [n.beat, n.beats])).toEqual([
            [12, 1],
            [13, 1],
        ]);
        expect(validateTimeline(t).errors).toEqual([]);
    });

    it('is the same every time and rides on the score', () => {
        expect(plan()).toEqual(plan());
        const tl = resolveTimeline(base() as unknown as TimelineV1);
        const score = buildScore(tl);
        expect(score.preset).toBeNull();
        expect(score.sheet).toEqual(plan());
        expect(score.key.name).toBe('Dm');
    });

    it('plans no sheet outside score mode', () => {
        const t = base();
        t.audio = { mode: 'preset', preset: 'pad' };
        expect(buildScore(resolveTimeline(t as unknown as TimelineV1)).sheet).toBeNull();
    });
});
