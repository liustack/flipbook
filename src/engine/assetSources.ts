// Every picture under assets/ carries its source and license in
// assets/SOURCES.json. A generated picture also names the tool that made it
// and the prompt, so where it came from can be told later.
import * as fs from 'fs';
import * as path from 'path';
import { type Finding, finding } from '../cli/report.ts';
import { isObject } from './schema.ts';
import { withTicketLock } from './ticketLock.ts';
import type { Workspace } from './workspace.ts';

const IMAGES = /\.(png|jpe?g|webp|gif|svg|avif)$/i;

/**
 * The one spelling of a file under assets/, from a path relative to assets/
 * (a SOURCES.json key, a cutFrom): forward slashes, no `.` or `..` steps. Null
 * when it is empty, absolute, uses backslashes, holds a NUL character (no file
 * system takes one), or leaves assets/.
 */
export function assetPath(rel: string): string | null {
    if (rel === '' || rel.includes('\\') || rel.includes('\0') || path.posix.isAbsolute(rel)) {
        return null;
    }
    const normal = path.posix.normalize(rel);
    if (normal === '.' || normal === '..' || normal.startsWith('../') || normal.endsWith('/')) {
        return null;
    }
    return normal;
}

/**
 * assets/SOURCES.json as an object of entries, from its text (null when the
 * file is missing: no entries yet), or why it cannot be read as one.
 */
export function parseSources(
    text: string | null,
): { sources: Record<string, unknown> } | { problem: string } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text ?? '{}');
    } catch (error) {
        return { problem: `assets/SOURCES.json is not valid JSON: ${(error as Error).message}` };
    }
    if (!isObject(parsed)) {
        return { problem: 'assets/SOURCES.json must be a JSON object of entries, one per file' };
    }
    return { sources: parsed };
}

/**
 * Run `fn` holding the sources lock (.flipbook/sources.d), with
 * assets/SOURCES.json read afresh and `save` to write it back. Commands that
 * run side by side (several stock fetches, a cutout next to a fetch) each see
 * the others' entries, and whatever `fn` puts in assets/ is decided in the
 * same turn. Returns what `fn` returns, or why the file as it is now cannot be
 * read (then `fn` does not run). Throws a LockBusyError when the lock stays
 * busy: nothing has run then.
 */
export async function withSources<T>(
    ws: Workspace,
    fn: (sources: Record<string, unknown>, save: () => string) => T,
): Promise<T | { problem: string }> {
    return withTicketLock(ws.path(), 'sources', () => {
        const read = parseSources(ws.readText(ws.path('assets', 'SOURCES.json')));
        if ('problem' in read) return read;
        const save = () =>
            ws.writeFile(
                ws.path('assets', 'SOURCES.json'),
                `${JSON.stringify(read.sources, null, 4)}\n`,
            );
        return fn(read.sources, save);
    });
}

/**
 * Change assets/SOURCES.json: read it afresh holding the sources lock, apply
 * `edit`, write it back. Returns the file's path, or why the file as it is now
 * cannot be read.
 */
export async function updateSources(
    ws: Workspace,
    edit: (sources: Record<string, unknown>) => void,
): Promise<{ path: string } | { problem: string }> {
    return withSources(ws, (sources, save) => {
        edit(sources);
        return { path: save() };
    });
}

/**
 * assets/SOURCES.json read by file: every own key in the one spelling
 * assetPath gives. Every reader of the file (picture and sound sources, cut
 * files, the story's materials, cutout, puppet, sprite, stock) looks entries
 * up through it, so "a.png" and "./a.png" name the same file everywhere.
 */
export interface SourceIndex {
    /** Each file with its first key, as written, and that key's entry. */
    files: Map<string, { key: string; entry: unknown }>;
    /** Files that two or more keys name, with those keys: none of them is used. */
    twice: Map<string, string[]>;
    /** Keys that are not a path inside assets/. */
    outside: string[];
}

export function indexSources(sources: Record<string, unknown>): SourceIndex {
    const files = new Map<string, { key: string; entry: unknown }>();
    const twice = new Map<string, string[]>();
    const outside: string[] = [];
    for (const [key, entry] of Object.entries(sources)) {
        const file = assetPath(key);
        if (file === null) {
            outside.push(key);
            continue;
        }
        const first = files.get(file);
        if (first) {
            twice.set(file, [...(twice.get(file) ?? [first.key]), key]);
            continue;
        }
        files.set(file, { key, entry });
    }
    return { files, twice, outside };
}

/**
 * The entry for `file` (a path under assets/, in any spelling): its key as
 * written and its value, or why there is none to use. Two keys for one file
 * are refused, never one picked over the other.
 */
export function sourceEntry(
    index: SourceIndex,
    file: string,
): { key: string; entry: unknown } | { problem: string } {
    const at = assetPath(file);
    if (at === null) return { problem: 'is not a path inside assets/' };
    const keys = index.twice.get(at);
    if (keys) {
        return {
            problem: `has ${keys.length} entries (${keys.map((k) => JSON.stringify(k)).join(', ')})`,
        };
    }
    return index.files.get(at) ?? { problem: 'has no entry' };
}

