#!/usr/bin/env node
// flipbook eval runner: prompts x models, each run in a fresh temporary
// workspace with this repository's skill and CLI installed, one evidence JSON
// per run. Spends real model quota: local and on demand, never in CI.
//
//   node eval/run.mjs --dry-run                     validate cases, hosts, install
//   node eval/run.mjs                               every case, default targets, 1 run
//   node eval/run.mjs --target flagship --runs 2 waiting pigeons
//   node eval/run.mjs --model claude-code:claude-opus-5 --timeout-min 20
//   node eval/run.mjs --dry-run --cases <dir>       validate cases kept somewhere else
//   node eval/run.mjs --tally eval/results/<date>   count a round once people have reviewed it
//
// What a case checks and how a run is judged: eval/judge.mjs and docs/eval.md.
import { spawn, spawnSync } from 'node:child_process';
import {
    copyFileSync,
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_DIRS, validateCase, workspaceSource } from './cases.mjs';
import { sha256File } from './files.mjs';
import { inspect, judge, tally } from './judge.mjs';
import { runtimeExports } from './page.mjs';
import { recheck, renderShape } from './recheck.mjs';
import { pinReports, REPORTS_ENV, shimReports, shimVersion, writeShims } from './shim.mjs';

const evalDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(evalDir, '..');
const cli = join(repoRoot, 'dist', 'main.js');

/** Appended to every prompt: the run is unattended. */
export const UNATTENDED =
    '\n\n（这是无人值守的评测：没有人会回答问题，不要提问，没说的按默认值。做完交付成片路径，没交付就说明原因。）';

/** Minutes a run may take when neither the case nor --timeout-min says otherwise. */
const DEFAULT_TIMEOUT_MIN = 30;

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
        tally: null,
        runs: 1,
        targets: [],
        models: [],
        timeoutMin: null,
        keep: false,
        casesDir: join(evalDir, 'cases'),
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
        else if (arg === '--cases') opts.casesDir = resolve(argv[++i]);
        else if (arg === '--tally') opts.tally = resolve(argv[++i]);
        else if (arg.startsWith('-')) throw new Error(`Unknown flag: ${arg}`);
        else opts.ids.push(arg);
    }
    if (!Number.isInteger(opts.runs) || opts.runs < 1)
        throw new Error('--runs takes a positive integer');
    if (opts.timeoutMin !== null && !(opts.timeoutMin > 0))
        throw new Error('--timeout-min takes a positive number of minutes');
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

