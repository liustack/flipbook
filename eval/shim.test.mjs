import { spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    realpathSync,
    renameSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { pinReports, REPORTS_ENV, shimReports, shimVersion, writeShims } from './shim.mjs';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'main.js');
const temps = [];
afterAll(() => {
    for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
const fresh = (name) => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), `flipbook-shim-${name}-`)));
    temps.push(dir);
    return dir;
};
const run = (bin, args, reports) =>
    spawnSync(join(bin, 'flipbook'), args, {
        encoding: 'utf-8',
        env: { ...process.env, [REPORTS_ENV]: reports ?? '' },
    });
const report = (marker) =>
    JSON.stringify({ schema: 'flipbook.report/1', command: 'stock-fetch', ok: true, marker });

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

/** An evaluator results root with a pinned report directory, a shim, and a folder outside both. */
function setup() {
    const root = fresh('root');
    const reports = join(root, 'results', 'reports', 'case--target--run1');
    mkdirSync(reports, { recursive: true });
    const away = join(root, 'away');
    mkdirSync(away);
    writeFileSync(join(away, 'external.json'), report('outside'));
    const bin = join(root, 'workspace', '.eval-bin');
    mkdirSync(bin, { recursive: true });
    writeShims(bin, fakeCli(root));
    return { root, reports, away, bin, pin: pinReports(reports) };
}

describe.skipIf(process.platform === 'win32')('the flipbook shim', () => {
    it('runs this checkout, passes stdout and the exit code through, and keeps each report in the pinned directory', () => {
        const bin = fresh('bin');
        const reports = fresh('reports');
        const pin = pinReports(reports);
        writeShims(bin, cli);
        expect(shimVersion(bin)).toMatch(/^\d+\.\d+\.\d+$/);
        const missing = join(bin, 'no-such-composition');
        const direct = spawnSync(process.execPath, [cli, 'check', missing], { encoding: 'utf-8' });
        const shimmed = run(bin, ['check', missing], pin.real);
        expect(shimmed.status).toBe(direct.status);
        expect(shimmed.status).not.toBe(0);
        expect(JSON.parse(shimmed.stdout).schema).toBe('flipbook.report/1');
        expect(shimReports(pin)).toEqual({ reports: [JSON.parse(shimmed.stdout)], problem: null });
        expect(existsSync(join(bin, 'reports'))).toBe(false);
    });

    it('keeps nothing when the evaluator names no directory', () => {
        const { bin, reports } = setup();
        const result = run(bin, ['ok', 'openverse:one']);
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout).ok).toBe(true);
        expect(readdirSync(reports)).toEqual([]);
    });

    it('keeps the report of every run, a success and a failure alike', () => {
        const { bin, pin } = setup();
        const codes = [
            ['ok', 'openverse:one'],
            ['fail', 'openverse:two'],
        ].map((args) => run(bin, args, pin.real).status);
        expect(codes).toEqual([0, 1]);
        const kept = shimReports(pin);
        expect(kept.problem).toBeNull();
        expect(kept.reports.map((r) => [r.ok, r.stock.id])).toEqual(
            expect.arrayContaining([
                [true, 'openverse:one'],
                [false, 'openverse:two'],
            ]),
        );
    });

    it('never reads the workspace, nor a report that is a link in the pinned directory', () => {
        const { root, bin, away, pin } = setup();
        symlinkSync(away, join(root, 'workspace', '.eval-bin', 'reports'));
        run(bin, ['ok', 'openverse:one'], pin.real);
        symlinkSync(join(away, 'external.json'), join(pin.real, 'linked.json'));
        const kept = shimReports(pin);
        expect(kept.problem).toBeNull();
        expect(kept.reports.map((r) => r.stock?.id ?? r.marker)).toEqual(['openverse:one']);
    });

    it('reads nothing once the pinned directory is swapped for a link, and the shim writes nothing through it', () => {
        const { bin, away, pin } = setup();
        run(bin, ['ok', 'openverse:before'], pin.real);
        renameSync(pin.real, `${pin.real}.moved`);
        symlinkSync(away, pin.real);
        expect(shimReports(pin)).toEqual({
            reports: [],
            problem: `${pin.real} became a link`,
        });
        const result = run(bin, ['ok', 'openverse:after'], pin.real);
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout).stock.id).toBe('openverse:after');
        expect(readdirSync(away)).toEqual(['external.json']);
    });

    it('reads nothing once a folder above the pinned directory is swapped for a link, and the shim writes nothing', () => {
        const { root, bin, away, pin } = setup();
        const results = join(root, 'results');
        mkdirSync(join(away, 'reports', 'case--target--run1'), { recursive: true });
        writeFileSync(
            join(away, 'reports', 'case--target--run1', 'planted.json'),
            report('planted'),
        );
        renameSync(results, `${results}.moved`);
        symlinkSync(away, results);
        expect(shimReports(pin)).toEqual({ reports: [], problem: `${results} became a link` });
        const result = run(bin, ['fail', 'openverse:after'], pin.real);
        expect(result.status).toBe(1);
        expect(readdirSync(join(away, 'reports', 'case--target--run1'))).toEqual(['planted.json']);
    });

    it('reads nothing once the pinned directory is replaced by another real one', () => {
        const { pin } = setup();
        renameSync(pin.real, `${pin.real}.old`);
        mkdirSync(pin.real);
        writeFileSync(join(pin.real, 'planted.json'), report('planted'));
        expect(shimReports(pin)).toEqual({ reports: [], problem: `${pin.real} was replaced` });
    });

    it('writes nothing when the directory it is given is reached through a link', () => {
        const { root, bin, pin } = setup();
        const linked = join(root, 'linked-results');
        symlinkSync(join(root, 'results'), linked);
        const result = run(
            bin,
            ['ok', 'openverse:one'],
            join(linked, 'reports', 'case--target--run1'),
        );
        expect(result.status).toBe(0);
        expect(readdirSync(pin.real)).toEqual([]);
    });
});

