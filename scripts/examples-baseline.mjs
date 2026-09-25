#!/usr/bin/env node
// Record every example's snapshot digest in its expected.json: the frames
// snapshot takes (each scene's middle plus 12 evenly spaced frames), hashed as
// captured, with the Chromium build and the machine they came from.
// test/e2e/examples.test.ts compares against it on that same machine only:
// the same Chromium on another Mac already gives other hashes. Recorded on
// macOS arm64. Rerun after upgrading playwright-core, together with
// scripts/rebaseline.mjs, and after a system update.
//
//   pnpm examples:baseline                  every example
//   pnpm examples:baseline hello page-turn  only these (paths under examples/)
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, release, tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'dist', 'main.js');
const examplesDir = join(root, 'examples');
export const DIGEST_PLATFORM = 'darwin-arm64';

/** What the digests depend on beyond Chromium: platform, kernel release and CPU model. */
export function machineId() {
    return `${process.platform}-${process.arch} ${release()} ${cpus()[0]?.model ?? 'unknown CPU'}`;
}

function fail(message) {
    console.error(`examples:baseline: ${message}`);
    process.exit(1);
}

/** Every folder under examples/ holding a timeline.json, as a path under examples/. */
export function exampleNames(dir = examplesDir) {
    const names = [];
    const walk = (current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name === 'out' || entry.name === '.flipbook')
                continue;
            const child = join(current, entry.name);
            if (readdirSync(child).includes('timeline.json')) {
                names.push(relative(dir, child).split('\\').join('/'));
            }
            walk(child);
        }
    };
    walk(dir);
    return names.sort();
}

function baseline(name) {
    const source = join(examplesDir, name);
    const work = mkdtempSync(join(tmpdir(), `flipbook-baseline-${basename(name)}-`));
    try {
        cpSync(source, work, {
            recursive: true,
            filter: (path) => !/[\\/](out|\.flipbook)([\\/]|$)/.test(relative(source, path)),
        });
        const result = spawnSync(process.execPath, [cli, 'snapshot', work], {
            encoding: 'utf-8',
            maxBuffer: 64 * 1024 * 1024,
        });
        let report;
        try {
            report = JSON.parse(result.stdout);
        } catch {
            fail(`${name}: snapshot printed no report (exit ${result.status}).\n${result.stderr}`);
        }
        if (result.status !== 0 || !report.snapshot?.digest) {
            fail(
                `${name}: snapshot exited ${result.status}.\n${JSON.stringify(report.failures, null, 2)}`,
            );
        }
        const file = join(source, 'expected.json');
        const expected = JSON.parse(readFileSync(file, 'utf-8'));
        expected.snapshot = {
            machine: machineId(),
            chromium: report.environment.chromium.revision,
            digest: report.snapshot.digest,
        };
        writeFileSync(file, `${JSON.stringify(expected, null, 4)}\n`);
        console.log(
            `${name}: ${report.snapshot.digest.slice(0, 12)} (${report.snapshot.tiles.length} frames)`,
        );
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const platform = `${process.platform}-${process.arch}`;
    if (platform !== DIGEST_PLATFORM) {
        fail(`digests are recorded on ${DIGEST_PLATFORM} only, this is ${platform}.`);
    }
    const all = exampleNames();
    const wanted = process.argv.slice(2);
    for (const name of wanted) {
        if (!all.includes(name)) fail(`no example "${name}". Examples: ${all.join(', ')}`);
    }
    for (const name of wanted.length > 0 ? wanted : all) baseline(name);
}
