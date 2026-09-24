#!/usr/bin/env node
// Adapted from liustack/modlens scripts/release.mjs.
// Copyright (c) 2026 Leon Liu (liustack). MIT License.
//
//   pnpm release 0.1.0        explicit version
//   pnpm release patch        bump from the current one
//
// Runs every refusal check first, then the gates (lint, typecheck, test,
// build), then bumps, stamps, commits, tags and pushes main and the tag
// atomically. It does not publish: the pushed tag triggers
// .github/workflows/release.yml, which publishes to npm and creates the
// GitHub Release.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
try {
    if (run('git', ['ls-remote', '--tags', 'origin', `refs/tags/v${next}`])) {
        fail(`tag v${next} already exists on origin.`);
    }
} catch (error) {
    fail(`cannot reach origin to verify tags: ${error.message ?? error}`);
}

const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf-8');
const section = changelog.match(
    new RegExp(`^## ${next.replace(/\./g, '\\.')}[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'),
);
if (!section) {
    fail(`CHANGELOG.md has no "## ${next}" section. Write what changed before releasing it.`);
}
if (section[1].trim().length < 20) {
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
runLoud('pnpm', ['build']);

// --- from here on it is real ---

if (next !== pkg.version) {
    writeFileSync(pkgPath, pkgRaw.replace(`"version": "${pkg.version}"`, `"version": "${next}"`));
}
stampLaunchers(root);
if (run('git', ['status', '--porcelain'])) {
    run('git', ['commit', '-am', `chore(release): v${next}`]);
}
run('git', ['tag', '-a', `v${next}`, '-m', `v${next}`]);
run('git', ['push', '--atomic', 'origin', 'main', `refs/tags/v${next}`]);

console.log(`\nTag v${next} pushed. CI finishes the release: npm publish and the GitHub Release.`);
console.log('Watch it: gh run watch, or https://github.com/liustack/flipbook/actions');
