#!/usr/bin/env node
// flipbook eval runner: prompts x models, each run in a fresh temporary
// workspace with this repository's skill and CLI installed, one evidence JSON
// per run. Spends real model quota: local and on demand, never in CI.
//
//   node eval/run.mjs --dry-run                     validate cases, hosts, install
//   node eval/run.mjs                               every case, default targets, 1 run
//   node eval/run.mjs --target flagship --runs 2 countdown city-bars
//   node eval/run.mjs --model claude-code:claude-opus-5 --timeout-min 20
//
// Criteria for the verdict are in docs/eval.md.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    chmodSync,
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const evalDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(evalDir, '..');
const cli = join(repoRoot, 'dist', 'main.js');

/** Appended to every prompt: the run is unattended. */
export const UNATTENDED =
    '\n\n（这是无人值守的评测：不要提问，没说的按默认值，做完就交付成片路径。）';

const HOSTS = {
    'claude-code': {
        bin: 'claude',
        skillDirs: ['.claude/skills/flipbook'],
        args: (model, prompt) => [
            '-p',
            prompt,
            '--model',
            model,
            '--output-format',
            'json',
            '--permission-mode',
            'bypassPermissions',
        ],
        usage(stdout) {
            try {
                const out = JSON.parse(stdout);
                return {
                    costUsd: out.total_cost_usd ?? null,
                    turns: out.num_turns ?? null,
                    durationMs: out.duration_ms ?? null,
                    usage: out.usage ?? null,
                    isError: out.is_error ?? null,
                    finalMessage: typeof out.result === 'string' ? out.result.slice(-4000) : null,
                };
            } catch {
                return null;
            }
        },
    },
    codex: {
        bin: 'codex',
        skillDirs: ['.agents/skills/flipbook', '.codex/skills/flipbook'],
        agentsNote:
            'For any video request, follow the flipbook skill at .agents/skills/flipbook/SKILL.md.\n',
        args: (model, prompt, ws) => [
            'exec',
            '--model',
            model,
            '-C',
            ws,
            '--skip-git-repo-check',
            '--dangerously-bypass-approvals-and-sandbox',
            '--json',
            prompt,
        ],
        usage(stdout) {
            const events = stdout
                .split('\n')
                .map((line) => {
                    try {
                        return JSON.parse(line);
                    } catch {
                        return null;
                    }
                })
                .filter(Boolean);
            const usage = events.filter((e) => e.usage || e.info?.total_token_usage).pop();
            return {
                costUsd: null,
                turns: events.filter((e) => /turn/.test(e.type ?? '')).length || null,
                usage: usage?.usage ?? usage?.info?.total_token_usage ?? null,
                finalMessage: JSON.stringify(events.slice(-3)).slice(-4000),
            };
        },
    },
};

function parseArgs(argv) {
    const opts = {
        dryRun: false,
        runs: 1,
        targets: [],
        models: [],
        timeoutMin: 30,
        keep: false,
        ids: [],
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--dry-run') opts.dryRun = true;
        else if (arg === '--runs') opts.runs = Number(argv[++i]);
        else if (arg === '--target') opts.targets.push(argv[++i]);
        else if (arg === '--model') opts.models.push(argv[++i]);
        else if (arg === '--timeout-min') opts.timeoutMin = Number(argv[++i]);
        else if (arg === '--keep') opts.keep = true;
        else if (arg.startsWith('-')) throw new Error(`Unknown flag: ${arg}`);
        else opts.ids.push(arg);
    }
    if (!Number.isInteger(opts.runs) || opts.runs < 1)
        throw new Error('--runs takes a positive integer');
    return opts;
}

function loadMatrix(opts) {
    const config = JSON.parse(readFileSync(join(evalDir, 'models.json'), 'utf-8'));
    const matrix = [];
    const names = opts.targets.length > 0 || opts.models.length > 0 ? opts.targets : config.default;
    for (const name of names) {
        const target = config.targets[name];
        if (!target) throw new Error(`No target "${name}" in eval/models.json`);
        matrix.push({ name, ...target });
    }
    for (const spec of opts.models) {
        const [host, model] = spec.split(':');
        if (!HOSTS[host] || !model)
            throw new Error(`--model takes host:model, hosts: ${Object.keys(HOSTS).join(', ')}`);
        matrix.push({ name: `${host}:${model}`, host, model, label: model });
    }
    return matrix;
}

