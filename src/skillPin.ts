// Copyright (c) 2026 Leon Liu (liustack). MIT License.
//
// An installed skill is a copy whose launcher carries the version it was
// stamped with. This reads the pin out of every installed copy so doctor can
// report copies older than the CLI. Nothing here reaches the network.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SKILL_NAME } from './names.ts';

/** Where each harness reads global skills from. */
export const SKILL_DIRS = [
    ['claude-code', '.claude/skills'],
    ['codex', '.codex/skills'],
    ['pi/opencode', '.agents/skills'],
] as const;

export interface SkillInstall {
    /** Which harness directory it was found in. */
    harness: string;
    /** The launcher file the pin was read from. */
    path: string;
    /** The version that copy pins, or null when the launcher is unreadable. */
    pinned: string | null;
    /** True when the pin is older than the CLI reporting it. */
    outdated: boolean;
}

/** Compare two dotted versions; missing or unparsable parts sort as older. */
export function isOlder(pinned: string, current: string): boolean {
    const parse = (v: string) => v.split('.').map((part) => Number.parseInt(part, 10) || 0);
    const [pa, pb, pc] = parse(pinned);
    const [ca, cb, cc] = parse(current);
    if (pa !== ca) return pa < ca;
    if (pb !== cb) return pb < cb;
    return pc < cc;
}

/** Read `PINNED="x.y.z"` out of a POSIX launcher's text. */
export function readPinnedVersion(launcher: string): string | null {
    return /^PINNED="([^"]+)"/m.exec(launcher)?.[1] ?? null;
}

/** Every installed skill copy on this machine, with the pin each one carries. */
export function findSkillInstalls(
    currentVersion: string,
    home: string = os.homedir(),
    skillName = SKILL_NAME,
): SkillInstall[] {
    const installs: SkillInstall[] = [];
    for (const [harness, relative] of SKILL_DIRS) {
        const launcher = path.join(home, relative, skillName, 'scripts', 'run.sh');
        let text: string;
        try {
            text = fs.readFileSync(launcher, 'utf-8');
        } catch {
            continue;
        }
        const pinned = readPinnedVersion(text);
        installs.push({
            harness,
            path: launcher,
            pinned,
            outdated: pinned !== null && isOlder(pinned, currentVersion),
        });
    }
    return installs;
}
