import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { buildDoctorReport } from '../src/cli/doctor.ts';
import { resetLaunchMode } from '../src/engine/browser.ts';
import { cleanTemps, copyFixture, runCli, tempDir } from './helpers.ts';

/** PATH with node on it and nothing else. */
const nodeOnly = path.dirname(process.execPath);

describe('doctor exits 78 with a fix when something is missing', () => {
    it('reports missing ffmpeg', () => {
        const result = runCli(['doctor', '--json'], { ...process.env, PATH: nodeOnly });
        expect(result.status).toBe(78);
        const report = result.json as {
            problems: { code: string; fix: string[] }[];
            fix: string[];
        };
        const problem = report.problems.find((p) => p.code === 'ffmpeg-missing');
        expect(problem?.fix.join('\n')).toContain('brew install ffmpeg');
        expect(report.fix.join('\n')).toContain('brew install ffmpeg');
    });

    it('reports missing Chromium with a copyable install command', () => {
        const cache = tempDir('empty-cache');
        const result = runCli(['doctor', '--json'], { ...process.env, FLIPBOOK_CACHE_DIR: cache });
        expect(result.status).toBe(78);
        const report = result.json as { problems: { code: string; fix: string[] }[] };
        const problem = report.problems.find((p) => p.code === 'chromium-missing');
        expect(problem?.fix[0]).toMatch(
            /^PLAYWRIGHT_BROWSERS_PATH=".*browsers" npx --yes playwright-core@\d+\.\d+\.\d+ install chromium-headless-shell$/,
        );
        cleanTemps();
    });

    it('reports a sandbox that blocks both launch modes', async () => {
        resetLaunchMode();
        const attempts: string[][] = [];
        const report = await buildDoctorReport({
            version: '0.1.0',
            probeFfmpeg: async () => ({
                ffmpeg: '/bin/ffmpeg',
                ffprobe: '/bin/ffprobe',
                version: '8.1',
                features: {
                    libx264: true,
                    amixNormalize: true,
                    loudnorm: true,
                    ebur128: true,
                    freezedetect: true,
                    tile: true,
                    gblur: true,
                },
                missing: [],
            }),
            shell: () => ({
                revision: '1243',
                browserVersion: '153.0.8010.12',
                browsersPath: '/cache/browsers',
                executable: '/cache/browsers/chrome-headless-shell',
                installed: true,
                playwrightVersion: '1.63.0',
            }),
            launch: async (args) => {
                attempts.push(args);
                throw new Error(
                    'FATAL:mach_port_rendezvous_mac.cc:159 bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer: Permission denied (1100)',
                );
            },
        });
        resetLaunchMode();
        expect(report.exitCode).toBe(78);
        expect(attempts).toHaveLength(2);
        expect(attempts[1]).toContain('--single-process');
        expect(attempts[1]).toContain('--no-zygote');
        const problem = report.problems.find((p) => p.code === 'sandbox-blocked');
        expect(problem?.fix.join('\n')).toContain('allowMachLookup');
        expect(problem?.fix.join('\n')).toContain('excludedCommands');
    });
});

describe('doctor checks that the cache can be written', () => {
    /** Everything else healthy, so only the cache decides. */
    const healthy = (cache: string) =>
        buildDoctorReport({
            version: '0.1.0',
            env: { ...process.env, FLIPBOOK_CACHE_DIR: cache },
            probeFfmpeg: async () => ({
                ffmpeg: '/bin/ffmpeg',
                ffprobe: '/bin/ffprobe',
                version: '8.1',
                features: {
                    libx264: true,
                    amixNormalize: true,
                    loudnorm: true,
                    ebur128: true,
                    freezedetect: true,
                    tile: true,
                    gblur: true,
                },
                missing: [],
            }),
            shell: () => ({
                revision: '1243',
                browserVersion: '153.0.8010.12',
                browsersPath: path.join(cache, 'browsers'),
                executable: path.join(cache, 'browsers', 'chrome-headless-shell'),
                installed: true,
                playwrightVersion: '1.63.0',
            }),
            launch: async () =>
                ({ version: () => '153.0.8010.12', close: async () => undefined }) as never,
        });

    it('reports a writable cache as fine', async () => {
        resetLaunchMode();
        const report = await healthy(tempDir('cache-ok'));
        resetLaunchMode();
        expect(report.cache.writable).toBe(true);
        expect(report.problems.map((p) => p.code)).not.toContain('cache-unwritable');
    });

    it.skipIf(process.getuid?.() === 0)('exits 78 when the cache cannot be written', async () => {
        const cache = tempDir('cache-readonly');
        fs.chmodSync(cache, 0o500);
        try {
            resetLaunchMode();
            const report = await healthy(cache);
            resetLaunchMode();
            expect(report.cache.writable).toBe(false);
            expect(report.exitCode).toBe(78);
            const problem = report.problems.find((p) => p.code === 'cache-unwritable');
            expect(problem?.message).toContain(cache);
            expect(report.fix.join('\n')).toContain('FLIPBOOK_CACHE_DIR');
        } finally {
            fs.chmodSync(cache, 0o700);
        }
    });
});

describe('commands exit 78 or 2 before touching the composition', () => {
    it('check exits 78 without ffmpeg and prints a diagnosis on stderr', () => {
        const result = runCli(['check', copyFixture('hello', 'examples')], {
            ...process.env,
            PATH: nodeOnly,
        });
        expect(result.status).toBe(78);
        expect((result.json as { exitCode: number }).exitCode).toBe(78);
        expect(JSON.parse(result.stderr).error).toBe('ffmpeg-missing');
    });

    it('usage errors exit 2 with a JSON report', () => {
        const unknown = runCli(['render']);
        expect(unknown.status).toBe(2);
        expect((unknown.json as { command: string }).command).toBe('usage');
        const badFlag = runCli(['check', '.', '--samples', '10oops']);
        expect(badFlag.status).toBe(2);
        const notDir = runCli(['check', path.join(nodeOnly, 'definitely-missing-dir')]);
        expect(notDir.status).toBe(2);
    });
});
