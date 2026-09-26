import * as fs from 'fs';
import * as path from 'path';
import { type Finding, finding } from '../cli/report.ts';
import { Checker, describe, ID_PATTERN, isNum, isObject, type Json } from './schema.ts';
import {
    BEAT_ROLES,
    type BeatRole,
    frameAt,
    type ResolvedStory,
    type ResolvedStoryBeat,
    type ResolvedTimeline,
} from './timelineResolve.ts';

// story.json: the film's story, written before the timeline and checked
// against it. A story is one idea told in beats. Each beat starts at a moment
// on the timeline (a scene, or a beat inside one) and runs until the next
// beat starts, so the beats cover the whole film with no gaps and no overlap.

export const STORY_FILE = 'story.json';
export const STORY_VERSION = 1;

/** Beats past this many are allowed but get a warning: a short film holds three to six. */
export const MAX_BEATS = 6;
/**
 * Reading speed above which on-screen words get a warning, in units a second:
 * a CJK character is one unit, a word in a spaced script two (about 3.5 words a second).
 */
export const READ_UNITS_PER_SEC = 7;

const TEXT_MAX = 300;

export interface StoryBeatV1 {
    id: string;
    role: BeatRole;
    /** A scene id (the beat starts with the scene), or a beat inside a scene. */
    at: string | { scene: string; beat: number };
    change: { from: string; to: string };
    text?: string[];
    sound?: string;
    callback?: string;
    hold?: boolean;
}

export interface StoryV1 {
    version: 1;
    idea: string;
    leave: string;
    subject: string;
    device: { what: string; why: string };
    beats: StoryBeatV1[];
}

type StoryCode =
    | 'story-invalid'
    | 'story-coverage'
    | 'story-arc'
    | 'story-text'
    | 'story-text-fast';

/** Units of reading in `text`: CJK characters count one, words of other scripts two. */
export function readingUnits(text: string): number {
    const cjk = text.match(
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu,
    );
    const rest = text.replace(
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu,
        ' ',
    );
    const words = rest.match(/[\p{L}\p{N}]+/gu);
    return (cjk?.length ?? 0) + 2 * (words?.length ?? 0);
}

function sentence(c: Checker, value: Json, at: string): value is string {
    if (!c.str(value, at, undefined, 'a sentence')) return false;
    // Counted in characters, not UTF-16 units: an emoji is one.
    const length = [...value].length;
    if (length > TEXT_MAX) {
        c.fail(at, `must be at most ${TEXT_MAX} characters (got ${length})`);
        return false;
    }
    return true;
}

