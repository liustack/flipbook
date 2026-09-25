#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { runAudio } from './cli/audio.ts';
import { runCheck } from './cli/check.ts';
import { runCutout } from './cli/cutout.ts';
import { buildDoctorReport, MIN_NODE, renderDoctorReport } from './cli/doctor.ts';
import { runRender } from './cli/render.ts';
import {
    type Command as CommandName,
    EnvError,
    EXIT,
    envDiagnosis,
    finding,
    type Report,
    ReportBuilder,
    saveReport,
    UsageError,
    writeJson,
} from './cli/report.ts';
import { parseRegion, runSnapshot } from './cli/snapshot.ts';
import { runStockFetch, runStockSearch } from './cli/stock.ts';
import { win32Allowed } from './engine/browser.ts';
import { pruneCache } from './engine/prune.ts';
import { workspaceFinding } from './engine/session.ts';
import { parseSize } from './engine/size.ts';
import { WorkspaceError } from './engine/workspace.ts';
import { COMMAND_NAME } from './names.ts';
import { appVersion } from './paths.ts';
import { type Orientation, PROVIDERS, type Provider } from './stock/providers.ts';

/** Strict integer parse: "10oops" is a typo, not 10. */
function parseInteger(
    raw: string,
    flag: string,
    min: number,
    max = Number.MAX_SAFE_INTEGER,
): number {
    const trimmed = raw.trim();
    const value = Number.parseInt(trimmed, 10);
    if (!/^\d+$/.test(trimmed) || value < min || value > max) {
        throw new UsageError(`Invalid ${flag} "${raw}". Use an integer from ${min} to ${max}.`);
    }
    return value;
}

function parseNumber(raw: string, flag: string, min: number, max: number): number {
    const value = Number(raw.trim());
    if (raw.trim() === '' || !Number.isFinite(value) || value < min || value > max) {
        throw new UsageError(`Invalid ${flag} "${raw}". Use a number from ${min} to ${max}.`);
    }
    return value;
}

function preflight(): void {
    if (process.platform === 'win32' && !win32Allowed()) {
        throw new EnvError('platform-unsupported', 'flipbook does not run on Windows.', [
            'Install WSL2 with Ubuntu (wsl --install), then run flipbook inside it.',
        ]);
    }
    const [major, minor] = process.versions.node.split('.').map(Number);
    const [minMajor, minMinor] = MIN_NODE.split('.').map(Number);
    if (major < minMajor || (major === minMajor && minor < minMinor)) {
        throw new EnvError('node-too-old', `Node ${process.version} is below ${MIN_NODE}.`, [
            'Install Node 22.19 or newer from https://nodejs.org',
        ]);
    }
}

function usageReport(message: string): Report {
    const rb = new ReportBuilder('usage');
    rb.report.usageError = message;
    return rb.finish(EXIT.usage);
}

/** Save the report, print it on stdout, and exit with its code. */
function emit(report: Report): void {
    saveReport(report);
    writeJson(process.stdout, report);
    process.exitCode = report.exitCode;
}

/** Run one command: JSON report on stdout, exit code from the report, on every path. */
async function execute(
    command: CommandName,
    dir: string | undefined,
    fn: () => Promise<Report>,
): Promise<void> {
    try {
        preflight();
        emit(await fn());
    } catch (error) {
        if (error instanceof EnvError) {
            const diagnosis = envDiagnosis(error);
            const rb = new ReportBuilder(command, dir);
            rb.report.environmentError = diagnosis;
            emit(rb.finish(EXIT.env));
            writeJson(process.stderr, diagnosis);
        } else if (error instanceof WorkspaceError) {
            const rb = new ReportBuilder(command, dir);
            rb.add(workspaceFinding(error));
            emit(rb.finish());
        } else if (error instanceof UsageError) {
            process.stderr.write(`Error: ${error.message}\n`);
            emit(usageReport(error.message));
        } else {
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`${error instanceof Error ? error.stack : message}\n`);
            const rb = new ReportBuilder(command, dir);
            rb.add(finding('internal-error', message.split('\n')[0], { detail: { message } }));
            emit(rb.finish(EXIT.failed));
        }
    }
}

const program = new Command();
program.exitOverride();
program
    .name(COMMAND_NAME)
    .description('Render an HTML composition to MP4 frame by frame, and verify the result')
    .version(appVersion());

