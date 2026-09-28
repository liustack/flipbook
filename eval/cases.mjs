// The format of eval/cases/<id>/case.json and what makes one valid. Every
// problem names the field it is about, so --dry-run points at the typo.
// docs/eval.md describes the fields.
import { lstatSync } from 'node:fs';
import { isAbsolute, posix, relative, resolve } from 'node:path';

/** The questions the eval answers. Each case lists the ones it covers in `asks`. */
export const QUESTIONS = ['story', 'film', 'characters', 'looks', 'pictures', 'brand', 'rules'];

export const AUDIO_MODES = ['preset', 'score', 'file', 'none'];

/** Directories that hold the host's copy of the skill, the eval's shims or tool output. */
export const HOST_DIRS = ['.claude', '.agents', '.codex', '.eval-bin', 'node_modules', '.git'];

const CASE_KEYS = ['id', 'title', 'asks', 'prompt', 'workspace', 'timeoutMin', 'expect'];
const EXPECT_KEYS = [
    'film',
    'durationSec',
    'width',
    'height',
    'audio',
    'timeline',
    'uses',
    'files',
    'brand',
    'notCopied',
    'review',
];
const BRAND_KEYS = ['name', 'primary', 'palette', 'logo'];
const GENERATORS = {
    clicks: ['bpm', 'offsetSec', 'seconds'],
    copy: ['from'],
    repo: ['from'],
};
const HEX = /^#[0-9a-f]{6}$/i;

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const key = (name) => `[${JSON.stringify(name)}]`;

/** A path inside `root`, or null when `rel` leaves it. */
function inside(root, rel) {
    const full = resolve(root, rel);
    const back = relative(root, full);
    return back && !back.startsWith('..') && !isAbsolute(back) ? full : null;
}

/** Where a workspace file comes from, for `copy` (the case directory) and `repo` (this repository). */
export function workspaceSource(item, { caseDir, repoRoot }) {
    if (item.generator === 'copy') return inside(caseDir, item.from);
    if (item.generator === 'repo') return inside(repoRoot, item.from);
    return null;
}