/** Check the shape of a parsed story.json. References to the timeline are checked later. */
function validateShape(input: Json): { c: Checker; story?: StoryV1 } {
    const c = new Checker('story v1');
    if (!isObject(input)) {
        c.fail('$', 'must be a JSON object');
        return { c };
    }
    c.keys(input, '$', ['$schema', 'version', 'idea', 'leave', 'subject', 'device', 'beats']);
    if (input.$schema !== undefined && typeof input.$schema !== 'string') {
        c.fail('$.$schema', `must be a string (got ${describe(input.$schema)})`);
    }
    if (input.version !== STORY_VERSION) {
        c.fail('$.version', `must be ${STORY_VERSION} (got ${describe(input.version)})`);
    }
    sentence(c, input.idea, '$.idea');
    sentence(c, input.leave, '$.leave');
    sentence(c, input.subject, '$.subject');
    if (!isObject(input.device)) {
        c.fail('$.device', `must be an object with what and why (got ${describe(input.device)})`);
    } else {
        c.keys(input.device, '$.device', ['what', 'why']);
        sentence(c, input.device.what, '$.device.what');
        sentence(c, input.device.why, '$.device.why');
    }
    if (!Array.isArray(input.beats) || input.beats.length === 0) {
        c.fail('$.beats', `must be a non-empty array of beats (got ${describe(input.beats)})`);
        return { c };
    }
    const ids = new Set<string>();
    input.beats.forEach((beat: Json, i: number) => {
        const at = `$.beats[${i}]`;
        if (!isObject(beat)) {
            c.fail(at, 'must be an object with id, role, at and change');
            return;
        }
        c.keys(beat, at, ['id', 'role', 'at', 'change', 'text', 'sound', 'callback', 'hold']);
        if (c.str(beat.id, `${at}.id`, ID_PATTERN, 'an id of letters, digits, - or _')) {
            if (ids.has(beat.id)) c.fail(`${at}.id`, `duplicates beat "${beat.id}"`);
            ids.add(beat.id);
        }
        if (!BEAT_ROLES.includes(beat.role as BeatRole)) {
            c.fail(
                `${at}.role`,
                `must be ${BEAT_ROLES.map((r) => `"${r}"`).join(', ')} (got ${describe(beat.role)})`,
            );
        }
        if (typeof beat.at !== 'string') {
            if (!isObject(beat.at)) {
                c.fail(
                    `${at}.at`,
                    `must be a scene id or { "scene": ..., "beat": ... } (got ${describe(beat.at)})`,
                );
            } else {
                c.keys(beat.at, `${at}.at`, ['scene', 'beat']);
                c.str(beat.at.scene, `${at}.at.scene`);
                if (!isNum(beat.at.beat)) {
                    c.fail(
                        `${at}.at.beat`,
                        `must be a number of beats (got ${describe(beat.at.beat)})`,
                    );
                }
            }
        } else {
            c.str(beat.at, `${at}.at`);
        }
        if (!isObject(beat.change)) {
            c.fail(
                `${at}.change`,
                `must be an object with from and to (got ${describe(beat.change)})`,
            );
        } else {
            c.keys(beat.change, `${at}.change`, ['from', 'to']);
            sentence(c, beat.change.from, `${at}.change.from`);
            sentence(c, beat.change.to, `${at}.change.to`);
        }
        if (beat.text !== undefined) {
            if (!Array.isArray(beat.text)) {
                c.fail(
                    `${at}.text`,
                    `must be an array of the words on screen (got ${describe(beat.text)})`,
                );
            } else {
                for (const [j, line] of beat.text.entries()) c.str(line, `${at}.text[${j}]`);
            }
        }
        if (beat.sound !== undefined) c.str(beat.sound, `${at}.sound`, ID_PATTERN, 'a cue id');
        if (beat.callback !== undefined)
            c.str(beat.callback, `${at}.callback`, ID_PATTERN, 'a beat id');
        if (beat.hold !== undefined && typeof beat.hold !== 'boolean') {
            c.fail(`${at}.hold`, `must be true or false (got ${describe(beat.hold)})`);
        }
    });
    return c.errors.length > 0 ? { c } : { c, story: input as unknown as StoryV1 };
}

interface StoryProblem {
    code: StoryCode;
    path: string;
    message: string;
    severity: 'error' | 'warning';
    detail?: Record<string, unknown>;
}

/**
 * Validate a parsed story.json against a resolved timeline and place its
 * beats on it. Returns every problem found. `story` is set when none is an error.
 */
