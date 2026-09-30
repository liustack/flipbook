// A lock file that cannot be opened (EPERM, as on Windows while files come and
// go in the folder) is read as the unknown ticket of a live process: waited on,
// then counted as busy, never reported as a broken path.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { LockBusyError, tryTicketLock, withTicketLock } from '../src/engine/ticketLock.ts';
import { WorkspaceError } from '../src/engine/workspace.ts';
import { cleanTemps, tempDir } from './helpers.ts';

// Reads of a file named here succeed `pass` times, then fail with EPERM.
const unreadable = new Map<string, { pass: number }>();

vi.mock('fs', async (importOriginal) => {
    const real = await importOriginal<typeof import('fs')>();
    const readFileSync = ((file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
        const name = path.basename(String(file));
        const rule = unreadable.get(name);
        if (rule && rule.pass-- <= 0) {
            throw Object.assign(new Error(`EPERM: operation not permitted, open '${file}'`), {
                code: 'EPERM',
            });
        }
        return (real.readFileSync as (...a: unknown[]) => unknown)(file, ...rest);
    }) as typeof real.readFileSync;
    return { ...real, readFileSync, default: { ...real, readFileSync } };
});

afterAll(cleanTemps);
afterEach(() => unreadable.clear());

const DEAD = 2 ** 22 + 11;

function lockFolder(name: string): { dir: string; folder: string } {
    const dir = tempDir('ticket-eperm');
    const folder = path.join(dir, '.flipbook', `${name}.d`);
    fs.mkdirSync(folder, { recursive: true });
    return { dir, folder };
}

describe('a lock file that cannot be read for a moment', () => {
    it('is waited on, and the lock is taken once it is gone', async () => {
        const { dir, folder } = lockFolder('sources');
        const name = `p.${process.ppid}.ee`;
        fs.writeFileSync(path.join(folder, name), '1\n');
        // read while joining, then unreadable: removed meanwhile, as a released lock file is
        unreadable.set(name, { pass: 1 });
        setTimeout(() => fs.rmSync(path.join(folder, name), { force: true }), 50);
        await expect(withTicketLock(dir, 'sources', () => 'ran')).resolves.toBe('ran');
        expect(fs.readdirSync(folder)).toEqual([]);
    });

    it('counts as a process still choosing once the ticket is chosen', () => {
        const { dir, folder } = lockFolder('render');
        const name = `p.${process.ppid}.ee`;
        fs.writeFileSync(path.join(folder, name), '1\n');
        // read while joining, unreadable when looking who is ahead
        unreadable.set(name, { pass: 1 });
        const start = Date.now();
        expect(tryTicketLock(dir, 'render', 50)).toBeNull();
        expect(Date.now() - start).toBeGreaterThanOrEqual(50);
        expect(fs.readdirSync(folder)).toEqual([name]);
    });

    it('counts as busy, within one deadline, when a live process keeps it unreadable before a ticket is chosen', () => {
        const { dir, folder } = lockFolder('render');
        const name = `p.${process.ppid}.ee`;
        fs.writeFileSync(path.join(folder, name), '1\n');
        unreadable.set(name, { pass: 0 });
        const start = Date.now();
        expect(tryTicketLock(dir, 'render', 200)).toBeNull();
        const took = Date.now() - start;
        expect(took).toBeGreaterThanOrEqual(200);
        // Joining and looking who is ahead share the one wait, not two.
        expect(took).toBeLessThan(1_000);
        expect(fs.readdirSync(folder)).toEqual([name]);
    }, 10_000);

    it('throws a LockBusyError, not a WorkspaceError, when it stays unreadable while queueing to write', async () => {
        const { dir, folder } = lockFolder('sources');
        const name = `p.${process.ppid}.ee`;
        fs.writeFileSync(path.join(folder, name), '1\n');
        unreadable.set(name, { pass: 0 });
        const start = Date.now();
        const error = await withTicketLock(dir, 'sources', () => 1, 300).catch((e) => e);
        expect(error).toBeInstanceOf(LockBusyError);
        expect(error).not.toBeInstanceOf(WorkspaceError);
        expect(error.lock).toBe('sources');
        expect(Date.now() - start).toBeLessThan(2_000);
        expect(fs.readdirSync(folder)).toEqual([name]);
    }, 10_000);

    it('is passed over, and left alone, when a dead process owns it', () => {
        const { dir, folder } = lockFolder('render');
        const name = `p.${DEAD}.ee`;
        fs.writeFileSync(path.join(folder, name), '1\n');
        unreadable.set(name, { pass: 0 });
        const release = tryTicketLock(dir, 'render', 50);
        expect(release).not.toBeNull();
        release?.();
        expect(fs.readdirSync(folder)).toEqual([name]);
    });
});
