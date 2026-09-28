// The `flipbook` command the eval puts first on PATH in each workspace, so
// the host runs this checkout's CLI, and the reports it keeps.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson } from './files.mjs';

const isWindows = process.platform === 'win32';

/**
 * `flipbook` shims that run this checkout's CLI: a sh script for POSIX shells
 * (Git Bash included) and, on Windows, a .cmd for everything else. The sh
 * script keeps what each run prints on stdout, the JSON report, in
 * `<bin>/reports/`, so every stock fetch leaves its own evidence even when
 * the next one overwrites the report flipbook saves. The .cmd keeps none.
 */
export function writeShims(bin, cli) {
    const reports = join(bin, 'reports');
    writeFileSync(
        join(bin, 'flipbook'),
        [
            '#!/bin/sh',
            `mkdir -p "${reports}"`,
            `out="${reports}/$(date +%s)-$$.json"`,
            `"${process.execPath}" "${cli}" "$@" > "$out"`,
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

/** The JSON reports the sh shim kept, one per run of the CLI, oldest first. */
export function shimReports(bin) {
    const dir = join(bin, 'reports');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .sort()
        .map((name) => readJson(join(dir, name)))
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
