import { spawnSync } from 'child_process';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanTemps, repoRoot } from './helpers.ts';

afterAll(() => cleanTemps());

describe('eval runner', () => {
    it('says there are no cases yet and installs the skill into a fresh workspace in a dry run', () => {
        const result = spawnSync(
            process.execPath,
            [path.join(repoRoot, 'eval', 'run.mjs'), '--dry-run'],
            {
                encoding: 'utf-8',
                timeout: 120_000,
            },
        );
        expect(result.status, result.stdout + result.stderr).toBe(0);
        // eval/cases/ is empty until the cases are rewritten.
        expect(result.stdout).toMatch(/0\/0 cases valid/);
        expect(result.stdout).toMatch(/no cases in .*: nothing to run until cases are written/);
        expect(result.stdout).toMatch(/workspace install ok, flipbook shim \d+\.\d+\.\d+/);
    });
});
