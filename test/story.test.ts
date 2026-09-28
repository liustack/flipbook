import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import {
    ENDING_AFTER_WORDS_SEC,
    loadStory,
    READ_UNITS_PER_SEC,
    readingUnits,
    validateStory,
} from '../src/engine/story.ts';
import { validateTimeline } from '../src/engine/timeline.ts';
import { resolveTimeline } from '../src/engine/timelineResolve.ts';
import { cleanTemps, tempDir } from './helpers.ts';

afterAll(cleanTemps);

// 120 bpm, 4 beats a bar: sun 2 bars (8 beats, 4 s), rain 1 bar, snow 1 bar. 8 s at 24 fps.
const TIMELINE = {
    version: 1,
    width: 320,
    height: 180,
    fps: 24,
    seed: 1,
    bpm: 120,
    beatsPerBar: 4,
    scenes: [
        { id: 'sun', bars: 2 },
        { id: 'rain', bars: 1 },
        { id: 'snow', bars: 1 },
    ],
    cues: [
        { id: 'title', scene: 'sun', beat: 1, kind: 'text', text: '纸船' },
        { id: 'drop', scene: 'rain', beat: 0, kind: 'sfx', sfx: 'drop' },
        { id: 'end', scene: 'snow', beat: 1, kind: 'text', text: '撑过去' },
    ],
};

function timeline() {
    const { timeline: t, errors } = validateTimeline(structuredClone(TIMELINE));
    expect(errors).toEqual([]);
    return resolveTimeline(t as NonNullable<typeof t>);
}

function story(edit?: (s: Record<string, unknown> & { beats: Record<string, unknown>[] }) => void) {
    const s = {
        version: 1,
        idea: 'A paper boat soaks through in the rain and is lifted out of the snow',
        leave: 'Small things make it through',
        subject: 'the paper boat',
        device: {
            what: 'the boat stays on one line while the weather changes behind it',
            why: 'the eye stays on the boat',
        },
        beats: [
            {
                id: 'calm',
                role: 'opening',
                at: 'sun',
                change: { from: 'the boat drifts in sun', to: 'clouds gather' },
                text: ['纸船'],
            },
            {
                id: 'soak',
                role: 'turn',
                at: 'rain',
                change: { from: 'the first drop hits', to: 'the boat sags' },
                sound: 'drop',
            },
            {
                id: 'lift',
                role: 'resolution',
                at: { scene: 'snow', beat: 1 },
                change: { from: 'snow covers it', to: 'a hand lifts it' },
                text: ['撑过去'],
                callback: 'calm',
            },
        ],
    } as Record<string, unknown> & { beats: Record<string, unknown>[] };
    edit?.(s);
    return s;
}

const codesOf = (input: unknown) => validateStory(input, timeline()).problems.map((p) => p.code);

