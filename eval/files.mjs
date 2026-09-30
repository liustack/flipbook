// Small file helpers the eval modules share, and the one way the judging
// code reads what an agent left in a workspace.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, posix, relative, sep } from 'node:path';

/**
 * The one spelling of a file under assets/, from a path relative to assets/
 * (a SOURCES.json key, a cutFrom), or null when it names no file inside
 * assets/. The same rule as assetPath in src/engine/assetSources.ts (the
 * eval stays plain JavaScript, eval/files.test.mjs keeps the two in step).
 */
export function assetPath(rel) {
    if (typeof rel !== 'string' || rel === '' || rel.includes('\\') || rel.includes('\0')) {
        return null;
    }
    if (posix.isAbsolute(rel)) return null;
    const normal = posix.normalize(rel);
    if (normal === '.' || normal === '..' || normal.startsWith('../') || normal.endsWith('/')) {
        return null;
    }
    return normal;
}

/** A path from the composition (`assets/x.png`, `./assets/x.png`) in the one spelling, or null outside assets/. */
export function compositionAsset(path) {
    if (typeof path !== 'string' || path.includes('\\') || path.includes('\0')) return null;
    const normal = posix.normalize(path);
    if (!normal.startsWith('assets/')) return null;
    const file = assetPath(normal.slice('assets/'.length));
    return file === null ? null : `assets/${file}`;
}

export function sha256File(file) {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function readJson(file) {
    try {
        return JSON.parse(readFileSync(file, 'utf-8'));
    } catch {
        return null;
    }
}

/**
 * Files under `dir`, as paths relative to it with forward slashes, skipping
 * `skip` directories. Links are never followed, and listed only with
 * `links: true`.
 */
export function listFiles(dir, skip, { links = false } = {}) {
    const out = [];
    const walk = (folder, prefix) => {
        let entries;
        try {
            entries = readdirSync(folder, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                if (!skip.includes(entry.name)) walk(join(folder, entry.name), rel);
            } else if (entry.isFile() || (links && entry.isSymbolicLink())) {
                out.push(rel);
            }
        }
    };
    walk(dir, '');
    return out.sort();
}

/** `*` matches within one path segment, nothing else is special. */
export function globMatches(pattern, rel) {
    const re = pattern
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*');
    return new RegExp(`^${re}$`).test(rel);
}

/**
 * The way the judging code reads files an agent wrote: only a regular file
 * whose real path, links followed, lies inside the workspace `wsRoot` and
 * outside the `leftOut` folders. Anything else is not read: a missing file
 * reads as null with nothing to say, and a link out of the workspace, a
 * broken link or a file in a left-out folder reads as null too, with a line
 * in `refused` for a person to look at.
 */
export function workspaceReader(wsRoot, { leftOut = [] } = {}) {
    const realRoot = realpathSync(wsRoot);
    const refused = [];
    const shown = (file) => relative(wsRoot, file).split(sep).join('/') || '.';
    const refuse = (file, why) => {
        const line = `${shown(file)} ${why}, not read`;
        if (!refused.includes(line)) refused.push(line);
        return null;
    };
    /** The real path of `file` when it may be read, or null. */
    const real = (file) => {
        try {
            lstatSync(file);
        } catch {
            return null;
        }
        let target;
        try {
            target = realpathSync(file);
        } catch {
            return refuse(file, 'is a link that leads nowhere');
        }
        const back = relative(realRoot, target);
        if (back === '' || back.startsWith('..') || isAbsolute(back))
            return refuse(file, `leads out of the workspace, to ${target}`);
        const folder = back.split(sep).find((part) => leftOut.includes(part));
        if (folder) return refuse(file, `lies in ${folder}/, a folder left out`);
        if (!statSync(target).isFile()) return null;
        return target;
    };
    return {
        real,
        refused,
        text(file) {
            const target = real(file);
            return target ? readFileSync(target, 'utf-8') : null;
        },
        json(file) {
            const text = this.text(file);
            if (text === null) return null;
            try {
                return JSON.parse(text);
            } catch {
                return null;
            }
        },
        sha256(file) {
            const target = real(file);
            return target ? sha256File(target) : null;
        },
        size(file) {
            const target = real(file);
            return target ? statSync(target).size : null;
        },
    };
}