program
    .command('doctor')
    .description('Offline self-check: Node, ffmpeg features, Chromium, launch, cache, skill copies')
    .option('--json', 'Emit the report as JSON')
    .option('--prune', 'Delete cached browsers and fonts this version does not use')
    .action(async (options: { json?: boolean; prune?: boolean }) => {
        try {
            preflight();
            const pruned = options.prune ? pruneCache() : undefined;
            const report = await buildDoctorReport({ version: appVersion(), pruned });
            process.stdout.write(
                `${options.json ? JSON.stringify(report, null, 2) : renderDoctorReport(report)}\n`,
            );
            process.exitCode = report.exitCode;
        } catch (error) {
            if (error instanceof EnvError) {
                const diagnosis = envDiagnosis(error);
                writeJson(process.stderr, diagnosis);
                if (options.json)
                    writeJson(process.stdout, {
                        ok: false,
                        exitCode: EXIT.env,
                        error: diagnosis.error,
                        message: diagnosis.message,
                        problems: [
                            {
                                code: diagnosis.error,
                                message: diagnosis.message,
                                fix: diagnosis.fix,
                            },
                        ],
                        fix: diagnosis.fix,
                        detail: diagnosis.detail,
                    });
                process.exitCode = EXIT.env;
            } else {
                throw error;
            }
        }
    });

program
    .command('check')
    .description(
        'Validate timeline.json, scan the source, and test the page for determinism, blank frames and text problems',
    )
    .argument('<dir>', 'composition directory')
    .option('--seed <n>', 'seed for choosing and ordering sample frames', '1')
    .option('--samples <n>', 'number of frames to sample', '8')
    .option('--seek-timeout <ms>', 'time limit for one seek', '10000')
    .option('--size <size>', 'stage size in place of the timeline: 9:16, 1:1, 4:5 or WxH')
    .option('--scale <n>', 'output pixels per CSS pixel, as render --scale will use', '1')
    .action(
        async (
            dir: string,
            options: {
                seed: string;
                samples: string;
                seekTimeout: string;
                size?: string;
                scale: string;
            },
        ) => {
            await execute('check', dir, () =>
                runCheck({
                    dir,
                    size: options.size ? parseSize(options.size) : undefined,
                    scale: parseNumber(options.scale, '--scale', 1, 4),
                    seed: parseInteger(options.seed, '--seed', 0, 4294967295),
                    samples: parseInteger(options.samples, '--samples', 2, 64),
                    seekTimeoutMs: parseInteger(
                        options.seekTimeout,
                        '--seek-timeout',
                        100,
                        600_000,
                    ),
                }),
            );
        },
    );

program
    .command('snapshot')
    .description('Tile frames at scene middles and even times into a contact sheet PNG')
    .argument('<dir>', 'composition directory')
    .option('--count <n>', 'evenly spaced frames on top of one per scene', '12')
    .option('--zoom <x,y,w,h>', 'also capture this region (CSS px) enlarged')
    .option('--at <seconds>', 'comma-separated times for --zoom (default: each scene middle)')
    .option('--scale <n>', 'enlargement for --zoom', '2')
    .option('--size <size>', 'stage size in place of the timeline: 9:16, 1:1, 4:5 or WxH')
    .action(
        async (
            dir: string,
            options: { count: string; zoom?: string; at?: string; scale: string; size?: string },
        ) => {
            await execute('snapshot', dir, () =>
                runSnapshot({
                    dir,
                    size: options.size ? parseSize(options.size) : undefined,
                    count: parseInteger(options.count, '--count', 1, 48),
                    zoom: options.zoom ? parseRegion(options.zoom) : undefined,
                    at: options.at
                        ? options.at.split(',').map((part) => parseNumber(part, '--at', 0, 3600))
                        : undefined,
                    scale: parseNumber(options.scale, '--scale', 1, 4),
                }),
            );
        },
    );

program
    .command('audio')
    .description('Synthesize the preset music and sfx cues to WAV files in .flipbook/audio/')
    .argument('<dir>', 'composition directory')
    .action(async (dir: string) => {
        await execute('audio', dir, () => runAudio({ dir }));
    });

program
    .command('render')
    .description('Render the composition to out/video.mp4 and verify it')
    .argument('<dir>', 'composition directory')
    .option('--seek-timeout <ms>', 'time limit for one seek', '10000')
    .option('--size <size>', 'stage size in place of the timeline: 9:16, 1:1, 4:5 or WxH')
    .option('--scale <n>', 'output pixels per CSS pixel, 2 turns 1920x1080 into 3840x2160', '1')
    .option('--jobs <n>', 'pages rendering at once (default: CPU cores - 1, within memory)')
    .option('--recycle <frames>', 'frames per page before it is reopened, 0 for never')
    .action(
        async (
            dir: string,
            options: {
                seekTimeout: string;
                size?: string;
                scale: string;
                jobs?: string;
                recycle?: string;
            },
        ) => {
            await execute('render', dir, () =>
                runRender({
                    dir,
                    seekTimeoutMs: parseInteger(
                        options.seekTimeout,
                        '--seek-timeout',
                        100,
                        600_000,
                    ),
                    size: options.size ? parseSize(options.size) : undefined,
                    scale: parseNumber(options.scale, '--scale', 1, 4),
                    jobs: options.jobs ? parseInteger(options.jobs, '--jobs', 1, 64) : undefined,
                    recycleFrames: options.recycle
                        ? parseInteger(options.recycle, '--recycle', 0, 1_000_000)
                        : undefined,
                }),
            );
        },
    );

