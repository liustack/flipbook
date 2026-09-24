// run.ps1 under every PowerShell on this machine: Windows PowerShell 5.1
// (powershell.exe, Windows only) and PowerShell 7 (pwsh). Skipped where
// neither exists.
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanTemps, repoRoot, tempDir } from './helpers.ts';

const launcher = path.join(repoRoot, 'skills', 'flipbook', 'scripts', 'run.ps1');
const pinned = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')).version;
const isWindows = process.platform === 'win32';

/** The PATH value, whatever case the key has (Windows usually spells it Path). */
function pathValue(env: NodeJS.ProcessEnv): string {
    const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
    return key ? (env[key] ?? '') : '';
}

/** A copy of process.env whose only PATH entry is `value`. */
function withPath(value: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, v] of Object.entries(process.env)) {
        if (key.toUpperCase() !== 'PATH') env[key] = v;
    }
    env.PATH = value;
    return env;
}

function findOnPath(name: string): string | null {
    const exts = isWindows ? ['.exe'] : [''];
    for (const dir of pathValue(process.env).split(path.delimiter)) {
        for (const ext of exts) {
            const full = path.join(dir, name + ext);
            if (dir && fs.existsSync(full)) return full;
        }
    }
    return null;
}

const shells = (isWindows ? ['powershell', 'pwsh'] : ['pwsh'])
    .map((name) => ({ name, exe: findOnPath(name) }))
    .filter((s): s is { name: string; exe: string } => s.exe !== null);

/** A fake flipbook on its own PATH directory: a .cmd shim on Windows, a sh script elsewhere. */
function fakeCli(version: string = pinned): string {
    const dir = tempDir('fakeps1');
    const script = path.join(dir, 'fake.mjs');
    fs.writeFileSync(
        script,
        [
            'const [cmd] = process.argv.slice(2);',
            `if (cmd === '--version') { process.stdout.write('${version}\\n'); process.exit(0); }`,
            "if (cmd === 'doctor') {",
            '    process.stderr.write(\'{"error":"platform-unsupported"}\\n\');',
            "    process.stdout.write(JSON.stringify({ ok: false, exitCode: 78, path: 'C:\\\\用户\\\\翻页书' }) + '\\n');",
            '    process.exit(78);',
            '}',
            "process.stderr.write('[flipbook] progress\\n');",
            "process.stdout.write(JSON.stringify({ command: cmd, text: '你好，翻页书' }) + '\\n');",
            'process.exit(1);',
        ].join('\n'),
    );
    if (isWindows) {
        fs.writeFileSync(
            path.join(dir, 'flipbook.cmd'),
            `@"${process.execPath}" "${script}" %*\r\n`,
        );
    } else {
        fs.writeFileSync(
            path.join(dir, 'flipbook'),
            `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
            { mode: 0o755 },
        );
    }
    return dir;
}

function runPs1(exe: string, args: string[], env: NodeJS.ProcessEnv) {
    return spawnSync(
        exe,
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcher, ...args],
        { env, encoding: 'utf-8', timeout: 60_000, windowsHide: true },
    );
}

afterAll(() => cleanTemps());

describe.runIf(shells.length > 0)('run.ps1', () => {
    for (const { name, exe } of shells) {
        describe(name, () => {
            const fake = fakeCli();
            const env = withPath(`${fake}${path.delimiter}${pathValue(process.env)}`);

            it('picks a compatible CLI on PATH, .cmd shims included', () => {
                expect(runPs1(exe, ['where'], env).stdout.trim()).toBe('path');
            });

            it('reads the version from its first digit and takes a prerelease only when it is the pin', () => {
                const [major, minor, patch] = pinned.split('.').map(Number);
                const cases: [string, string][] = [
                    [`flipbook v${pinned}`, 'path'],
                    [`${pinned}+build.7`, 'path'],
                    [`${major + 10}.${minor}.${patch}`, 'none'],
                    [`${pinned}-beta.1`, 'none'],
                    [`${major}.${minor}`, 'none'],
                ];
                for (const [version, expected] of cases) {
                    const only = withPath(fakeCli(version));
                    expect(runPs1(exe, ['where'], only).stdout.trim(), version).toBe(expected);
                }
            });

            it('passes the exit code and UTF-8 stdout through', () => {
                const result = runPs1(exe, ['check', 'somewhere'], env);
                expect(result.status).toBe(1);
                expect(JSON.parse(result.stdout).text).toBe('你好，翻页书');
            });

            it('prints the CLI doctor report plus the launcher block, with or without --json', () => {
                for (const args of [['doctor'], ['doctor', '--json']]) {
                    const result = runPs1(exe, args, env);
                    expect(result.status, args.join(' ')).toBe(78);
                    const report = JSON.parse(result.stdout);
                    expect(report.launcher.selected).toBe('path');
                    expect(report.path).toBe('C:\\用户\\翻页书');
                }
            });

            it('exits 78 with a runtime-missing report carrying fix when nothing can run the CLI', () => {
                const empty = withPath(tempDir('emptypath'));
                const result = runPs1(exe, ['check', 'somewhere'], empty);
                expect(result.status).toBe(78);
                const diagnosis = JSON.parse(result.stderr);
                expect(diagnosis.error).toBe('runtime-missing');
                expect(diagnosis.launcher.selected).toBe('none');
                expect(diagnosis.launcher.pinnedVersion).toBe(pinned);
                expect(diagnosis.fix).toHaveLength(2);
                const doctor = runPs1(exe, ['doctor'], empty);
                expect(doctor.status).toBe(78);
                expect(JSON.parse(doctor.stdout).launcher.selected).toBe('none');
            });
        });
    }
});
