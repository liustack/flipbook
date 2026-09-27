// What an eval case asks for, what a finished workspace shows, and the
// verdict. Reads files only, starts nothing and spends nothing, so the rules
// can be tested on their own. The criteria are in docs/eval.md.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** The questions the eval answers. Each case lists the ones it covers in `asks`. */
export const QUESTIONS = ['story', 'film', 'characters', 'looks', 'pictures', 'brand', 'rules'];

export const AUDIO_MODES = ['preset', 'score', 'file', 'none'];

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
const HEX = /^#[0-9a-f]{6}$/i;

/** What `stock fetch` writes as an entry's id: the picture came with a known license. */
const STOCK_ID = /^(openverse|pexels|pixabay):/;

/** Directories that hold the host's copy of the skill, the eval's shims or tool output. */
const HOST_DIRS = ['.claude', '.agents', '.codex', '.eval-bin', 'node_modules', '.git'];

/** Runtime calls worth recording for a reviewer: which look, character and material a film used. */
const FEATURES = {
    paper: ['paperLayer(', 'drawPaper('],
    grain: ['grainLayer(', 'drawGrain('],
    riso: ['riso('],
    pixel: ['pixel('],
    puppet: ['puppet('],
    rig: ['loadRig('],
    sprite: ['loadSprite('],
    photo: ['photo('],
    specimens: ['specimens('],
    brand: ['brand('],
    pageTurn: ['pageTurn('],
    arcCuts: ['arcCuts('],
    lens: ['lens('],
    assemble: ['assemble('],
};

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

