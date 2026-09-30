import * as fs from 'fs';
import * as path from 'path';
import { type Finding, finding } from '../cli/report.ts';
import { assetPath, parseSources } from './assetSources.ts';
import { Checker, describe, ID_PATTERN, isNum, isObject, type Json } from './schema.ts';
import {
    BEAT_ROLES,
    type BeatRole,
    frameAt,
    type ResolvedStory,
    type ResolvedStoryBeat,
    type ResolvedStorySlot,
    type ResolvedTimeline,
    type StoryMemory,
    type StoryRecord,
    type StoryStage,
} from './timelineResolve.ts';

// story.json: the film's story, written before the timeline and checked
// against it. A story is one sentence in four slots: who wants what, because
// of what, and what they become. Each slot says where the viewer finds it: on
// stage in one beat, through the picture, the words or the sound, or off stage,
// filled in from a written record or from the viewer's own memory. The beats
// tell it in order: each starts at a moment on the timeline (a scene, or a
// beat inside one) and runs until the next beat starts, so the beats cover the
// whole film with no gaps and no overlap.

export const STORY_FILE = 'story.json';
export const STORY_VERSION = 2;

/** Beats past this many are allowed but get a warning: a short film holds three to six. */
export const MAX_BEATS = 6;
/**
 * Reading speed above which on-screen words get a warning, in units a second:
 * a CJK character is one unit, a word in a spaced script two (about 3.5 words a second).
 */
export const READ_UNITS_PER_SEC = 7;
/**
 * The ending needs room: the film goes on at least this long after its last
 * words settle (or, with no words, its last beat lasts this long), scaled down
 * for very short films by the share of their length.
 */
export const ENDING_AFTER_WORDS_SEC = 2;
export const ENDING_BEAT_SEC = 2.5;
export const ENDING_SHARE = 0.15;

const TEXT_MAX = 300;

/** The four slots of the story sentence, in the order it reads. */
export const SLOTS = ['who', 'wants', 'because', 'becomes'] as const;
export type Slot = (typeof SLOTS)[number];
/** The ways a slot on stage reaches the viewer. */
export const CHANNELS = ['picture', 'words', 'sound'] as const;
export type Channel = (typeof CHANNELS)[number];