export function validateStory(
    input: Json,
    timeline: ResolvedTimeline,
): { problems: StoryProblem[]; story?: ResolvedStory } {
    const problems: StoryProblem[] = [];
    const add = (
        code: StoryCode,
        at: string,
        message: string,
        detail?: Record<string, unknown>,
        severity: 'error' | 'warning' = 'error',
    ) => problems.push({ code, path: at, message, severity, ...(detail ? { detail } : {}) });

    const { c, story } = validateShape(input);
    for (const error of c.errors) add('story-invalid', error.path, error.message);
    if (!story) return { problems };

    // References to the timeline: where each beat starts, its sound, its callback.
    const scenes = new Map(timeline.scenes.map((scene) => [scene.id, scene]));
    const known = timeline.scenes.map((s) => s.id).join(', ');
    const starts: (number | null)[] = story.beats.map((beat, i) => {
        const at = `$.beats[${i}].at`;
        const sceneId = typeof beat.at === 'string' ? beat.at : beat.at.scene;
        const scene = scenes.get(sceneId);
        if (!scene) {
            add(
                'story-invalid',
                typeof beat.at === 'string' ? at : `${at}.scene`,
                `names no scene (known: ${known})`,
            );
            return null;
        }
        const offset = typeof beat.at === 'string' ? 0 : beat.at.beat;
        if (offset < 0 || offset >= scene.beats) {
            add(
                'story-invalid',
                `${at}.beat`,
                `must be at least 0 and below ${scene.beats}, the beats in scene "${scene.id}" (got ${offset})`,
            );
            return null;
        }
        return scene.startBeat + offset;
    });
    const holds = story.beats.filter((beat) => beat.hold === true);
    if (holds.length > 1) {
        add(
            'story-invalid',
            '$.beats',
            `marks ${holds.length} beats hold (${holds.map((b) => b.id).join(', ')}): at most one beat may stand still on purpose`,
        );
    }
    story.beats.forEach((beat, i) => {
        if (beat.callback === undefined) return;
        const target = story.beats.findIndex((other) => other.id === beat.callback);
        if (target < 0 || target >= i) {
            add(
                'story-invalid',
                `$.beats[${i}].callback`,
                `must name an earlier beat (got "${beat.callback}")`,
            );
        }
    });
    if (starts.some((start) => start === null)) return { problems };
    const at = starts as number[];

    // Coverage: the first beat opens the film, and each beat starts after the one before.
    if (at[0] !== 0) {
        add(
            'story-coverage',
            '$.beats[0].at',
            `must be where the film starts, the first beat of scene "${timeline.scenes[0].id}": the film would open before the story does`,
            { startBeat: at[0] },
        );
    }
    for (let i = 1; i < at.length; i++) {
        if (at[i] <= at[i - 1]) {
            add(
                'story-coverage',
                `$.beats[${i}].at`,
                `must come after beat "${story.beats[i - 1].id}": beats follow the film in order and each one lasts until the next starts`,
                { startBeat: at[i], previousStartBeat: at[i - 1] },
            );
        }
    }

    // The arc: open, turn, resolve.
    const roles = story.beats.map((beat) => beat.role);
    if (roles.length < 3) {
        add(
            'story-arc',
            '$.beats',
            `has ${roles.length} beat${roles.length === 1 ? '' : 's'}: a story needs at least an opening, a turn and a resolution`,
            { roles },
        );
    } else {
        if (roles[0] !== 'opening') {
            add('story-arc', '$.beats[0].role', `must be "opening" (got "${roles[0]}")`, {
                roles,
            });
        }
        if (roles[roles.length - 1] !== 'resolution') {
            add(
                'story-arc',
                `$.beats[${roles.length - 1}].role`,
                `must be "resolution" (got "${roles[roles.length - 1]}")`,
                { roles },
            );
        }
        if (!roles.slice(1, -1).includes('turn')) {
            add(
                'story-arc',
                '$.beats',
                'has no "turn" between the opening and the resolution: parts that sit side by side are a list, not a story. Find the moment something goes wrong or changes course',
                { roles },
            );
        }
    }
    if (roles.length > MAX_BEATS) {
        add(
            'story-arc',
            '$.beats',
            `has ${roles.length} beats: a short film holds ${3} to ${MAX_BEATS}, merge the ones that do the same job`,
            { roles },
            'warning',
        );
    }
    if (problems.some((p) => p.severity === 'error')) return { problems };

    // Place the beats on the timeline.
    const spb = timeline.secondsPerBeat;
    const beats: ResolvedStoryBeat[] = story.beats.map((beat, i) => {
        const startBeat = at[i];
        const endBeat = i + 1 < at.length ? at[i + 1] : timeline.totalBeats;
        return {
            id: beat.id,
            index: i,
            role: beat.role,
            startBeat,
            endBeat,
            start: startBeat * spb,
            end: endBeat * spb,
            startFrame: Math.min(frameAt(startBeat * spb, timeline.fps), timeline.frameCount),
            endFrame: Math.min(frameAt(endBeat * spb, timeline.fps), timeline.frameCount),
            change: beat.change,
            text: beat.text ?? [],
            sound: beat.sound ?? null,
            callback: beat.callback ?? null,
            hold: beat.hold === true,
        };
    });

    // Every beat must show at least one frame: beats a sliver apart, or a
    // last beat starting in the film's final sliver, round to none.
    beats.forEach((beat, i) => {
        if (beat.endFrame > beat.startFrame) return;
        add(
            'story-coverage',
            `$.beats[${i}].at`,
            i + 1 < beats.length
                ? `covers no frame: beat "${beats[i + 1].id}" starts on the same frame (${beat.startFrame}). Give beat "${beat.id}" at least one frame`
                : `covers no frame: it starts on frame ${beat.startFrame}, where the film ends. Start it earlier`,
            { startFrame: beat.startFrame, endFrame: beat.endFrame },
        );
    });
    if (problems.some((p) => p.severity === 'error')) return { problems };

    // The words on screen and the sound, beat by beat.
    const within = (beat: ResolvedStoryBeat, absBeat: number) =>
        absBeat >= beat.startBeat && absBeat < beat.endBeat;
    beats.forEach((beat, i) => {
        const cues = timeline.cues
            .filter((cue) => cue.kind === 'text' && within(beat, cue.absBeat))
            .sort((a, b) => a.absBeat - b.absBeat);
        const shown = cues.map((cue) => cue.text ?? '');
        const same = shown.length === beat.text.length && shown.every((t, j) => t === beat.text[j]);
        if (!same) {
            add(
                'story-text',
                `$.beats[${i}].text`,
                shown.length === 0
                    ? `lists words on screen, but no text cue falls inside beat "${beat.id}"`
                    : `must list the text cues inside beat "${beat.id}" in order: ${JSON.stringify(shown)} (got ${JSON.stringify(beat.text)})`,
                { beat: beat.id, cues: cues.map((cue) => cue.id), expected: shown, got: beat.text },
            );
        }
        const seconds = beat.end - beat.start;
        const units = shown.reduce((sum, t) => sum + readingUnits(t), 0);
        if (units > 0 && units / seconds > READ_UNITS_PER_SEC) {
            add(
                'story-text-fast',
                `$.beats[${i}].text`,
                `puts ${units} reading units on screen in ${seconds.toFixed(2)} s, above ${READ_UNITS_PER_SEC} a second: cut words or give the beat more time`,
                { beat: beat.id, units, seconds },
                'warning',
            );
        }
        if (beat.sound !== null) {
            const cue = timeline.cues.find((c2) => c2.id === beat.sound);
            if (cue?.kind !== 'sfx') {
                add(
                    'story-invalid',
                    `$.beats[${i}].sound`,
                    `names no sfx cue (got "${beat.sound}")`,
                );
            } else if (!within(beat, cue.absBeat)) {
                add(
                    'story-invalid',
                    `$.beats[${i}].sound`,
                    `names sfx cue "${cue.id}", which plays outside beat "${beat.id}"`,
                );
            }
        }
    });
    if (problems.some((p) => p.severity === 'error')) return { problems };
    const { idea, leave, subject, device } = story;
    return { problems, story: { idea, leave, subject, device, beats } };
}

