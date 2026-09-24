import * as fs from 'fs';
import * as path from 'path';
import { type Finding, finding } from '../cli/report.ts';
import {
    type ResolvedTimeline,
    resolveTimeline,
    TIMELINE_VERSION,
    type TimelineV1,
} from './timelineResolve.ts';

export const MAX_DURATION_SEC = 180;

export interface SchemaError {
    /** JSON path, e.g. $.scenes[1].bars */
    path: string;
    message: string;
}

type Json = unknown;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const KEY_PATTERN = /^[A-G](#|b)?m?$/;

function isObject(value: Json): value is Record<string, Json> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInt(value: Json): value is number {
    return typeof value === 'number' && Number.isInteger(value);
}

function isNum(value: Json): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function describe(value: Json): string {
    if (value === undefined) return 'missing';
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'an array';
    if (typeof value === 'string')
        return `"${value.length > 40 ? `${value.slice(0, 40)}...` : value}"`;
    return String(value);
}

class Checker {
    readonly errors: SchemaError[] = [];

    fail(at: string, message: string): void {
        this.errors.push({ path: at, message });
    }

    keys(obj: Record<string, Json>, at: string, allowed: readonly string[]): void {
        for (const key of Object.keys(obj)) {
            if (!allowed.includes(key)) {
                this.fail(
                    `${at}.${key}`,
                    `is not a timeline v1 field (allowed here: ${allowed.join(', ')})`,
                );
            }
        }
    }

    int(value: Json, at: string, min: number, max: number, extra?: string): boolean {
        if (!isInt(value) || value < min || value > max) {
            this.fail(
                at,
                `must be an integer from ${min} to ${max}${extra ? `, ${extra}` : ''} (got ${describe(value)})`,
            );
            return false;
        }
        return true;
    }

    num(value: Json, at: string, min: number, max: number, exclusiveMin = false): boolean {
        const tooLow = isNum(value) && (exclusiveMin ? value <= min : value < min);
        if (!isNum(value) || tooLow || value > max) {
            const floor = exclusiveMin ? `greater than ${min}` : `at least ${min}`;
            this.fail(at, `must be a number ${floor} and at most ${max} (got ${describe(value)})`);
            return false;
        }
        return true;
    }

    str(value: Json, at: string, pattern?: RegExp, what = 'a string'): value is string {
        if (typeof value !== 'string' || value.length === 0 || (pattern && !pattern.test(value))) {
            this.fail(at, `must be ${what} (got ${describe(value)})`);
            return false;
        }
        return true;
    }
}

/** Validate a parsed timeline.json against schema v1. */
export function validateTimeline(input: Json): { errors: SchemaError[]; timeline?: TimelineV1 } {
    const c = new Checker();
    if (!isObject(input)) {
        c.fail('$', 'must be a JSON object');
        return { errors: c.errors };
    }
    c.keys(input, '$', [
        '$schema',
        'version',
        'width',
        'height',
        'fps',
        'seed',
        'bpm',
        'beatsPerBar',
        'scenes',
        'cues',
        'audio',
    ]);
    if (input.version !== TIMELINE_VERSION) {
        c.fail('$.version', `must be ${TIMELINE_VERSION} (got ${describe(input.version)})`);
    }
    for (const [key, max] of [
        ['width', 7680],
        ['height', 4320],
    ] as const) {
        if (c.int(input[key], `$.${key}`, 16, max) && (input[key] as number) % 2 !== 0) {
            c.fail(`$.${key}`, `must be even, yuv420p needs even sizes (got ${input[key]})`);
        }
    }
    c.int(input.fps, '$.fps', 1, 60);
    c.int(input.seed, '$.seed', 0, 4294967295);
    c.num(input.bpm, '$.bpm', 30, 300);
    const beatsPerBarOk = c.int(input.beatsPerBar, '$.beatsPerBar', 1, 16);
    const beatsPerBar = beatsPerBarOk ? (input.beatsPerBar as number) : 0;

    const sceneBeats = new Map<string, number>();
    let totalBeats = 0;
    if (!Array.isArray(input.scenes) || input.scenes.length === 0) {
        c.fail('$.scenes', `must be a non-empty array (got ${describe(input.scenes)})`);
    } else {
        input.scenes.forEach((scene: Json, i: number) => {
            const at = `$.scenes[${i}]`;
            if (!isObject(scene)) {
                c.fail(at, 'must be an object with id and bars');
                return;
            }
            c.keys(scene, at, ['id', 'bars', 'hold']);
            if (c.str(scene.id, `${at}.id`, ID_PATTERN, 'an id of letters, digits, - or _')) {
                if (sceneBeats.has(scene.id)) c.fail(`${at}.id`, `duplicates scene "${scene.id}"`);
            }
            if (c.num(scene.bars, `${at}.bars`, 0, 1000, true) && beatsPerBar > 0) {
                const beats = (scene.bars as number) * beatsPerBar;
                if (!Number.isInteger(beats)) {
                    c.fail(
                        `${at}.bars`,
                        `must span whole beats: bars x beatsPerBar = ${beats} is not an integer`,
                    );
                } else {
                    totalBeats += beats;
                    if (typeof scene.id === 'string') sceneBeats.set(scene.id, beats);
                }
            }
            if (scene.hold !== undefined && typeof scene.hold !== 'boolean') {
                c.fail(`${at}.hold`, `must be true or false (got ${describe(scene.hold)})`);
            }
        });
    }

    if (input.cues !== undefined) {
        if (!Array.isArray(input.cues)) {
            c.fail('$.cues', `must be an array (got ${describe(input.cues)})`);
        } else {
            const cueIds = new Set<string>();
            input.cues.forEach((cue: Json, i: number) => {
                const at = `$.cues[${i}]`;
                if (!isObject(cue)) {
                    c.fail(at, 'must be an object with id, scene, beat and kind');
                    return;
                }
                c.keys(cue, at, ['id', 'scene', 'beat', 'kind', 'text', 'settleBeats', 'sfx']);
                if (c.str(cue.id, `${at}.id`, ID_PATTERN, 'an id of letters, digits, - or _')) {
                    if (cueIds.has(cue.id)) c.fail(`${at}.id`, `duplicates cue "${cue.id}"`);
                    cueIds.add(cue.id);
                }
                let beats: number | undefined;
                if (c.str(cue.scene, `${at}.scene`)) {
                    beats = sceneBeats.get(cue.scene);
                    if (beats === undefined) {
                        c.fail(
                            `${at}.scene`,
                            `names no scene (known: ${[...sceneBeats.keys()].join(', ') || 'none'})`,
                        );
                    }
                }
                if (isNum(cue.beat) && beats !== undefined) {
                    if (cue.beat < 0 || cue.beat >= beats) {
                        c.fail(
                            `${at}.beat`,
                            `must be at least 0 and below ${beats}, the beats in scene "${cue.scene}" (got ${cue.beat})`,
                        );
                    }
                } else if (!isNum(cue.beat)) {
                    c.fail(`${at}.beat`, `must be a number of beats (got ${describe(cue.beat)})`);
                }
                if (cue.kind !== 'text' && cue.kind !== 'sfx' && cue.kind !== 'mark') {
                    c.fail(
                        `${at}.kind`,
                        `must be "text", "sfx" or "mark" (got ${describe(cue.kind)})`,
                    );
                }
                if (cue.kind === 'text') {
                    c.str(cue.text, `${at}.text`, undefined, 'the on-screen text');
                } else if (cue.text !== undefined) {
                    c.fail(`${at}.text`, 'is only allowed on kind "text"');
                }
                if (cue.kind === 'sfx') {
                    c.str(cue.sfx, `${at}.sfx`, ID_PATTERN, 'a sound effect name');
                } else if (cue.sfx !== undefined) {
                    c.fail(`${at}.sfx`, 'is only allowed on kind "sfx"');
                }
                if (cue.settleBeats !== undefined) {
                    c.num(cue.settleBeats, `${at}.settleBeats`, 0, 64);
                }
            });
        }
    }

    if (input.audio !== undefined) {
        const audio = input.audio;
        if (!isObject(audio)) {
            c.fail('$.audio', `must be an object (got ${describe(audio)})`);
        } else {
            c.keys(audio, '$.audio', ['mode', 'preset', 'key', 'progression', 'file', 'bpmOffset']);
            if (audio.mode !== 'preset' && audio.mode !== 'file' && audio.mode !== 'none') {
                c.fail(
                    '$.audio.mode',
                    `must be "preset", "file" or "none" (got ${describe(audio.mode)})`,
                );
            }
            if (audio.mode === 'preset' || audio.preset !== undefined) {
                c.str(audio.preset, '$.audio.preset', ID_PATTERN, 'a preset name');
            }
            if (audio.key !== undefined) {
                c.str(audio.key, '$.audio.key', KEY_PATTERN, 'a key such as D, F# or Bbm');
            }
            if (audio.progression !== undefined) {
                c.int(audio.progression, '$.audio.progression', 0, 99);
            }
            if (audio.mode === 'file' || audio.file !== undefined) {
                if (c.str(audio.file, '$.audio.file', undefined, 'a path inside the composition')) {
                    const file = audio.file as string;
                    if (path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) {
                        c.fail('$.audio.file', 'must be a relative path inside the composition');
                    }
                }
            }
            if (audio.bpmOffset !== undefined) {
                c.num(audio.bpmOffset, '$.audio.bpmOffset', 0, 60);
            }
        }
    }

    if (c.errors.length === 0 && isNum(input.bpm)) {
        const duration = (totalBeats * 60) / input.bpm;
        if (duration > MAX_DURATION_SEC) {
            c.fail(
                '$.scenes',
                `add up to ${duration.toFixed(2)} s; the limit is ${MAX_DURATION_SEC} s`,
            );
        }
        if (Math.round(duration * (input.fps as number)) < 1) {
            c.fail('$.scenes', 'add up to less than one frame');
        }
    }

    if (c.errors.length > 0) return { errors: c.errors };
    return { errors: [], timeline: input as unknown as TimelineV1 };
}

export interface LoadedTimeline {
    timeline?: TimelineV1;
    resolved?: ResolvedTimeline;
    findings: Finding[];
}

/** Read, validate and resolve `<dir>/timeline.json`. Writes the resolved copy on success. */
export function loadTimeline(dir: string, write = true): LoadedTimeline {
    const file = path.join(dir, 'timeline.json');
    let raw: string;
    try {
        raw = fs.readFileSync(file, 'utf-8');
    } catch {
        return {
            findings: [finding('timeline-missing', `No timeline.json in ${dir}.`)],
        };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        return {
            findings: [
                finding(
                    'timeline-invalid',
                    `timeline.json is not valid JSON: ${(error as Error).message}`,
                    { detail: { path: '$' } },
                ),
            ],
        };
    }
    const { errors, timeline } = validateTimeline(parsed);
    if (!timeline) {
        return {
            findings: errors.map((error) =>
                finding('timeline-invalid', `${error.path} ${error.message}`, {
                    detail: { path: error.path },
                }),
            ),
        };
    }
    const resolved = resolveTimeline(timeline);
    if (write) {
        const outDir = path.join(dir, '.flipbook');
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(
            path.join(outDir, 'timeline.resolved.json'),
            `${JSON.stringify(resolved, null, 2)}\n`,
        );
    }
    return { timeline, resolved, findings: [] };
}