/** Why `rel` cannot name a file in the workspace or the composition, or null. */
function pathProblem(rel) {
    if (!isText(rel)) return 'must be a non-empty path';
    if (rel.includes('\\')) return 'must use forward slashes';
    if (posix.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return 'must be a relative path';
    const plain = posix.normalize(rel);
    if (plain === '..' || plain.startsWith('../')) return 'leaves the directory';
    if (plain !== rel) return `must be written plainly, as ${plain}`;
    return null;
}

/** A list field: problems for anything but an array of non-empty strings, and the strings. */
function stringList(value, path, add) {
    if (!Array.isArray(value)) {
        add(path, 'must be a list');
        return [];
    }
    const good = [];
    value.forEach((item, i) => {
        if (isText(item)) good.push(item);
        else add(`${path}[${i}]`, 'must be a non-empty string');
    });
    return good;
}

function validateWorkspace(workspace, dirs, add) {
    if (!isObject(workspace)) {
        add('workspace', 'must map workspace paths to files');
        return;
    }
    for (const [rel, item] of Object.entries(workspace)) {
        const at = `workspace${key(rel)}`;
        const bad = pathProblem(rel);
        if (bad) add(at, bad === 'leaves the directory' ? 'leaves the workspace' : bad);
        else if (HOST_DIRS.includes(rel.split('/')[0]))
            add(at, 'lands in a folder kept for the host or the eval');
        if (!isObject(item)) {
            add(at, 'must be an object');
            continue;
        }
        const fields = GENERATORS[item.generator];
        if (!fields) {
            add(
                `${at}.generator`,
                `must be one of ${Object.keys(GENERATORS).join(', ')}, not ${JSON.stringify(item.generator)}`,
            );
            continue;
        }
        for (const name of Object.keys(item)) {
            if (name !== 'generator' && !fields.includes(name))
                add(`${at}.${name}`, `unknown field for ${item.generator}`);
        }
        for (const name of fields) {
            if (item[name] === undefined)
                add(`${at}.${name}`, `missing, ${item.generator} needs it`);
        }
        if (item.generator === 'clicks') {
            const { bpm, offsetSec, seconds } = item;
            if (bpm !== undefined && !(Number.isFinite(bpm) && bpm > 0))
                add(`${at}.bpm`, 'must be a number above 0');
            if (offsetSec !== undefined && !(Number.isFinite(offsetSec) && offsetSec >= 0))
                add(`${at}.offsetSec`, 'must be a number of seconds, 0 or more');
            if (seconds !== undefined && !(Number.isFinite(seconds) && seconds > 0))
                add(`${at}.seconds`, 'must be a number of seconds above 0');
            continue;
        }
        if (item.from === undefined) continue;
        if (!isText(item.from)) {
            add(`${at}.from`, 'must be a non-empty path');
            continue;
        }
        const from = workspaceSource(item, dirs);
        const base = item.generator === 'copy' ? 'the case directory' : 'the repository';
        if (!from) {
            add(`${at}.from`, `leaves ${base}`);
            continue;
        }
        let stat = null;
        try {
            stat = lstatSync(from);
        } catch {
            add(`${at}.from`, `no file ${item.from} in ${base}`);
            continue;
        }
        if (!stat.isFile()) add(`${at}.from`, `${item.from} is not a regular file`);
    }
}

function validateBrand(brand, workspace, add) {
    if (!isObject(brand)) {
        add('expect.brand', 'must be an object');
        return;
    }
    for (const name of Object.keys(brand)) {
        if (!BRAND_KEYS.includes(name)) add(`expect.brand.${name}`, 'unknown field');
    }
    if (brand.name !== undefined && !isText(brand.name))
        add('expect.brand.name', 'must be a non-empty string');
    if (brand.primary !== undefined && !HEX.test(String(brand.primary)))
        add('expect.brand.primary', 'must be #rrggbb');
    if (brand.palette !== undefined) {
        if (!Array.isArray(brand.palette) || brand.palette.length === 0) {
            add('expect.brand.palette', 'must list #rrggbb colors');
        } else {
            brand.palette.forEach((color, i) => {
                if (!HEX.test(String(color))) add(`expect.brand.palette[${i}]`, 'must be #rrggbb');
            });
        }
    }
    if (brand.logo !== undefined && !(isText(brand.logo) && workspace[brand.logo]))
        add('expect.brand.logo', `${JSON.stringify(brand.logo)} is not a workspace file`);
}

function validateExpect(e, workspace, runtimeNames, add) {
    for (const name of Object.keys(e)) {
        if (!EXPECT_KEYS.includes(name)) add(`expect.${name}`, 'unknown field');
    }
    if (e.film !== undefined && !['required', 'optional'].includes(e.film))
        add('expect.film', 'must be "required" or "optional"');
    const range = e.durationSec;
    if (
        !Array.isArray(range) ||
        range.length !== 2 ||
        !range.every(Number.isFinite) ||
        !(range[0] > 0 && range[0] < range[1])
    )
        add('expect.durationSec', 'must be [min, max] seconds with 0 < min < max');
    if ((e.width === undefined) !== (e.height === undefined))
        add('expect.width', 'and expect.height go together');
    for (const side of ['width', 'height']) {
        const v = e[side];
        if (v !== undefined && !(Number.isInteger(v) && v > 0 && v % 2 === 0))
            add(`expect.${side}`, 'must be a positive even whole number of pixels');
    }
    const modes = Array.isArray(e.audio) ? e.audio : [e.audio];
    if (
        e.audio !== 'any' &&
        (modes.length === 0 ||
            modes.some((m) => !AUDIO_MODES.includes(m)) ||
            new Set(modes).size !== modes.length)
    )
        add('expect.audio', `must be "any", or one or a list of ${AUDIO_MODES.join(', ')}`);
    if (e.timeline !== undefined) {
        if (!isObject(e.timeline)) {
            add('expect.timeline', 'must map dotted paths to values');
        } else {
            for (const [path, value] of Object.entries(e.timeline)) {
                if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(path))
                    add(
                        `expect.timeline${key(path)}`,
                        'must be a dotted path such as audio.bpmOffset',
                    );
                const plain =
                    typeof value === 'string' ||
                    typeof value === 'boolean' ||
                    Number.isFinite(value);
                if (!plain)
                    add(`expect.timeline${key(path)}`, 'must be a string, number or boolean');
            }
        }
    }
    if (e.uses !== undefined) {
        stringList(e.uses, 'expect.uses', add);
        (Array.isArray(e.uses) ? e.uses : []).forEach((token, i) => {
            if (!isText(token)) return;
            for (const name of token.split('|')) {
                if (!/^[A-Za-z_$][\w$]*$/.test(name))
                    add(`expect.uses[${i}]`, `"${name}" is not a function name`);
                else if (runtimeNames && !runtimeNames.has(name))
                    add(`expect.uses[${i}]`, `"${name}" is not a function the runtime exports`);
            }
        });
    }
    if (e.files !== undefined) {
        stringList(e.files, 'expect.files', add);
        (Array.isArray(e.files) ? e.files : []).forEach((pattern, i) => {
            const bad = isText(pattern) ? pathProblem(pattern) : null;
            if (bad) add(`expect.files[${i}]`, bad);
        });
    }
    if (e.notCopied !== undefined) {
        stringList(e.notCopied, 'expect.notCopied', add).forEach((rel) => {
            if (!workspace[rel]) add('expect.notCopied', `${rel} is not a workspace file`);
        });
    }
    if (e.brand !== undefined) validateBrand(e.brand, workspace, add);
    if (stringList(e.review, 'expect.review', add).length === 0 && Array.isArray(e.review))
        add('expect.review', 'must list at least one question for the person reviewing');
}