/** Read and check `<dir>/story.json` against the resolved timeline. */
export function loadStory(
    dir: string,
    timeline: ResolvedTimeline,
): { story?: ResolvedStory; findings: Finding[] } {
    const file = path.join(dir, STORY_FILE);
    let raw: string;
    try {
        raw = fs.readFileSync(file, 'utf-8');
    } catch {
        return {
            findings: [
                finding(
                    'story-missing',
                    `No ${STORY_FILE} in ${dir}. Write the story first: the idea, what it leaves the viewer with, the subject that changes, the device and the beats.`,
                ),
            ],
        };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        return {
            findings: [
                finding(
                    'story-invalid',
                    `${STORY_FILE} is not valid JSON: ${(error as Error).message}`,
                    {
                        detail: { path: '$' },
                    },
                ),
            ],
        };
    }
    const { problems, story } = validateStory(parsed, timeline);
    return {
        story,
        findings: problems.map((p) =>
            finding(p.code, `${p.path} ${p.message}`, {
                severity: p.severity,
                detail: { path: p.path, ...p.detail },
            }),
        ),
    };
}

/**
 * Share of pixels (on the gray analysis frames) that must differ between a
 * beat's first and last frames for the beat to count as showing a change.
 */
export const STATIC_BEAT_SHARE = 0.002;

/** The first and last frame of every beat that is meant to change. */
export function beatEnds(
    story: ResolvedStory,
): { beat: ResolvedStoryBeat; first: number; last: number }[] {
    return story.beats
        .filter((beat) => !beat.hold && beat.endFrame > beat.startFrame)
        .map((beat) => ({ beat, first: beat.startFrame, last: beat.endFrame - 1 }));
}

/** A story-static-beat finding for a beat whose ends differ in `share` of their pixels. */
export function staticBeatFinding(
    beat: ResolvedStoryBeat,
    share: number,
    fps: number,
    evidence: string[],
): Finding {
    return finding(
        'story-static-beat',
        `Beat "${beat.id}" looks the same at ${(beat.startFrame / fps).toFixed(2)} s and ${((beat.endFrame - 1) / fps).toFixed(2)} s (${(share * 100).toFixed(2)}% of pixels differ): the story says "${beat.change.from}" becomes "${beat.change.to}".`,
        {
            severity: 'warning',
            time: beat.startFrame / fps,
            frame: beat.startFrame,
            evidence,
            detail: { beat: beat.id, share, threshold: STATIC_BEAT_SHARE },
        },
    );
}
