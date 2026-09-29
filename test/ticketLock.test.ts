// The sources lock across real processes: many writers at once, a holder
// paused or killed while it writes, files left by dead processes, a timeout.
import { type ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { afterAll, describe, expect, it } from 'vitest';
import { updateSources } from '../src/engine/assetSources.ts';
import { withTicketLock } from '../src/engine/ticketLock.ts';
import { Workspace, WorkspaceError } from '../src/engine/workspace.ts';
import { cleanTemps, tempDir } from './helpers.ts';

afterAll(cleanTemps);

const src = path.resolve('src');
const DEAD = 2 ** 22 + 11;

function composition(): string {
    const dir = tempDir('ticket');
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'assets', 'SOURCES.json'), '{}\n');
    return dir;
}

const sources = (dir: string) =>
    JSON.parse(fs.readFileSync(path.join(dir, 'assets', 'SOURCES.json'), 'utf-8')) as Record<
        string,
        unknown
    >;

/**
 * A child process that adds `count` entries named <name>-<k>. With `hold`, it
 * marks <name>-in inside its first edit and waits there for <name>-go.
 */
function writer(
    dir: string,
    name: string,
    count: number,
    hold = false,
): { proc: ChildProcess; exit: Promise<number | null> } {
    const code = `
        import fs from 'node:fs';
        import path from 'node:path';
        const dir = ${JSON.stringify(dir)};
        const clock = new Int32Array(new SharedArrayBuffer(4));
        const wait = (f) => { const end = Date.now() + 20000; while (!fs.existsSync(path.join(dir, f))) { if (Date.now() > end) throw new Error('no ' + f); Atomics.wait(clock, 0, 0, 5); } };
        const { updateSources } = await import(${JSON.stringify(pathToFileURL(path.join(src, 'engine', 'assetSources.ts')).href)});
        const { Workspace } = await import(${JSON.stringify(pathToFileURL(path.join(src, 'engine', 'workspace.ts')).href)});
        for (let k = 0; k < ${count}; k++) {
            await updateSources(Workspace.open(dir), (s) => {
                if (${hold} && k === 0) { fs.writeFileSync(path.join(dir, '${name}-in'), ''); wait('${name}-go'); }
                s['${name}-' + k + '.png'] = { source: '${name}', license: 'cc0' };
            });
        }
    `;
    const proc = spawn(
        process.execPath,
        ['--experimental-transform-types', '--input-type=module', '-e', code],
        {
            stdio: ['ignore', 'ignore', 'inherit'],
        },
    );
    return { proc, exit: new Promise((resolve) => proc.on('exit', resolve)) };
}

async function until(dir: string, file: string): Promise<void> {
    const end = Date.now() + 20_000;
    while (!fs.existsSync(path.join(dir, file))) {
        if (Date.now() > end) throw new Error(`no ${file}`);
        await new Promise((r) => setTimeout(r, 10));
    }
}

describe('the sources lock', () => {
    it('keeps every entry when several processes write at once', async () => {
        const dir = composition();
        const writers = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => writer(dir, n, 12));
        expect(await Promise.all(writers.map((w) => w.exit))).toEqual([0, 0, 0, 0, 0, 0]);
        expect(Object.keys(sources(dir))).toHaveLength(72);
        expect(fs.readdirSync(path.join(dir, '.flipbook', 'sources.d'))).toEqual([]);
    }, 60_000);

    it('lets nobody in while the holder is still writing', async () => {
        const dir = composition();
        const a = writer(dir, 'a', 1, true);
        await until(dir, 'a-in');
        const b = writer(dir, 'b', 1);
        await new Promise((r) => setTimeout(r, 700));
        expect(Object.keys(sources(dir))).toEqual([]);
        fs.writeFileSync(path.join(dir, 'a-go'), '');
        expect(await Promise.all([a.exit, b.exit])).toEqual([0, 0]);
        expect(Object.keys(sources(dir)).sort()).toEqual(['a-0.png', 'b-0.png']);
    }, 60_000);

    it('goes on when the holder is killed while it writes', async () => {
        const dir = composition();
        const a = writer(dir, 'a', 1, true);
        await until(dir, 'a-in');
        const b = writer(dir, 'b', 1);
        a.proc.kill('SIGKILL');
        await a.exit;
        expect(await b.exit).toBe(0);
        expect(Object.keys(sources(dir))).toEqual(['b-0.png']);
    }, 60_000);

    it('skips and removes what dead processes left behind', async () => {
        const dir = composition();
        const folder = path.join(dir, '.flipbook', 'sources.d');
        fs.mkdirSync(folder, { recursive: true });
        // one still choosing, two holding tickets, all dead
        fs.writeFileSync(path.join(folder, `p.${DEAD}.aa`), '');
        fs.writeFileSync(path.join(folder, `p.${DEAD}.bb`), '1\n');
        fs.writeFileSync(path.join(folder, `p.${DEAD}.cc`), '7\n');
        const written = await updateSources(Workspace.open(dir), (s) => {
            s['x.png'] = { source: 'x', license: 'cc0' };
        });
        expect('path' in written).toBe(true);
        expect(fs.readdirSync(folder)).toEqual([]);
    });

    it('gives up after its time limit while a live holder keeps it', async () => {
        const dir = composition();
        const a = writer(dir, 'a', 1, true);
        await until(dir, 'a-in');
        await expect(withTicketLock(dir, 'sources', () => 1, 300)).rejects.toBeInstanceOf(
            WorkspaceError,
        );
        fs.writeFileSync(path.join(dir, 'a-go'), '');
        expect(await a.exit).toBe(0);
    }, 60_000);
});