/**
 * Why a case.json falls short, as `field: problem` lines. Empty when it
 * holds. `runtimeNames`, the functions the runtime exports, lets `expect.uses`
 * be checked for names that do not exist.
 */
export function validateCase(spec, { name, caseDir, repoRoot, runtimeNames }) {
    const problems = [];
    const add = (path, message) => problems.push(`${path}: ${message}`);
    if (!isObject(spec)) return ['case.json: must be an object'];
    for (const field of Object.keys(spec)) {
        if (!CASE_KEYS.includes(field)) add(field, 'unknown field');
    }
    if (!isText(spec.id)) add('id', 'must be a non-empty string');
    else if (spec.id !== name) add('id', `"${spec.id}" does not match the directory "${name}"`);
    for (const field of ['title', 'prompt']) {
        if (!isText(spec[field])) add(field, 'must be a non-empty string');
    }
    const asks = stringList(spec.asks, 'asks', add);
    if (Array.isArray(spec.asks) && spec.asks.length === 0)
        add('asks', `must list some of ${QUESTIONS.join(', ')}`);
    for (const q of asks) {
        if (!QUESTIONS.includes(q)) add('asks', `"${q}" is none of ${QUESTIONS.join(', ')}`);
    }
    if (new Set(asks).size !== asks.length) add('asks', 'lists a question twice');
    if (spec.timeoutMin !== undefined && !(Number.isFinite(spec.timeoutMin) && spec.timeoutMin > 0))
        add('timeoutMin', 'must be a number of minutes above 0');
    const workspace = spec.workspace ?? {};
    validateWorkspace(workspace, { caseDir, repoRoot }, add);
    if (!isObject(spec.expect)) add('expect', 'must be an object');
    else validateExpect(spec.expect, isObject(workspace) ? workspace : {}, runtimeNames, add);
    return problems;
}
