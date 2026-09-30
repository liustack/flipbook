// A lock another flipbook process holds, or whose file cannot be read, is a
// wait: the real CLI reports render-busy or sources-busy, records no attempt,
// and never tells the user to delete a lock folder that may be in use.
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanTemps, cli, copyFixture, runCli, tempDir } from './helpers.ts';

afterAll(cleanTemps);

// Loaded with --import into the CLI: the file named in FLIPBOOK_TEST_EPERM
// cannot be opened (EPERM, as on Windows), and with FLIPBOOK_TEST_FAST_LOCK
// the clock withTicketLock reads runs a second ahead on every look, so its
// 30 s wait for SOURCES.json runs out at once.
const LOADER = `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const peer = process.env.FLIPBOOK_TEST_EPERM;
const read = fs.readFileSync;
fs.readFileSync = function (file, ...rest) {
    if (String(file) === peer) {
        throw Object.assign(new Error('EPERM: operation not permitted, open ' + file), { code: 'EPERM' });
    }
    return read.call(this, file, ...rest);
};
syncBuiltinESMExports();
if (process.env.FLIPBOOK_TEST_FAST_LOCK) {
    const now = Date.now;
    let ahead = 0;
    Date.now = () => ((new Error().stack ?? '').includes('withTicketLock') ? now() + (ahead += 1000) : now());
}
`;

const PLATE = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="130" viewBox="0 0 200 130">
<rect width="200" height="130" fill="#efe6d2"/><circle cx="100" cy="65" r="30" fill="#2a6f97"/></svg>`;

const DELETE = /\b(delete|remove|rm)\b/i;

/** Run the CLI on `dir` with a live process's file in .flipbook/<lock>.d that cannot be read. */
function runLocked(args: string[], dir: string, lock: string, env: Record<string, string> = {}) {
    const loader = path.join(tempDir('lock-loader'), 'eperm.mjs');
    fs.writeFileSync(loader, LOADER);
    const folder = path.join(dir, '.flipbook', `${lock}.d`);
    fs.mkdirSync(folder, { recursive: true });
    // This test process is alive: its ticket counts, and cannot be read.
    const peer = path.join(folder, `p.${process.pid}.eeee`);
    fs.writeFileSync(peer, '1\n');
    const start = Date.now();
    const result = spawnSync(process.execPath, ['--import', loader, cli, ...args], {
        encoding: 'utf-8',
        timeout: 120_000,
        env: { ...process.env, FLIPBOOK_QUIET: '1', FLIPBOOK_TEST_EPERM: peer, ...env },
    });
    const report = JSON.parse(result.stdout) as {
        exitCode: number;
        failures: { code: string; fix: string; detail?: Record<string, unknown> }[];
    };
    return { status: result.status, report, ms: Date.now() - start, folder, peer };
}

describe('a busy lock in the real CLI', () => {
    for (const command of ['render', 'audio']) {
        it(`${command}: an unreadable live ticket is render-busy within one wait, with no advice to delete`, () => {
            const dir = copyFixture('audio');
            const { status, report, ms, folder, peer } = runLocked([command, dir], dir, 'render');
            expect(status).toBe(1);
            expect(report.failures.map((f) => f.code)).toEqual(['render-busy']);
            expect(report.failures[0].fix).not.toMatch(DELETE);
            // Joining and looking who is ahead share the 2 s wait.
            expect(ms).toBeLessThan(15_000);
            // Its own ticket is gone, the other process's stays.
            expect(fs.readdirSync(folder)).toEqual([path.basename(peer)]);
            expect(fs.existsSync(path.join(dir, '.flipbook', 'attempts.json'))).toBe(false);
        }, 60_000);
    }

    it('cutout: SOURCES.json busy past the wait is sources-busy, which says not to delete the lock', () => {
        const dir = tempDir('lock-cutout');
        fs.mkdirSync(path.join(dir, 'assets'));
        fs.writeFileSync(path.join(dir, 'assets', 'plate.svg'), PLATE);
        const sources = JSON.stringify({
            'plate.svg': { source: 'https://example.org', license: 'pdm' },
        });
        fs.writeFileSync(path.join(dir, 'assets', 'SOURCES.json'), sources);
        const { status, report, folder, peer } = runLocked(
            ['cutout', dir, 'assets/plate.svg'],
            dir,
            'sources',
            { FLIPBOOK_TEST_FAST_LOCK: '1' },
        );
        expect(status).toBe(1);
        expect(report.failures.map((f) => f.code)).toEqual(['sources-busy']);
        expect(report.failures[0].detail).toEqual({ lock: 'sources' });
        expect(report.failures[0].fix).toContain('Do not delete anything under .flipbook/');
        expect(report.failures.map((f) => f.code)).not.toContain('unsafe-output');
        expect(fs.readFileSync(path.join(dir, 'assets', 'SOURCES.json'), 'utf-8')).toBe(sources);
        expect(fs.readdirSync(folder)).toEqual([path.basename(peer)]);
        // The cut files already written have no entry yet. cutout owns
        // assets/cut/plate/: run again once the other command is done, it
        // rebuilds the folder whole and records every file in it.
        fs.rmSync(peer);
        const again = runCli(['cutout', dir, 'assets/plate.svg']);
        expect(again.status).toBe(0);
        const cut = fs
            .readdirSync(path.join(dir, 'assets', 'cut', 'plate'))
            .filter((f) => f.endsWith('.png'));
        const entries = JSON.parse(
            fs.readFileSync(path.join(dir, 'assets', 'SOURCES.json'), 'utf-8'),
        );
        expect(cut.length).toBeGreaterThan(0);
        for (const file of cut)
            expect(entries[`cut/plate/${file}`]).toMatchObject({ cutFrom: 'plate.svg' });
    }, 180_000);
});
