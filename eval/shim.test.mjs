import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { shimReports, shimVersion, writeShims } from './shim.mjs';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'main.js');
const temps = [];
afterAll(() => {
    for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('the flipbook shim', () => {
    it('runs this checkout, passes stdout and the exit code through, and keeps each report', () => {
        const bin = mkdtempSync(join(tmpdir(), 'flipbook-shim-'));
        temps.push(bin);
        writeShims(bin, cli);
        expect(shimVersion(bin)).toMatch(/^\d+\.\d+\.\d+$/);
        const missing = join(bin, 'no-such-composition');
        const direct = spawnSync(process.execPath, [cli, 'check', missing], { encoding: 'utf-8' });
        const shimmed = spawnSync(join(bin, 'flipbook'), ['check', missing], { encoding: 'utf-8' });
        expect(shimmed.status).toBe(direct.status);
        expect(shimmed.status).not.toBe(0);
        expect(JSON.parse(shimmed.stdout).schema).toBe('flipbook.report/1');
        const kept = shimReports(bin);
        expect(kept).toHaveLength(1);
        expect(kept[0]).toEqual(JSON.parse(shimmed.stdout));
    });

    it('keeps the report of every run, a success and a failure alike', () => {
        const bin = mkdtempSync(join(tmpdir(), 'flipbook-shim-'));
        temps.push(bin);
        const fake = join(bin, 'fake-cli.mjs');
        writeFileSync(
            fake,
            `const ok = process.argv[2] === 'ok';
console.log(JSON.stringify({ schema: 'flipbook.report/1', command: 'stock-fetch', ok, stock: { id: process.argv[3], file: 'assets/a.jpg' } }));
process.exit(ok ? 0 : 1);`,
        );
        writeShims(bin, fake);
        const runs = [
            ['ok', 'openverse:one'],
            ['fail', 'openverse:two'],
        ].map((args) => spawnSync(join(bin, 'flipbook'), args, { encoding: 'utf-8' }).status);
        expect(runs).toEqual([0, 1]);
        const kept = shimReports(bin).map((r) => [r.ok, r.stock.id]);
        expect(kept).toHaveLength(2);
        expect(kept).toEqual(
            expect.arrayContaining([
                [true, 'openverse:one'],
                [false, 'openverse:two'],
            ]),
        );
    });
});
