import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { REPORTS_ENV, shimReports, shimVersion, writeShims } from './shim.mjs';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'main.js');
const temps = [];
afterAll(() => {
    for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
const fresh = (name) => {
    const dir = mkdtempSync(join(tmpdir(), `flipbook-shim-${name}-`));
    temps.push(dir);
    return dir;
};
const run = (bin, args, reports) =>
    spawnSync(join(bin, 'flipbook'), args, {
        encoding: 'utf-8',
        env: { ...process.env, [REPORTS_ENV]: reports ?? '' },
    });

/** A stand-in CLI that prints one stock fetch report and exits 0 when told `ok`, 1 otherwise. */
function fakeCli(dir) {
    const file = join(dir, 'fake-cli.mjs');
    writeFileSync(
        file,
        `const ok = process.argv[2] === 'ok';
console.log(JSON.stringify({ schema: 'flipbook.report/1', command: 'stock-fetch', ok, stock: { id: process.argv[3], file: 'assets/a.jpg' } }));
process.exit(ok ? 0 : 1);`,
    );
    return file;
}

describe.skipIf(process.platform === 'win32')('the flipbook shim', () => {
    it('runs this checkout, passes stdout and the exit code through, and keeps each report where the evaluator says', () => {
        const bin = fresh('bin');
        const reports = fresh('reports');
        writeShims(bin, cli);
        expect(shimVersion(bin)).toMatch(/^\d+\.\d+\.\d+$/);
        const missing = join(bin, 'no-such-composition');
        const direct = spawnSync(process.execPath, [cli, 'check', missing], { encoding: 'utf-8' });
        const shimmed = run(bin, ['check', missing], reports);
        expect(shimmed.status).toBe(direct.status);
        expect(shimmed.status).not.toBe(0);
        expect(JSON.parse(shimmed.stdout).schema).toBe('flipbook.report/1');
        expect(shimReports(reports)).toEqual([JSON.parse(shimmed.stdout)]);
        expect(existsSync(join(bin, 'reports'))).toBe(false);
    });

    it('keeps nothing when the evaluator names no directory', () => {
        const bin = fresh('bin');
        writeShims(bin, fakeCli(bin));
        const result = run(bin, ['ok', 'openverse:one']);
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout).ok).toBe(true);
        expect(existsSync(join(bin, 'reports'))).toBe(false);
    });

    it('keeps the report of every run, a success and a failure alike', () => {
        const bin = fresh('bin');
        const reports = fresh('reports');
        writeShims(bin, fakeCli(bin));
        const codes = [
            ['ok', 'openverse:one'],
            ['fail', 'openverse:two'],
        ].map((args) => run(bin, args, reports).status);
        expect(codes).toEqual([0, 1]);
        const kept = shimReports(reports).map((r) => [r.ok, r.stock.id]);
        expect(kept).toHaveLength(2);
        expect(kept).toEqual(
            expect.arrayContaining([
                [true, 'openverse:one'],
                [false, 'openverse:two'],
            ]),
        );
    });

    it('never reads reports from the workspace, nor through a link in its own directory', () => {
        const ws = fresh('ws');
        const away = fresh('away');
        const reports = fresh('reports');
        const planted = {
            schema: 'flipbook.report/1',
            command: 'stock-fetch',
            ok: true,
            marker: 'planted outside',
        };
        writeFileSync(join(away, 'report.json'), JSON.stringify(planted));
        mkdirSync(join(ws, '.eval-bin'));
        symlinkSync(away, join(ws, '.eval-bin', 'reports'));
        writeShims(join(ws, '.eval-bin'), fakeCli(ws));
        run(join(ws, '.eval-bin'), ['ok', 'openverse:one'], reports);
        symlinkSync(join(away, 'report.json'), join(reports, 'linked.json'));
        const kept = shimReports(reports);
        expect(kept.map((r) => r.stock?.id)).toEqual(['openverse:one']);
        expect(kept.some((r) => r.marker)).toBe(false);
    });
});
