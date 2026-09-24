import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { repoRoot, tempDir } from './helpers.ts';

const launcher = path.join(repoRoot, 'skills', 'flipbook', 'scripts', 'run.sh');
const pinned = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')).version;

/** What the launcher selects with only a fake `flipbook` of this version on PATH. */
function selectWith(version: string): string {
    const bin = tempDir('fakebin');
    fs.writeFileSync(path.join(bin, 'flipbook'), `#!/bin/sh\necho "${version}"\n`, { mode: 0o755 });
    const result = spawnSync('sh', [launcher, 'where'], {
        env: { PATH: `${bin}:/usr/bin:/bin` },
        encoding: 'utf-8',
    });
    return result.stdout.trim();
}

describe('skill launcher', () => {
    it('accepts the same major.minor at or above the pin while below 1.0', () => {
        const [major, minor, patch] = pinned.split('.').map(Number);
        expect(major).toBe(0);
        expect(selectWith(pinned)).toBe('path');
        expect(selectWith(`0.${minor}.${patch + 3}`)).toBe('path');
        expect(selectWith(`0.${minor + 1}.0`)).toBe('none');
        expect(selectWith('1.0.0')).toBe('none');
        if (patch > 0) expect(selectWith(`0.${minor}.${patch - 1}`)).toBe('none');
    });

    it('exits 78 with a JSON diagnosis when nothing can run the CLI', () => {
        const result = spawnSync('sh', [launcher, 'check', '.'], {
            env: { PATH: '/usr/bin:/bin' },
            encoding: 'utf-8',
        });
        expect(result.status).toBe(78);
        const diagnosis = JSON.parse(result.stderr);
        expect(diagnosis.selected).toBe('none');
        expect(diagnosis.pinnedVersion).toBe(pinned);
        expect(diagnosis.nextSteps.length).toBe(2);
    });

    it('keeps the CLI doctor JSON and exit code when the CLI reports problems', () => {
        const bin = tempDir('fakedoctor');
        fs.writeFileSync(
            path.join(bin, 'flipbook'),
            `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${pinned}"; exit 0; fi\necho '{"ok":false,"problems":[{"code":"chromium-missing"}]}'\nexit 78\n`,
            { mode: 0o755 },
        );
        const result = spawnSync('sh', [launcher, 'doctor', '--json'], {
            env: { PATH: `${bin}:/usr/bin:/bin` },
            encoding: 'utf-8',
        });
        expect(result.status).toBe(78);
        const report = JSON.parse(result.stdout);
        expect(report.selected).toBe('path');
        expect(report.cliDoctor.problems[0].code).toBe('chromium-missing');
    });
});
