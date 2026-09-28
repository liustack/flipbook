// The evaluator's own check of a composition, so the verdict never rests on
// the agent's last run. It checks a fresh copy of the whole workspace: what
// the agent left in .flipbook/ and out/ stays behind, and every file the
// composition reaches by a relative path (a brand.json in the workspace root,
// the logo and fonts it names) keeps its place next to it.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { HOST_DIRS } from './judge.mjs';

/** Folders left out of the copy: the host's and the eval's own, and what flipbook wrote. */
const LEFT_OUT = [...HOST_DIRS, '.flipbook', 'out'];

function readJsonText(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/**
 * Run `flipbook check` on a copy of `wsRoot` at the composition's place in
 * it, and return its exit code and report.
 */
export function recheck(composition, { wsRoot, cli }) {
    const copy = mkdtempSync(join(tmpdir(), 'flipbook-eval-recheck-'));
    try {
        cpSync(wsRoot, copy, {
            recursive: true,
            filter: (src) =>
                !relative(wsRoot, src)
                    .split(sep)
                    .some((part) => LEFT_OUT.includes(part)),
        });
        const result = spawnSync(
            process.execPath,
            [cli, 'check', join(copy, relative(wsRoot, composition))],
            {
                encoding: 'utf-8',
                maxBuffer: 64 * 1024 * 1024,
                env: { ...process.env, FLIPBOOK_QUIET: '1' },
            },
        );
        return { exitCode: result.status, report: readJsonText(result.stdout) };
    } finally {
        rmSync(copy, { recursive: true, force: true });
    }
}
