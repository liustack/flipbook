// A lock that several flipbook processes can wait on, whose holder may die.
//
// It is Lamport's bakery algorithm on files in .flipbook/<name>.d/. Each
// process makes one file, `p.<pid>.<rand>`, with O_EXCL and keeps it, never
// renamed or replaced, until it is done: listing the folder while others come
// and go always returns the files that were there the whole time (POSIX leaves
// only files added or removed during the listing unspecified). The file's
// contents are the state: empty or without its closing newline, the process is
// still choosing; `<number>\n`, it holds that ticket. A process creates its
// file, reads every ticket there, writes one more than the highest, then waits
// until no live process is choosing and none holds a lower ticket (ties go by
// file name). A process that joins while another is waiting creates its file
// after that one wrote its ticket, so it reads that ticket and queues behind.
// Files of dead processes are skipped and removed: a dead process never acts
// again. A live process's file is only removed by itself.
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pidAlive, Workspace, WorkspaceError } from './workspace.ts';

const ENTRY = /^p\.(\d+)\.[0-9a-f]+$/;

interface Entry {
    name: string;
    pid: number;
    file: string;
    /** The ticket, or null while the process is still choosing (or already gone). */
    ticket: number | null;
}

function entries(folder: string): Entry[] {
    const out: Entry[] = [];
    for (const name of fs.readdirSync(folder)) {
        const m = ENTRY.exec(name);
        if (!m) continue;
        const file = path.join(folder, name);
        let text: string;
        try {
            text = fs.readFileSync(file, 'utf-8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
            throw error;
        }
        const ticket = /^(\d+)\n$/.exec(text);
        out.push({ name, pid: Number(m[1]), file, ticket: ticket ? Number(ticket[1]) : null });
    }
    return out;
}

/** Make this process's file and write its ticket: one more than the highest seen. */
function join(folder: string): { me: string; mine: string; ticket: number } {
    const me = `p.${process.pid}.${randomBytes(6).toString('hex')}`;
    const mine = path.join(folder, me);
    fs.writeFileSync(mine, '', { flag: 'wx' });
    try {
        const highest = entries(folder).reduce(
            (n, e) => (e.name !== me && e.ticket !== null ? Math.max(n, e.ticket) : n),
            0,
        );
        const ticket = highest + 1;
        fs.writeFileSync(mine, `${ticket}\n`);
        return { me, mine, ticket };
    } catch (error) {
        fs.rmSync(mine, { force: true });
        throw error;
    }
}

/**
 * What stands before this process now: 'choosing' while a live process has not
 * written its ticket yet, 'ahead' when a live process holds a lower one, null
 * when it is this process's turn. Files of dead processes are removed.
 */
function ahead(folder: string, me: string, ticket: number): 'choosing' | 'ahead' | null {
    let found: 'choosing' | 'ahead' | null = null;
    for (const e of entries(folder)) {
        if (e.name === me) continue;
        if (!pidAlive(e.pid)) {
            fs.rmSync(e.file, { force: true });
            continue;
        }
        if (e.ticket === null) found = 'choosing';
        else if ((e.ticket < ticket || (e.ticket === ticket && e.name < me)) && found === null) {
            found = 'ahead';
        }
    }
    return found;
}

const pause = new Int32Array(new SharedArrayBuffer(4));

/**
 * Take .flipbook/<name>.d without waiting for a holder: the release function,
 * or null when another live process holds it or is ahead in line. A process
 * still writing its ticket is waited for up to `choosingMs` (writing one takes
 * microseconds), then counted as busy.
 */
export function tryTicketLock(dir: string, name: string, choosingMs = 2_000): (() => void) | null {
    const ws = Workspace.open(dir);
    const folder = ws.ensureDir(ws.path('.flipbook', `${name}.d`));
    const { me, mine, ticket } = join(folder);
    const start = Date.now();
    for (;;) {
        const before = ahead(folder, me, ticket);
        if (before === null) return () => fs.rmSync(mine, { force: true });
        if (before === 'ahead' || Date.now() - start > choosingMs) {
            fs.rmSync(mine, { force: true });
            return null;
        }
        Atomics.wait(pause, 0, 0, 5);
    }
}

/**
 * One render (or audio synthesis) per composition at a time, re-entry from the
 * same process included: the release function, or null when one is running.
 */
export function acquireLock(dir: string): (() => void) | null {
    return tryTicketLock(dir, 'render');
}

/**
 * Run `fn` holding .flipbook/<name>.d of the composition in `dir`: every
 * other process waiting on the same name runs its `fn` before or after, never
 * alongside. Throws a WorkspaceError after `timeoutMs` of waiting.
 */
export async function withTicketLock<T>(
    dir: string,
    name: string,
    fn: () => T,
    timeoutMs = 30_000,
): Promise<T> {
    const ws = Workspace.open(dir);
    const folder = ws.ensureDir(ws.path('.flipbook', `${name}.d`));
    const { me, mine, ticket } = join(folder);
    try {
        const start = Date.now();
        while (ahead(folder, me, ticket) !== null) {
            if (Date.now() - start > timeoutMs) {
                throw new WorkspaceError(
                    folder,
                    `.flipbook/${name}.d stayed busy for ${Math.round(timeoutMs / 1000)} s: another flipbook command is still writing.`,
                );
            }
            await new Promise((resolve) => setTimeout(resolve, 15));
        }
        return fn();
    } finally {
        fs.rmSync(mine, { force: true });
    }
}
