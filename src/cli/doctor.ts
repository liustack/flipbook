// flipbook doctor: offline self-check. Reads the machine only; never
// installs, never downloads, never touches the network.
import * as fs from 'fs';
import * as os from 'os';
import {
    type HeadlessShell,
    headlessShell,
    installCommand,
    installDepsCommand,
    type LaunchFn,
    launchBrowser,
} from '../engine/browser.ts';
import { cacheRoot } from '../engine/cache.ts';
import { ALL_FEATURES, FFMPEG_INSTALL, type FfmpegStatus, probeFfmpeg } from '../engine/ffmpeg.ts';
import { type FontStatus, fontStatus } from '../engine/fonts.ts';
import type { PruneResult } from '../engine/prune.ts';
import { findSkillInstalls, type SkillInstall } from '../skillPin.ts';
import { ENV_CODES, type EnvCode } from './codes.ts';
import { EnvError, EXIT, type ExitCode, platformId } from './report.ts';

export const MIN_NODE = '22.19';
export const DOCTOR_SCHEMA = 'flipbook.doctor/1';

export interface DoctorProblem {
    code: EnvCode;
    message: string;
    fix: string[];
}

export interface DoctorReport {
    schema: typeof DOCTOR_SCHEMA;
    ok: boolean;
    exitCode: ExitCode;
    version: string;
    platform: { id: string; supported: boolean };
    node: { version: string; minimum: string; ok: boolean };
    ffmpeg: FfmpegStatus & { ok: boolean };
    chromium: {
        revision: string;
        browserVersion: string;
        playwrightCore: string;
        executable: string;
        installed: boolean;
    };
    launch: { ok: boolean; skipped: boolean; mode?: string; version?: string; error?: string };
    cache: { root: string; exists: boolean; fonts: FontStatus[] };
    skillInstalls: SkillInstall[];
    /** Present after --prune. */
    pruned?: PruneResult;
    problems: DoctorProblem[];
    /** Every fix line from problems, in order and without repeats: what to relay on exit 78. */
    fix: string[];
    warnings: string[];
}

export interface DoctorDeps {
    version: string;
    env?: NodeJS.ProcessEnv;
    home?: string;
    platform?: NodeJS.Platform;
    arch?: string;
    nodeVersion?: string;
    probeFfmpeg?: (env: NodeJS.ProcessEnv) => Promise<FfmpegStatus>;
    shell?: (env: NodeJS.ProcessEnv) => HeadlessShell;
    /** Replaces the real Chromium launch (tests). */
    launch?: LaunchFn;
    /** Result of --prune, reported as is. */
    pruned?: PruneResult;
}

function nodeOk(version: string, minimum: string): boolean {
    const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
    const [minMajor, minMinor] = minimum.split('.').map(Number);
    return major > minMajor || (major === minMajor && minor >= minMinor);
}

