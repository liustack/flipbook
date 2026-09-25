import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { loadTimeline, validateTimeline } from '../src/engine/timeline.ts';
import { resolveTimeline, sceneAtFrame, type TimelineV1 } from '../src/engine/timelineResolve.ts';
import { cueProgress } from '../src/runtime/core/timeline.ts';
import { repoRoot, tempDir } from './helpers.ts';

const base = (): Record<string, unknown> => ({
    version: 1,
    width: 1920,
    height: 1080,
    fps: 24,
    seed: 1,
    bpm: 96,
    beatsPerBar: 4,
    scenes: [
        { id: 'a', bars: 1 },
        { id: 'b', bars: 1, hold: true },
    ],
    cues: [{ id: 'title', scene: 'b', beat: 1, kind: 'text', text: '你好', settleBeats: 2 }],
});

function errorsFor(mutate: (t: Record<string, unknown>) => void) {
    const t = base();
    mutate(t);
    return validateTimeline(t).errors;
}

describe('validateTimeline', () => {
    it('accepts the base timeline', () => {
        expect(validateTimeline(base()).errors).toEqual([]);
    });

    it('names the JSON path of every error', () => {
        expect(errorsFor((t) => (t.width = 1921))[0].path).toBe('$.width');
        expect(errorsFor((t) => (t.fps = 0))[0].path).toBe('$.fps');
        expect(errorsFor((t) => (t.version = 2))[0].path).toBe('$.version');
        expect(errorsFor((t) => ((t.scenes as { bars: number }[])[1].bars = -1))[0].path).toBe(
            '$.scenes[1].bars',
        );
        expect(errorsFor((t) => ((t.cues as { scene: string }[])[0].scene = 'zzz'))[0].path).toBe(
            '$.cues[0].scene',
        );
        expect(errorsFor((t) => ((t.cues as { beat: number }[])[0].beat = 4))[0].path).toBe(
            '$.cues[0].beat',
        );
        expect(errorsFor((t) => (t.extra = true))[0].path).toBe('$.extra');
        expect(errorsFor((t) => (t.audio = { mode: 'loud' }))[0].path).toBe('$.audio.mode');
        expect(errorsFor((t) => (t.audio = { mode: 'file', file: '../x.wav' }))[0].path).toBe(
            '$.audio.file',
        );
    });

    it('requires text on text cues and sfx on sfx cues', () => {
        const noText = errorsFor((t) => delete (t.cues as Record<string, unknown>[])[0].text);
        expect(noText[0].path).toBe('$.cues[0].text');
        const sfx = errorsFor((t) => (t.cues = [{ id: 'hit', scene: 'a', beat: 0, kind: 'sfx' }]));
        expect(sfx[0].path).toBe('$.cues[0].sfx');
    });

    it('rejects duplicate ids and whole-beat violations', () => {
        const dup = errorsFor((t) => (t.scenes as { id: string }[]).push({ id: 'a' }));
        expect(dup.some((e) => e.message.includes('duplicates'))).toBe(true);
        const partial = errorsFor((t) => ((t.scenes as { bars: number }[])[0].bars = 0.3));
        expect(partial[0].message).toContain('whole beats');
    });

    it('caps the duration at three minutes', () => {
        const long = errorsFor((t) => {
            t.scenes = [{ id: 'a', bars: 80 }];
            delete t.cues;
        });
        expect(long[0].path).toBe('$.scenes');
        expect(long[0].message).toContain('180');
    });
});

