import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { repoRoot, tempDir } from './helpers.ts';

const launcher = path.join(repoRoot, 'skills', 'flipbook', 'scripts', 'run.sh');
const pinned = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')).version;
const [, minor, patch] = pinned.split('.').map(Number);

/** A directory of fake executables, each a shell script body. */
function fakeBin(scripts: Record<string, string>): string {
    const bin = tempDir('fakebin');
    for (const [name, body] of Object.entries(scripts)) {
        fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    }
    return bin;
}

function launch(args: string[], bin?: string) {
    return spawnSync('sh', [launcher, ...args], {
        env: { PATH: bin ? `${bin}:/usr/bin:/bin` : '/usr/bin:/bin' },
        encoding: 'utf-8',
    });
}

/** What the launcher selects with only a fake `flipbook` printing this version on PATH. */
function selectWith(version: string): string {
    return launch(['where'], fakeBin({ flipbook: `echo "${version}"` })).stdout.trim();
}

describe('skill launcher picks a compatible CLI', () => {
    it('accepts the same major.minor at or above the pin while below 1.0', () => {
        expect(pinned.split('.')[0]).toBe('0');
        expect(selectWith(pinned)).toBe('path');
        expect(selectWith(`0.${minor}.${patch + 3}`)).toBe('path');
        expect(selectWith(`flipbook v0.${minor}.${patch + 3}`)).toBe('path');
        expect(selectWith(`0.${minor + 1}.0`)).toBe('none');
        expect(selectWith('1.0.0')).toBe('none');
        if (patch > 0) expect(selectWith(`0.${minor}.${patch - 1}`)).toBe('none');
    });

    it('reads every digit of a multi-digit major', () => {
        expect(selectWith(`10.${minor}.${patch}`)).toBe('none');
        expect(selectWith(`flipbook 10.${minor}.${patch}`)).toBe('none');
    });

    it('accepts a prerelease only when it is exactly the pin, and ignores build metadata', () => {
        expect(selectWith(`${pinned}-beta.1`)).toBe('none');
        expect(selectWith(`0.${minor}.${patch + 1}-rc.1`)).toBe('none');
        expect(selectWith(`${pinned}+build.7`)).toBe('path');
    });

    it('rejects version text it cannot parse', () => {
        expect(selectWith('0.1')).toBe('none');
        expect(selectWith('unknown')).toBe('none');
    });
});

describe('skill launcher when nothing can run the CLI', () => {
    it('exits 78 with a JSON diagnosis carrying fix on stderr', () => {
        const result = launch(['check', '.']);
        expect(result.status).toBe(78);
        const diagnosis = JSON.parse(result.stderr);
        expect(diagnosis.ok).toBe(false);
        expect(diagnosis.error).toBe('runtime-missing');
        expect(diagnosis.launcher.selected).toBe('none');
        expect(diagnosis.launcher.pinnedVersion).toBe(pinned);
        expect(diagnosis.fix).toHaveLength(2);
        expect(diagnosis.fix[0]).toContain('nodejs.org');
    });

    it('explains an npx whose node is below the floor', () => {
        const bin = fakeBin({ node: 'echo v20.11.0', npx: 'exit 0' });
        expect(launch(['where'], bin).stdout.trim()).toBe('none');
        const result = launch(['check', '.'], bin);
        expect(result.status).toBe(78);
        const diagnosis = JSON.parse(result.stderr);
        expect(diagnosis.launcher.checked.npx.nodeMeetsFloor).toBe(false);
        expect(diagnosis.fix[0]).toContain('below the 22.19.0 floor');
    });

    it('falls back to bunx when it is the only runtime', () => {
        expect(launch(['where'], fakeBin({ bunx: 'exit 0' })).stdout.trim()).toBe('bunx');
    });
});

describe('skill launcher doctor prints one JSON object on stdout', () => {
    it('with no runtime: fix at the top level, exit 78, with or without --json', () => {
        for (const args of [['doctor'], ['doctor', '--json']]) {
            const result = launch(args);
            expect(result.status, args.join(' ')).toBe(78);
            const report = JSON.parse(result.stdout);
            expect(report.exitCode).toBe(78);
            expect(report.launcher.selected).toBe('none');
            expect(report.fix).toHaveLength(2);
        }
    });

    it('with a CLI: its doctor report plus the launcher block, CLI exit code kept', () => {
        const report = JSON.stringify({
            ok: false,
            exitCode: 78,
            problems: [{ code: 'chromium-missing', message: 'x', fix: ['install it'] }],
            fix: ['install it'],
        });
        const bin = fakeBin({
            flipbook: [
                `if [ "$1" = "--version" ]; then echo "${pinned}"; exit 0; fi`,
                'case " $* " in *" --json "*) ;; *) echo "human text"; exit 78 ;; esac',
                `echo '${report}'`,
                'exit 78',
            ].join('\n'),
        });
        for (const args of [['doctor'], ['doctor', '--json']]) {
            const result = launch(args, bin);
            expect(result.status, args.join(' ')).toBe(78);
            const merged = JSON.parse(result.stdout);
            expect(merged.launcher.selected).toBe('path');
            expect(merged.problems[0].code).toBe('chromium-missing');
            expect(merged.fix).toEqual(['install it']);
        }
    });
});
