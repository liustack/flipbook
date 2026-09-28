// The `flipbook` command the eval puts first on PATH in each workspace, so
// the host runs this checkout's CLI, and the reports it keeps.
//
// Trust: the agent under test runs as the same user as the evaluator, with
// full permissions, and FLIPBOOK_EVAL_REPORTS tells it where the reports go.
// Nothing here can stop it from writing, moving or replacing them. What the
// evaluator can do is notice: it pins the report directory before the host
// starts and reads nothing from it if the directory or any folder above it
// changed. The reports are evidence for a person, never grounds for an
// automatic pass.
import { spawnSync } from 'node:child_process';
import {
    chmodSync,
    closeSync,
    constants,
    fstatSync,
    lstatSync,
    openSync,
    readdirSync,
    readFileSync,
    realpathSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, sep } from 'node:path';

/** The environment variable that tells the shim where to keep reports. */
export const REPORTS_ENV = 'FLIPBOOK_EVAL_REPORTS';

const isWindows = process.platform === 'win32';

/**
 * The sh-side shim, a small Node script: it runs the CLI, passes its stdout
 * and exit code through, and keeps the stdout (the JSON report) as a new
 * file in FLIPBOOK_EVAL_REPORTS when that is set and still a real directory
 * at exactly the path given, no link on the way. The file is created with
 * O_EXCL and O_NOFOLLOW, so it never replaces or follows anything. Anything
 * else and no report is kept, the CLI runs all the same.
 */
function nodeShim(cli) {
    return `#!${process.execPath}
'use strict';
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const run = spawnSync(process.execPath, [${JSON.stringify(cli)}, ...process.argv.slice(2)], {
    stdio: ['inherit', 'pipe', 'inherit'],
    maxBuffer: 1024 * 1024 * 1024,
});
if (run.error) process.stderr.write('flipbook shim: ' + run.error.message + '\\n');
const out = run.stdout ?? Buffer.alloc(0);
process.stdout.write(out);
process.exitCode = run.status ?? 1;
const dir = process.env.${REPORTS_ENV};
if (dir && out.length > 0) {
    try {
        if (fs.lstatSync(dir).isDirectory() && fs.realpathSync(dir) === dir) {
            const name = Date.now() + '-' + process.pid + '-' + randomBytes(4).toString('hex') + '.json';
            const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0);
            const fd = fs.openSync(path.join(dir, name), flags, 0o600);
            try {
                fs.writeSync(fd, out);
            } finally {
                fs.closeSync(fd);
            }
        }
    } catch {}
}
`;
}

/**
 * `flipbook` shims that run this checkout's CLI: a Node script for POSIX
 * shells (Git Bash included) that also keeps each report (see nodeShim),
 * and, on Windows, a .cmd for everything else, which keeps none.
 */
export function writeShims(bin, cli) {
    writeFileSync(join(bin, 'flipbook'), nodeShim(cli));
    chmodSync(join(bin, 'flipbook'), 0o755);
    if (isWindows) {
        writeFileSync(join(bin, 'flipbook.cmd'), `@"${process.execPath}" "${cli}" %*\r\n`);
    }
}

/** The directory and every folder above it, from the root down, as real paths. */
function chainOf(real) {
    const chain = [];
    let at = real;
    for (;;) {
        chain.unshift(at);
        const up = dirname(at);
        if (up === at) break;
        at = up;
    }
    return chain;
}

/**
 * Pin the report directory `dir` before the host starts: its real path, and
 * the device and inode of it and of every folder above it. The shim gets
 * the real path, so a link anywhere on the way stops it from writing.
 */
export function pinReports(dir) {
    const real = realpathSync(dir);
    return {
        real,
        chain: chainOf(real).map((path) => {
            const stat = lstatSync(path);
            return { path, dev: stat.dev, ino: stat.ino };
        }),
    };
}

/** Why the pinned directory is no longer what was pinned, or null when it is. */
export function pinProblem(pin) {
    for (const { path, dev, ino } of pin.chain) {
        let stat;
        try {
            stat = lstatSync(path);
        } catch {
            return `${path} is gone`;
        }
        if (stat.isSymbolicLink()) return `${path} became a link`;
        if (!stat.isDirectory()) return `${path} is no longer a directory`;
        if (stat.dev !== dev || stat.ino !== ino) return `${path} was replaced`;
    }
    let real;
    try {
        real = realpathSync(pin.real);
    } catch {
        return `${pin.real} cannot be resolved`;
    }
    return real === pin.real ? null : `${pin.real} now resolves to ${real}`;
}

/** A regular file directly in `dir`, read without following a link, or null. */
function readPlain(dir, name) {
    let fd;
    try {
        fd = openSync(join(dir, name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch {
        return null;
    }
    try {
        return fstatSync(fd).isFile() ? readFileSync(fd, 'utf-8') : null;
    } finally {
        closeSync(fd);
    }
}

/**
 * The JSON reports kept in the pinned directory, one per run of the CLI:
 * `{ reports, problem }`. When the directory or a folder above it changed
 * since it was pinned, before or after reading, nothing is read and
 * `problem` says what changed. Only entries that are regular files are
 * read, never through a link.
 */
export function shimReports(pin) {
    const before = pinProblem(pin);
    if (before) return { reports: [], problem: before };
    const reports = readdirSync(pin.real, { withFileTypes: true })
        .filter((entry) => entry.isFile() && !entry.name.includes(sep))
        .map((entry) => entry.name)
        .sort()
        .map((name) => {
            const text = readPlain(pin.real, name);
            try {
                return text === null ? null : JSON.parse(text);
            } catch {
                return null;
            }
        })
        .filter((report) => report?.schema === 'flipbook.report/1');
    const after = pinProblem(pin);
    return after ? { reports: [], problem: after } : { reports, problem: null };
}

/** What `flipbook --version` prints through the shim this platform starts, or ''. */
export function shimVersion(bin) {
    const result = isWindows
        ? // Node starts a .cmd only through a shell.
          spawnSync(`"${join(bin, 'flipbook.cmd')}" --version`, { shell: true, encoding: 'utf-8' })
        : spawnSync(join(bin, 'flipbook'), ['--version'], { encoding: 'utf-8' });
    return result.status === 0 ? result.stdout.trim() : '';
}
