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

type Story = Record<string, unknown> & { beats: Record<string, unknown>[] };

function story(edit?: (s: Story) => void) {
    const s = {
        version: 2,
        who: { what: 'a paper boat', where: { beat: 'calm', via: ['picture'] } },
        wants: { what: 'to reach the far shore', where: { beat: 'calm', via: ['picture'] } },
        because: {
            what: 'the rain soaks it through and the snow buries it',
            where: { beat: 'soak', via: ['picture', 'sound'] },
        },
        becomes: {
            what: 'a hand lifts it out and it rides high again',
            where: { beat: 'lift', via: ['picture'] },
        },
        leave: 'Small things make it through',
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
    } as Story;
    edit?.(s);
    return s;
}

/** The story left partly off stage: `slots` go to `kind`, with its block. */
function offstage(kind: 'record' | 'memory', slots: string[], edit?: (s: Story) => void) {
    return story((s) => {
        for (const slot of slots) (s[slot] as Record<string, unknown>).where = kind;
        if (kind === 'record') {
            s.record = {
                story: 'A paper boat a child set on the river in 1900 was found at the sea',
                sources: ['The river town paper, 3 May 1900'],
                key: '撑过去',
                materials: {},
            };
        } else {
            s.memory = { detail: 'a paper boat on a rain puddle' };
        }
        edit?.(s);
    });
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
            // The slots there go through words and sound, which a still beat can carry.
            (s.who as { where: { via: string[] } }).where.via = ['words'];
            (s.wants as { where: { via: string[] } }).where.via = ['words'];
        });
        expect(codesOf(twoHolds)).toEqual(['story-invalid']);
    });

    it('checks the shape field by field', () => {
        const { problems } = validateStory(
            story((s) => {
                s.version = 3;
                s.leave = '';
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
            '$.leave',
            '$.beats[0].role',
            '$.beats[1].change',
            '$.beats[2].id',
        ]);
    });

    it('refuses a story v1 file outright', () => {
        const v1 = {
            version: 1,
            idea: 'A paper boat soaks through in the rain',
            leave: 'Small things make it through',
            subject: 'the paper boat',
            device: { what: 'one line', why: 'the eye stays on the boat' },
            beats: story().beats,
        };
        const { problems } = validateStory(v1, timeline());
        expect(problems.map((p) => [p.code, p.path])).toEqual([['story-invalid', '$.version']]);
        expect(problems[0].message).toContain('who, wants, because and becomes');
    });

    it('needs all four slots, each with what and where', () => {
        const { problems } = validateStory(
            story((s) => {
                delete s.who;
                s.wants = { what: '', where: { beat: 'calm', via: ['picture'] } };
                s.because = { what: 'rain', where: 'offstage' };
                s.becomes = { what: 'lifted', where: { beat: 'lift', via: [] }, why: 'luck' };
            }),
            timeline(),
        );
        expect(problems.map((p) => [p.code, p.path])).toEqual([
            ['story-invalid', '$.who'],
            ['story-invalid', '$.wants.what'],
            ['story-invalid', '$.because.where'],
            ['story-invalid', '$.becomes.why'],
            ['story-invalid', '$.becomes.where.via'],
        ]);
    });

    it('takes each channel once, from picture, words and sound', () => {
        const via = (list: unknown[]) =>
            validateStory(
                story((s) => ((s.wants as { where: { via: unknown[] } }).where.via = list)),
                timeline(),
            ).problems.map((p) => [p.code, p.path]);
        expect(via(['picture', 'picture'])).toEqual([['story-invalid', '$.wants.where.via[1]']]);
        expect(via(['smell'])).toEqual([['story-invalid', '$.wants.where.via[0]']]);
        expect(via(['picture', 'words'])).toEqual([]);
        const missing = story((s) => ((s.who as { where: { beat: string } }).where.beat = 'dusk'));
        expect(validateStory(missing, timeline()).problems.map((p) => [p.code, p.path])).toEqual([
            ['story-invalid', '$.who.where.beat'],
        ]);
    });

    it('works out the stage from the slots', () => {
        const onstage = validateStory(story(), timeline());
        expect(onstage.story).toMatchObject({ stage: 'onstage', record: null, memory: null });
        expect(onstage.story?.who).toEqual({
            what: 'a paper boat',
            where: { beat: 'calm', via: ['picture'] },
        });
        const record = validateStory(offstage('record', ['who', 'wants']), timeline());
        expect(record.problems).toEqual([]);
        expect(record.story).toMatchObject({ stage: 'record', memory: null });
        expect(record.story?.record?.key).toBe('撑过去');
        const memory = validateStory(offstage('memory', ['who', 'wants', 'because']), timeline());
        expect(memory.problems).toEqual([]);
        expect(memory.story).toMatchObject({
            stage: 'memory',
            record: null,
            memory: { detail: 'a paper boat on a rain puddle' },
        });
    });

    it('asks for the block of the slots left off stage, and only for it', () => {
        const paths = (input: unknown) =>
            validateStory(input, timeline()).problems.map((p) => [p.code, p.path]);
        expect(paths(offstage('record', ['who'], (s) => delete s.record))).toEqual([
            ['story-invalid', '$.record'],
        ]);
        expect(paths(offstage('memory', ['who'], (s) => delete s.memory))).toEqual([
            ['story-invalid', '$.memory'],
        ]);
        // A block with no slot left to it.
        expect(paths(story((s) => (s.memory = { detail: 'a puddle' })))).toEqual([
            ['story-invalid', '$.memory'],
        ]);
        expect(
            paths(
                offstage(
                    'record',
                    ['who'],
                    (s) =>
                        ((s.who as { where: unknown }).where = {
                            beat: 'calm',
                            via: ['picture'],
                        }),
                ),
            ),
        ).toEqual([['story-invalid', '$.record']]);
        // A block of the wrong shape.
        expect(paths(offstage('memory', ['who'], (s) => (s.memory = { detail: '' })))).toEqual([
            ['story-invalid', '$.memory.detail'],
        ]);
        const record = offstage('record', ['who'], (s) => {
            s.record = { story: 'x', sources: [], key: '', materials: { 'boat.png': 'the boat' } };
        });
        expect(paths(record)).toEqual([
            ['story-invalid', '$.record.sources'],
            ['story-invalid', '$.record.key'],
            ['story-invalid', '$.record.materials["boat.png"]'],
        ]);
    });

    it('tells a film from a record or from memory, not both', () => {
        const paths = (input: unknown) =>
            validateStory(input, timeline()).problems.map((p) => [p.code, p.path]);
        const mixed = offstage('record', ['who'], (s) => {
            (s.wants as { where: unknown }).where = 'memory';
            s.memory = { detail: 'a paper boat on a rain puddle' };
        });
        expect(paths(mixed)).toEqual([
            ['story-invalid', '$.wants.where'],
            ['story-invalid', '$.memory'],
        ]);
        const blocks = offstage('record', ['who'], (s) => (s.memory = { detail: 'a puddle' }));
        expect(paths(blocks)).toEqual([['story-invalid', '$.memory']]);
    });

    it('keeps at least one slot on stage in a film told from memory', () => {
        const all = offstage('memory', ['who', 'wants', 'because', 'becomes']);
        const { problems } = validateStory(all, timeline());
        expect(problems.map((p) => [p.code, p.path])).toEqual([['story-invalid', '$.memory']]);
        expect(problems[0].message).toContain('at least one on stage');
        // A story told from a record may leave all four to it.
        const record = offstage('record', ['who', 'wants', 'because', 'becomes']);
        expect(validateStory(record, timeline()).problems).toEqual([]);
    });

    it('lands each slot on stage in a beat that can carry it', () => {
        const slot = (name: string, beat: string, via: string[]) =>
            story((s) => ((s[name] as { where: unknown }).where = { beat, via }));
        const found = (input: unknown) =>
            validateStory(input, timeline()).problems.map((p) => [p.code, p.path, p.severity]);
        // Words in a beat with no text, sound in a beat with no sound.
        expect(found(slot('wants', 'soak', ['picture', 'words']))).toEqual([
            ['story-slot', '$.wants.where.via', 'error'],
        ]);
        expect(found(slot('becomes', 'lift', ['sound']))).toEqual([
            ['story-slot', '$.becomes.where.via', 'error'],
        ]);
        // Words and sound in a beat with words only: one problem, for the sound.
        const both = validateStory(slot('because', 'calm', ['words', 'sound']), timeline());
        expect(both.problems.map((p) => [p.code, p.path])).toEqual([
            ['story-slot', '$.because.where.via'],
        ]);
        expect(both.problems[0].message).toContain('names no sound');
        // The picture alone in the hold beat shows nothing, sound there carries it.
        const held = (via: string[]) =>
            story((s) => {
                s.beats[1].hold = true;
                (s.because as { where: unknown }).where = { beat: 'soak', via };
            });
        const stillPicture = validateStory(held(['picture']), timeline()).problems;
        expect(stillPicture.map((p) => [p.code, p.path])).toEqual([
            ['story-slot', '$.because.where.via'],
        ]);
        expect(stillPicture[0].detail).toEqual({
            slot: 'because',
            beat: 'soak',
            via: ['picture'],
        });
        expect(found(held(['picture', 'sound']))).toEqual([]);
        // Slots left off stage have no beat to check.
        expect(found(offstage('memory', ['wants']))).toEqual([]);
    });

    describe('a story told from a record', () => {
        // A picture fetched, cut out, and one part of the cutout rigged; a sound.
        const SOURCES = {
            'boat.png': { source: 'https://example.org/boat', license: 'cc0' },
            'cut/boat/boat-01.png': {
                source: 'https://example.org/boat',
                license: 'cc0',
                cutFrom: 'boat.png',
            },
            'puppets/boat/parts/hull.png': {
                source: 'https://example.org/boat',
                license: 'cc0',
                cutFrom: 'cut/boat/boat-01.png',
            },
            'rain.mp3': { source: 'https://example.org/rain', license: 'cc0' },
        };
        const materials = {
            'assets/boat.png': 'the boat the child set on the river',
            'assets/rain.mp3': 'the storm the town paper wrote about',
        };
        const told = (edit?: (s: Story) => void) =>
            offstage('record', ['who', 'wants'], (s) => {
                (s.record as Record<string, unknown>).materials = { ...materials };
                edit?.(s);
            });
        const found = (input: unknown, sources: Record<string, unknown> = SOURCES) =>
            validateStory(input, timeline(), { sources: { sources } }).problems;

        it('gives every file a part in the story, a cut file through its original', () => {
            expect(found(told())).toEqual([]);
            const unplaced = found(
                told(
                    (s) =>
                        delete (s.record as { materials: Record<string, string> }).materials[
                            'assets/boat.png'
                        ],
                ),
            );
            expect(unplaced.map((p) => [p.code, p.path, p.severity])).toEqual([
                ['story-record', '$.record.materials', 'error'],
            ]);
            expect(unplaced[0].detail).toEqual({
                file: 'assets/boat.png',
                files: [
                    'assets/boat.png',
                    'assets/cut/boat/boat-01.png',
                    'assets/puppets/boat/parts/hull.png',
                ],
            });
            expect(unplaced[0].message).toContain('the 2 files cut from it');
            const sound = found(
                told(
                    (s) =>
                        delete (s.record as { materials: Record<string, string> }).materials[
                            'assets/rain.mp3'
                        ],
                ),
            );
            expect(sound.map((p) => p.detail?.file)).toEqual(['assets/rain.mp3']);
        });

        it('lists only files the film has', () => {
            const extra = found(
                told(
                    (s) =>
                        ((s.record as { materials: Record<string, string> }).materials[
                            'assets/sun.png'
                        ] = 'the sun'),
                ),
            );
            expect(extra.map((p) => [p.code, p.path])).toEqual([
                ['story-record', '$.record.materials["assets/sun.png"]'],
            ]);
        });

        it('ends on the clue: the last words contain the key', () => {
            const lost = found(
                told((s) => ((s.record as { key: string }).key = 'River town 1900')),
            );
            expect(lost.map((p) => [p.code, p.path])).toEqual([['story-record', '$.record.key']]);
            expect(lost[0].detail).toEqual({
                key: 'River town 1900',
                beat: 'lift',
                text: ['撑过去'],
            });
            // Part of a line is enough.
            expect(found(told((s) => ((s.record as { key: string }).key = '撑过')))).toEqual([]);
        });

        it('says so when assets/SOURCES.json cannot be read', () => {
            const { problems } = validateStory(told(), timeline(), {
                sources: { problem: 'assets/SOURCES.json is not valid JSON: nope' },
            });
            expect(problems.map((p) => [p.code, p.path])).toEqual([
                ['story-record', '$.record.materials'],
            ]);
        });

        it('checks nothing of the kind on stage or from memory', () => {
            expect(found(story())).toEqual([]);
            expect(found(offstage('memory', ['who']))).toEqual([]);
        });

        it('reads assets/SOURCES.json next to story.json', () => {
            const dir = tempDir('story-record');
            fs.mkdirSync(path.join(dir, 'assets'));
            fs.writeFileSync(path.join(dir, 'story.json'), JSON.stringify(told()));
            expect(loadStory(dir, timeline()).findings.map((f) => f.code)).toEqual([
                'story-record',
                'story-record',
            ]);
            fs.writeFileSync(path.join(dir, 'assets', 'SOURCES.json'), JSON.stringify(SOURCES));
            const loaded = loadStory(dir, timeline());
            expect(loaded.findings).toEqual([]);
            expect(loaded.story?.stage).toBe('record');
        });
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