function loadCases(ids, casesDir) {
    const runtimeNames = runtimeExports(repoRoot);
    const found = readdirSync(casesDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    const unknown = ids.filter((id) => !found.some((d) => d.name === id));
    if (unknown.length > 0) throw new Error(`No case ${unknown.join(', ')} in ${casesDir}`);
    return found
        .filter((d) => ids.length === 0 || ids.includes(d.name))
        .map((d) => {
            const caseDir = join(casesDir, d.name);
            let spec;
            try {
                spec = JSON.parse(readFileSync(join(caseDir, 'case.json'), 'utf-8'));
            } catch (error) {
                return {
                    name: d.name,
                    caseDir,
                    spec: null,
                    problems: [`case.json: ${error.message}`],
                };
            }
            const problems = validateCase(spec, { name: d.name, caseDir, repoRoot, runtimeNames });
            return { name: d.name, caseDir, spec, problems };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
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

/**
 * A fresh workspace with the repository's skill, a `flipbook` shim on PATH
 * and the case's files, with the size and sha256 of each of those files as
 * they were before the host started.
 */
function prepareWorkspace(entry, host) {
    const ws = mkdtempSync(join(tmpdir(), `flipbook-eval-${entry.name}-`));
    for (const skillDir of HOSTS[host].skillDirs) {
        mkdirSync(join(ws, skillDir), { recursive: true });
        cpSync(join(repoRoot, 'skills', 'flipbook'), join(ws, skillDir), { recursive: true });
    }
    if (HOSTS[host].agentsNote) writeFileSync(join(ws, 'AGENTS.md'), HOSTS[host].agentsNote);
    const bin = join(ws, '.eval-bin');
    mkdirSync(bin, { recursive: true });
    writeShims(bin, cli);
    const files = {};
    for (const [rel, item] of Object.entries(entry.spec.workspace ?? {})) {
        const file = join(ws, rel);
        mkdirSync(dirname(file), { recursive: true });
        if (item.generator === 'clicks') makeClicks(file, item);
        else {
            const source = workspaceSource(item, { caseDir: entry.caseDir, repoRoot });
            if (source.problem)
                throw new Error(`${entry.name}: workspace ${rel} ${source.problem}`);
            copyFileSync(source.file, file);
        }
        files[rel] = { size: statSync(file).size, sha256: sha256File(file) };
    }
    return { ws, bin, files };
}

function findCompositions(ws) {
    const found = [];
    const walk = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (!e.isDirectory() || [...HOST_DIRS, '.flipbook', 'out'].includes(e.name)) continue;
            walk(join(dir, e.name));
        }
        if (existsSync(join(dir, 'timeline.json')) && existsSync(join(dir, 'index.html')))
            found.push(dir);
    };
    walk(ws);
    return found;
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

function runHost(target, prompt, ws, bin, timeoutMin, reports) {
    const host = HOSTS[target.host];
    return new Promise((resolve) => {
        const started = Date.now();
        const child = spawn(host.bin, host.args(target.model, prompt, ws), {
            cwd: ws,
            env: { ...envWithBin(bin), [REPORTS_ENV]: reports },
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
    const timeoutMin = opts.timeoutMin ?? entry.spec.timeoutMin ?? DEFAULT_TIMEOUT_MIN;
    const { ws, bin, files: workspaceFiles } = prepareWorkspace(entry, target.host);
    process.stderr.write(`eval: ${entry.name} x ${target.name} run ${run} in ${ws}\n`);
    const slug = `${entry.name}--${target.name.replace(/[^\w.-]+/g, '_')}--run${run}`;
    const reports = join(resultsDir, 'reports', slug);
    mkdirSync(reports, { recursive: true });
    const pin = pinReports(reports);
    const host = await runHost(target, prompt, ws, bin, timeoutMin, pin.real);
    const kept = shimReports(pin);
    const stockReports = kept.reports.filter((r) => r.command === 'stock-fetch');
    const runNotes = kept.problem
        ? [
              `The evaluator's report directory changed during the run (${kept.problem}), so none of its reports were read. Check what the agent did there.`,
          ]
        : [];
    const compositions = findCompositions(ws).map((dir) => {
        const seen = inspect(dir, { spec: entry.spec, wsRoot: ws, workspaceFiles, stockReports });
        const flags = renderShape(seen.lastRender);
        return {
            dir: relative(ws, dir) || '.',
            ...seen,
            videoSha256: seen.video ? sha256File(seen.video) : null,
            probe: seen.video ? probe(seen.video) : null,
            recheck: { flags, ...recheck(dir, { wsRoot: ws, cli, flags }) },
        };
    });
    const evidence = {
        case: entry.name,
        title: entry.spec.title,
        asks: entry.spec.asks,
        prompt,
        timeoutMin,
        target: { name: target.name, host: target.host, model: target.model, label: target.label },
        run,
        startedAt: new Date(Date.now() - host.durationMs).toISOString(),
        workspace: ws,
        flipbook: info.flipbook,
        hostVersion: info.hosts[target.host],
        node: process.version,
        ffmpeg: info.ffmpeg,
        host,
        workspaceFiles,
        shimReports: relative(repoRoot, reports),
        shimReportsProblem: kept.problem,
        stockFetches: stockReports.map((r) => ({
            ok: r.ok,
            dir: r.composition?.dir ?? null,
            id: r.stock?.id ?? null,
            file: r.stock?.file ?? null,
        })),
        compositions,
    };
    evidence.verdict = judge(entry.spec, { host, compositions, workspaceFiles, runNotes });
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
    evidence.workspaceKept =
        opts.keep || !evidence.verdict.oneShot || evidence.verdict.needsReview.length > 0;
    if (!evidence.workspaceKept) rmSync(ws, { recursive: true, force: true });
    const file = join(resultsDir, `${slug}.json`);
    writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
    return { file, evidence };
}

/**
 * Count a round from its evidence files, after people filled in the human
 * reviews: prints each target's numbers and writes them to tally.json there.
 */
function printTally(dir) {
    const evidences = readdirSync(dir)
        .filter((f) => f.endsWith('.json') && !/^(summary-.*|tally)\.json$/.test(f))
        .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')))
        .filter((e) => e.verdict && e.target);
    if (evidences.length === 0) throw new Error(`No evidence files in ${dir}`);
    const byTarget = tally(evidences);
    for (const [name, t] of Object.entries(byTarget)) {
        const questions = Object.entries(t.byQuestion)
            .map(([q, n]) => `${q} ${n.passed}/${n.runs}`)
            .join(', ');
        process.stdout.write(
            `${name} (${t.label}): ${t.runs} runs of ${Object.keys(t.runsByCase).length} cases\n` +
                `  runs by case: ${Object.entries(t.runsByCase)
                    .map(([c, n]) => `${c} ${n}`)
                    .join(', ')}\n` +
                (t.even ? '' : '  uneven: the cases did not all run as often\n') +
                t.repeated.map((key) => `  repeated: ${key} comes twice\n`).join('') +
                `  delivered ${t.delivered}, one-shot ${t.oneShot}, reviewed ${t.reviewed}, passed ${t.passed}\n` +
                `  silent bad films ${t.silentBadFilms}, moving slides ${t.movingSlides}\n` +
                `  passed by question: ${questions}\n` +
                t.toReview.map((line) => `  to review: ${line}\n`).join(''),
        );
    }
    writeFileSync(join(dir, 'tally.json'), `${JSON.stringify(byTarget, null, 2)}\n`);
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.tally) {
        printTally(opts.tally);
        return;
    }
    const cases = loadCases(opts.ids, opts.casesDir);
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
            const asks = c.problems.length === 0 ? ` (${c.spec.asks.join(', ')})` : '';
            process.stdout.write(
                `  ${c.problems.length === 0 ? 'ok' : '!!'} ${c.name}${asks}${c.problems.length ? `: ${c.problems.join(', ')}` : ''}\n`,
            );
        }
        for (const target of matrix) {
            const version = info.hosts[target.host];
            process.stdout.write(
                `  ${version ? 'ok' : '!!'} ${target.name}: ${target.host} ${version ?? 'not found'}, model ${target.model}\n`,
            );
            const { ws } = prepareWorkspace({ name: 'install', spec: {} }, target.host);
            const installed = HOSTS[target.host].skillDirs.every((d) =>
                existsSync(join(ws, d, 'SKILL.md')),
            );
            const shim = shimVersion(join(ws, '.eval-bin'));
            process.stdout.write(
                `     workspace install ${installed ? 'ok' : 'FAILED'}, flipbook shim ${shim || 'FAILED'}\n`,
            );
            rmSync(ws, { recursive: true, force: true });
        }
        for (const c of cases.filter((c) => c.problems.length === 0 && c.spec.workspace)) {
            const { ws } = prepareWorkspace(c, matrix[0]?.host ?? 'claude-code');
            const missing = Object.keys(c.spec.workspace).filter(
                (rel) => !existsSync(join(ws, rel)),
            );
            process.stdout.write(
                `  ${missing.length === 0 ? 'ok' : '!!'} ${c.name} workspace files${missing.length ? `: missing ${missing.join(', ')}` : ''}\n`,
            );
            if (missing.length > 0) process.exitCode = 1;
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
                    asks: entry.spec.asks,
                    run,
                    delivered: evidence.verdict.delivered,
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
        timeoutMin: opts.timeoutMin ?? 'per case',
        byTarget: Object.fromEntries(
            matrix.map((t) => {
                const mine = rows.filter((r) => r.target === t.name);
                return [
                    t.name,
                    {
                        runs: mine.length,
                        delivered: mine.filter((r) => r.delivered).length,
                        oneShot: mine.filter((r) => r.oneShot).length,
                    },
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
        process.stdout.write(
            `\n${name}: ${s.oneShot}/${s.runs} one-shot, ${s.delivered}/${s.runs} delivered a film\n`,
        );
    process.stdout.write(`evidence: ${resultsDir}\n`);
}

main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