export function sha256File(file) {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function readJson(file) {
    try {
        return JSON.parse(readFileSync(file, 'utf-8'));
    } catch {
        return null;
    }
}

/** A path inside `root`, or null when `rel` leaves it. */
function inside(root, rel) {
    const full = resolve(root, rel);
    const back = relative(root, full);
    return back && !back.startsWith('..') && !isAbsolute(back) ? full : null;
}

/** Where a workspace file comes from, for `copy` (the case directory) and `repo` (this repository). */
export function workspaceSource(item, { caseDir, repoRoot }) {
    if (item.generator === 'copy') return inside(caseDir, item.from ?? '');
    if (item.generator === 'repo') return inside(repoRoot, item.from ?? '');
    return null;
}

function validateWorkspace(workspace, dirs) {
    const problems = [];
    if (!isObject(workspace)) return ['workspace must map workspace paths to files'];
    for (const [rel, item] of Object.entries(workspace)) {
        if (!isObject(item)) {
            problems.push(`workspace ${rel}: not an object`);
        } else if (item.generator === 'clicks') {
            const { bpm, offsetSec, seconds } = item;
            const numbers = [bpm, offsetSec, seconds].every(Number.isFinite);
            if (!numbers || !(bpm > 0 && offsetSec >= 0 && seconds > 0))
                problems.push(`workspace ${rel}: clicks needs bpm, offsetSec and seconds`);
        } else if (item.generator === 'copy' || item.generator === 'repo') {
            const from = workspaceSource(item, dirs);
            if (!from || !existsSync(from))
                problems.push(`workspace ${rel}: no file ${item.from} for ${item.generator}`);
        } else {
            problems.push(`workspace ${rel}: unknown generator ${item.generator}`);
        }
    }
    return problems;
}

function validateBrand(brand, workspace) {
    if (!isObject(brand)) return ['expect.brand must be an object'];
    const problems = Object.keys(brand)
        .filter((key) => !BRAND_KEYS.includes(key))
        .map((key) => `unknown field expect.brand.${key}`);
    if (brand.name !== undefined && typeof brand.name !== 'string')
        problems.push('expect.brand.name must be a string');
    if (brand.primary !== undefined && !HEX.test(brand.primary))
        problems.push('expect.brand.primary must be #rrggbb');
    if (
        brand.palette !== undefined &&
        (!Array.isArray(brand.palette) || !brand.palette.every((c) => HEX.test(c)))
    )
        problems.push('expect.brand.palette must list #rrggbb colors');
    if (brand.logo !== undefined && !workspace[brand.logo])
        problems.push(`expect.brand.logo: ${brand.logo} is not a workspace file`);
    return problems;
}

/** Why a case.json falls short, as a list of problems. Empty when it holds. */
export function validateCase(spec, { name, caseDir, repoRoot }) {
    if (!isObject(spec)) return ['case.json must be an object'];
    const problems = [];
    for (const key of ['id', 'title', 'asks', 'prompt', 'expect']) {
        if (spec[key] === undefined) problems.push(`missing ${key}`);
    }
    for (const key of Object.keys(spec)) {
        if (!CASE_KEYS.includes(key)) problems.push(`unknown field ${key}`);
    }
    if (spec.id !== name) problems.push(`id "${spec.id}" does not match the directory`);
    if (
        !Array.isArray(spec.asks) ||
        spec.asks.length === 0 ||
        spec.asks.some((q) => !QUESTIONS.includes(q))
    )
        problems.push(`asks must list some of ${QUESTIONS.join(', ')}`);
    if (spec.timeoutMin !== undefined && !(Number.isFinite(spec.timeoutMin) && spec.timeoutMin > 0))
        problems.push('timeoutMin must be a positive number of minutes');
    const workspace = spec.workspace ?? {};
    problems.push(...validateWorkspace(workspace, { caseDir, repoRoot }));
    const e = spec.expect;
    if (!isObject(e)) return [...problems, 'expect must be an object'];
    for (const key of Object.keys(e)) {
        if (!EXPECT_KEYS.includes(key)) problems.push(`unknown field expect.${key}`);
    }
    if (e.film !== undefined && !['required', 'optional'].includes(e.film))
        problems.push('expect.film must be "required" or "optional"');
    const range = e.durationSec;
    if (
        !Array.isArray(range) ||
        range.length !== 2 ||
        !range.every(Number.isFinite) ||
        range[0] >= range[1]
    )
        problems.push('expect.durationSec must be [min, max]');
    if ((e.width === undefined) !== (e.height === undefined))
        problems.push('expect.width and expect.height go together');
    const modes = [e.audio].flat();
    if (e.audio !== 'any' && (modes.length === 0 || modes.some((m) => !AUDIO_MODES.includes(m))))
        problems.push(`expect.audio must be "any", or one or a list of ${AUDIO_MODES.join(', ')}`);
    if (
        e.timeline !== undefined &&
        (!isObject(e.timeline) || Object.values(e.timeline).some((v) => typeof v === 'object'))
    )
        problems.push('expect.timeline maps dotted paths to plain values');
    for (const key of ['uses', 'files', 'notCopied']) {
        const list = e[key];
        if (
            list !== undefined &&
            (!Array.isArray(list) || list.some((s) => !s || typeof s !== 'string'))
        )
            problems.push(`expect.${key} must be a list of strings`);
    }
    for (const rel of e.notCopied ?? []) {
        if (!workspace[rel]) problems.push(`expect.notCopied: ${rel} is not a workspace file`);
    }
    if (e.brand !== undefined) problems.push(...validateBrand(e.brand, workspace));
    if (
        !Array.isArray(e.review) ||
        e.review.length === 0 ||
        e.review.some((q) => !q || typeof q !== 'string')
    )
        problems.push('expect.review must list the questions a person answers');
    return problems;
}

/** Files under `dir`, as paths relative to it with forward slashes, skipping `skip` directories. */
export function listFiles(dir, skip) {
    const out = [];
    const walk = (folder, prefix) => {
        let entries;
        try {
            entries = readdirSync(folder, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                if (!skip.includes(entry.name)) walk(join(folder, entry.name), rel);
            } else if (entry.isFile()) {
                out.push(rel);
            }
        }
    };
    walk(dir, '');
    return out.sort();
}

/** `*` matches within one path segment, nothing else is special. */
export function globMatches(pattern, rel) {
    const re = pattern
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*');
    return new RegExp(`^${re}$`).test(rel);
}

/** Whether `source` calls `token`: `a(|b(` means either. A call must not be the tail of a longer name. */
export function sourceUses(source, token) {
    return token.split('|').some((one) => {
        const escaped = one.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^\\w$])${escaped}`).test(source);
    });
}

/**
 * The text a composition is made of: its pages, scripts and styles outside
 * assets/, and every JSON file (timeline, story, brand, SOURCES, puppet and
 * sprite files), so a reference to a file shows up wherever it is written.
 */
function readSource(dir) {
    const skip = [...HOST_DIRS, '.flipbook', 'out'];
    return listFiles(dir, skip)
        .filter(
            (rel) =>
                /\.json$/i.test(rel) ||
                (!rel.startsWith('assets/') && /\.(html?|m?js|css)$/i.test(rel)),
        )
        .map((rel) => readFileSync(join(dir, rel), 'utf-8'))
        .join('\n');
}

/** assets/SOURCES.json sorted by where each picture or sound came from. */
function sourcesSummary(dir) {
    const sources = readJson(join(dir, 'assets', 'SOURCES.json'));
    if (!isObject(sources)) return null;
    const out = { stock: [], cut: 0, generated: [], other: [] };
    for (const [key, entry] of Object.entries(sources)) {
        if (isObject(entry) && typeof entry.cutFrom === 'string') out.cut++;
        else if (isObject(entry) && STOCK_ID.test(String(entry.id ?? ''))) out.stock.push(key);
        else if (isObject(entry) && entry.license === 'generated') out.generated.push(key);
        else out.other.push(key);
    }
    return out;
}

/** The brand.json timeline.json names, as far as the verdict needs it. */
function brandFacts(dir, timeline) {
    if (typeof timeline?.brand !== 'string') return null;
    const file = resolve(dir, timeline.brand);
    const data = readJson(file);
    if (!isObject(data)) return { file, readable: false };
    const logo = isObject(data.logo) && typeof data.logo.file === 'string' ? data.logo.file : null;
    const logoFile = logo ? resolve(dirname(file), logo) : null;
    return {
        file,
        readable: true,
        name: data.name ?? null,
        colors: isObject(data.colors) ? data.colors : null,
        logo,
        logoSha256: logoFile && existsSync(logoFile) ? sha256File(logoFile) : null,
    };
}

/**
 * Files in the composition with the same bytes as a watched workspace file
 * (the original itself aside), and whether `stock fetch` brought them in.
 */
function findCopies(dir, wsRoot, watched) {
    if (watched.length === 0) return [];
    const sources = readJson(join(dir, 'assets', 'SOURCES.json'));
    const copies = [];
    for (const rel of listFiles(dir, [...HOST_DIRS, '.flipbook', 'out'])) {
        const full = join(dir, rel);
        const wsRel = relative(wsRoot, full).split(sep).join('/');
        const size = statSync(full).size;
        for (const w of watched) {
            if (w.rel === wsRel || w.size !== size || sha256File(full) !== w.sha256) continue;
            const entry = rel.startsWith('assets/') ? sources?.[rel.slice('assets/'.length)] : null;
            copies.push({
                path: rel,
                of: w.rel,
                fetched: isObject(entry) && STOCK_ID.test(String(entry.id ?? '')),
            });
        }
    }
    return copies;
}

/**
 * What a composition directory shows, beyond its video and reports: the
 * timeline and story, the runtime calls it makes, where its pictures came
 * from, its brand, which of the case's files exist, and copies of watched
 * workspace files. `source` is for the verdict only and stays out of the
 * evidence.
 */
export function inspect(dir, { spec, wsRoot, workspaceFiles }) {
    const e = spec.expect;
    const timeline = readJson(join(dir, 'timeline.json'));
    const source = readSource(dir);
    const files = listFiles(dir, HOST_DIRS);
    const watched = (e.notCopied ?? []).map((rel) => ({ rel, ...workspaceFiles[rel] }));
    return {
        timeline,
        story: readJson(join(dir, 'story.json')),
        features: Object.entries(FEATURES)
            .filter(([, tokens]) => sourceUses(source, tokens.join('|')))
            .map(([name]) => name),
        sources: sourcesSummary(dir),
        brand: brandFacts(dir, timeline),
        files: Object.fromEntries(
            (e.files ?? []).map((pattern) => [
                pattern,
                files.some((rel) => globMatches(pattern, rel)),
            ]),
        ),
        copies: findCopies(dir, wsRoot, watched),
        source,
    };
}

function getPath(object, dotted) {
    return dotted.split('.').reduce((at, key) => (isObject(at) ? at[key] : undefined), object);
}

/** Why the delivered film falls short of acceptance, or nothing. */
function filmGate(c) {
    const reasons = [];
    if (!c.video) reasons.push('no out/video.mp4');
    if (!c.lastRender?.ok) reasons.push('last render report is missing or not ok');
    if (c.lastRender?.stop || c.lastCheck?.stop) reasons.push('the CLI asked the agent to stop');
    if (c.recheck?.exitCode !== 0) reasons.push(`independent check exited ${c.recheck?.exitCode}`);
    return reasons;
}

/** The story as the film tells it: beats and roles, and beats the finished video shows no change in. */
function storyVerdict(c) {
    const beats = Array.isArray(c.story?.beats) ? c.story.beats : null;
    if (!beats) return { reasons: ['no story.json with beats'], facts: null };
    const warnings = c.lastRender?.warnings ?? [];
    const named = (code) =>
        warnings.filter((w) => w.code === code).map((w) => String(w.detail?.beat ?? '?'));
    const staticBeats = named('story-static-beat');
    return {
        reasons: staticBeats.map(
            (id) => `beat ${id} shows no change in the video (story-static-beat)`,
        ),
        facts: {
            beats: beats.length,
            roles: beats.map((b) => b.role),
            staticBeats,
            fastText: named('story-text-fast'),
        },
    };
}

/** Why the film misses what this case asks of it. */
function expectations(e, c, workspaceFiles) {
    const reasons = [];
    if (c.probe) {
        const [min, max] = e.durationSec;
        if (c.probe.durationSec < min || c.probe.durationSec > max)
            reasons.push(`duration ${c.probe.durationSec.toFixed(2)} s outside [${min}, ${max}]`);
        if (e.width && (c.probe.width !== e.width || c.probe.height !== e.height))
            reasons.push(
                `size ${c.probe.width}x${c.probe.height}, expected ${e.width}x${e.height}`,
            );
    }
    if (e.audio !== 'any') {
        const allowed = [e.audio].flat();
        const mode = c.timeline?.audio?.mode ?? 'none';
        if (!allowed.includes(mode))
            reasons.push(`timeline audio.mode is "${mode}", expected ${allowed.join(' or ')}`);
        if (mode !== 'none' && c.probe && !c.probe.audio) reasons.push('no audio track');
    }
    for (const [path, value] of Object.entries(e.timeline ?? {})) {
        const got = getPath(c.timeline, path);
        if (got !== value)
            reasons.push(
                `timeline ${path} is ${JSON.stringify(got)}, expected ${JSON.stringify(value)}`,
            );
    }
    const missing = (e.uses ?? []).filter((token) => !sourceUses(c.source, token));
    if (missing.length > 0) reasons.push(`the source never calls ${missing.join(', ')}`);
    for (const [pattern, found] of Object.entries(c.files ?? {})) {
        if (!found) reasons.push(`no file matches ${pattern}`);
    }
    if (e.brand) reasons.push(...brandReasons(e.brand, c.brand, workspaceFiles));
    return reasons;
}

function brandReasons(want, got, workspaceFiles) {
    if (!got) return ['timeline.json names no brand.json'];
    if (!got.readable) return [`${got.file} is not a readable brand.json`];
    const reasons = [];
    if (want.name !== undefined && got.name !== want.name)
        reasons.push(
            `brand name is ${JSON.stringify(got.name)}, expected ${JSON.stringify(want.name)}`,
        );
    const colors = got.colors ?? {};
    if (
        want.primary !== undefined &&
        String(colors.primary).toLowerCase() !== want.primary.toLowerCase()
    )
        reasons.push(`brand primary is ${colors.primary}, expected ${want.primary}`);
    if (want.palette) {
        const palette = want.palette.map((c) => c.toLowerCase());
        const invented = Object.entries(colors).filter(
            ([, value]) => value !== null && !palette.includes(String(value).toLowerCase()),
        );
        for (const [role, value] of invented)
            reasons.push(`brand color ${role} ${value} is not one of the workspace's colors`);
    }
    if (want.logo !== undefined && got.logoSha256 !== workspaceFiles[want.logo]?.sha256)
        reasons.push(`brand logo ${got.logo ?? '(none)'} is not the workspace's ${want.logo}`);
    return reasons;
}

