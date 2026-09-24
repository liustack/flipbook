import { spawnSync } from 'child_process';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './helpers.ts';

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
        expect(result.stdout).toMatch(/8\/8 cases valid/);
        expect(result.stdout).toMatch(/workspace install ok, flipbook shim \d+\.\d+\.\d+/);
    });
});