describe('story.json', () => {
    it('places the beats on the timeline, each lasting until the next starts', () => {
        const { problems, story: resolved } = validateStory(story(), timeline());
        expect(problems).toEqual([]);
        const beats = resolved?.beats ?? [];
        expect(beats.map((b) => [b.id, b.startBeat, b.endBeat])).toEqual([
            ['calm', 0, 8],
            ['soak', 8, 13],
            ['lift', 13, 16],
        ]);
        expect(beats.map((b) => [b.startFrame, b.endFrame])).toEqual([
            [0, 96],
            [96, 156],
            [156, 192],
        ]);
        expect(beats[1].sound).toBe('drop');
        expect(beats[2].callback).toBe('calm');
        expect(beats.map((b) => b.hold)).toEqual([false, false, false]);
    });

    it('needs an opening, a turn and a resolution', () => {
        // Three weathers side by side: a list, not a story.
        expect(codesOf(story((s) => (s.beats[1].role = 'build')))).toEqual(['story-arc']);
        expect(codesOf(story((s) => (s.beats[0].role = 'turn')))).toEqual(['story-arc']);
        expect(codesOf(story((s) => (s.beats[2].role = 'build')))).toEqual(['story-arc']);
        expect(codesOf(story((s) => s.beats.splice(1, 1)))).toContain('story-arc');
    });

    it('warns past six beats', () => {
        const many = story((s) => {
            s.beats = [
                { id: 'b0', role: 'opening', at: 'sun' },
                ...[1, 2, 3, 4, 5].map((beat) => ({
                    id: `b${beat}`,
                    role: beat === 3 ? 'turn' : 'build',
                    at: { scene: 'sun', beat },
                })),
                { id: 'end', role: 'resolution', at: 'rain' },
            ].map((b) => ({ ...b, change: { from: 'a', to: 'b' } }));
            s.beats[1].text = ['纸船'];
        });
        const { problems } = validateStory(many, timeline());
        const arc = problems.filter((p) => p.code === 'story-arc');
        expect(arc.map((p) => p.severity)).toEqual(['warning']);
    });

    it('follows the film from its first frame, in order', () => {
        expect(codesOf(story((s) => (s.beats[0].at = { scene: 'sun', beat: 1 })))).toContain(
            'story-coverage',
        );
        const swapped = story(
            (s) => ([s.beats[1].at, s.beats[2].at] = [s.beats[2].at, s.beats[1].at]),
        );
        expect(codesOf(swapped)).toContain('story-coverage');
        expect(codesOf(story((s) => (s.beats[1].at = s.beats[0].at)))).toContain('story-coverage');
    });

    it('refuses a beat that rounds to no frame at all', () => {
        // 120 bpm at 24 fps: a beat lasts 12 frames, 0.001 of one rounds to nothing.
        const collapsed = story((s) => {
            s.beats[1].at = { scene: 'sun', beat: 0.001 };
            s.beats[0].text = [];
            s.beats[1].text = ['纸船'];
        });
        const { problems } = validateStory(collapsed, timeline());
        expect(problems.map((p) => [p.code, p.path])).toEqual([
            ['story-coverage', '$.beats[0].at'],
        ]);
        // The last beat starting in the film's final sliver covers no frame either.
        const tail = story((s) => (s.beats[2].at = { scene: 'snow', beat: 3.999 }));
        const late = validateStory(tail, timeline()).problems;
        expect(late.map((p) => [p.code, p.path])).toEqual([['story-coverage', '$.beats[2].at']]);
    });

    it('lists the words on screen of each beat exactly', () => {
        expect(codesOf(story((s) => (s.beats[0].text = ['纸 船'])))).toEqual(['story-text']);
        expect(codesOf(story((s) => delete s.beats[2].text))).toEqual(['story-text']);
        expect(codesOf(story((s) => (s.beats[1].text = ['雨'])))).toEqual(['story-text']);
    });

    it('warns when a beat shows more words than a viewer can read', () => {
        const t = structuredClone(TIMELINE);
        t.cues[0].text = '一'.repeat(READ_UNITS_PER_SEC * 5);
        const { timeline: v } = validateTimeline(t);
        const resolved = resolveTimeline(v as NonNullable<typeof v>);
        const { problems } = validateStory(
            story((s) => (s.beats[0].text = [t.cues[0].text as string])),
            resolved,
        );
        expect(problems.map((p) => [p.code, p.severity])).toEqual([['story-text-fast', 'warning']]);
    });

    it('warns when the film stops right after its last words or its last beat', () => {
        // 8 s at 120 bpm: the room after the last words is 15% of it, 1.2 s.
        const late = structuredClone(TIMELINE);
        late.cues[2].beat = 2.5; // settles 0.75 s before the end
        const { timeline: v } = validateTimeline(late);
        const lateProblems = validateStory(
            story(),
            resolveTimeline(v as NonNullable<typeof v>),
        ).problems;
        expect(lateProblems.map((p) => [p.code, p.severity, p.path])).toEqual([
            ['story-ending-short', 'warning', '$.beats[2]'],
        ]);
        expect(lateProblems[0].detail).toMatchObject({ cue: 'end', room: 1.2 });
        // A longer film asks for the full two seconds.
        const long = structuredClone(TIMELINE);
        long.scenes[0].bars = 8;
        long.cues[2].beat = 0;
        const { timeline: l } = validateTimeline(long);
        const longResolved = resolveTimeline(l as NonNullable<typeof l>);
        const settled = validateStory(
            story((s) => (s.beats[2].at = 'snow')),
            longResolved,
        ).problems;
        expect(settled).toEqual([]);
        long.cues[2].beat = 3;
        const { timeline: l2 } = validateTimeline(long);
        const short = validateStory(
            story((s) => (s.beats[2].at = 'snow')),
            resolveTimeline(l2 as NonNullable<typeof l2>),
        ).problems;
        expect(short.map((p) => p.code)).toEqual(['story-ending-short']);
        expect(short[0].detail).toMatchObject({ room: ENDING_AFTER_WORDS_SEC });
        // No words at all: the last beat itself needs the room.
        const silent = structuredClone(TIMELINE);
        silent.cues = silent.cues.filter((c) => c.kind !== 'text');
        const { timeline: s0 } = validateTimeline(silent);
        const quiet = validateStory(
            story((s) => {
                s.beats[0].text = [];
                s.beats[2].text = [];
                s.beats[2].at = { scene: 'snow', beat: 3 };
            }),
            resolveTimeline(s0 as NonNullable<typeof s0>),
        ).problems;
        expect(quiet.map((p) => [p.code, p.detail?.beat])).toEqual([
            ['story-ending-short', 'lift'],
        ]);
    });

    it('refuses references that do not hold', () => {
        expect(codesOf(story((s) => (s.beats[1].at = 'hail')))).toEqual(['story-invalid']);
        expect(codesOf(story((s) => (s.beats[2].at = { scene: 'snow', beat: 4 })))).toEqual([
            'story-invalid',
        ]);
        expect(codesOf(story((s) => (s.beats[1].callback = 'lift')))).toEqual(['story-invalid']);
        expect(codesOf(story((s) => (s.beats[0].sound = 'drop')))).toEqual(['story-invalid']);
        expect(codesOf(story((s) => (s.beats[1].sound = 'title')))).toEqual(['story-invalid']);
        const twoHolds = story((s) => {
            s.beats[0].hold = true;
            s.beats[1].hold = true;
        });
        expect(codesOf(twoHolds)).toEqual(['story-invalid']);
    });

    it('checks the shape field by field', () => {
        const { problems } = validateStory(
            story((s) => {
                s.version = 2;
                s.idea = '';
                s.mood = 'hopeful';
                s.beats[0].role = 'climax';
                s.beats[1].change = 'rain';
                s.beats[2].id = 'lift me';
            }),
            timeline(),
        );
        expect(problems.every((p) => p.code === 'story-invalid')).toBe(true);
        expect(problems.map((p) => p.path)).toEqual([
            '$.mood',
            '$.version',
            '$.idea',
            '$.beats[0].role',
            '$.beats[1].change',
            '$.beats[2].id',
        ]);
    });

    it('counts sentence length in characters and takes $schema only as a string', () => {
        expect(codesOf(story((s) => (s.leave = '🙂'.repeat(300))))).toEqual([]);
        expect(codesOf(story((s) => (s.leave = '🙂'.repeat(301))))).toEqual(['story-invalid']);
        expect(codesOf(story((s) => (s.$schema = './story.schema.json')))).toEqual([]);
        expect(codesOf(story((s) => (s.$schema = 42)))).toEqual(['story-invalid']);
    });

    it('counts reading units: a CJK character is one, another word two', () => {
        expect(readingUnits('撑过去')).toBe(3);
        expect(readingUnits('Hello, flipbook')).toBe(4);
        expect(readingUnits('你好 flipbook')).toBe(4);
    });

    it('reports a missing or broken file', () => {
        const dir = tempDir('story');
        expect(loadStory(dir, timeline()).findings.map((f) => f.code)).toEqual(['story-missing']);
        fs.writeFileSync(path.join(dir, 'story.json'), '{ nope');
        expect(loadStory(dir, timeline()).findings.map((f) => f.code)).toEqual(['story-invalid']);
        fs.writeFileSync(path.join(dir, 'story.json'), JSON.stringify(story()));
        const loaded = loadStory(dir, timeline());
        expect(loaded.findings).toEqual([]);
        expect(loaded.story?.beats).toHaveLength(3);
    });
});