export async function buildDoctorReport(deps: DoctorDeps): Promise<DoctorReport> {
    const env = deps.env ?? process.env;
    const platform = deps.platform ?? process.platform;
    const arch = deps.arch ?? process.arch;
    const nodeVersion = deps.nodeVersion ?? process.version;
    const problems: DoctorProblem[] = [];
    const warnings: string[] = [];
    const supported =
        (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) ||
        (platform === 'linux' && (arch === 'x64' || arch === 'arm64'));
    if (!supported) {
        problems.push({
            code: 'platform-unsupported',
            message: `${platform}-${arch} is not supported.`,
            fix: [ENV_CODES['platform-unsupported'].fix],
        });
    }
    const node = { version: nodeVersion, minimum: MIN_NODE, ok: nodeOk(nodeVersion, MIN_NODE) };
    if (!node.ok) {
        problems.push({
            code: 'node-too-old',
            message: `Node ${nodeVersion} is below ${MIN_NODE}.`,
            fix: [ENV_CODES['node-too-old'].fix],
        });
    }

    const ff = await (deps.probeFfmpeg ?? probeFfmpeg)(env);
    const ffOk =
        ff.ffmpeg !== null &&
        ff.ffprobe !== null &&
        ALL_FEATURES.every((name) => ff.features?.[name]);
    if (!ff.ffmpeg || !ff.ffprobe) {
        problems.push({
            code: 'ffmpeg-missing',
            message: `${!ff.ffmpeg ? 'ffmpeg' : 'ffprobe'} is not on PATH.`,
            fix: FFMPEG_INSTALL,
        });
    } else if (!ffOk) {
        problems.push({
            code: 'ffmpeg-feature-missing',
            message: `ffmpeg lacks: ${ff.missing.join(', ')}.`,
            fix: FFMPEG_INSTALL,
        });
    }

    const shell = (deps.shell ?? headlessShell)(env);
    if (!shell.installed) {
        problems.push({
            code: 'chromium-missing',
            message: `Chromium headless shell ${shell.browserVersion} (r${shell.revision}) is not installed at ${shell.executable}.`,
            fix: [
                installCommand(shell),
                'Or run flipbook check <dir> once outside the sandbox. It installs Chromium on first use.',
            ],
        });
    }
    const launch: DoctorReport['launch'] = { ok: false, skipped: true };
    if (shell.installed && supported) {
        launch.skipped = false;
        try {
            const launched = await launchBrowser(shell, deps.launch);
            launch.ok = true;
            launch.mode = launched.mode;
            launch.version = launched.browser.version();
            await launched.browser.close();
        } catch (error) {
            const envError =
                error instanceof EnvError
                    ? error
                    : new EnvError('browser-launch-failed', String((error as Error).message));
            launch.error = envError.message;
            problems.push({
                code: envError.code,
                message: envError.message,
                fix:
                    envError.fix.length > 0
                        ? envError.fix
                        : envError.code === 'browser-launch-failed' && platform === 'linux'
                          ? [installDepsCommand(shell)]
                          : [ENV_CODES[envError.code].fix],
            });
        }
    }

    const root = cacheRoot(env);
    const fonts = fontStatus(env);
    for (const font of fonts) {
        if (!font.present) {
            warnings.push(
                `${font.family} is not cached yet. check and render download it on first use (network needed).`,
            );
        }
    }
    const skillInstalls = findSkillInstalls(deps.version, deps.home ?? env.HOME ?? os.homedir());
    for (const install of skillInstalls) {
        if (install.outdated) {
            warnings.push(
                `The ${install.harness} skill copy pins ${install.pinned}, older than this CLI (${deps.version}). Reinstall the skill to update it.`,
            );
        }
    }
    const ok = problems.length === 0;
    return {
        schema: DOCTOR_SCHEMA,
        ok,
        exitCode: ok ? EXIT.ok : EXIT.env,
        version: deps.version,
        platform: { id: `${platform}-${arch}`, supported },
        node,
        ffmpeg: { ...ff, ok: ffOk },
        chromium: {
            revision: shell.revision,
            browserVersion: shell.browserVersion,
            playwrightCore: shell.playwrightVersion,
            executable: shell.executable,
            installed: shell.installed,
        },
        launch,
        cache: { root, exists: fs.existsSync(root), fonts },
        skillInstalls,
        ...(deps.pruned ? { pruned: deps.pruned } : {}),
        problems,
        fix: [...new Set(problems.flatMap((problem) => problem.fix))],
        warnings,
    };
}

const mark = (ok: boolean) => (ok ? '[ok]' : '[!!]');

export function renderDoctorReport(report: DoctorReport): string {
    const lines: string[] = [];
    lines.push(`flipbook ${report.version} doctor (${platformId()})`, '');
    lines.push(`${mark(report.platform.supported)} platform ${report.platform.id}`);
    lines.push(
        `${mark(report.node.ok)} node ${report.node.version} (minimum ${report.node.minimum})`,
    );
    lines.push(
        `${mark(report.ffmpeg.ok)} ffmpeg ${report.ffmpeg.version ?? 'not found'}${report.ffmpeg.ffmpeg ? ` at ${report.ffmpeg.ffmpeg}` : ''}`,
    );
    if (report.ffmpeg.features) {
        lines.push(
            `     ${Object.entries(report.ffmpeg.features)
                .map(([name, ok]) => `${name} ${ok ? 'yes' : 'NO'}`)
                .join(', ')}`,
        );
    }
    lines.push(
        `${mark(report.chromium.installed)} chromium headless shell ${report.chromium.browserVersion} (r${report.chromium.revision}, playwright-core ${report.chromium.playwrightCore})`,
    );
    lines.push(`     ${report.chromium.executable}`);
    if (report.launch.skipped) lines.push('[--] launch skipped');
    else if (report.launch.ok)
        lines.push(`[ok] launch ${report.launch.version} (${report.launch.mode})`);
    else lines.push(`[!!] launch failed: ${report.launch.error}`);
    lines.push(`     cache ${report.cache.root}`);
    for (const font of report.cache.fonts) {
        lines.push(
            `${font.present ? '[ok]' : '[--]'} font ${font.family}${font.present ? '' : ' (downloads on first use)'}`,
        );
    }
    for (const install of report.skillInstalls) {
        lines.push(
            `${install.outdated ? '[!!]' : '[ok]'} skill copy (${install.harness}) pins ${install.pinned ?? 'nothing'}`,
        );
    }
    if (report.pruned) {
        lines.push(
            `[ok] pruned ${report.pruned.removed.length} cache entries, ${(report.pruned.bytesFreed / 1e6).toFixed(1)} MB freed`,
        );
        for (const removed of report.pruned.removed) lines.push(`     removed ${removed}`);
    }
    if (report.problems.length > 0) {
        lines.push('', 'Problems:');
        for (const problem of report.problems) {
            lines.push(`  ${problem.code}: ${problem.message}`);
            for (const fix of problem.fix) lines.push(`    fix: ${fix}`);
        }
    }
    if (report.warnings.length > 0) {
        lines.push('', 'Warnings:');
        for (const warning of report.warnings) lines.push(`  ${warning}`);
    }
    return lines.join('\n');
}