describe('audio files in the timeline', () => {
    const fileCue =
        (extra: Record<string, unknown> = {}) =>
        (t: Record<string, unknown>) => {
            t.cues = [{ id: 'turn', scene: 'a', beat: 1, kind: 'sfx', ...extra }];
        };

    it('takes an sfx cue with a file instead of a built-in name, never both', () => {
        expect(errorsFor(fileCue({ file: 'assets/page-turn.mp3' }))).toEqual([]);
        const both = errorsFor(fileCue({ sfx: 'paper', file: 'assets/page-turn.mp3' }));
        expect(both.map((e) => e.path)).toEqual(['$.cues[0].file']);
        const neither = errorsFor(fileCue());
        expect(neither[0].path).toBe('$.cues[0].sfx');
        expect(neither[0].message).toContain('"file"');
        for (const file of ['../x.wav', '/tmp/x.wav', '']) {
            expect(errorsFor(fileCue({ file }))[0].path).toBe('$.cues[0].file');
        }
        const onText = errorsFor((t) => {
            (t.cues as Record<string, unknown>[])[0].file = 'assets/x.wav';
        });
        expect(onText[0].path).toBe('$.cues[0].file');
    });

    it('takes offset, fadeIn and fadeOut with mode file only', () => {
        const file = { mode: 'file', file: 'assets/song.ogg' };
        expect(
            errorsFor((t) => (t.audio = { ...file, offset: 12.5, fadeIn: 0.5, fadeOut: 2 })),
        ).toEqual([]);
        expect(errorsFor((t) => (t.audio = { ...file, offset: -1 }))[0].path).toBe(
            '$.audio.offset',
        );
        expect(errorsFor((t) => (t.audio = { ...file, fadeIn: 31 }))[0].path).toBe(
            '$.audio.fadeIn',
        );
        const twice = errorsFor((t) => (t.audio = { ...file, offset: 3, bpmOffset: 0.5 }));
        expect(twice.map((e) => e.path)).toEqual(['$.audio.offset']);
        const preset = errorsFor(
            (t) => (t.audio = { mode: 'preset', preset: 'pluck', fadeOut: 1 }),
        );
        expect(preset.map((e) => e.path)).toEqual(['$.audio.fadeOut']);
        // The base timeline lasts 5 s.
        const tooLong = errorsFor((t) => (t.audio = { ...file, fadeIn: 3, fadeOut: 3 }));
        expect(tooLong.map((e) => e.path)).toEqual(['$.audio.fadeOut']);
    });

    function composition(timeline: (t: Record<string, unknown>) => void): string {
        const dir = tempDir('timeline-audio');
        const t = base();
        timeline(t);
        fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(t));
        fs.mkdirSync(path.join(dir, 'assets'));
        fs.writeFileSync(path.join(dir, 'assets', 'tap.wav'), 'RIFF');
        fs.writeFileSync(path.join(dir, 'assets', 'song.ogg'), 'OggS');
        return dir;
    }
    const writeSources = (dir: string, sources: unknown) =>
        fs.writeFileSync(path.join(dir, 'assets', 'SOURCES.json'), JSON.stringify(sources));

    it('needs every audio file listed with its source and license in assets/SOURCES.json', () => {
        const dir = composition((t) => {
            fileCue({ file: 'assets/tap.wav' })(t);
            t.audio = { mode: 'file', file: 'assets/song.ogg' };
        });
        const none = loadTimeline(dir, false).findings;
        expect(none.map((f) => [f.code, f.element, f.detail?.path])).toEqual([
            ['audio-unlicensed', 'assets/song.ogg', '$.audio.file'],
            ['audio-unlicensed', 'assets/tap.wav', '$.cues[0].file'],
        ]);

        writeSources(dir, {
            'song.ogg': { source: 'https://commons.wikimedia.org/x', license: 'cc0' },
            'tap.wav': { source: 'https://freesound.org/x' },
        });
        const partial = loadTimeline(dir, false).findings;
        expect(partial.map((f) => f.element)).toEqual(['assets/tap.wav']);
        expect(partial[0].message).toContain('license');

        writeSources(dir, {
            'song.ogg': { source: 'https://commons.wikimedia.org/x', license: 'cc0' },
            'tap.wav': { source: 'https://freesound.org/x', license: 'cc0' },
        });
        const loaded = loadTimeline(dir, false);
        expect(loaded.findings).toEqual([]);
        expect(loaded.resolved?.cues[0]).toMatchObject({ kind: 'sfx', file: 'assets/tap.wav' });

        fs.writeFileSync(path.join(dir, 'assets', 'SOURCES.json'), '{ broken');
        expect(loadTimeline(dir, false).findings[0].code).toBe('audio-unlicensed');
    });

    it('reports a missing effect file as timeline-invalid at its cue', () => {
        const dir = composition(fileCue({ file: 'assets/nope.wav' }));
        const findings = loadTimeline(dir, false).findings;
        expect(findings.map((f) => [f.code, f.detail?.path])).toEqual([
            ['timeline-invalid', '$.cues[0].file'],
        ]);
    });
});

