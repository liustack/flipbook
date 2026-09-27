import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadTimeline } from '../src/engine/timeline.ts';
import { cleanTemps, repoRoot, tempDir } from './helpers.ts';
import { writeStory } from './story.ts';

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
        expect(result.stdout).toMatch(/10\/10 cases valid/);
        expect(result.stdout).toMatch(/workspace install ok, flipbook shim \d+\.\d+\.\d+/);
    });
});

describe('eval cases', () => {
    it('tea-house gives the agent what a brand.json needs, and one written from it passes the brand checks', () => {
        const caseDir = path.join(repoRoot, 'eval', 'cases', 'tea-house');
        const spec = JSON.parse(fs.readFileSync(path.join(caseDir, 'case.json'), 'utf-8'));
        const want = spec.expect.brand;
        const files = path.join(caseDir, 'files');
        const css = fs.readFileSync(path.join(files, 'site', 'styles.css'), 'utf-8').toLowerCase();
        for (const color of want.palette) expect(css).toContain(color);
        expect(want.palette).toContain(want.primary);
        expect(fs.readFileSync(path.join(files, 'README.md'), 'utf-8')).toContain(want.name);

        const root = tempDir('eval-brand');
        const dir = path.join(root, 'film');
        fs.mkdirSync(path.join(root, 'site', 'img'), { recursive: true });
        fs.mkdirSync(dir);
        fs.copyFileSync(path.join(files, 'site', 'img', 'logo.svg'), path.join(root, want.logo));
        fs.writeFileSync(
            path.join(root, 'brand.json'),
            JSON.stringify({
                version: 1,
                name: want.name,
                logo: {
                    file: want.logo,
                    license: 'owned by the tea house, free for its promotion',
                },
                colors: { primary: want.primary, secondary: want.palette[1] },
            }),
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
        writeStory(dir);
        const loaded = loadTimeline(dir, false);
        expect(loaded.findings).toEqual([]);
        expect(loaded.resolved?.brand?.name).toBe('潮汐茶室');
    });
});