/** Rules that hold whether or not a film came out: watched workspace files stay out of the film. */
function ruleReasons(e, compositions) {
    const reasons = [];
    for (const rel of e.notCopied ?? []) {
        const stem = basename(rel).replace(/\.[^.]+$/, '');
        for (const c of compositions) {
            for (const copy of c.copies ?? []) {
                if (copy.of === rel && !copy.fetched)
                    reasons.push(
                        `${c.dir}/${copy.path} is a copy of ${rel}, whose source is unknown`,
                    );
            }
            if (c.source.includes(stem)) reasons.push(`${c.dir} refers to ${rel}`);
        }
    }
    return reasons;
}

/**
 * The verdict on one run. `delivered`: exactly one composition with a video
 * that passed acceptance. `oneShot`: the run met everything the case checks
 * automatically, with nobody stepping in. A case whose film is optional
 * passes without a film as long as its rules hold. `humanReview` is left
 * for a person to fill in.
 */
export function judge(spec, { host, compositions, workspaceFiles }) {
    const e = spec.expect;
    const reasons = [];
    if (host.timedOut) reasons.push('host timed out');
    else if (host.exitCode !== 0) reasons.push(`host exited ${host.exitCode}`);
    reasons.push(...ruleReasons(e, compositions));
    const withVideo = compositions.filter((c) => c.video);
    let delivered = false;
    let story = null;
    if ((e.film ?? 'required') === 'required' || withVideo.length > 0) {
        const gate = [];
        if (compositions.length !== 1)
            gate.push(`${compositions.length} compositions found, expected 1`);
        const c = withVideo[0] ?? compositions[0];
        if (c) {
            gate.push(...filmGate(c));
            const told = storyVerdict(c);
            story = told.facts;
            reasons.push(...gate, ...told.reasons, ...expectations(e, c, workspaceFiles));
        } else {
            reasons.push(...gate);
        }
        delivered = gate.length === 0;
    }
    return {
        delivered,
        oneShot: reasons.length === 0,
        reasons,
        story,
        humanReview: {
            retold: null,
            turnOnScreen: null,
            beatsMatch: null,
            case: e.review.map((question) => ({ question, answer: null })),
            silentBadFilm: null,
            movingSlides: null,
            notes: '',
        },
    };
}