describe('resolveTimeline', () => {
    it('turns beats into seconds and frames', () => {
        const r = resolveTimeline(base() as unknown as TimelineV1);
        expect(r.secondsPerBeat).toBeCloseTo(0.625);
        expect(r.durationSec).toBe(5);
        expect(r.frameCount).toBe(120);
        expect(r.scenes.map((s) => [s.startFrame, s.endFrame])).toEqual([
            [0, 60],
            [60, 120],
        ]);
        const cue = r.cues[0];
        expect(cue.absBeat).toBe(5);
        expect(cue.time).toBeCloseTo(3.125);
        expect(cue.frame).toBe(75);
        expect(cue.settleTime).toBeCloseTo(4.375);
        expect(cue.settleFrame).toBe(105);
        expect(sceneAtFrame(r, 59).id).toBe('a');
        expect(sceneAtFrame(r, 60).id).toBe('b');
    });

    it('matches the hello example', () => {
        const dir = tempDir('timeline');
        fs.copyFileSync(
            path.join(repoRoot, 'examples/hello/timeline.json'),
            path.join(dir, 'timeline.json'),
        );
        const loaded = loadTimeline(dir);
        const expected = JSON.parse(
            fs.readFileSync(path.join(repoRoot, 'examples/hello/expected.json'), 'utf-8'),
        );
        expect(loaded.findings).toEqual([]);
        expect(loaded.resolved?.frameCount).toBe(expected.frames);
        expect(loaded.resolved?.durationSec).toBe(expected.durationSec);
        expect(fs.existsSync(path.join(dir, '.flipbook', 'timeline.resolved.json'))).toBe(true);
    });

    it('reports a missing or broken file as findings', () => {
        const dir = tempDir('timeline-missing');
        expect(loadTimeline(dir).findings[0].code).toBe('timeline-missing');
        fs.writeFileSync(path.join(dir, 'timeline.json'), '{ nope');
        expect(loadTimeline(dir).findings[0].code).toBe('timeline-invalid');
    });
});

describe('settle contract between the resolver and cueProgress', () => {
    const settleCases: [string, number | undefined][] = [
        ['omitted', undefined],
        ['zero', 0],
        ['two beats', 2],
    ];
    for (const [name, settleBeats] of settleCases) {
        it(`settleBeats ${name}: the text is fully in at the frame check samples`, () => {
            const t = base();
            const cue: Record<string, unknown> = {
                id: 'x',
                scene: 'a',
                beat: 1,
                kind: 'text',
                text: '字',
            };
            if (settleBeats !== undefined) cue.settleBeats = settleBeats;
            t.cues = [cue];
            expect(validateTimeline(t).errors).toEqual([]);
            const r = resolveTimeline(t as unknown as TimelineV1);
            const c = r.cues[0];
            expect(cueProgress(r, c.settleFrame / r.fps, 'x')).toBe(1);
            if (c.settleFrame > c.frame) {
                expect(cueProgress(r, c.frame / r.fps, 'x')).toBe(0);
                expect(cueProgress(r, (c.settleFrame - 1) / r.fps, 'x')).toBeLessThan(1);
            }
        });
    }
});

describe('text cues settle inside their scene', () => {
    const twoScenes = (cue: Record<string, unknown>): Record<string, unknown> => ({
        version: 1,
        width: 640,
        height: 360,
        fps: 24,
        seed: 1,
        bpm: 120,
        beatsPerBar: 4,
        scenes: [
            { id: 'a', bars: 1 },
            { id: 'b', bars: 1 },
        ],
        cues: [{ id: 'x', scene: 'a', kind: 'text', text: '字', ...cue }],
    });

    it('rejects a cue that settles when the next scene is already on screen', () => {
        const errors = validateTimeline(twoScenes({ beat: 3, settleBeats: 1 })).errors;
        expect(errors.map((e) => e.path)).toEqual(['$.cues[0].settleBeats']);
        expect(errors[0].message).toContain('scene "a"');
    });

    it('rejects a cue too close to the cut to show even without settling', () => {
        const errors = validateTimeline(twoScenes({ beat: 3.99 })).errors;
        expect(errors.map((e) => e.path)).toEqual(['$.cues[0].beat']);
    });

    it('samples a frame of the cue scene, where cueProgress is 1', () => {
        const t = twoScenes({ beat: 2, settleBeats: 1.5 });
        expect(validateTimeline(t).errors).toEqual([]);
        const r = resolveTimeline(t as unknown as TimelineV1);
        const c = r.cues[0];
        expect(sceneAtFrame(r, c.settleFrame).id).toBe('a');
        expect(cueProgress(r, c.settleFrame / r.fps, 'x')).toBe(1);
    });
});
