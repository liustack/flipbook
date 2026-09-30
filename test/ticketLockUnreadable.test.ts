// On Windows a lock file that one process is removing while another reads it
// cannot be opened for a moment: opening it fails with EPERM. The lock reads
// such a file as unknown instead of failing.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { tryTicketLock, withTicketLock } from '../src/engine/ticketLock.ts';
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

    it('stops joining with an error when a live process keeps it unreadable', () => {
        const { dir, folder } = lockFolder('render');
        const name = `p.${process.ppid}.ee`;
        fs.writeFileSync(path.join(folder, name), '1\n');
        unreadable.set(name, { pass: 0 });
        expect(() => tryTicketLock(dir, 'render')).toThrow(WorkspaceError);
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
