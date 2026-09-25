// The sandbox signature table in src/engine/browser.ts, driven by error texts
// measured in real sandboxes (docs/platform.md lists where each was seen).
import type { Browser } from 'playwright-core';
import { afterEach, describe, expect, it } from 'vitest';
import { RUN_ONCE_OUTSIDE_SANDBOX } from '../src/cli/codes.ts';
import type { EnvError } from '../src/cli/report.ts';
import {
    type HeadlessShell,
    installCommand,
    installError,
    isSupportedPlatform,
    launchBrowser,
    matchSandboxSignature,
    resetLaunchMode,
    SANDBOX_SIGNATURES,
    sandboxHost,
    shellLayout,
} from '../src/engine/browser.ts';
import { cacheRoot } from '../src/engine/cache.ts';

process.env.FLIPBOOK_QUIET = '1';

const MACH_PORT =
    '[pid=58399][err] [0925/041326.769907:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.58399: Permission denied (1100)';
const CODEX_LINUX =
    '[pid=13][err] [0924/205841.310702:FATAL:content/browser/sandbox_host_linux.cc:41] Check failed: . shutdown: Operation not permitted (1)';
const TEMP_EPERM =
    "browserType.launch: EPERM: operation not permitted, mkdtemp '/var/folders/p8/vpkbx_ss5j7c4yfn4p0jvqlm0000gn/T/playwright-artifacts-04geOJ'";
const TEMP_EROFS =
    "browserType.launch: EROFS: read-only file system, mkdtemp '/tmp/playwright-artifacts-2Rw7aB'";
const TEMP_ENOENT =
    "browserType.launch: ENOENT: no such file or directory, mkdtemp '/tmp/claude/playwright-artifacts-NNEyOd'";
const MISSING_LIBS =
    'chrome-headless-shell: error while loading shared libraries: libnspr4.so: cannot open shared object file';

const shell: HeadlessShell = {
    revision: '1243',
    browserVersion: '153.0.8010.12',
    browsersPath: '/cache/browsers',
    executable: '/cache/browsers/chrome-headless-shell',
    installed: true,
    playwrightVersion: '1.63.0',
};
const fakeBrowser = {} as Browser;

/** A launcher that fails with `messages[i]` on attempt i and succeeds once they run out. */
function scripted(messages: string[]) {
    const attempts: string[][] = [];
    const launch = async (args: string[]) => {
        attempts.push(args);
        const message = messages[attempts.length - 1];
        if (message !== undefined) throw new Error(message);
        return fakeBrowser;
    };
    return { attempts, launch };
}

async function launchFailure(messages: string[]): Promise<{ error: EnvError; attempts: number }> {
    const { attempts, launch } = scripted(messages);
    try {
        await launchBrowser(shell, launch);
    } catch (error) {
        return { error: error as EnvError, attempts: attempts.length };
    }
    throw new Error('launchBrowser did not fail');
}

afterEach(() => resetLaunchMode());

describe('sandbox signature table', () => {
    it('matches each measured text to one row, most specific first', () => {
        expect(matchSandboxSignature(MACH_PORT)?.id).toBe('mach-port');
        expect(matchSandboxSignature(CODEX_LINUX)?.id).toBe('linux-socket-filter');
        expect(matchSandboxSignature(TEMP_EPERM)?.id).toBe('temp-dir');
        expect(matchSandboxSignature(TEMP_EROFS)?.id).toBe('temp-dir');
        expect(matchSandboxSignature(TEMP_ENOENT)?.id).toBe('temp-dir');
        expect(matchSandboxSignature('socket: Operation not permitted')?.id).toBe(
            'operation-not-permitted',
        );
        expect(matchSandboxSignature(MISSING_LIBS)).toBeNull();
        expect(matchSandboxSignature('Target page, context or browser has been closed')).toBeNull();
    });

    it('records where every row was seen', () => {
        for (const row of SANDBOX_SIGNATURES) {
            expect(row.seenIn.length, row.id).toBeGreaterThan(10);
            expect(row.fix.length, row.id).toBeGreaterThan(0);
        }
    });

    it('retries a mach port refusal in single-process mode', async () => {
        const { attempts, launch } = scripted([MACH_PORT]);
        const launched = await launchBrowser(shell, launch);
        expect(launched.mode).toBe('single-process');
        expect(attempts).toHaveLength(2);
        expect(attempts[1]).toEqual(expect.arrayContaining(['--single-process', '--no-zygote']));
    });

    it('names both hosts when single-process mode is refused too', async () => {
        const { error, attempts } = await launchFailure([MACH_PORT, MACH_PORT]);
        expect(attempts).toBe(2);
        expect(error.code).toBe('sandbox-blocked');
        expect(error.detail.signature).toBe('mach-port');
        const fix = error.fix.join('\n');
        expect(fix).toContain('allowMachLookup');
        expect(fix).toContain('excludedCommands');
        expect(fix).toContain('Codex');
    });

    it('does not retry the Codex Linux socket filter and points at network_access', async () => {
        const { error, attempts } = await launchFailure([CODEX_LINUX]);
        expect(attempts).toBe(1);
        expect(error.code).toBe('sandbox-blocked');
        expect(error.detail.signature).toBe('linux-socket-filter');
        expect(error.fix.join('\n')).toContain('network_access = true');
    });

    it('does not retry an unwritable temp directory and reports tmp-unwritable', async () => {
        for (const text of [TEMP_EPERM, TEMP_EROFS, TEMP_ENOENT]) {
            resetLaunchMode();
            const { error, attempts } = await launchFailure([text]);
            expect(attempts).toBe(1);
            expect(error.code).toBe('tmp-unwritable');
            expect(error.detail.signature).toBe('temp-dir');
            expect(error.message).toContain(/mkdtemp '([^']+)\//.exec(text)?.[1]);
            expect(error.fix.join('\n')).toContain('TMPDIR');
        }
    });

    it('keeps missing Linux libraries and unknown failures apart from the table', async () => {
        const libs = await launchFailure([MISSING_LIBS]);
        expect(libs.attempts).toBe(1);
        expect(libs.error.code).toBe('linux-deps-missing');
        resetLaunchMode();
        const other = await launchFailure(['Target page, context or browser has been closed']);
        expect(other.attempts).toBe(1);
        expect(other.error.code).toBe('browser-launch-failed');
    });

    it('tells the hosts apart by the variables they set', () => {
        expect(sandboxHost({ CODEX_SANDBOX: 'seatbelt' })).toBe('codex');
        expect(sandboxHost({ SANDBOX_RUNTIME: '1' })).toBe('claude-code');
        expect(sandboxHost({ CLAUDECODE: '1' })).toBeNull();
        expect(sandboxHost({})).toBeNull();
    });
});