const CASE_FIELDS = ['id', 'title', 'prompt', 'expect'];

function loadCases(ids) {
    const casesDir = join(evalDir, 'cases');
    return readdirSync(casesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && (ids.length === 0 || ids.includes(d.name)))
        .map((d) => {
            const spec = JSON.parse(readFileSync(join(casesDir, d.name, 'case.json'), 'utf-8'));
            const problems = CASE_FIELDS.filter((field) => spec[field] === undefined).map(
                (f) => `missing ${f}`,
            );
            if (spec.id !== d.name) problems.push(`id "${spec.id}" does not match the directory`);
            const range = spec.expect?.durationSec;
            if (!Array.isArray(range) || range.length !== 2 || range[0] >= range[1])
                problems.push('expect.durationSec must be [min, max]');
            if (!['none', 'preset', 'file'].includes(spec.expect?.audio))
                problems.push('expect.audio must be "none", "preset" or "file"');
            return { name: d.name, spec, problems };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}

function sha256File(file) {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function commandVersion(bin, args = ['--version']) {
    const result = spawnSync(bin, args, { encoding: 'utf-8' });
    return result.status === 0 ? result.stdout.trim().split('\n')[0] : null;
}

function repoInfo() {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'));
    const git = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: repoRoot,
        encoding: 'utf-8',
    });
    const dirty =
        spawnSync('git', ['status', '--porcelain'], {
            cwd: repoRoot,
            encoding: 'utf-8',
        }).stdout.trim() !== '';
    return { version: pkg.version, commit: git.status === 0 ? git.stdout.trim() : null, dirty };
}

/** A click track: a soft low tone with a short high blip on every beat. */
function makeClicks(file, { bpm, offsetSec, seconds }) {
    const beat = 60 / bpm;
    const expr = `if(gte(t,${offsetSec})*lt(mod(t-${offsetSec},${beat}),0.05),0.6,0.08)`;
    const result = spawnSync('ffmpeg', [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=660:sample_rate=48000:duration=${seconds}`,
        '-af',
        `volume='${expr}':eval=frame`,
        file,
    ]);
    if (result.status !== 0) throw new Error(`ffmpeg could not make ${file}: ${result.stderr}`);
}

const isWindows = process.platform === 'win32';

/**
 * `flipbook` shims that run this checkout's CLI: a sh script for POSIX shells
 * (Git Bash included) and, on Windows, a .cmd for everything else.
 */
function writeShims(bin) {
    writeFileSync(join(bin, 'flipbook'), `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`);
    chmodSync(join(bin, 'flipbook'), 0o755);
    if (isWindows) {
        writeFileSync(join(bin, 'flipbook.cmd'), `@"${process.execPath}" "${cli}" %*\r\n`);
    }
}

/** What `flipbook --version` prints through the shim this platform starts, or ''. */
function shimVersion(bin) {
    const result = isWindows
        ? // Node starts a .cmd only through a shell.
          spawnSync(`"${join(bin, 'flipbook.cmd')}" --version`, { shell: true, encoding: 'utf-8' })
        : spawnSync(join(bin, 'flipbook'), ['--version'], { encoding: 'utf-8' });
    return result.status === 0 ? result.stdout.trim() : '';
}

/** process.env with `dir` first on PATH, whatever case the PATH key has. */
function envWithBin(dir) {
    const env = {};
    let current = '';
    for (const [key, value] of Object.entries(process.env)) {
        if (key.toUpperCase() === 'PATH') current = value ?? '';
        else env[key] = value;
    }
    env.PATH = `${dir}${delimiter}${current}`;
    return env;
}

/** A fresh workspace with the repository's skill and a `flipbook` shim on PATH. */
function prepareWorkspace(entry, host) {
    const ws = mkdtempSync(join(tmpdir(), `flipbook-eval-${entry.name}-`));
    for (const skillDir of HOSTS[host].skillDirs) {
        mkdirSync(join(ws, skillDir), { recursive: true });
        cpSync(join(repoRoot, 'skills', 'flipbook'), join(ws, skillDir), { recursive: true });
    }
    if (HOSTS[host].agentsNote) writeFileSync(join(ws, 'AGENTS.md'), HOSTS[host].agentsNote);
    const bin = join(ws, '.eval-bin');
    mkdirSync(bin, { recursive: true });
    writeShims(bin);
    for (const [rel, spec] of Object.entries(entry.spec.workspace ?? {})) {
        const file = join(ws, rel);
        mkdirSync(dirname(file), { recursive: true });
        if (spec.generator === 'clicks') makeClicks(file, spec);
        else throw new Error(`${entry.name}: unknown workspace generator ${spec.generator}`);
    }
    return { ws, bin };
}

function findCompositions(ws) {
    const found = [];
    const walk = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (
                !e.isDirectory() ||
                [
                    '.claude',
                    '.agents',
                    '.codex',
                    '.eval-bin',
                    'node_modules',
                    '.flipbook',
                    'out',
                    '.git',
                ].includes(e.name)
            )
                continue;
            walk(join(dir, e.name));
        }
        if (existsSync(join(dir, 'timeline.json')) && existsSync(join(dir, 'index.html')))
            found.push(dir);
    };
    walk(ws);
    return found;
}

function readJson(file) {
    try {
        return JSON.parse(readFileSync(file, 'utf-8'));
    } catch {
        return null;
    }
}

function probe(video) {
    const result = spawnSync(
        'ffprobe',
        [
            '-v',
            'error',
            '-show_entries',
            'stream=codec_type,codec_name,width,height,nb_frames:format=duration',
            '-of',
            'json',
            video,
        ],
        { encoding: 'utf-8' },
    );
    if (result.status !== 0) return null;
    const data = JSON.parse(result.stdout);
    const videoStream = data.streams.find((s) => s.codec_type === 'video');
    const audioStream = data.streams.find((s) => s.codec_type === 'audio');
    return {
        durationSec: Number(data.format?.duration ?? 0),
        width: videoStream?.width ?? null,
        height: videoStream?.height ?? null,
        frames: Number(videoStream?.nb_frames ?? 0),
        audio: audioStream ? audioStream.codec_name : null,
    };
}

/** Independent check on a copy, so the evidence never trusts the agent's own last run. */
function recheck(composition) {
    const copy = mkdtempSync(join(tmpdir(), 'flipbook-eval-recheck-'));
    cpSync(composition, copy, {
        recursive: true,
        filter: (src) => !/[\\/](\.flipbook|out)([\\/]|$)/.test(src),
    });
    const result = spawnSync(process.execPath, [cli, 'check', copy], {
        encoding: 'utf-8',
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, FLIPBOOK_QUIET: '1' },
    });
    rmSync(copy, { recursive: true, force: true });
    return { exitCode: result.status, report: readJsonText(result.stdout) };
}

function readJsonText(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function judge(spec, evidence) {
    const reasons = [];
    const e = spec.expect;
    if (evidence.host.timedOut) reasons.push('host timed out');
    else if (evidence.host.exitCode !== 0) reasons.push(`host exited ${evidence.host.exitCode}`);
    if (evidence.compositions.length !== 1)
        reasons.push(`${evidence.compositions.length} compositions found, expected 1`);
    const c = evidence.compositions[0];
    if (c) {
        if (!c.video) reasons.push('no out/video.mp4');
        if (!c.lastRender?.ok) reasons.push('last render report is missing or not ok');
        if (c.lastRender?.stop || c.lastCheck?.stop)
            reasons.push('the CLI asked the agent to stop');
        if (c.recheck.exitCode !== 0)
            reasons.push(`independent check exited ${c.recheck.exitCode}`);
        if (c.probe) {
            const [min, max] = e.durationSec;
            if (c.probe.durationSec < min || c.probe.durationSec > max)
                reasons.push(
                    `duration ${c.probe.durationSec.toFixed(2)} s outside [${min}, ${max}]`,
                );
            if (e.width && (c.probe.width !== e.width || c.probe.height !== e.height))
                reasons.push(`size ${c.probe.width}x${c.probe.height}`);
            if (e.audio !== 'none' && !c.probe.audio) reasons.push('no audio track');
        }
        if (e.audio !== 'none' && c.audioMode !== e.audio)
            reasons.push(`timeline audio.mode is "${c.audioMode}", expected "${e.audio}"`);
        const missingText = (e.textInSource ?? []).filter((text) => !c.source.includes(text));
        if (missingText.length > 0)
            reasons.push(`text missing from the source: ${missingText.join(', ')}`);
    }
    return {
        oneShot: reasons.length === 0,
        reasons,
        humanReview: { silentBadFilm: null, movingSlides: null, notes: '' },
    };
}

function runHost(target, prompt, ws, bin, timeoutMin) {
    const host = HOSTS[target.host];
    return new Promise((resolve) => {
        const started = Date.now();
        const child = spawn(host.bin, host.args(target.model, prompt, ws), {
            cwd: ws,
            env: envWithBin(bin),
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const out = [];
        const err = [];
        child.stdout.on('data', (d) => out.push(d));
        child.stderr.on('data', (d) => err.push(d));
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 5000);
        }, timeoutMin * 60_000);
        child.on('close', (code) => {
            clearTimeout(timer);
            const stdout = Buffer.concat(out).toString('utf-8');
            resolve({
                exitCode: code,
                timedOut,
                durationMs: Date.now() - started,
                reported: host.usage(stdout),
                stdoutTail: stdout.slice(-4000),
                stderrTail: Buffer.concat(err).toString('utf-8').slice(-4000),
            });
        });
    });
}

async function runOnce(entry, target, run, opts, info, resultsDir) {
    const prompt = `${entry.spec.prompt}${UNATTENDED}`;
    const { ws, bin } = prepareWorkspace(entry, target.host);
    process.stderr.write(`eval: ${entry.name} x ${target.name} run ${run} in ${ws}\n`);
    const host = await runHost(target, prompt, ws, bin, opts.timeoutMin);
    const compositions = findCompositions(ws).map((dir) => {
        const video = join(dir, 'out', 'video.mp4');
        const sheet = join(dir, 'out', 'contact-sheet.png');
        const hashes = readJson(join(dir, '.flipbook', 'frame-hashes.json'));
        return {
            dir: relative(ws, dir) || '.',
            video: existsSync(video) ? video : null,
            videoSha256: existsSync(video) ? sha256File(video) : null,
            contactSheet: existsSync(sheet) ? sheet : null,
            frameDigest: hashes?.digest ?? null,
            probe: existsSync(video) ? probe(video) : null,
            lastCheck: readJson(join(dir, '.flipbook', 'reports', 'check.json')),
            lastSnapshot: readJson(join(dir, '.flipbook', 'reports', 'snapshot.json')),
            lastRender: readJson(join(dir, '.flipbook', 'reports', 'render.json')),
            attempts: readJson(join(dir, '.flipbook', 'attempts.json')),
            recheck: recheck(dir),
            audioMode: readJson(join(dir, 'timeline.json'))?.audio?.mode ?? 'none',
            source: ['index.html', 'timeline.json']
                .map((f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf-8') : ''))
                .join('\n'),
        };
    });
    const evidence = {
        case: entry.name,
        title: entry.spec.title,
        prompt,
        target: { name: target.name, host: target.host, model: target.model, label: target.label },
        run,
        startedAt: new Date(Date.now() - host.durationMs).toISOString(),
        workspace: ws,
        flipbook: info.flipbook,
        hostVersion: info.hosts[target.host],
        node: process.version,
        ffmpeg: info.ffmpeg,
        host,
        compositions: compositions.map(({ source, ...rest }) => ({
            ...rest,
            sourceSha256: createHash('sha256').update(source).digest('hex'),
        })),
    };
    evidence.verdict = judge(entry.spec, { host, compositions });
    const slug = `${entry.name}--${target.name.replace(/[^\w.-]+/g, '_')}--run${run}`;
    const films = join(resultsDir, 'films', slug);
    for (const [i, c] of evidence.compositions.entries()) {
        mkdirSync(films, { recursive: true });
        const suffix = evidence.compositions.length > 1 ? `-${i + 1}` : '';
        if (c.video) {
            cpSync(c.video, join(films, `video${suffix}.mp4`));
            c.video = join(films, `video${suffix}.mp4`);
        }
        if (c.contactSheet) {
            cpSync(c.contactSheet, join(films, `contact-sheet${suffix}.png`));
            c.contactSheet = join(films, `contact-sheet${suffix}.png`);
        }
    }
    evidence.workspaceKept = opts.keep || !evidence.verdict.oneShot;
    if (!evidence.workspaceKept) rmSync(ws, { recursive: true, force: true });
    const file = join(resultsDir, `${slug}.json`);
    writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
    return { file, evidence };
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const cases = loadCases(opts.ids);
    const matrix = loadMatrix(opts);
    const info = {
        flipbook: repoInfo(),
        ffmpeg: commandVersion('ffmpeg', ['-hide_banner', '-version']),
        hosts: Object.fromEntries(
            [...new Set(matrix.map((t) => t.host))].map((h) => [h, commandVersion(HOSTS[h].bin)]),
        ),
    };
    const invalid = cases.filter((c) => c.problems.length > 0);
    if (opts.dryRun) {
        process.stdout.write(
            `flipbook eval (dry run)\nflipbook ${info.flipbook.version} @ ${info.flipbook.commit}${info.flipbook.dirty ? ' (dirty)' : ''}\n\n`,
        );
        for (const c of cases) {
            process.stdout.write(
                `  ${c.problems.length === 0 ? 'ok' : '!!'} ${c.name}${c.problems.length ? `: ${c.problems.join(', ')}` : ''}\n`,
            );
        }
        for (const target of matrix) {
            const version = info.hosts[target.host];
            process.stdout.write(
                `  ${version ? 'ok' : '!!'} ${target.name}: ${target.host} ${version ?? 'not found'}, model ${target.model}\n`,
            );
            const { ws } = prepareWorkspace(
                cases.find((c) => c.problems.length === 0) ?? cases[0],
                target.host,
            );
            const installed = HOSTS[target.host].skillDirs.every((d) =>
                existsSync(join(ws, d, 'SKILL.md')),
            );
            const shim = shimVersion(join(ws, '.eval-bin'));
            process.stdout.write(
                `     workspace install ${installed ? 'ok' : 'FAILED'}, flipbook shim ${shim || 'FAILED'}\n`,
            );
            rmSync(ws, { recursive: true, force: true });
        }
        process.stdout.write(
            `\n${cases.length - invalid.length}/${cases.length} cases valid, ${matrix.length} targets x ${opts.runs} runs = ${cases.length * matrix.length * opts.runs} runs planned\n`,
        );
        if (invalid.length > 0 || !existsSync(cli)) process.exitCode = 1;
        if (!existsSync(cli)) process.stdout.write(`missing ${cli}: run pnpm build\n`);
        return;
    }
    if (invalid.length > 0)
        throw new Error(`Invalid cases: ${invalid.map((c) => c.name).join(', ')}`);
    if (!existsSync(cli)) throw new Error(`Build first: ${cli} is missing`);
    for (const target of matrix) {
        if (!info.hosts[target.host]) throw new Error(`${HOSTS[target.host].bin} is not installed`);
    }
    const resultsDir = join(evalDir, 'results', new Date().toISOString().slice(0, 10));
    mkdirSync(resultsDir, { recursive: true });
    const rows = [];
    for (const target of matrix) {
        for (const entry of cases) {
            for (let run = 1; run <= opts.runs; run++) {
                const { file, evidence } = await runOnce(
                    entry,
                    target,
                    run,
                    opts,
                    info,
                    resultsDir,
                );
                rows.push({
                    target: target.name,
                    case: entry.name,
                    run,
                    oneShot: evidence.verdict.oneShot,
                    reasons: evidence.verdict.reasons,
                    minutes: (evidence.host.durationMs / 60000).toFixed(1),
                    cost: evidence.host.reported?.costUsd ?? null,
                    file,
                });
                process.stdout.write(
                    `  ${evidence.verdict.oneShot ? 'ok' : '!!'} ${entry.name} x ${target.name} #${run} ${rows.at(-1).minutes} min${rows.at(-1).cost !== null ? ` $${rows.at(-1).cost}` : ''}${evidence.verdict.reasons.length ? `: ${evidence.verdict.reasons.join(', ')}` : ''}\n`,
                );
            }
        }
    }
    const summary = {
        date: new Date().toISOString(),
        flipbook: info.flipbook,
        hosts: info.hosts,
        timeoutMin: opts.timeoutMin,
        byTarget: Object.fromEntries(
            matrix.map((t) => {
                const mine = rows.filter((r) => r.target === t.name);
                return [
                    t.name,
                    { runs: mine.length, oneShot: mine.filter((r) => r.oneShot).length },
                ];
            }),
        ),
        rows,
    };
    writeFileSync(
        join(resultsDir, `summary-${Date.now()}.json`),
        `${JSON.stringify(summary, null, 2)}\n`,
    );
    for (const [name, s] of Object.entries(summary.byTarget))
        process.stdout.write(`\n${name}: ${s.oneShot}/${s.runs} one-shot\n`);
    process.stdout.write(`evidence: ${resultsDir}\n`);
}

main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
