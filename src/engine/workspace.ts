import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const SKIP = new Set(['.flipbook', 'out', 'node_modules', '.git', '.DS_Store']);

function walk(dir: string, root: string, out: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, root, out);
        else if (entry.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
    }
}

/** sha256 over every source file of the composition (paths and bytes), outputs excluded. */
export function compositionHash(dir: string): string {
    const files: string[] = [];
    walk(dir, dir, files);
    files.sort();
    const hash = createHash('sha256');
    for (const rel of files) {
        const bytes = fs.readFileSync(path.join(dir, rel));
        hash.update(rel);
        hash.update('\0');
        hash.update(String(bytes.length));
        hash.update('\0');
        hash.update(bytes);
    }
    return `sha256:${hash.digest('hex')}`;
}

export function sha256(bytes: Buffer | string): string {
    return createHash('sha256').update(bytes).digest('hex');
}

/** .flipbook/<parts...>, created. */
export function workDir(dir: string, ...parts: string[]): string {
    const target = path.join(dir, '.flipbook', ...parts);
    fs.mkdirSync(target, { recursive: true });
    return target;
}

function pidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}

/**
 * Take .flipbook/render.lock. Returns a release function, or null when a live
 * process holds it. A lock left by a dead process is taken over.
 */
export function acquireLock(dir: string): (() => void) | null {
    const lock = path.join(workDir(dir), 'render.lock');
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const fd = fs.openSync(lock, 'wx');
            fs.writeSync(fd, String(process.pid));
            fs.closeSync(fd);
            return () => fs.rmSync(lock, { force: true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            const holder = Number.parseInt(fs.readFileSync(lock, 'utf-8'), 10);
            if (Number.isFinite(holder) && holder !== process.pid && pidAlive(holder)) return null;
            fs.rmSync(lock, { force: true });
        }
    }
    return null;
}