describe('first download inside a sandbox', () => {
    it('reads a refused download as a network block', () => {
        for (const log of [
            'Error: getaddrinfo ENOTFOUND cdn.playwright.dev',
            "Error: Download failed: server returned code 403 body 'Connection blocked by network allowlist'. URL: https://cdn.playwright.dev/builds/cft/153.0.8010.12/linux-arm64/chrome-headless-shell-linux-arm64.zip",
        ]) {
            const error = installError(log, shell, {});
            expect(error.code).toBe('chromium-install-failed');
            expect(error.detail.signature).toBe('network-blocked');
            expect(error.fix[0]).toBe(installCommand(shell));
            expect(error.fix.join('\n')).toContain('network_access = true');
            expect(error.fix).toContain(RUN_ONCE_OUTSIDE_SANDBOX);
        }
    });

    it('reads a refused write as an unwritable cache', () => {
        const error = installError(
            "Error: EACCES: permission denied, mkdir '/cache/browsers'",
            shell,
            {},
        );
        expect(error.code).toBe('cache-unwritable');
        expect(error.fix).toContain(RUN_ONCE_OUTSIDE_SANDBOX);
    });

    it('says how the one approved rerun goes, in every first-download fix', () => {
        expect(RUN_ONCE_OUTSIDE_SANDBOX).toContain('dangerouslyDisableSandbox');
        expect(RUN_ONCE_OUTSIDE_SANDBOX).toContain('approves once');
        expect(RUN_ONCE_OUTSIDE_SANDBOX).toContain('inside the sandbox');
    });
});

describe('Windows', () => {
    it('has an x64 headless shell layout and nothing for arm64', () => {
        expect(shellLayout('win32', 'x64')).toEqual([
            'chrome-headless-shell-win64',
            'chrome-headless-shell.exe',
        ]);
        expect(shellLayout('win32', 'arm64')).toBeNull();
        expect(shellLayout('linux', 'arm64')).toEqual([
            'chrome-headless-shell-linux-arm64',
            'chrome-headless-shell',
        ]);
    });

    it('stays unsupported unless FLIPBOOK_ALLOW_WIN32=1', () => {
        expect(isSupportedPlatform('win32', 'x64', {})).toBe(false);
        expect(isSupportedPlatform('win32', 'x64', { FLIPBOOK_ALLOW_WIN32: '1' })).toBe(true);
        expect(isSupportedPlatform('win32', 'arm64', { FLIPBOOK_ALLOW_WIN32: '1' })).toBe(false);
        expect(isSupportedPlatform('darwin', 'arm64', {})).toBe(true);
        expect(isSupportedPlatform('linux', 'x64', {})).toBe(true);
        expect(isSupportedPlatform('freebsd', 'x64', {})).toBe(false);
    });

    it('prints the install command in PowerShell syntax', () => {
        const win = {
            ...shell,
            browsersPath: 'C:\\Users\\me\\AppData\\Local\\liustack\\flipbook\\browsers',
        };
        expect(installCommand(win, 'win32')).toBe(
            '$env:PLAYWRIGHT_BROWSERS_PATH="C:\\Users\\me\\AppData\\Local\\liustack\\flipbook\\browsers"; npx --yes playwright-core@1.63.0 install chromium-headless-shell',
        );
        expect(installCommand(shell, 'linux')).toMatch(/^PLAYWRIGHT_BROWSERS_PATH="/);
    });

    it('keeps the cache under %LOCALAPPDATA%\\liustack\\flipbook', () => {
        expect(cacheRoot({ LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, 'win32')).toBe(
            'C:\\Users\\me\\AppData\\Local\\liustack\\flipbook',
        );
        expect(cacheRoot({ USERPROFILE: 'C:\\Users\\me' }, 'win32')).toBe(
            'C:\\Users\\me\\AppData\\Local\\liustack\\flipbook',
        );
        expect(cacheRoot({ HOME: '/home/me' }, 'linux')).toBe('/home/me/.cache/liustack/flipbook');
        expect(cacheRoot({ HOME: '/Users/me' }, 'darwin')).toBe(
            '/Users/me/Library/Caches/liustack/flipbook',
        );
    });
});
