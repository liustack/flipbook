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
 * when it is empty, absolute, uses backslashes, or leaves assets/.
 */
export function assetPath(rel: string): string | null {
    if (rel === '' || rel.includes('\\') || path.posix.isAbsolute(rel)) return null;
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
 * Change assets/SOURCES.json: read it afresh holding the sources lock (.flipbook/sources.d),
 * apply `edit`, write it back. Commands that run side by side (several stock
 * fetches, a cutout next to a fetch) each see the others' entries. Returns the
 * file's path, or why the file as it is now cannot be read.
 */
export async function updateSources(
    ws: Workspace,
    edit: (sources: Record<string, unknown>) => void,
): Promise<{ path: string } | { problem: string }> {
    return withTicketLock(ws.path(), 'sources', () => {
        const read = parseSources(ws.readText(ws.path('assets', 'SOURCES.json')));
        if ('problem' in read) return read;
        edit(read.sources);
        return {
            path: ws.writeFile(
                ws.path('assets', 'SOURCES.json'),
                `${JSON.stringify(read.sources, null, 4)}\n`,
            ),
        };
    });
}

/**
 * Why the entry for `key` (a path under assets/) in assets/SOURCES.json falls
 * short, or null when it holds. A picture cut from another names it in
 * `cutFrom`: a generated one finds its tool and prompt up that chain.
 */
export function sourceProblem(sources: Record<string, unknown>, key: string): string | null {
    const entry = sources[key];
    if (!isObject(entry)) return 'has no entry';
    if (typeof entry.source !== 'string' || !entry.source) return 'has no source';
    if (typeof entry.license !== 'string' || !entry.license) return 'has no license';
    if (entry.license !== 'generated') return null;
    let tool: unknown = entry.tool;
    let prompt: unknown = entry.prompt;
    let at: Record<string, unknown> = entry;
    const seen = new Set([key]);
    while ((tool === undefined || prompt === undefined) && typeof at.cutFrom === 'string') {
        const from = at.cutFrom;
        const next = sources[from];
        if (seen.has(from)) return `is cut from ${from}, which leads back to itself`;
        if (!isObject(next)) return `is cut from ${from}, which has no entry of its own`;
        seen.add(from);
        at = next;
        tool ??= at.tool;
        prompt ??= at.prompt;
    }
    if (typeof tool !== 'string' || !tool) return 'is generated but names no tool';
    if (typeof prompt !== 'string' || !prompt) return 'is generated but gives no prompt';
    return null;
}

/** What a picture cut from `key` records: the plate's source and license, and where it was cut from. */
export function cutEntry(sources: Record<string, unknown>, key: string): Record<string, unknown> {
    const entry = sources[key] as Record<string, unknown>;
    return { source: entry.source, license: entry.license, cutFrom: key };
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
