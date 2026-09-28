// What a finished workspace shows and the verdict on a run. Reads files
// only, starts nothing and spends nothing, so the rules can be tested on
// their own. The case format is in cases.mjs, the criteria in docs/eval.md.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { HOST_DIRS } from './cases.mjs';
import { globMatches, listFiles, readJson, sha256File } from './files.mjs';
import { runtimeUse } from './scripts.mjs';

/** What `stock fetch` writes as an entry's id: the picture came with a known license. */
const STOCK_ID = /^(openverse|pexels|pixabay):/;

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

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
 * timeline and story, the runtime functions its page scripts call, where its pictures came
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
        runtime: runtimeUse(dir),
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

/**
 * Why the film misses what this case asks of it. What cannot be settled
 * from the files goes to `review` for a person instead.
 */
function expectations(e, c, workspaceFiles, review) {
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
    if ((e.uses ?? []).length > 0 && !c.runtime?.imports) {
        review.push(
            `no page script imports /__flipbook/runtime.js, so expect.uses (${e.uses.join(', ')}) was not checked`,
        );
    } else {
        const calls = c.runtime?.calls ?? [];
        const missing = (e.uses ?? []).filter(
            (token) => !token.split('|').some((name) => calls.includes(name)),
        );
        if (missing.length > 0)
            reasons.push(`the page scripts never call ${missing.join(', ')} from the runtime`);
    }
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
 * passes without a film as long as its rules hold. `needsReview` lists
 * what the runner could not settle from the files, and `humanReview` is
 * left for a person to fill in.
 */
export function judge(spec, { host, compositions, workspaceFiles }) {
    const e = spec.expect;
    const reasons = [];
    const needsReview = [];
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
            reasons.push(
                ...gate,
                ...told.reasons,
                ...expectations(e, c, workspaceFiles, needsReview),
            );
        } else {
            reasons.push(...gate);
        }
        delivered = gate.length === 0;
    }
    return {
        delivered,
        oneShot: reasons.length === 0,
        reasons,
        needsReview,
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