export interface StoryBeatV2 {
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

export interface StoryV2 {
    version: 2;
    who: ResolvedStorySlot;
    wants: ResolvedStorySlot;
    because: ResolvedStorySlot;
    becomes: ResolvedStorySlot;
    record?: StoryRecord;
    memory?: StoryMemory;
    leave: string;
    device: { what: string; why: string };
    beats: StoryBeatV2[];
}

type StoryCode =
    | 'story-invalid'
    | 'story-slot'
    | 'story-record'
    | 'story-coverage'
    | 'story-arc'
    | 'story-text'
    | 'story-text-fast'
    | 'story-ending-short';

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

/** True when `value` holds something besides white space. The value itself is kept as written. */
function filled(c: Checker, value: Json, at: string, what: string): value is string {
    if (!c.str(value, at, undefined, what)) return false;
    if (value.trim() === '') {
        c.fail(at, `must be ${what}, not only white space`);
        return false;
    }
    return true;
}

function sentence(c: Checker, value: Json, at: string): value is string {
    if (!filled(c, value, at, 'a sentence')) return false;
    // Counted in characters, not UTF-16 units: an emoji is one.
    const length = [...value].length;
    if (length > TEXT_MAX) {
        c.fail(at, `must be at most ${TEXT_MAX} characters (got ${length})`);
        return false;
    }
    return true;
}

/** Check one slot of the story sentence: `{ what, where }`. */
function validateSlot(c: Checker, value: Json, at: string): void {
    if (!isObject(value)) {
        c.fail(at, `must be an object with what and where (got ${describe(value)})`);
        return;
    }
    c.keys(value, at, ['what', 'where']);
    sentence(c, value.what, `${at}.what`);
    const where = value.where;
    if (where === 'record' || where === 'memory') return;
    if (!isObject(where)) {
        c.fail(
            `${at}.where`,
            `must be { "beat": ..., "via": [...] }, "record" or "memory" (got ${describe(where)})`,
        );
        return;
    }
    c.keys(where, `${at}.where`, ['beat', 'via']);
    c.str(where.beat, `${at}.where.beat`, ID_PATTERN, 'a beat id');
    const channels = CHANNELS.map((ch) => `"${ch}"`).join(', ');
    if (!Array.isArray(where.via) || where.via.length === 0) {
        c.fail(
            `${at}.where.via`,
            `must be a non-empty array of ${channels} (got ${describe(where.via)})`,
        );
        return;
    }
    const seen = new Set<string>();
    where.via.forEach((ch: Json, i: number) => {
        if (!CHANNELS.includes(ch as Channel)) {
            c.fail(`${at}.where.via[${i}]`, `must be ${channels} (got ${describe(ch)})`);
        } else if (seen.has(ch as string)) {
            c.fail(`${at}.where.via[${i}]`, `repeats "${ch as string}"`);
        } else seen.add(ch as string);
    });
}

function validateRecord(c: Checker, value: Json): void {
    if (!isObject(value)) {
        c.fail(
            '$.record',
            `must be an object with story, sources, key and materials (got ${describe(value)})`,
        );
        return;
    }
    c.keys(value, '$.record', ['story', 'sources', 'key', 'materials']);
    sentence(c, value.story, '$.record.story');
    if (!Array.isArray(value.sources) || value.sources.length === 0) {
        c.fail(
            '$.record.sources',
            `must be a non-empty array of where the story is written (got ${describe(value.sources)})`,
        );
    } else {
        for (const [i, source] of value.sources.entries()) {
            filled(c, source, `$.record.sources[${i}]`, 'a source: a book, an archive, a link');
        }
    }
    sentence(c, value.key, '$.record.key');
    if (!isObject(value.materials)) {
        c.fail(
            '$.record.materials',
            `must be an object of asset paths and the part of the story each one is (got ${describe(value.materials)})`,
        );
        return;
    }
    const spelled = new Map<string, string>();
    for (const [file, part] of Object.entries(value.materials)) {
        const at = `$.record.materials[${JSON.stringify(file)}]`;
        sentence(c, part, at);
        const asset = materialPath(file);
        if (asset === null) {
            c.fail(
                at,
                'must name a file inside assets/, as a path from the composition such as "assets/horse.jpg"',
            );
            continue;
        }
        const same = spelled.get(asset);
        if (same !== undefined) {
            c.fail(at, `names the same file as ${JSON.stringify(same)}: give each file one line`);
            continue;
        }
        spelled.set(asset, file);
    }
}

/**
 * The file under assets/ a record.materials key names, in the spelling
 * assetPath gives (so "assets/./a.png" is "a.png"), or null when the key is
 * not a path inside assets/.
 */
function materialPath(file: string): string | null {
    return file.startsWith('assets/') ? assetPath(file.slice('assets/'.length)) : null;
}

function validateMemory(c: Checker, value: Json): void {
    if (!isObject(value)) {
        c.fail('$.memory', `must be an object with detail (got ${describe(value)})`);
        return;
    }
    c.keys(value, '$.memory', ['detail']);
    sentence(c, value.detail, '$.memory.detail');
}

/**
 * Where the story plays, from its slots, or the problems that keep it from
 * having one stage: a record and memory mixed, a block missing for the slots
 * left off stage, or a block no slot uses.
 */
function validateStage(c: Checker, input: Record<string, Json>): StoryStage | null {
    const offstage = (kind: 'record' | 'memory') =>
        SLOTS.filter((slot) => isObject(input[slot]) && input[slot].where === kind);
    const record = offstage('record');
    const memory = offstage('memory');
    const errors = c.errors.length;
    const names = (slots: Slot[]) => slots.join(', ');
    if (record.length > 0 && memory.length > 0) {
        c.fail(
            `$.${memory[0]}.where`,
            `leaves ${names(memory)} to memory while ${names(record)} ${record.length === 1 ? 'is' : 'are'} left to the record: a film is told from a record or from memory, not both`,
        );
    }
    if (input.record !== undefined && input.memory !== undefined) {
        c.fail(
            '$.memory',
            'stands beside record: a film is told from a record or from memory, not both',
        );
    } else {
        if (record.length > 0 && input.record === undefined) {
            c.fail(
                '$.record',
                `is required: ${names(record)} ${record.length === 1 ? 'is' : 'are'} left to the record. Write the story, its sources, the key to search and what each asset is`,
            );
        }
        if (record.length === 0 && input.record !== undefined) {
            c.fail(
                '$.record',
                'is set, but no slot is left to the record: set a slot\'s where to "record", or drop the block',
            );
        }
        if (memory.length > 0 && input.memory === undefined) {
            c.fail(
                '$.memory',
                `is required: ${names(memory)} ${memory.length === 1 ? 'is' : 'are'} left to memory. Write the detail that brings the memory back`,
            );
        }
        if (memory.length === 0 && input.memory !== undefined) {
            c.fail(
                '$.memory',
                'is set, but no slot is left to memory: set a slot\'s where to "memory", or drop the block',
            );
        }
    }
    if (memory.length === SLOTS.length) {
        c.fail(
            '$.memory',
            'leaves all four slots to memory: put at least one on stage, the one the film shows (usually wants or becomes)',
        );
    }
    if (c.errors.length > errors) return null;
    return record.length > 0 ? 'record' : memory.length > 0 ? 'memory' : 'onstage';
}

/** Check the shape of a parsed story.json. References to the timeline are checked later. */
function validateShape(input: Json): { c: Checker; story?: StoryV2; stage?: StoryStage } {
    const c = new Checker('story v2');
    if (!isObject(input)) {
        c.fail('$', 'must be a JSON object');
        return { c };
    }
    if (input.version === 1) {
        c.fail(
            '$.version',
            `must be ${STORY_VERSION}: this is a story v1 file. Version 2 replaces idea and subject with who, wants, because and becomes, see references/story.md`,
        );
        return { c };
    }
    c.keys(input, '$', [
        '$schema',
        'version',
        ...SLOTS,
        'record',
        'memory',
        'leave',
        'device',
        'beats',
    ]);
    if (input.$schema !== undefined && typeof input.$schema !== 'string') {
        c.fail('$.$schema', `must be a string (got ${describe(input.$schema)})`);
    }
    if (input.version !== STORY_VERSION) {
        c.fail('$.version', `must be ${STORY_VERSION} (got ${describe(input.version)})`);
    }
    for (const slot of SLOTS) validateSlot(c, input[slot], `$.${slot}`);
    if (input.record !== undefined) validateRecord(c, input.record);
    if (input.memory !== undefined) validateMemory(c, input.memory);
    const stage = validateStage(c, input);
    sentence(c, input.leave, '$.leave');
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
    return c.errors.length > 0 || stage === null
        ? { c }
        : { c, story: input as unknown as StoryV2, stage };
}

/** assets/SOURCES.json as read: its entries, or why it cannot be read. */
export type SourcesRead = { sources: Record<string, unknown> } | { problem: string };

/** Why a slot on stage cannot land in `beat` through `via`: nothing there carries it. */
function slotProblems(slot: Slot, via: Channel[], beat: StoryBeatV2): string[] {
    const out: string[] = [];
    if (via.includes('words') && (beat.text ?? []).length === 0) {
        out.push(
            `goes through the words, but beat "${beat.id}" has no text: put the words that carry ${slot} on screen in that beat and list them in its text, or take "words" out of via`,
        );
    }
    if (via.includes('sound') && beat.sound === undefined) {
        out.push(
            `goes through the sound, but beat "${beat.id}" names no sound: give it the sfx cue that carries ${slot}, or take "sound" out of via`,
        );
    }
    if (via.length === 1 && via[0] === 'picture' && beat.hold === true) {
        out.push(
            `goes through the picture alone, but beat "${beat.id}" is the hold beat, where the picture stands still: land ${slot} in a beat where it shows, or carry it in words or sound too`,
        );
    }
    return out;
}

/**
 * Files of assets/SOURCES.json with no part in the story, and materials that
 * name no file there. Keys, cutFrom and materials are matched in the one
 * spelling assetPath gives, as own entries only.
 */
function materialProblems(
    record: StoryRecord,
    sources: Record<string, unknown>,
): { path: string; message: string; detail: Record<string, unknown> }[] {
    const out: { path: string; message: string; detail: Record<string, unknown> }[] = [];
    const bad = (key: string, problem: string) =>
        out.push({
            path: '$.record.materials',
            message: `cannot be checked against assets/SOURCES.json: its entry ${JSON.stringify(key)} ${problem}`,
            detail: { sources: 'assets/SOURCES.json', entry: key, problem },
        });
    // SOURCES.json entries by file, each in one spelling.
    const entries = new Map<string, { key: string; entry: unknown }>();
    for (const [key, entry] of Object.entries(sources)) {
        const file = assetPath(key);
        if (file === null) {
            bad(key, 'is not a path inside assets/');
            continue;
        }
        const same = entries.get(file);
        if (same) {
            bad(key, `names the same file as ${JSON.stringify(same.key)}`);
            continue;
        }
        entries.set(file, { key, entry });
    }
    const materials = new Set<string>();
    for (const file of Object.keys(record.materials)) {
        const asset = materialPath(file) as string; // checked with the shape
        materials.add(asset);
        if (entries.has(asset)) continue;
        out.push({
            path: `$.record.materials[${JSON.stringify(file)}]`,
            message: `names ${file}, which assets/SOURCES.json has no entry for: list only the files this film uses`,
            detail: { file },
        });
    }
    // A file cut from another (cutout, puppet, sprite) names it in cutFrom
    // and belongs where its original does. Before anything is inherited, each
    // entry must be an object and each cutFrom must lead to an own entry and
    // end: a break or a loop is reported where it is, whatever materials says.
    const broken = new Set<string>();
    for (const [file, { key, entry }] of entries) {
        if (!isObject(entry)) {
            bad(key, `is not an object with source and license (got ${describe(entry as Json)})`);
            broken.add(file);
            continue;
        }
        if (entry.cutFrom === undefined) continue;
        const from = typeof entry.cutFrom === 'string' ? assetPath(entry.cutFrom) : null;
        if (from === null) {
            bad(
                key,
                `has a cutFrom that is not a path inside assets/ (got ${describe(entry.cutFrom as Json)})`,
            );
            broken.add(file);
        } else if (!entries.has(from)) {
            bad(key, `is cut from ${JSON.stringify(entry.cutFrom)}, which has no entry of its own`);
            broken.add(file);
        }
    }
    const next = (file: string): string | null => {
        const entry = entries.get(file)?.entry as Record<string, unknown>;
        return typeof entry.cutFrom === 'string' ? assetPath(entry.cutFrom) : null;
    };
    for (const file of entries.keys()) {
        const chain: string[] = [];
        let at: string | null = file;
        while (at !== null && !broken.has(at) && !chain.includes(at)) {
            chain.push(at);
            at = next(at);
        }
        if (at === null || broken.has(at)) continue;
        const loop = chain.slice(chain.indexOf(at));
        bad(
            entries.get(at)?.key as string,
            `is cut from a file that leads back to it (${[...loop, at].map((f) => `assets/${f}`).join(' → ')}): name the original each file was really cut from`,
        );
        for (const f of loop) broken.add(f);
    }
    const unplaced = new Map<string, string[]>();
    for (const file of entries.keys()) {
        let at = file;
        let placed = false;
        let after = false;
        for (;;) {
            if (broken.has(at)) {
                after = true;
                break;
            }
            if (materials.has(at)) {
                placed = true;
                break;
            }
            const from = next(at);
            if (from === null) break;
            at = from;
        }
        // A file after a break or a loop has no original to belong with: that is reported above.
        if (placed || after) continue;
        unplaced.set(at, [...(unplaced.get(at) ?? []), file]);
    }
    for (const [root, files] of unplaced) {
        const cut = files.filter((file) => file !== root).length;
        out.push({
            path: '$.record.materials',
            message: `has no line for assets/${root}${cut > 0 ? ` (nor for the ${cut} file${cut === 1 ? '' : 's'} cut from it)` : ''}: say which part of the story it is. A file that is not part of the story is decoration, take it out of the film`,
            detail: { file: `assets/${root}`, files: files.map((file) => `assets/${file}`) },
        });
    }
    return out;
}

/**
 * Why a story told from a record falls short of what the film can hold: a
 * file in assets/SOURCES.json with no part in the story, a material the film
 * does not have, or no clue to search in the last words.
 */
function recordProblems(
    record: StoryRecord,
    beats: StoryBeatV2[],
    read: SourcesRead,
): { path: string; message: string; detail: Record<string, unknown> }[] {
    const out: { path: string; message: string; detail: Record<string, unknown> }[] = [];
    if ('problem' in read) {
        out.push({
            path: '$.record.materials',
            message: `cannot be checked: ${read.problem}`,
            detail: { problem: read.problem },
        });
    } else {
        out.push(...materialProblems(record, read.sources));
    }
    const last = beats[beats.length - 1];
    const text = last.text ?? [];
    if (!text.some((line) => line.includes(record.key))) {
        out.push({
            path: '$.record.key',
            message: `"${record.key}" is in none of the words of the last beat "${last.id}" (${text.length === 0 ? 'it has none' : JSON.stringify(text)}): end the film on the clue a viewer can search for`,
            detail: { key: record.key, beat: last.id, text },
        });
    }
    return out;
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
    options: { sources?: SourcesRead } = {},
): { problems: StoryProblem[]; story?: ResolvedStory } {
    const problems: StoryProblem[] = [];
    const add = (
        code: StoryCode,
        at: string,
        message: string,
        detail?: Record<string, unknown>,
        severity: 'error' | 'warning' = 'error',
    ) => problems.push({ code, path: at, message, severity, ...(detail ? { detail } : {}) });

    const { c, story, stage } = validateShape(input);
    for (const error of c.errors) add('story-invalid', error.path, error.message);
    if (!story || !stage) return { problems };

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
    // The slots on stage: each lands in a beat that can carry it.
    for (const slot of SLOTS) {
        const where = story[slot].where;
        if (typeof where === 'string') continue;
        const beat = story.beats.find((b) => b.id === where.beat);
        if (!beat) {
            add(
                'story-invalid',
                `$.${slot}.where.beat`,
                `names no beat (known: ${story.beats.map((b) => b.id).join(', ')})`,
            );
            continue;
        }
        for (const problem of slotProblems(slot, where.via, beat)) {
            add('story-slot', `$.${slot}.where.via`, problem, {
                slot,
                beat: beat.id,
                via: where.via,
            });
        }
    }
    if (stage === 'record' && story.record) {
        // Without SOURCES.json the film has no files: every material then names none.
        const read = options.sources ?? { sources: {} };
        for (const problem of recordProblems(story.record, story.beats, read)) {
            add('story-record', problem.path, problem.message, problem.detail);
        }
    }
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
    // The ending: once the story has landed, the picture needs time before the film stops.
    const film = timeline.durationSec;
    const last = beats[beats.length - 1];
    const words = timeline.cues
        .filter((cue) => cue.kind === 'text')
        .map((cue) => ({ cue, settled: cue.settleFrame / timeline.fps }))
        .sort((a, b) => a.settled - b.settled)
        .at(-1);
    if (words) {
        const room = Math.min(ENDING_AFTER_WORDS_SEC, film * ENDING_SHARE);
        const after = film - words.settled;
        if (after < room - 1e-9) {
            add(
                'story-ending-short',
                `$.beats[${beats.length - 1}]`,
                `ends ${after.toFixed(2)} s after its last words ("${words.cue.text ?? ''}") settle: hold the final picture at least ${room.toFixed(1)} s after them, with a last small action, the light or camera settling and the music landing on its home chord`,
                { beat: last.id, cue: words.cue.id, after, room },
                'warning',
            );
        }
    } else {
        const room = Math.min(ENDING_BEAT_SEC, film * ENDING_SHARE);
        const length = last.end - last.start;
        if (length < room - 1e-9) {
            add(
                'story-ending-short',
                `$.beats[${beats.length - 1}]`,
                `the last beat "${last.id}" lasts ${length.toFixed(2)} s: give the resolution at least ${room.toFixed(1)} s on screen before the film stops`,
                { beat: last.id, length, room },
                'warning',
            );
        }
    }
    if (problems.some((p) => p.severity === 'error')) return { problems };
    const { who, wants, because, becomes, leave, device } = story;
    return {
        problems,
        story: {
            stage,
            who,
            wants,
            because,
            becomes,
            record: story.record ?? null,
            memory: story.memory ?? null,
            leave,
            device,
            beats,
        },
    };
}

/** `<dir>/assets/SOURCES.json` as read: no file is no entries. */
function readSources(dir: string): SourcesRead {
    let text: string | null;
    try {
        text = fs.readFileSync(path.join(dir, 'assets', 'SOURCES.json'), 'utf-8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            return {
                problem: `assets/SOURCES.json cannot be read: ${(error as Error).message}`,
            };
        }
        text = null;
    }
    return parseSources(text);
}

/** Read and check `<dir>/story.json` against the resolved timeline and `<dir>/assets/SOURCES.json`. */
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
                    `No ${STORY_FILE} in ${dir}. Write the story first: who wants what, because of what, what they become and where the viewer finds each, what it leaves the viewer with, the device and the beats.`,
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
    const { problems, story } = validateStory(parsed, timeline, { sources: readSources(dir) });
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
