import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadTimeline } from '../src/engine/timeline.ts';
import { cleanTemps, repoRoot, tempDir } from './helpers.ts';

afterAll(() => cleanTemps());

describe('eval runner', () => {
    it('validates every case and installs the skill into a fresh workspace in a dry run', () => {
        const result = spawnSync(
            process.execPath,
            [path.join(repoRoot, 'eval', 'run.mjs'), '--dry-run'],
            {
                encoding: 'utf-8',
                timeout: 120_000,
            },
        );
        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(result.stdout).toMatch(/11\/11 cases valid/);
        expect(result.stdout).toMatch(/workspace install ok, flipbook shim \d+\.\d+\.\d+/);
    });
});

describe('eval cases', () => {
    it('brand-film puts a brand.json and logo in the workspace root that pass the brand checks', () => {
        const root = tempDir('eval-brand');
        const dir = path.join(root, 'film');
        const files = path.join(repoRoot, 'eval', 'cases', 'brand-film', 'files');
        fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
        fs.mkdirSync(dir);
        fs.copyFileSync(path.join(files, 'brand.json'), path.join(root, 'brand.json'));
        fs.copyFileSync(
            path.join(files, 'tide-logo.svg'),
            path.join(root, 'assets', 'tide-logo.svg'),
        );
        fs.writeFileSync(
            path.join(dir, 'timeline.json'),
            JSON.stringify({
                version: 1,
                width: 640,
                height: 360,
                fps: 12,
                seed: 1,
                bpm: 120,
                beatsPerBar: 4,
                brand: '../brand.json',
                scenes: [{ id: 'main', bars: 1 }],
            }),
        );
        const loaded = loadTimeline(dir, false);
        expect(loaded.findings).toEqual([]);
        expect(loaded.resolved?.brand?.name).toBe('潮汐茶室');
    });
});
