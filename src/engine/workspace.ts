import { createHash, randomBytes } from 'crypto';
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

/** The directories flipbook writes in a composition. */
export const OWNED_DIRS = ['.flipbook', 'out'] as const;

/** A write refused because a path in the composition is a link or the wrong kind of file. */
export class WorkspaceError extends Error {
    readonly path: string;

    constructor(target: string, message: string) {
        super(message);
        this.name = 'WorkspaceError';
        this.path = target;
    }
}

function errno(error: unknown): string | undefined {
    return (error as NodeJS.ErrnoException).code;
}

const CREATE_EXCLUSIVE =
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW;

/**
 * Every write, delete and move flipbook makes in a composition directory.
 * Paths are checked one component at a time from the real root: a component
 * that is a link, or a file where a directory belongs, stops the operation
 * with a WorkspaceError, so nothing is created, replaced or removed outside
 * the composition. Files are written to a new name and renamed into place,
 * which never writes through an existing link or hard link.
 *
 * ffmpeg writes its outputs itself; it only gets paths inside a directory
 * this class has just emptied with fresh(), so no link can sit at its target.
 */
export class Workspace {
    /** The composition directory as given (resolved). Paths handed out start here. */
    readonly dir: string;
    /** The composition directory with links resolved. Checks start here. */
    readonly root: string;

    private constructor(dir: string, root: string) {
        this.dir = dir;
        this.root = root;
    }

    static open(dir: string): Workspace {
        const resolved = path.resolve(dir);
        return new Workspace(resolved, fs.realpathSync(resolved));
    }

    /** An absolute path under the composition directory. */
    path(...parts: string[]): string {
        return path.join(this.dir, ...parts);
    }

    /** Path components of `target` below the root; refuses anything outside. */
    private parts(target: string): string[] {
        for (const base of [this.dir, this.root]) {
            const rel = path.relative(base, path.resolve(target));
            if (rel === '') return [];
            if (!rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep);
        }
        throw new WorkspaceError(target, `${target} is outside the composition directory.`);
    }

    private real(parts: string[]): string {
        return path.join(this.root, ...parts);
    }

    private stat(file: string): fs.Stats | null {
        try {
            return fs.lstatSync(file);
        } catch (error) {
            if (errno(error) === 'ENOENT') return null;
            throw error;
        }
    }

    /** Walk from the root, creating missing directories when `create` is set. */
    private walkDirs(parts: string[], create: boolean): boolean {
        let current = this.root;
        for (const part of parts) {
            current = path.join(current, part);
            let stat = this.stat(current);
            if (!stat) {
                if (!create) return false;
                try {
                    fs.mkdirSync(current);
                } catch (error) {
                    if (errno(error) !== 'EEXIST') throw error;
                }
                stat = fs.lstatSync(current);
            }
            if (stat.isSymbolicLink()) {
                throw new WorkspaceError(
                    current,
                    `${current} is a symbolic link. flipbook does not write through links.`,
                );
            }
            if (!stat.isDirectory()) {
                throw new WorkspaceError(current, `${current} is not a directory.`);
            }
        }
        return true;
    }

    /** `target` as a directory, created if missing. Every component must be a real directory. */
    ensureDir(target: string): string {
        this.walkDirs(this.parts(target), true);
        return path.resolve(target);
    }

    /** `target` as a new, empty directory. */
    fresh(target: string): string {
        const parts = this.parts(target);
        if (parts.length === 0) throw new WorkspaceError(target, 'Refusing to empty the root.');
        this.walkDirs(parts.slice(0, -1), true);
        const real = this.real(parts);
        const stat = this.stat(real);
        if (stat?.isSymbolicLink()) {
            throw new WorkspaceError(
                real,
                `${real} is a symbolic link. flipbook does not write through links.`,
            );
        }
        if (stat) fs.rmSync(real, { recursive: true, force: true });
        fs.mkdirSync(real);
        return path.resolve(target);
    }

    /** Check that `target` may be replaced: its directory exists and it is not a link or a directory. */
    private replaceable(parts: string[]): string {
        this.walkDirs(parts.slice(0, -1), true);
        const real = this.real(parts);
        const stat = this.stat(real);
        if (stat?.isSymbolicLink()) {
            throw new WorkspaceError(
                real,
                `${real} is a symbolic link. flipbook does not write through links.`,
            );
        }
        if (stat && !stat.isFile()) {
            throw new WorkspaceError(real, `${real} is not a regular file.`);
        }
        return real;
    }

    /** Write `data` to `target`, creating its directories, replacing an existing file. */
    writeFile(target: string, data: string | Buffer): string {
        const parts = this.parts(target);
        if (parts.length === 0) throw new WorkspaceError(target, 'Cannot write the root.');
        const real = this.replaceable(parts);
        const temp = `${real}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
        const fd = fs.openSync(temp, CREATE_EXCLUSIVE, 0o644);
        try {
            fs.writeFileSync(fd, data);
        } finally {
            fs.closeSync(fd);
        }
        try {
            fs.renameSync(temp, real);
        } catch (error) {
            fs.rmSync(temp, { force: true });
            throw error;
        }
        return path.resolve(target);
    }

    /** Copy a file into the workspace. */
    copyFile(source: string, target: string): string {
        return this.writeFile(target, fs.readFileSync(source));
    }

    /** Move a file inside the workspace to `target`, replacing an existing file. */
    move(source: string, target: string): string {
        const from = this.parts(source);
        this.walkDirs(from.slice(0, -1), false);
        const real = this.replaceable(this.parts(target));
        fs.renameSync(this.real(from), real);
        return path.resolve(target);
    }

    /** Remove `target` (a link is removed, never followed). Missing is fine. */
    remove(target: string): void {
        const parts = this.parts(target);
        if (parts.length === 0) throw new WorkspaceError(target, 'Refusing to remove the root.');
        if (!this.walkDirs(parts.slice(0, -1), false)) return;
        fs.rmSync(this.real(parts), { recursive: true, force: true });
    }

    /** Text of `target`, or null when it does not exist. Refuses links. */
    readText(target: string): string | null {
        const parts = this.parts(target);
        if (!this.walkDirs(parts.slice(0, -1), false)) return null;
        let fd: number;
        try {
            fd = fs.openSync(this.real(parts), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        } catch (error) {
            if (errno(error) === 'ENOENT') return null;
            if (errno(error) === 'ELOOP') {
                throw new WorkspaceError(target, `${target} is a symbolic link.`);
            }
            throw error;
        }
        try {
            return fs.readFileSync(fd, 'utf-8');
        } finally {
            fs.closeSync(fd);
        }
    }

    /** Links under .flipbook/ and out/, the two directories included, relative to the root. */
    links(): string[] {
        const found: string[] = [];
        const visit = (rel: string) => {
            const stat = this.stat(path.join(this.root, rel));
            if (!stat) return;
            if (stat.isSymbolicLink()) {
                found.push(rel);
                return;
            }
            if (!stat.isDirectory()) return;
            for (const name of fs.readdirSync(path.join(this.root, rel)).sort()) {
                visit(path.join(rel, name));
            }
        };
        for (const name of OWNED_DIRS) visit(name);
        return found;
    }
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
    const ws = Workspace.open(dir);
    const lock = path.join(ws.ensureDir(ws.path('.flipbook')), 'render.lock');
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
