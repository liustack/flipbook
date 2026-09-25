// Copyright (c) 2026 Leon Liu (liustack). MIT License.
//
// Version stamping for every file that names a version: the skill launchers
// (run.sh, run.ps1) and pinned install commands in the docs and SKILL.md.
// scripts/release.mjs calls stampLaunchers() at release time;
// scripts/stamp.test.mjs reads the same files back and asserts they match.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function readPackage(root) {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
}

/** The version this repo currently ships, from package.json. */
export function readPackageVersion(root = repoRoot) {
    return readPackage(root).version;
}

/** The skill directory name, derived from the scoped package name. */
export function skillName(root = repoRoot) {
    return readPackage(root).name.split('/').pop();
}

/** GitHub owner/repo, derived from the scoped package name. */
export function repoSlug(root = repoRoot) {
    const [scope, name] = readPackage(root).name.split('/');
    return `${scope.replace(/^@/, '')}/${name}`;
}

function escapeRe(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Files that must carry the pinned version, each with a pattern capturing the
 * value in group 1 and a formatter that rebuilds that text for a version.
 */
export function stampTargets(base) {
    return [
        {
            name: 'run.sh',
            file: join(base, 'scripts', 'run.sh'),
            pattern: /^PINNED="([^"]*)"$/m,
            format: (version) => `PINNED="${version}"`,
            required: true,
        },
        {
            name: 'run.ps1',
            file: join(base, 'scripts', 'run.ps1'),
            pattern: /^\$Pinned = '([^']*)'$/m,
            format: (version) => `$Pinned = '${version}'`,
            required: true,
        },
        {
            name: 'SKILL.md pinned prose',
            file: join(base, 'SKILL.md'),
            pattern: /the pinned version is (\d+\.\d+\.\d+)/,
            format: (version) => `the pinned version is ${version}`,
            required: true,
        },
    ];
}

/** Pinned install commands in the docs and SKILL.md: stamped where present. */
export function docTargets(root, pkgName, slug) {
    const escaped = escapeRe(pkgName);
    const files = [
        'README.md',
        'README.zh-CN.md',
        'INSTALL.md',
        join('skills', pkgName.split('/').pop(), 'SKILL.md'),
        join('docs', 'troubleshooting.md'),
    ];
    return files.flatMap((relative) => [
        {
            name: `${relative} install pin`,
            file: join(root, relative),
            pattern: new RegExp(`${escaped}@(\\d+\\.\\d+\\.\\d+)`, 'g'),
            format: (version) => `${pkgName}@${version}`,
            required: false,
        },
        {
            name: `${relative} skills add pin`,
            file: join(root, relative),
            pattern: new RegExp(`${escapeRe(slug)}#v(\\d+\\.\\d+\\.\\d+)`, 'g'),
            format: (version) => `${slug}#v${version}`,
            required: false,
        },
        {
            name: `${relative} git tag pin`,
            file: join(root, relative),
            pattern: /--branch v(\d+\.\d+\.\d+)/g,
            format: (version) => `--branch v${version}`,
            required: false,
        },
        {
            name: `${relative} tagged link pin`,
            file: join(root, relative),
            pattern: new RegExp(`${escapeRe(slug)}/blob/v(\\d+\\.\\d+\\.\\d+)`, 'g'),
            format: (version) => `${slug}/blob/v${version}`,
            required: false,
        },
    ]);
}

/** Every file carrying the version. */
export function allTargets(root = repoRoot) {
    const pkg = readPackage(root);
    return [
        ...stampTargets(join(root, 'skills', skillName(root))),
        ...docTargets(root, pkg.name, repoSlug(root)),
    ];
}

function everyMatch(pattern) {
    return pattern.flags.includes('g') ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
}

/** Rewrite every version occurrence in those files to the package version. */
export function stampLaunchers(root = repoRoot) {
    const version = readPackageVersion(root);
    const stamped = [];
    for (const target of allTargets(root)) {
        if (!existsSync(target.file)) {
            if (target.required) throw new Error(`Missing ${target.file}`);
            continue;
        }
        const before = readFileSync(target.file, 'utf-8');
        if (before.match(everyMatch(target.pattern)) === null) {
            if (target.required) throw new Error(`No version line to stamp in ${target.file}`);
            continue;
        }
        const after = before.replace(everyMatch(target.pattern), target.format(version));
        if (after !== before) writeFileSync(target.file, after);
        stamped.push(target.name);
    }
    return { version, stamped };
}

/** The version written at every occurrence, one entry each. */
export function readStampedVersions(root = repoRoot) {
    const entries = [];
    for (const target of allTargets(root)) {
        if (!existsSync(target.file)) {
            if (target.required)
                entries.push({ name: target.name, file: target.file, version: null });
            continue;
        }
        const matches = [
            ...readFileSync(target.file, 'utf-8').matchAll(everyMatch(target.pattern)),
        ];
        if (matches.length === 0) {
            if (target.required)
                entries.push({ name: target.name, file: target.file, version: null });
            continue;
        }
        for (const [index, match] of matches.entries()) {
            const name = matches.length > 1 ? `${target.name} #${index + 1}` : target.name;
            entries.push({ name, file: target.file, version: match[1] });
        }
    }
    return entries;
}

/**
 * Every install command in `text` that cannot be proven to install an exact
 * version of `pkgName`. Text is split into commands at the separators that end
 * one, comments are removed first, and anything left holding the package
 * without an exact x.y.z is reported.
 */
export function unpinnedInstalls(text, pkgName = '@liustack/flipbook') {
    const escaped = escapeRe(pkgName);
    const spec = new RegExp(`${escaped}@([^\\s\`'";|&#)]*)`, 'g');
    const bare = new RegExp(
        `(\\b(add|install|npx|bunx|dlx)\\b|\\b(pnpm|npm|yarn|bun)\\s+i\\b)[^\\n]*?(^|[\\s'"=])${escaped}(?![\\w./@-])`,
    );
    const found = [];
    const joined = text.replace(/\r\n/g, '\n').replace(/\\\n\s*/g, ' ');
    for (const line of joined.split('\n')) {
        const code = line.replace(/(^|\s)#.*$/, '');
        for (const segment of code.split(/&&|\|\||[|;&]/)) {
            if (!segment.includes(pkgName)) continue;
            const args = segment
                .replace(/[<>]+\s*\S+/g, ' ')
                .replace(/(^|\s)[A-Za-z_][A-Za-z0-9_]*=\S+/g, ' ');
            if (/(^|\s)--config\.minimumReleaseAge=0(\s|$)/.test(args)) continue;
            const specs = [...segment.matchAll(spec)]
                .map((match) => match[1])
                .filter((value) => !/^<(pinned|version)>$/.test(value));
            const unpinned = specs.filter((value) => !/^\d+\.\d+\.\d+$/.test(value));
            if (unpinned.length > 0 || bare.test(segment)) {
                found.push(segment.trim());
            }
        }
    }
    return found;
}

/** `skills add owner/repo` commands that do not name an exact #vX.Y.Z tag. */
export function unpinnedSkillAdds(text, slug = 'liustack/flipbook') {
    const found = [];
    const pattern = new RegExp(`\\bskills\\s+add\\s+${escapeRe(slug)}(#\\S*)?`, 'g');
    for (const match of text.matchAll(pattern)) {
        if (!/^#v\d+\.\d+\.\d+$/.test(match[1] ?? '')) found.push(match[0]);
    }
    return found;
}
