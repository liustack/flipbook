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
];

/** Added when the host sandbox blocks Chromium's multi-process startup. */
export const SANDBOX_ARGS = ['--single-process', '--no-zygote'];

const SANDBOX_SIGNATURE =
    /mach_port_rendezvous|bootstrap_check_in|Permission denied \(1100\)|\bEPERM\b|Operation not permitted/;
const MISSING_LIBS_SIGNATURE = /error while loading shared libraries/;

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

function platformDir(): [string, string] | null {
    const key = `${process.platform}-${process.arch}`;
    const table: Record<string, [string, string]> = {
        'darwin-arm64': ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell'],
        'darwin-x64': ['chrome-headless-shell-mac-x64', 'chrome-headless-shell'],
        'linux-x64': ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
        'linux-arm64': ['chrome-headless-shell-linux-arm64', 'chrome-headless-shell'],
    };
    return table[key] ?? null;
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
    const layout = platformDir();
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
export function installCommand(shell: HeadlessShell): string {
    return `PLAYWRIGHT_BROWSERS_PATH="${shell.browsersPath}" npx --yes playwright-core@${shell.playwrightVersion} install chromium-headless-shell`;
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
        });
        const forward = (chunk: Buffer) => {
            output.push(chunk.toString('utf-8'));
            if (process.env.FLIPBOOK_QUIET !== '1') process.stderr.write(chunk);
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
    if (code !== 0 || !fs.existsSync(shell.executable)) {
        if (SANDBOX_SIGNATURE.test(log) || /EACCES/.test(log)) {
            throw new EnvError(
                'cache-unwritable',
                `The Chromium install could not write to ${shell.browsersPath}.`,
                [installCommand(shell)],
                { log: log.slice(-2000) },
            );
        }
        throw new EnvError(
            'chromium-install-failed',
            `Installing Chromium headless shell ${shell.browserVersion} failed.`,
            [installCommand(shell)],
            { log: log.slice(-2000) },
        );
    }
}

/** The pinned headless shell, installed when missing. */
export async function ensureHeadlessShell(
    env: NodeJS.ProcessEnv = process.env,
): Promise<HeadlessShell> {
    const shell = headlessShell(env);
    if (!platformDir()) {
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

/** Classify a failed launch into the environment error it stands for. */
export function launchError(message: string, shell: HeadlessShell, bothModes: boolean): EnvError {
    const log = message.split('\n').slice(0, 40).join('\n');
    if (MISSING_LIBS_SIGNATURE.test(message)) {
        return new EnvError(
            'linux-deps-missing',
            'Chromium cannot start: Linux system libraries are missing.',
            [installDepsCommand(shell)],
            { log },
        );
    }
    if (bothModes && SANDBOX_SIGNATURE.test(message)) {
        return new EnvError(
            'sandbox-blocked',
            'The host sandbox blocked Chromium in both normal and single-process mode.',
            [
                'Claude Code: enable sandbox.network.allowMachLookup in settings.json',
                'Claude Code: or add the flipbook launcher (skills/flipbook/scripts/run.sh) to sandbox.excludedCommands',
            ],
            { log },
        );
    }
    return new EnvError('browser-launch-failed', 'Chromium did not start.', [], { log });
}

export function isSandboxFailure(message: string): boolean {
    return SANDBOX_SIGNATURE.test(message);
}

/**
 * Launch the headless shell with the fixed arguments. A launch that dies on
 * the sandbox signature is retried once with --single-process --no-zygote.
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
        if (!SANDBOX_SIGNATURE.test(message)) throw launchError(message, shell, false);
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