/**
 * Why the entry for `file` (a path under assets/, in any spelling) in
 * assets/SOURCES.json falls short, or null when it holds. A picture cut from
 * another names it in `cutFrom`: a generated one finds its tool and prompt up
 * that chain, looked up the same way.
 */
export function sourceProblem(sources: Record<string, unknown>, file: string): string | null {
    const index = indexSources(sources);
    const found = sourceEntry(index, file);
    if ('problem' in found) return found.problem;
    const entry = found.entry;
    if (!isObject(entry)) return 'has no entry';
    if (typeof entry.source !== 'string' || !entry.source) return 'has no source';
    if (typeof entry.license !== 'string' || !entry.license) return 'has no license';
    if (entry.license !== 'generated') return null;
    let tool: unknown = entry.tool;
    let prompt: unknown = entry.prompt;
    let at: Record<string, unknown> = entry;
    const seen = new Set([assetPath(file)]);
    while ((tool === undefined || prompt === undefined) && typeof at.cutFrom === 'string') {
        const from = at.cutFrom;
        if (seen.has(assetPath(from))) return `is cut from ${from}, which leads back to itself`;
        const next = sourceEntry(index, from);
        if ('problem' in next) {
            return next.problem === 'has no entry'
                ? `is cut from ${from}, which has no entry of its own`
                : `is cut from ${from}, which ${next.problem}`;
        }
        if (!isObject(next.entry)) return `is cut from ${from}, which has no entry of its own`;
        seen.add(assetPath(from));
        at = next.entry;
        tool ??= at.tool;
        prompt ??= at.prompt;
    }
    if (typeof tool !== 'string' || !tool) return 'is generated but names no tool';
    if (typeof prompt !== 'string' || !prompt) return 'is generated but gives no prompt';
    return null;
}

/**
 * What a picture cut from `file` records: the plate's source and license, and
 * where it was cut from, in the one spelling. `file` must have passed sourceProblem.
 */
export function cutEntry(sources: Record<string, unknown>, file: string): Record<string, unknown> {
    const found = sourceEntry(indexSources(sources), file) as { entry: Record<string, unknown> };
    return { source: found.entry.source, license: found.entry.license, cutFrom: assetPath(file) };
}

/**
 * Put `added` (entries flipbook writes, keyed by path under assets/ in the one
 * spelling) into `current`, SOURCES.json as read for a write. A key that names
 * the same file in another spelling goes first, and so does every entry under
 * `under` (a folder a rerun replaces whole), so no file ends up with two keys.
 * The other keys stay as the user wrote them.
 */
export function putSources(
    current: Record<string, unknown>,
    added: Record<string, unknown>,
    under?: string,
): void {
    const replaced = new Set(Object.keys(added).map((key) => assetPath(key)));
    for (const key of Object.keys(current)) {
        const file = assetPath(key);
        if (file === null) continue;
        if (replaced.has(file) || (under !== undefined && file.startsWith(under))) {
            delete current[key];
        }
    }
    Object.assign(current, added);
}

/** Pictures under assets/, fonts aside, as paths relative to assets/. */
function pictures(dir: string): string[] {
    const root = path.join(dir, 'assets');
    const out: string[] = [];
    const walk = (folder: string) => {
        let names: string[];
        try {
            names = fs.readdirSync(folder);
        } catch {
            return;
        }
        for (const name of names.sort()) {
            const full = path.join(folder, name);
            const rel = path.relative(root, full).split(path.sep).join('/');
            if (rel === 'fonts') continue;
            const stat = fs.statSync(full, { throwIfNoEntry: false });
            if (stat?.isDirectory()) walk(full);
            else if (stat?.isFile() && IMAGES.test(name)) out.push(rel);
        }
    };
    walk(root);
    return out;
}

/**
 * asset-unlicensed for every picture under assets/ without a full entry.
 * `licensed` holds real paths whose license is stated elsewhere (the brand
 * logo, in brand.json).
 */
export function pictureSourceFindings(dir: string, licensed: readonly string[] = []): Finding[] {
    const skip = new Set(licensed);
    const found = pictures(dir).filter((rel) => {
        try {
            return !skip.has(fs.realpathSync(path.join(dir, 'assets', rel)));
        } catch {
            return true;
        }
    });
    if (found.length === 0) return [];
    let sources: Record<string, unknown> = {};
    try {
        const parsed = JSON.parse(
            fs.readFileSync(path.join(dir, 'assets', 'SOURCES.json'), 'utf-8'),
        );
        if (isObject(parsed)) sources = parsed;
    } catch {
        // No file or no JSON: every picture is then without an entry.
    }
    const findings: Finding[] = [];
    for (const rel of found) {
        const problem = sourceProblem(sources, rel);
        if (!problem) continue;
        findings.push(
            finding('asset-unlicensed', `assets/${rel} ${problem} in assets/SOURCES.json.`, {
                element: `assets/${rel}`,
                detail: { file: `assets/${rel}`, problem },
            }),
        );
    }
    return findings;
}
