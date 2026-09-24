#!/usr/bin/env node
// Compare renders from two flipbook builds, for a playwright-core (Chromium) upgrade.
//
//   node scripts/rebaseline.mjs --old "node ../flipbook-0.1.0/dist/main.js" [--new "node dist/main.js"]
//                               [--threshold 40] [--out rebaseline] [composition dirs...]
//
// Every composition (default: examples/*) is copied twice and rendered with
// each CLI. Frames whose raw capture hashes differ are decoded from both
// videos and compared by PSNR. Frames below the threshold are tiled old|new
// into a comparison sheet. A summary is written to <out>/<date>/summary.json.
import { spawnSync } from 'node:child_process';
import {
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
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
    const opts = {
        old: null,
        next: `node ${join(root, 'dist', 'main.js')}`,
        threshold: 40,
        out: join(root, 'rebaseline'),
        dirs: [],
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--old') opts.old = argv[++i];
        else if (arg === '--new') opts.next = argv[++i];
        else if (arg === '--threshold') opts.threshold = Number(argv[++i]);
        else if (arg === '--out') opts.out = resolve(argv[++i]);
        else if (arg.startsWith('-')) throw new Error(`Unknown flag: ${arg}`);
        else opts.dirs.push(resolve(arg));
    }
    if (!opts.old) throw new Error('--old "<command that runs the previous flipbook>" is required');
    if (opts.dirs.length === 0) {
        const examples = join(root, 'examples');
        opts.dirs = readdirSync(examples, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => join(examples, d.name));
    }
    return opts;
}

function runCli(command, args) {
    const [cmd, ...rest] = command.split(/\s+/).filter(Boolean);
    const result = spawnSync(cmd, [...rest, ...args], {
        encoding: 'utf-8',
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, FLIPBOOK_QUIET: '1' },
    });
    let report = null;
    try {
        report = JSON.parse(result.stdout);
    } catch {
        report = null;
    }
    return { status: result.status, report, stdout: result.stdout, stderr: result.stderr };
}

