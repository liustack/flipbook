#!/usr/bin/env node
// Render one sample PNG per runtime module into docs/samples/, the images the
// references point to. Each sample is a composition: it must pass check with
// no findings, then one frame is captured with snapshot --zoom.
//
//   pnpm build && node scripts/samples.mjs
//   node scripts/samples.mjs paper text      only these samples
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'dist', 'main.js');
const outDir = join(root, 'docs', 'samples');

/** name: output file; dir: composition; at: seconds; width: output width in px. */
export const SAMPLES = [
    { name: 'paper', dir: 'docs/samples/src/paper', at: 0.5, width: 960 },
    { name: 'materials', dir: 'docs/samples/src/materials', at: 0.5, width: 960 },
    { name: 'text', dir: 'docs/samples/src/text', at: 1.5, width: 960 },
    { name: 'templates', dir: 'examples/eggs-five/five', at: 2.6, width: 960 },
    { name: 'page-turn', dir: 'examples/page-turn', at: 6.2, width: 960 },
];

function fail(message) {
    console.error(`samples: ${message}`);
    process.exit(1);
}

function flipbook(args) {
    const result = spawnSync(process.execPath, [cli, ...args], {
        encoding: 'utf-8',
        env: { ...process.env, FLIPBOOK_QUIET: '1' },
        maxBuffer: 64 * 1024 * 1024,
    });
    let report = null;
    try {
        report = JSON.parse(result.stdout);
    } catch {
        report = null;
    }
    return { status: result.status, report, stderr: result.stderr };
}

function render(sample) {
    const source = join(root, sample.dir);
    const work = mkdtempSync(join(tmpdir(), `flipbook-sample-${sample.name}-`));
    try {
        cpSync(source, work, {
            recursive: true,
            filter: (src) => !/[\\/](\.flipbook|out)([\\/]|$)/.test(src),
        });
        const checked = flipbook(['check', work]);
        const findings = [...(checked.report?.failures ?? []), ...(checked.report?.warnings ?? [])];
        if (checked.status !== 0 || findings.length > 0) {
            fail(
                `${sample.dir} does not pass check cleanly: ${
                    findings.map((f) => `${f.code} ${f.message}`).join('; ') || checked.stderr
                }`,
            );
        }
        const timeline = JSON.parse(readFileSync(join(work, 'timeline.json'), 'utf-8'));
        const snap = flipbook([
            'snapshot',
            work,
            '--count',
            '1',
            '--zoom',
            `0,0,${timeline.width},${timeline.height}`,
            '--scale',
            '1',
            '--at',
            String(sample.at),
        ]);
        const zoom = snap.report?.artifacts?.zoom1;
        if (snap.status !== 0 || !zoom || !existsSync(zoom)) {
            fail(`snapshot of ${sample.dir} failed: ${snap.stderr}`);
        }
        const target = join(outDir, `${sample.name}.png`);
        const scale =
            sample.width === timeline.width
                ? []
                : ['-vf', `scale=${sample.width}:-2:flags=lanczos`];
        execFileSync('ffmpeg', [
            '-v',
            'error',
            '-y',
            '-i',
            zoom,
            ...scale,
            '-compression_level',
            '100',
            '-pred',
            'mixed',
            target,
        ]);
        console.log(`samples: ${target}`);
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

if (!existsSync(cli)) fail('dist/main.js is missing. Run pnpm build first.');
const only = process.argv.slice(2);
for (const sample of SAMPLES) {
    if (only.length === 0 || only.includes(sample.name)) render(sample);
}
