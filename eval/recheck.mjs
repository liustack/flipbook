// The evaluator's own check of a composition, so the verdict never rests on
// the agent's last run. It checks a fresh copy of the whole workspace: what
// the agent left in .flipbook/ and out/ stays behind, and every file the
// composition reaches by a relative path (a brand.json in the workspace root,
// the logo and fonts it names) keeps its place next to it.
import { spawnSync } from 'node:child_process';
import {
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    realpathSync,
    rmSync,
    statSync,
    symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { HOST_DIRS } from './cases.mjs';

/** Folders left out of the copy: the host's and the eval's own, and what flipbook wrote. */
const LEFT_OUT = [...HOST_DIRS, '.flipbook', 'out'];

function readJsonText(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/**
 * Copy the workspace `wsRoot` to `dest`, leaving out the LEFT_OUT folders.
 * A link whose real target lies in the workspace, outside those folders,
 * becomes a link to the same place in the copy, so the copy never reaches
 * back into the original. A link that leads out of the workspace, into a
 * folder left out, or nowhere is not followed: it stays out of the copy,
 * and a note says so. Returns the notes.
 */
export function copyWorkspace(wsRoot, dest) {
    const realRoot = realpathSync(wsRoot);
    const notes = [];
    const walk = (rel) => {
        for (const entry of readdirSync(join(wsRoot, rel), { withFileTypes: true })) {
            if (LEFT_OUT.includes(entry.name)) continue;
            const childRel = rel ? join(rel, entry.name) : entry.name;
            const from = join(wsRoot, childRel);
            const to = join(dest, childRel);
            const shown = childRel.split(sep).join('/');
            if (entry.isSymbolicLink()) {
                let target;
                try {
                    target = realpathSync(from);
                } catch {
                    notes.push(
                        `${shown} is a link that leads nowhere, left out of the recheck copy`,
                    );
                    continue;
                }
                const back = relative(realRoot, target);
                if (back === '' || back.startsWith('..') || isAbsolute(back)) {
                    notes.push(
                        `${shown} is a link out of the workspace, to ${target}, left out of the recheck copy`,
                    );
                    continue;
                }
                const into = back.split(sep).find((part) => LEFT_OUT.includes(part));
                if (into) {
                    notes.push(
                        `${shown} is a link into ${into}/, which the recheck leaves out, so it is left out too`,
                    );
                    continue;
                }
                const type = statSync(target).isDirectory() ? 'dir' : 'file';
                symlinkSync(relative(dirname(to), join(dest, back)), to, type);
            } else if (entry.isDirectory()) {
                mkdirSync(to);
                walk(childRel);
            } else if (entry.isFile()) {
                copyFileSync(from, to);
            }
        }
    };
    walk('');
    return notes;
}

/**
 * The stage the agent's last render drew, as check flags: text and the safe
 * area are then checked in the shape the video has, even when the render
 * used --size or --scale. None without a render report.
 */
export function renderShape(lastRender) {
    const c = lastRender?.composition;
    if (!Number.isInteger(c?.width) || !Number.isInteger(c?.height)) return [];
    const flags = ['--size', `${c.width}x${c.height}`];
    if (typeof c.scale === 'number' && c.scale !== 1) flags.push('--scale', String(c.scale));
    return flags;
}

/**
 * Run `flipbook check` on a copy of `wsRoot` at the composition's place in
 * it, with `flags` (such as the ones from renderShape). Returns its exit code
 * and report, and `notes` on links the copy did not follow.
 */
export function recheck(composition, { wsRoot, cli, flags = [] }) {
    const copy = mkdtempSync(join(tmpdir(), 'flipbook-eval-recheck-'));
    try {
        const notes = copyWorkspace(wsRoot, copy);
        const result = spawnSync(
            process.execPath,
            [cli, 'check', join(copy, relative(wsRoot, composition)), ...flags],
            {
                encoding: 'utf-8',
                maxBuffer: 64 * 1024 * 1024,
                env: { ...process.env, FLIPBOOK_QUIET: '1' },
            },
        );
        return { exitCode: result.status, report: readJsonText(result.stdout), notes };
    } finally {
        rmSync(copy, { recursive: true, force: true });
    }
}
