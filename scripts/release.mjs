#!/usr/bin/env node
// Copyright (c) 2026 Leon Liu (liustack). MIT License.
//
//   pnpm release 0.1.0        explicit version
//   pnpm release patch        bump from the current one
//
// Runs every refusal check first, then the gates (lint, typecheck, the unit,
// e2e and release test tiers, build), regenerates docs/samples, then bumps, stamps the launchers, turns
// "## Unreleased" in CHANGELOG.md into "## <version> - <today>" (or dates the
// version's own heading), commits, tags and pushes main and the tag
// atomically. It does not publish: the pushed tag triggers
// .github/workflows/release.yml, which publishes to npm and creates the
// GitHub Release.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localDate, releaseChangelog, releaseNotes } from './changelog.mjs';
import { stampLaunchers } from './stamp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, options = {}) =>
    execFileSync(cmd, args, { cwd: root, encoding: 'utf-8', stdio: 'pipe', ...options }).trim();
const runLoud = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });

function fail(message) {
    console.error(`\nRelease stopped: ${message}\n`);
    process.exit(1);
}

const pkgPath = join(root, 'package.json');
const pkgRaw = readFileSync(pkgPath, 'utf-8');
const pkg = JSON.parse(pkgRaw);

const requested = process.argv[2];
if (!requested) {
    fail('give a version (0.1.0) or a bump (patch, minor, major).');
}

const next = (() => {
    const [major, minor, patch] = pkg.version.split('.').map(Number);
    if (requested === 'major') return `${major + 1}.0.0`;
    if (requested === 'minor') return `${major}.${minor + 1}.0`;
    if (requested === 'patch') return `${major}.${minor}.${patch + 1}`;
    if (!/^\d+\.\d+\.\d+$/.test(requested)) fail(`"${requested}" is not a version or a bump.`);
    const toParts = (v) => v.split('.').map(Number);
    const [ca, cb, cc] = toParts(pkg.version);
    const [na, nb, nc] = toParts(requested);
    const forward = na > ca || (na === ca && (nb > cb || (nb === cb && nc >= cc)));
    // The first release ships the version already in package.json.
    const firstRelease = run('git', ['tag', '--list', 'v*']) === '' && requested === pkg.version;
    if (!forward || (requested === pkg.version && !firstRelease)) {
        fail(`"${requested}" is not higher than the current version ${pkg.version}.`);
    }
    return requested;
})();

// --- refuse early, while nothing has happened yet ---

if (run('git', ['status', '--porcelain'])) {
    fail('the working tree has uncommitted changes. Commit them first.');
}
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'main') {
    fail(`on branch ${branch}, not main.`);
}
if (run('git', ['tag', '--list', `v${next}`])) {
    fail(`tag v${next} already exists.`);
}

run('git', ['fetch', 'origin', 'main']);
try {
    run('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']);
} catch {
    fail('local main is behind or diverged from origin/main. Pull first.');
}
// The commit being released must already be on origin/main with a green CI,
// the Linux render of every example included: release.yml renders them again
// for the Release, and a failure there comes after the tag is out.
const head = run('git', ['rev-parse', 'HEAD']);
if (run('git', ['rev-parse', 'origin/main']) !== head) {
    fail('HEAD is not on origin/main yet. Push main, wait for CI to pass, then release.');
}
let ci;
try {
    ci = JSON.parse(
        run('gh', ['run', 'list', '--workflow', 'ci.yml', '--commit', head, '--json', 'status,conclusion,url']),
    );
} catch (error) {
    fail(`cannot read the CI runs for ${head.slice(0, 7)} with gh: ${error.message ?? error}`);
}
if (!ci.some((r) => r.status === 'completed' && r.conclusion === 'success')) {
    const seen = ci.map((r) => `${r.status}/${r.conclusion || '-'} ${r.url}`).join(', ') || 'no run yet';
    fail(`CI has not passed on ${head.slice(0, 7)} (${seen}). Wait for it to go green, then release.`);
}

try {
    if (run('git', ['ls-remote', '--tags', 'origin', `refs/tags/v${next}`])) {
        fail(`tag v${next} already exists on origin.`);
    }
} catch (error) {
    fail(`cannot reach origin to verify tags: ${error.message ?? error}`);
}

const changelogPath = join(root, 'CHANGELOG.md');
const changelog = readFileSync(changelogPath, 'utf-8');
let notes;
try {
    notes = releaseNotes(changelog, next);
} catch (error) {
    fail(error.message);
}
if (notes.trim().length < 20) {
    fail(`the CHANGELOG entry for ${next} is empty. Say what changed.`);
}

const notices = join(root, 'THIRD_PARTY_NOTICES.md');
if (!existsSync(notices) || readFileSync(notices, 'utf-8').trim().length < 100) {
    fail('THIRD_PARTY_NOTICES.md is missing or empty.');
}

console.log(`Releasing ${pkg.name} ${pkg.version} -> ${next}\n`);
runLoud('pnpm', ['lint']);
runLoud('pnpm', ['typecheck']);
runLoud('pnpm', ['test']);
runLoud('pnpm', ['test:e2e']);
runLoud('pnpm', ['test:release']);
runLoud('pnpm', ['build']);
runLoud('node', ['scripts/samples.mjs']);

// --- from here on it is real ---

if (next !== pkg.version) {
    writeFileSync(pkgPath, pkgRaw.replace(`"version": "${pkg.version}"`, `"version": "${next}"`));
}
stampLaunchers(root);
writeFileSync(
    changelogPath,
    releaseChangelog(readFileSync(changelogPath, 'utf-8'), next, localDate()),
);
if (run('git', ['status', '--porcelain'])) {
    run('git', ['commit', '-am', `chore(release): v${next}`]);
}
run('git', ['tag', '-a', `v${next}`, '-m', `v${next}`]);
run('git', ['push', '--atomic', 'origin', 'main', `refs/tags/v${next}`]);

console.log(`\nTag v${next} pushed. CI finishes the release: npm publish and the GitHub Release.`);
console.log('Watch it: gh run watch, or https://github.com/liustack/flipbook/actions');
