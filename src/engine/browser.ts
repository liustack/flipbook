import { spawn } from 'child_process';
import * as fs from 'fs';
import { createRequire } from 'module';
import * as path from 'path';
import type { Browser } from 'playwright-core';
import { EnvError, progress } from '../cli/report.ts';
import { browsersDir, isWritable } from './cache.ts';
import { terminate } from './proc.ts';

/** Launch arguments every render uses. No GPU flags. */
export const FIXED_ARGS = [
    '--force-color-profile=srgb',
    '--font-render-hinting=none',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-checker-imaging',
    // Network backstops for what page routes cannot see: no WebRTC over UDP,
    // no name lookups (DNS prefetch, preconnect). Pages are served by routes, never resolved.
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--host-resolver-rules=MAP * ~NOTFOUND',
];

/** Added when the host sandbox blocks Chromium's multi-process startup. */
export const SANDBOX_ARGS = ['--single-process', '--no-zygote'];

/** The agent host whose sandbox this process runs in, from the variables each host sets. */
export type SandboxHost = 'claude-code' | 'codex' | null;

export function sandboxHost(env: NodeJS.ProcessEnv = process.env): SandboxHost {
    if (env.CODEX_SANDBOX) return 'codex';
    if (env.SANDBOX_RUNTIME === '1') return 'claude-code';
    return null;
}

/** One way a host sandbox stops Chromium, as measured. docs/platform.md keeps the same table. */
export interface SandboxSignature {
    /** Reported as `detail.signature`. */
    id: string;
    /** Where this text was measured. */
    seenIn: string;
    pattern: RegExp;
    /** True when --single-process --no-zygote got past it in the measurement. */
    singleProcessHelps: boolean;
    /** What flipbook reports when it gives up, given the launch log. */
    message: (log: string) => string;
    fix: string[];
}

const BOTH_MODES = () =>
    'The host sandbox blocked Chromium in both normal and single-process mode.';

const HOST_ESCAPE = [
    'Claude Code: enable sandbox.network.allowMachLookup in settings.json',
    'Claude Code: or add the flipbook launcher (skills/flipbook/scripts/run.sh) to sandbox.excludedCommands',
    'Codex: approve running this command outside the sandbox',
];

/** Checked in order: the first matching row wins, so specific rows come before generic ones. */
export const SANDBOX_SIGNATURES: readonly SandboxSignature[] = [
    {
        id: 'temp-dir',
        seenIn: 'Codex read-only sandbox (EPERM on macOS, EROFS on Linux), a read-only Linux root file system (EROFS), the Claude Code sandbox runtime before its TMPDIR exists (ENOENT)',
        pattern: /\b(?:EPERM|EACCES|EROFS|ENOENT)\b[^\n]*\bmkdtemp\b/,
        singleProcessHelps: false,
        message: (log) => {
            const dir = /mkdtemp '([^']+)'/.exec(log)?.[1];
            const where = dir ? ` ${path.dirname(dir)}` : '';
            return `Chromium could not start: the temporary directory${where} cannot be written.`;
        },
        fix: [
            'Point TMPDIR at an existing directory this command may write, then run it again: mkdir -p .tmp && TMPDIR="$PWD/.tmp" <the same command>',
            'Codex: use the workspace-write sandbox, not read-only',
        ],
    },
    {
        id: 'linux-socket-filter',
        seenIn: 'Codex sandbox on Linux with network access off (its seccomp filter refuses shutdown() on sockets), in both launch modes',
        pattern: /sandbox_host_linux\.cc[^\n]*shutdown: Operation not permitted/,
        singleProcessHelps: false,
        message: () =>
            'The host sandbox refuses a socket call Chromium makes at startup, in both launch modes.',
        fix: [
            'Codex: set network_access = true under [sandbox_workspace_write] in ~/.codex/config.toml, which drops the socket filter',
            'Codex: or approve running this command outside the sandbox',
        ],
    },
    {
        id: 'mach-port',
        seenIn: 'macOS Seatbelt: the Claude Code sandbox and the Codex workspace-write sandbox. Single-process mode starts in both',
        pattern: /mach_port_rendezvous|bootstrap_check_in|Permission denied \(1100\)/,
        singleProcessHelps: true,
        message: BOTH_MODES,
        fix: HOST_ESCAPE,
    },
    {
        id: 'operation-not-permitted',
        seenIn: 'not measured in a known host: any other EPERM, tried once in single-process mode like the mach port row',
        pattern: /\bEPERM\b|Operation not permitted/,
        singleProcessHelps: true,
        message: BOTH_MODES,
        fix: HOST_ESCAPE,
    },
];

/** The first signature row that matches a launch failure, or null. */
export function matchSandboxSignature(message: string): SandboxSignature | null {
    return SANDBOX_SIGNATURES.find((row) => row.pattern.test(message)) ?? null;
}

const MISSING_LIBS_SIGNATURE = /error while loading shared libraries/;
/** The Chromium download was refused: no DNS, no route, or a proxy allowlist. */
const NETWORK_BLOCKED =
    /\bENOTFOUND\b|\bEAI_AGAIN\b|\bECONNREFUSED\b|\bENETUNREACH\b|Connection blocked by network allowlist/;
