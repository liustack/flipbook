// The `flipbook` command the eval puts first on PATH in each workspace, so
// the host runs this checkout's CLI, and the reports it keeps. The reports
// go to a directory the evaluator makes outside the agent's workspace and
// names in FLIPBOOK_EVAL_REPORTS: the workspace holds none of them.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { workspaceReader } from './files.mjs';

/** The environment variable that tells the shim where to keep reports. */
export const REPORTS_ENV = 'FLIPBOOK_EVAL_REPORTS';

const isWindows = process.platform === 'win32';

/**
 * `flipbook` shims that run this checkout's CLI: a sh script for POSIX shells
 * (Git Bash included) and, on Windows, a .cmd for everything else. When
 * FLIPBOOK_EVAL_REPORTS names a directory, the sh script keeps what each run
 * prints on stdout, the JSON report, there, so every stock fetch leaves its
 * own evidence even when the next one overwrites the report flipbook saves.
 * Without it, and in the .cmd, the CLI just runs.
 */
export function writeShims(bin, cli) {
    const run = `"${process.execPath}" "${cli}" "$@"`;
    writeFileSync(
        join(bin, 'flipbook'),
        [
            '#!/bin/sh',
            `if [ -z "$${REPORTS_ENV}" ]; then exec ${run}; fi`,
            `out="$${REPORTS_ENV}/$(date +%s)-$$.json"`,
            `${run} > "$out"`,
            'code=$?',
            'cat "$out"',
            'exit $code',
            '',
        ].join('\n'),
    );
    chmodSync(join(bin, 'flipbook'), 0o755);
    if (isWindows) {
        writeFileSync(join(bin, 'flipbook.cmd'), `@"${process.execPath}" "${cli}" %*\r\n`);
    }
}

/**
 * The JSON reports the sh shim kept in `dir`, the evaluator's own directory,
 * one per run of the CLI. Only regular files whose real path lies inside
 * `dir` are read: a link there is not followed.
 */
export function shimReports(dir) {
    if (!existsSync(dir)) return [];
    const reader = workspaceReader(dir);
    return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort()
        .map((name) => reader.json(join(dir, name)))
        .filter((report) => report?.schema === 'flipbook.report/1');
}

/** What `flipbook --version` prints through the shim this platform starts, or ''. */
export function shimVersion(bin) {
    const result = isWindows
        ? // Node starts a .cmd only through a shell.
          spawnSync(`"${join(bin, 'flipbook.cmd')}" --version`, { shell: true, encoding: 'utf-8' })
        : spawnSync(join(bin, 'flipbook'), ['--version'], { encoding: 'utf-8' });
    return result.status === 0 ? result.stdout.trim() : '';
}