describe.skipIf(process.platform === 'win32')(
    'the flipbook shim in a workspace of ES modules',
    () => {
        /** A workspace whose package.json makes every .js and extensionless file an ES module. */
        function esmWorkspace() {
            const ws = fresh('esm');
            writeFileSync(join(ws, 'package.json'), JSON.stringify({ type: 'module' }));
            const bin = join(ws, '.eval-bin');
            mkdirSync(bin);
            writeShims(bin, cli);
            const reports = join(ws, '..', `${ws.split('/').pop()}-reports`);
            mkdirSync(reports);
            temps.push(reports);
            return { ws, bin, pin: pinReports(reports) };
        }

        it('prints the version', () => {
            const { bin } = esmWorkspace();
            expect(shimVersion(bin)).toMatch(/^\d+\.\d+\.\d+$/);
        });

        it('keeps the report of a normal run', () => {
            const { ws, bin, pin } = esmWorkspace();
            const result = spawnSync(join(bin, 'flipbook'), ['--version'], {
                cwd: ws,
                encoding: 'utf-8',
                env: { ...process.env, [REPORTS_ENV]: pin.real },
            });
            expect(result.status).toBe(0);
            const check = spawnSync(join(bin, 'flipbook'), ['check', join(ws, 'missing')], {
                cwd: ws,
                encoding: 'utf-8',
                env: { ...process.env, [REPORTS_ENV]: pin.real },
            });
            const kept = shimReports(pin);
            expect(kept.problem).toBeNull();
            expect(kept.reports).toEqual([JSON.parse(check.stdout)]);
        });

        it('passes a CLI error through: its exit code, its report and its message', () => {
            const { ws, bin, pin } = esmWorkspace();
            const missing = join(ws, 'missing');
            const direct = spawnSync(process.execPath, [cli, 'check', missing], {
                cwd: ws,
                encoding: 'utf-8',
            });
            const shimmed = spawnSync(join(bin, 'flipbook'), ['check', missing], {
                cwd: ws,
                encoding: 'utf-8',
                env: { ...process.env, [REPORTS_ENV]: pin.real },
            });
            expect(direct.status).toBe(2);
            expect(shimmed.status).toBe(2);
            expect(JSON.parse(shimmed.stdout).usageError).toBe(
                JSON.parse(direct.stdout).usageError,
            );
            expect(shimmed.stderr).toContain('does not exist');
        });
    },
);