/** Writing the cache was refused. */
const WRITE_REFUSED = /\bEPERM\b|\bEACCES\b|\bEROFS\b|Operation not permitted/;
/** Lines of the boxed notice playwright-core prints when its CLI runs from an npx cache. */
const BANNER_LINE = /^[\u2554\u2551\u255a]/;

export type LaunchMode = 'normal' | 'single-process';

export interface HeadlessShell {
    revision: string;
    browserVersion: string;
    browsersPath: string;
    executable: string;
    installed: boolean;
    playwrightVersion: string;
}

const require = createRequire(import.meta.url);

function playwrightCoreDir(): string {
    return path.dirname(require.resolve('playwright-core/package.json'));
}

/** Where playwright-core unpacks the headless shell on each platform (its own table). */
const SHELL_LAYOUT: Record<string, [string, string]> = {
    'darwin-arm64': ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell'],
    'darwin-x64': ['chrome-headless-shell-mac-x64', 'chrome-headless-shell'],
    'linux-x64': ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
    'linux-arm64': ['chrome-headless-shell-linux-arm64', 'chrome-headless-shell'],
    'win32-x64': ['chrome-headless-shell-win64', 'chrome-headless-shell.exe'],
};

/** The headless shell's directory and file name for a platform, or null when there is no build. */
export function shellLayout(
    platform: string = process.platform,
    arch: string = process.arch,
): [string, string] | null {
    return SHELL_LAYOUT[`${platform}-${arch}`] ?? null;
}

/** Windows is not supported. FLIPBOOK_ALLOW_WIN32=1 lets it run anyway, for CI. */
export function win32Allowed(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.FLIPBOOK_ALLOW_WIN32 === '1';
}

/** True for macOS and Linux on arm64 or x64, and for Windows x64 only when win32 is allowed. */
export function isSupportedPlatform(
    platform: string = process.platform,
    arch: string = process.arch,
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    if (platform === 'win32' && !win32Allowed(env)) return false;
    return shellLayout(platform, arch) !== null;
}

/** Where the pinned headless shell lives and whether it is there. */
export function headlessShell(env: NodeJS.ProcessEnv = process.env): HeadlessShell {
    const dir = playwrightCoreDir();
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'browsers.json'), 'utf-8')) as {
        browsers: { name: string; revision: string; browserVersion?: string }[];
    };
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')) as {
        version: string;
    };
    const entry = manifest.browsers.find((b) => b.name === 'chromium-headless-shell');
    if (!entry) throw new Error('playwright-core has no chromium-headless-shell entry.');
    const browsersPath = browsersDir(env);
    const layout = shellLayout();
    const executable = layout
        ? path.join(browsersPath, `chromium_headless_shell-${entry.revision}`, ...layout)
        : '';
    return {
        revision: entry.revision,
        browserVersion: entry.browserVersion ?? '',
        browsersPath,
        executable,
        installed: executable !== '' && fs.existsSync(executable),
        playwrightVersion: pkg.version,
    };
}

/** The copyable command that installs the pinned headless shell into the flipbook cache. */
export function installCommand(
    shell: HeadlessShell,
    platform: NodeJS.Platform = process.platform,
): string {
    const install = `npx --yes playwright-core@${shell.playwrightVersion} install chromium-headless-shell`;
    if (platform === 'win32') {
        return `$env:PLAYWRIGHT_BROWSERS_PATH="${shell.browsersPath}"; ${install}`;
    }
    return `PLAYWRIGHT_BROWSERS_PATH="${shell.browsersPath}" ${install}`;
}

export function installDepsCommand(shell: HeadlessShell): string {
    return `sudo npx --yes playwright-core@${shell.playwrightVersion} install-deps chromium-headless-shell`;
}

/** Install the pinned headless shell with playwright-core's own CLI. */
export async function installHeadlessShell(
    shell: HeadlessShell,
    env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
    if (!isWritable(shell.browsersPath)) {
        throw new EnvError(
            'cache-unwritable',
            `Cannot write ${shell.browsersPath} to install Chromium.`,
            [
                installCommand(shell),
                'Or run the same flipbook command once outside the sandbox. Later runs work inside it.',
            ],
            { browsersPath: shell.browsersPath },
        );
    }
    fs.mkdirSync(shell.browsersPath, { recursive: true });
    progress(
        `installing Chromium headless shell ${shell.browserVersion} into ${shell.browsersPath}`,
    );
    const cli = path.join(playwrightCoreDir(), 'cli.js');
    const output: string[] = [];
    const code = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(process.execPath, [cli, 'install', 'chromium-headless-shell'], {
            env: { ...env, PLAYWRIGHT_BROWSERS_PATH: shell.browsersPath },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        const forward = (chunk: Buffer) => {
            const text = chunk.toString('utf-8');
            output.push(text);
            if (process.env.FLIPBOOK_QUIET === '1') return;
            const shown = text
                .split('\n')
                .filter((line) => !BANNER_LINE.test(line))
                .join('\n');
            if (shown.trim()) process.stderr.write(shown);
        };
        child.stdout.on('data', forward);
        child.stderr.on('data', forward);
        const timer = setTimeout(() => terminate(child), 15 * 60 * 1000);
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on('exit', (exitCode) => {
            clearTimeout(timer);
            resolve(exitCode);
        });
    });
    const log = output.join('').trim();
    if (code !== 0 || !fs.existsSync(shell.executable)) throw installError(log, shell, env);
}

