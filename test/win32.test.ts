import { describe, expect, it } from 'vitest';
import { buildDoctorReport, type DoctorDeps } from '../src/cli/doctor.ts';
import type { HeadlessShell } from '../src/engine/browser.ts';

const base: DoctorDeps = {
    version: '0.1.0',
    home: '/nonexistent',
    platform: 'win32',
    arch: 'x64',
    probeFfmpeg: async () => ({
        ffmpeg: 'C:\\ffmpeg\\ffmpeg.exe',
        ffprobe: 'C:\\ffmpeg\\ffprobe.exe',
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
    shell: (): HeadlessShell => ({
        revision: '1243',
        browserVersion: '153.0.8010.12',
        browsersPath: 'C:\\cache\\browsers',
        executable: 'C:\\cache\\browsers\\chrome-headless-shell.exe',
        installed: false,
        playwrightVersion: '1.63.0',
    }),
};

describe('win32', () => {
    it('is reported unsupported by default', async () => {
        const report = await buildDoctorReport({ ...base, env: {} });
        expect(report.platform.supported).toBe(false);
        expect(report.problems.map((p) => p.code)).toContain('platform-unsupported');
    });

    it('is let through with FLIPBOOK_ALLOW_WIN32=1', async () => {
        const report = await buildDoctorReport({ ...base, env: { FLIPBOOK_ALLOW_WIN32: '1' } });
        expect(report.platform.supported).toBe(true);
        expect(report.problems.map((p) => p.code)).not.toContain('platform-unsupported');
    });
});