function ffmpeg(args, binary = true) {
    const result = spawnSync('ffmpeg', ['-v', 'error', ...args], {
        maxBuffer: 1024 * 1024 * 1024,
        encoding: binary ? 'buffer' : 'utf-8',
    });
    if (result.status !== 0) throw new Error(`ffmpeg ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout;
}

function probeSize(video) {
    const out = spawnSync(
        'ffprobe',
        [
            '-v',
            'error',
            '-select_streams',
            'v:0',
            '-show_entries',
            'stream=width,height',
            '-of',
            'csv=p=0',
            video,
        ],
        { encoding: 'utf-8' },
    );
    const [width, height] = out.stdout.trim().split(',').map(Number);
    return { width, height };
}

function framesRgb(video, frames, width, height) {
    const select = frames.map((n) => `eq(n\\,${n})`).join('+');
    const bytes = ffmpeg([
        '-i',
        video,
        '-vf',
        `select='${select}',format=rgb24`,
        '-fps_mode',
        'passthrough',
        '-f',
        'rawvideo',
        '-',
    ]);
    const size = width * height * 3;
    const out = [];
    for (let offset = 0; offset + size <= bytes.length; offset += size)
        out.push(bytes.subarray(offset, offset + size));
    return out;
}

function psnr(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const d = a[i] - b[i];
        sum += d * d;
    }
    if (sum === 0) return Number.POSITIVE_INFINITY;
    return 10 * Math.log10((255 * 255) / (sum / a.length));
}

function renderWith(command, source, label) {
    const dir = mkdtempSync(join(tmpdir(), `flipbook-rebaseline-${label}-`));
    cpSync(source, dir, {
        recursive: true,
        filter: (src) => !/[\\/](\.flipbook|out)([\\/]|$)/.test(src),
    });
    const run = runCli(command, ['render', dir]);
    const video = run.report?.artifacts?.video ?? run.report?.artifacts?.rejectedVideo ?? null;
    const hashesFile = join(dir, '.flipbook', 'frame-hashes.json');
    const hashes = existsSync(hashesFile)
        ? JSON.parse(readFileSync(hashesFile, 'utf-8')).hashes
        : null;
    return { dir, run, video, hashes };
}

function compare(name, opts, outDir) {
    process.stderr.write(`rebaseline: ${name}\n`);
    const before = renderWith(opts.old, opts.source, 'old');
    const after = renderWith(opts.next, opts.source, 'new');
    const entry = {
        composition: opts.source,
        old: {
            exitCode: before.run.status,
            video: before.video,
            chromium: before.run.report?.environment?.chromium ?? null,
        },
        new: {
            exitCode: after.run.status,
            video: after.video,
            chromium: after.run.report?.environment?.chromium ?? null,
        },
    };
    if (!before.video || !after.video) {
        entry.error = 'one of the renders produced no video';
        return entry;
    }
    const { width, height } = probeSize(after.video);
    const count = Math.min(
        before.hashes?.length ?? Number.POSITIVE_INFINITY,
        after.hashes?.length ?? Number.POSITIVE_INFINITY,
    );
    const total = Number.isFinite(count)
        ? count
        : Number(
              spawnSync(
                  'ffprobe',
                  [
                      '-v',
                      'error',
                      '-count_frames',
                      '-select_streams',
                      'v:0',
                      '-show_entries',
                      'stream=nb_read_frames',
                      '-of',
                      'csv=p=0',
                      after.video,
                  ],
                  { encoding: 'utf-8' },
              ).stdout.trim(),
          );
    const changed = [];
    for (let i = 0; i < total; i++) {
        if (!before.hashes || !after.hashes || before.hashes[i] !== after.hashes[i])
            changed.push(i);
    }
    const scores = [];
    for (let i = 0; i < changed.length; i += 24) {
        const batch = changed.slice(i, i + 24);
        const a = framesRgb(before.video, batch, width, height);
        const b = framesRgb(after.video, batch, width, height);
        for (const [j, frame] of batch.entries()) {
            scores.push({ frame, psnr: a[j] && b[j] ? psnr(a[j], b[j]) : 0 });
        }
    }
    const below = scores.filter((s) => s.psnr < opts.threshold).sort((x, y) => x.psnr - y.psnr);
    Object.assign(entry, {
        frames: total,
        identicalFrames: total - changed.length,
        changedFrames: changed.length,
        belowThreshold: below.length,
        minPsnrDb:
            scores.length > 0 ? Number(Math.min(...scores.map((s) => s.psnr)).toFixed(2)) : null,
        worst: below
            .slice(0, 12)
            .map((s) => ({ frame: s.frame, psnrDb: Number(s.psnr.toFixed(2)) })),
    });
    if (below.length > 0) {
        const pairs = join(outDir, `${name}-pairs`);
        mkdirSync(pairs, { recursive: true });
        below.slice(0, 12).forEach((s, i) => {
            ffmpeg([
                '-y',
                '-i',
                before.video,
                '-i',
                after.video,
                '-filter_complex',
                `[0:v]select='eq(n\\,${s.frame})'[a];[1:v]select='eq(n\\,${s.frame})'[b];[a][b]hstack=inputs=2`,
                '-fps_mode',
                'passthrough',
                '-frames:v',
                '1',
                join(pairs, `p_${String(i).padStart(3, '0')}.png`),
            ]);
        });
        const n = Math.min(12, below.length);
        const cols = n > 6 ? 3 : n > 2 ? 2 : 1;
        const rows = Math.ceil(n / cols);
        const sheet = join(outDir, `${name}-old-vs-new.png`);
        ffmpeg([
            '-y',
            '-i',
            join(pairs, 'p_%03d.png'),
            '-vf',
            `scale=1040:-2,tile=${cols}x${rows}:margin=8:padding=8:color=0x303030`,
            '-frames:v',
            '1',
            '-update',
            '1',
            sheet,
        ]);
        entry.sheet = sheet;
    }
    rmSync(before.dir, { recursive: true, force: true });
    rmSync(after.dir, { recursive: true, force: true });
    return entry;
}

function version(command) {
    return runCli(command, ['--version']).stdout.trim();
}

function main() {
    const opts = parseArgs(process.argv.slice(2));
    const outDir = join(opts.out, new Date().toISOString().slice(0, 10));
    mkdirSync(outDir, { recursive: true });
    const summary = {
        date: new Date().toISOString(),
        threshold: opts.threshold,
        old: { command: opts.old, version: version(opts.old) },
        new: { command: opts.next, version: version(opts.next) },
        compositions: opts.dirs.map((source) =>
            compare(basename(source), { ...opts, source }, outDir),
        ),
    };
    writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    for (const c of summary.compositions) {
        process.stdout.write(
            c.error
                ? `!! ${basename(c.composition)}: ${c.error}\n`
                : `${c.belowThreshold > 0 ? '!!' : 'ok'} ${basename(c.composition)}: ${c.identicalFrames}/${c.frames} identical, ${c.belowThreshold} below ${opts.threshold} dB${c.sheet ? `, see ${c.sheet}` : ''}\n`,
        );
    }
    process.stdout.write(`summary: ${join(outDir, 'summary.json')}\n`);
}

main();