/** Classify a failed Chromium install: refused write, refused download, or anything else. */
export function installError(
    log: string,
    shell: HeadlessShell,
    env: NodeJS.ProcessEnv = process.env,
): EnvError {
    const tail = log.slice(-2000);
    const host = sandboxHost(env);
    if (WRITE_REFUSED.test(log)) {
        return new EnvError(
            'cache-unwritable',
            `The Chromium install could not write to ${shell.browsersPath}.`,
            [installCommand(shell)],
            { log: tail, host },
        );
    }
    if (NETWORK_BLOCKED.test(log)) {
        return new EnvError(
            'chromium-install-failed',
            `The Chromium ${shell.browserVersion} download was refused. A sandbox without network access does this.`,
            [
                installCommand(shell),
                'Run the command above, or the same flipbook command, once outside the sandbox. Later runs work inside it.',
                'Codex: or set network_access = true under [sandbox_workspace_write] in ~/.codex/config.toml',
            ],
            { log: tail, host, signature: 'network-blocked' },
        );
    }
    return new EnvError(
        'chromium-install-failed',
        `Installing Chromium headless shell ${shell.browserVersion} failed.`,
        [installCommand(shell)],
        { log: tail, host },
    );
}

/** The pinned headless shell, installed when missing. */
export async function ensureHeadlessShell(
    env: NodeJS.ProcessEnv = process.env,
): Promise<HeadlessShell> {
    const shell = headlessShell(env);
    if (!shellLayout()) {
        throw new EnvError(
            'platform-unsupported',
            `No Chromium headless shell build for ${process.platform}-${process.arch}.`,
        );
    }
    if (shell.installed) return shell;
    await installHeadlessShell(shell, env);
    return headlessShell(env);
}

export interface Launched {
    browser: Browser;
    mode: LaunchMode;
    shell: HeadlessShell;
}

export type LaunchFn = (args: string[]) => Promise<Browser>;

let preferredMode: LaunchMode | null = null;

/**
 * Classify a failed launch into the environment error it stands for.
 * `bothModes` is true once single-process mode has failed too.
 */
export function launchError(
    message: string,
    shell: HeadlessShell,
    bothModes: boolean,
    env: NodeJS.ProcessEnv = process.env,
): EnvError {
    const log = message.split('\n').slice(0, 40).join('\n');
    if (MISSING_LIBS_SIGNATURE.test(message)) {
        return new EnvError(
            'linux-deps-missing',
            'Chromium cannot start: Linux system libraries are missing.',
            [installDepsCommand(shell)],
            { log },
        );
    }
    const row = matchSandboxSignature(message);
    if (row && (bothModes || !row.singleProcessHelps)) {
        return new EnvError('sandbox-blocked', row.message(message), [...row.fix], {
            log,
            signature: row.id,
            host: sandboxHost(env),
        });
    }
    return new EnvError('browser-launch-failed', 'Chromium did not start.', [], { log });
}

/** True when the failure matches a signature that single-process mode gets past. */
export function isSandboxFailure(message: string): boolean {
    return matchSandboxSignature(message)?.singleProcessHelps === true;
}

/**
 * Launch the headless shell with the fixed arguments. A launch that dies on a
 * signature single-process mode gets past is retried once with
 * --single-process --no-zygote.
 */
export async function launchBrowser(shell: HeadlessShell, launch?: LaunchFn): Promise<Launched> {
    const doLaunch: LaunchFn =
        launch ??
        (async (args) => {
            const { chromium } = await import('playwright-core');
            return chromium.launch({
                executablePath: shell.executable,
                headless: true,
                args,
                timeout: 60_000,
            });
        });
    if (preferredMode === 'single-process') {
        try {
            const browser = await doLaunch([...FIXED_ARGS, ...SANDBOX_ARGS]);
            return { browser, mode: 'single-process', shell };
        } catch (error) {
            throw launchError(String((error as Error).message), shell, true);
        }
    }
    try {
        const browser = await doLaunch(FIXED_ARGS);
        preferredMode = 'normal';
        return { browser, mode: 'normal', shell };
    } catch (error) {
        const message = String((error as Error).message);
        if (!isSandboxFailure(message)) throw launchError(message, shell, false);
        progress('Chromium hit the host sandbox, retrying with --single-process --no-zygote');
        try {
            const browser = await doLaunch([...FIXED_ARGS, ...SANDBOX_ARGS]);
            preferredMode = 'single-process';
            return { browser, mode: 'single-process', shell };
        } catch (retryError) {
            throw launchError(
                `${message}\n--- single-process retry ---\n${String((retryError as Error).message)}`,
                shell,
                true,
            );
        }
    }
}

/** Forget the remembered launch mode (tests). */
export function resetLaunchMode(): void {
    preferredMode = null;
}
