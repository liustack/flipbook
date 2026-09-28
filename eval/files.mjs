// Small file helpers the eval modules share.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

/** Files under `dir`, as paths relative to it with forward slashes, skipping `skip` directories. */
export function listFiles(dir, skip) {
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
            } else if (entry.isFile()) {
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