function parseChoice<T extends string>(raw: string, flag: string, choices: readonly T[]): T {
    if (!(choices as readonly string[]).includes(raw)) {
        throw new UsageError(`Invalid ${flag} "${raw}". Use one of: ${choices.join(', ')}.`);
    }
    return raw as T;
}

const stock = program
    .command('stock')
    .description('Find public domain and free images and save one into assets/ with its license');

stock
    .command('search')
    .description(
        'Search Pexels, then Pixabay (with keys), then Openverse (cc0 and pdm only), and tile the thumbnails into out/stock/contact-sheet.png',
    )
    .argument('<dir>', 'composition directory')
    .argument('<query...>', 'two to four concrete English words')
    .option('--provider <name>', 'ask only this service: pexels, pixabay or openverse')
    .option('--source <name>', 'Openverse collection only, such as wikimedia or smithsonian')
    .option('--orientation <shape>', 'landscape, portrait or square')
    .option('--count <n>', 'results to show', '8')
    .action(
        async (
            dir: string,
            query: string[],
            options: { provider?: string; source?: string; orientation?: string; count: string },
        ) => {
            await execute('stock-search', dir, () =>
                runStockSearch({
                    dir,
                    query: query.join(' '),
                    provider: options.provider
                        ? parseChoice<Provider>(options.provider, '--provider', PROVIDERS)
                        : undefined,
                    source: options.source,
                    orientation: options.orientation
                        ? parseChoice<Orientation>(options.orientation, '--orientation', [
                              'landscape',
                              'portrait',
                              'square',
                          ])
                        : undefined,
                    count: parseInteger(options.count, '--count', 1, 20),
                }),
            );
        },
    );

stock
    .command('fetch')
    .description(
        'Save one search result as assets/<name>.<ext> and record it in assets/SOURCES.json',
    )
    .argument('<dir>', 'composition directory')
    .argument('<id>', 'an id from stock search, such as openverse:<id>')
    .requiredOption('--as <name>', 'file name under assets/, without the extension')
    .action(async (dir: string, id: string, options: { as: string }) => {
        await execute('stock-fetch', dir, () => runStockFetch({ dir, id, as: options.as }));
    });

program
    .command('cutout')
    .description(
        'Cut every specimen on a plate under assets/ into transparent PNGs under assets/cut/, with a sheet to look at',
    )
    .argument('<dir>', 'composition directory')
    .argument('<image>', 'the plate, such as assets/beetles.jpg')
    .option(
        '--ink',
        'line art (engravings, pen drawings): turn the paper transparent and keep the lines',
    )
    .option('--paper <color>', 'ground color as #rrggbb, measured along the edge when not given')
    .option(
        '--threshold <n>',
        'how far from the ground a color may be and still count as ground, 1 to 255',
    )
    .option(
        '--gap <share>',
        'pieces closer than this share of the long edge are one specimen',
        '0.012',
    )
    .option(
        '--holes <share>',
        'also clear ground enclosed by a specimen covering at least this share of it',
    )
    .option('--max <n>', 'most specimens to cut, biggest first', '12')
    .option(
        '--size <px>',
        'long edge of each cutout (default: its size on the plate, at most 1200)',
    )
    .action(
        async (
            dir: string,
            image: string,
            options: {
                ink?: boolean;
                paper?: string;
                threshold?: string;
                gap: string;
                holes?: string;
                max: string;
                size?: string;
            },
        ) => {
            if (options.paper && !/^#[0-9a-fA-F]{6}$/.test(options.paper)) {
                throw new UsageError(
                    `Invalid --paper "${options.paper}". Use a color such as #efe6d2.`,
                );
            }
            await execute('cutout', dir, () =>
                runCutout({
                    dir,
                    image,
                    mode: options.ink ? 'ink' : 'paper',
                    paper: options.paper,
                    threshold: options.threshold
                        ? parseInteger(options.threshold, '--threshold', 1, 255)
                        : undefined,
                    gap: parseNumber(options.gap, '--gap', 0, 0.2),
                    holes: options.holes ? parseNumber(options.holes, '--holes', 0, 1) : undefined,
                    max: parseInteger(options.max, '--max', 1, 64),
                    size: options.size ? parseInteger(options.size, '--size', 64, 4000) : undefined,
                }),
            );
        },
    );

try {
    await program.parseAsync(process.argv, { from: 'node' });
} catch (error) {
    if (error instanceof CommanderError) {
        if (
            ['commander.helpDisplayed', 'commander.help', 'commander.version'].includes(error.code)
        ) {
            process.exitCode = EXIT.ok;
        } else {
            writeJson(process.stdout, usageReport(error.message));
            process.exitCode = EXIT.usage;
        }
    } else {
        throw error;
    }
}
