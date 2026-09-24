// Adapted from liustack/modlens scripts/stamp.test.mjs.
// Copyright (c) 2026 Leon Liu (liustack). MIT License.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    docTargets,
    readPackageVersion,
    readStampedVersions,
    repoRoot,
    stampTargets,
    unpinnedInstalls,
    unpinnedSkillAdds,
} from './stamp.mjs';

const BINARY = /\.(png|jpe?g|gif|webp|heic|heif|ico|pdf|zip|gz|woff2?|ttf|otf|mp4|wav)$/i;
const DOC = /\.(md|ya?ml|sh|ps1)$/i;
const LOCKFILE = /(^|[\\/])pnpm-lock\.yaml$/;

function trackedFiles(root) {
    const listed = execFileSync(
        'git',
        ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
        {
            cwd: root,
            encoding: 'utf-8',
        },
    );
    return listed
        .split('\0')
        .filter((name) => name !== '' && !BINARY.test(name))
        .map((name) => join(root, name));
}

describe('launcher version stamping', () => {
    it('keeps the launchers and every doc install command pinned to the package version', () => {
        const version = readPackageVersion();
        const stamped = readStampedVersions();
        expect(stamped.length).toBeGreaterThanOrEqual(2);
        for (const entry of stamped) {
            expect(entry.version, `${entry.name} is not stamped to ${version}`).toBe(version);
        }
    });

    it('pins every install command in every tracked file', () => {
        const offenders = [];
        const self = join(repoRoot, 'scripts', 'stamp.test.mjs');
        for (const file of trackedFiles(repoRoot)) {
            if (file === self) continue;
            const text = readFileSync(file, 'utf-8');
            for (const command of unpinnedInstalls(text, '@liustack/flipbook')) {
                offenders.push(`${file}: ${command}`);
            }
            for (const command of unpinnedSkillAdds(text)) {
                offenders.push(`${file}: ${command}`);
            }
            if (DOC.test(file) && !LOCKFILE.test(file)) {
                for (const command of unpinnedInstalls(text, 'playwright-core')) {
                    offenders.push(`${file}: ${command}`);
                }
            }
        }
        expect(offenders, 'these install whatever the registry serves that day').toEqual([]);
    });

    it('names the playwright-core version package.json depends on', () => {
        const pinned = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'))
            .dependencies['playwright-core'];
        const stale = [];
        for (const file of trackedFiles(repoRoot)) {
            if (!DOC.test(file) || LOCKFILE.test(file)) continue;
            for (const match of readFileSync(file, 'utf-8').matchAll(
                /playwright-core@(\d+\.\d+\.\d+)/g,
            )) {
                if (match[1] !== pinned) stale.push(`${file}: ${match[0]}`);
            }
        }
        expect(stale).toEqual([]);
    });

    it('recognizes every shape of an unpinned install', () => {
        const unpinned = [
            'add @liustack/flipbook@latest',
            "add '@liustack/flipbook@latest'",
            'add "@liustack/flipbook@latest"',
            'add @liustack/flipbook',
            'add @liustack/flipbook@^0.1.0',
            'add @liustack/flipbook@next',
            'add @liustack/flipbook@0',
            'add @liustack/flipbook@0.1.0+local',
            'add @liustack/flipbook@$VERSION',
            'pnpm add --save-prod @liustack/flipbook@latest',
            'add @liustack/flipbook@1.2.3 --config.minimumReleaseAge=0 | add @liustack/flipbook@latest',
            'pnpm add @liustack/flipbook@latest && printf %s --config.minimumReleaseAge=0',
            'pnpm add @liustack/flipbook@latest # use --config.minimumReleaseAge=0 if you must',
            'PKG=@liustack/flipbook@latest; pnpm add "$PKG"',
            'FLAG=--config.minimumReleaseAge=0 pnpm add @liustack/flipbook@latest',
            'pnpm add @liustack/flipbook@1.2.3 @liustack/flipbook',
            'pnpm add @liustack/flipbook@<anything>',
            'pnpm i @liustack/flipbook',
            'npm i @liustack/flipbook@latest',
            'npx @liustack/flipbook check .',
            'npx --yes --package @liustack/flipbook flipbook render .',
            'bunx @liustack/flipbook doctor',
        ];
        for (const command of unpinned) {
            expect(unpinnedInstalls(command), command).not.toEqual([]);
        }
        const fine = [
            'add @liustack/flipbook@1.2.3',
            'add @liustack/flipbook@latest --config.minimumReleaseAge=0',
            'npx --yes --package @liustack/flipbook@1.2.3 flipbook',
            'the `@latest` tag does not skip the gate',
            'installed with @liustack/flipbook as the package name',
            'npx --yes --package @liustack/flipbook@<pinned> flipbook <args>',
            'bunx --bun @liustack/flipbook@<version> <args>',
        ];
        for (const command of fine) {
            expect(unpinnedInstalls(command), command).toEqual([]);
        }
        expect(
            unpinnedInstalls('npx playwright-core install-deps chromium', 'playwright-core'),
        ).not.toEqual([]);
        expect(
            unpinnedInstalls(
                'npx --yes playwright-core@1.63.0 install chromium-headless-shell',
                'playwright-core',
            ),
        ).toEqual([]);
    });

    it('requires an exact tag on skills add', () => {
        expect(unpinnedSkillAdds('npx skills add liustack/flipbook')).not.toEqual([]);
        expect(unpinnedSkillAdds('npx skills add liustack/flipbook#main')).not.toEqual([]);
        expect(unpinnedSkillAdds('npx skills add liustack/flipbook#v0.1')).not.toEqual([]);
        expect(unpinnedSkillAdds('npx skills add liustack/flipbook#v0.1.0')).toEqual([]);
    });

    it('joins a continuation before judging the command it belongs to', () => {
        const lifted = 'pnpm add @liustack/flipbook@latest \\\n  --config.minimumReleaseAge=0';
        expect(unpinnedInstalls(lifted)).toEqual([]);
        expect(unpinnedInstalls(lifted.replace(/\n/g, '\r\n'))).toEqual([]);
        expect(unpinnedInstalls('pnpm add \\\n  @liustack/flipbook@latest')).not.toEqual([]);
    });

    it('rewrites only the version value and leaves the line shape intact', () => {
        for (const target of [
            ...stampTargets('/base'),
            ...docTargets('/base', '@scope/pkg', 'scope/pkg'),
        ]) {
            const original = target.format('0.0.0');
            const restamped = original.replace(target.pattern, target.format('9.9.9'));
            expect(restamped).toBe(target.format('9.9.9'));
            expect(restamped).not.toBe(original);
        }
    });
});
