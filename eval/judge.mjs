// What a finished workspace shows and the verdict on a run. Reads files
// only, starts nothing and spends nothing, so the rules can be tested on
// their own. The case format is in cases.mjs, the criteria in docs/eval.md.
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { HOST_DIRS } from './cases.mjs';
import { globMatches, listFiles, readJson, sha256File } from './files.mjs';
import { pageReferences, pageScripts, runtimeUse } from './scripts.mjs';

/** What `stock fetch` writes as an entry's id: the picture came with a known license. */
const STOCK_ID = /^(openverse|pexels|pixabay):/;

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

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

/** The music file the timeline plays, when its audio mode is `file`, with its sha256. */
function audioFacts(dir, timeline) {
    const audio = timeline?.audio;
    if (audio?.mode !== 'file' || typeof audio.file !== 'string') return null;
    const file = resolve(dir, audio.file);
    return {
        file: audio.file,
        sha256: existsSync(file) && statSync(file).isFile() ? sha256File(file) : null,
    };
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

/** How a file came from a watched workspace file, for the verdict's wording. */
const HOW = {
    original: 'is',
    copy: 'is a copy of',
    claimed: 'has the bytes of',
    cut: 'was cut from',
    named: 'has a SOURCES.json entry that mentions',
};

/**
 * Files in the composition that come from a watched workspace file, and
 * whether the page names them. `certain` files are the file itself, a byte
 * copy that `stock fetch` did not bring in, or a picture cut from one of
 * those. Less certain ones: a byte copy whose entry claims a stock id with
 * no stock fetch report beside it, an entry whose text mentions the file,
 * and pictures cut from those. `referenced` is `exact` when a page, script
 * or stylesheet names the file, `prefix` when a name built from pieces could
 * be it, `none` otherwise. Comments name nothing.
 */
function watchedFiles(dir, wsRoot, watched) {
    if (watched.length === 0) return [];
    const sources = readJson(join(dir, 'assets', 'SOURCES.json'));
    const entries = isObject(sources) ? sources : {};
    const stockReport = existsSync(join(dir, '.flipbook', 'reports', 'stock-fetch.json'));
    const stockClaim = (entry) =>
        isObject(entry) && STOCK_ID.test(String(entry.id ?? '')) && typeof entry.url === 'string';
    const found = [];
    for (const rel of listFiles(dir, [...HOST_DIRS, '.flipbook', 'out'])) {
        const full = join(dir, rel);
        const wsRel = relative(wsRoot, full).split(sep).join('/');
        const size = statSync(full).size;
        for (const w of watched) {
            if (w.rel === wsRel) {
                found.push({ path: rel, of: w.rel, how: 'original', certain: true });
                continue;
            }
            if (w.size !== size || sha256File(full) !== w.sha256) continue;
            const entry = rel.startsWith('assets/') ? entries[rel.slice('assets/'.length)] : null;
            if (stockClaim(entry) && stockReport) continue;
            const how = stockClaim(entry) ? 'claimed' : 'copy';
            found.push({ path: rel, of: w.rel, how, certain: how === 'copy' });
        }
    }
    for (const w of watched) {
        const stem = basename(w.rel).replace(/\.[^.]+$/, '');
        const tainted = new Map();
        for (const f of found) {
            if (f.of === w.rel && f.path.startsWith('assets/'))
                tainted.set(f.path.slice('assets/'.length), f.certain);
        }
        for (const [key, entry] of Object.entries(entries)) {
            if (tainted.has(key) || (stockClaim(entry) && stockReport)) continue;
            if (JSON.stringify(entry).includes(stem)) {
                tainted.set(key, false);
                found.push({ path: `assets/${key}`, of: w.rel, how: 'named', certain: false });
            }
        }
        for (let grew = true; grew; ) {
            grew = false;
            for (const [key, entry] of Object.entries(entries)) {
                if (tainted.has(key) || !isObject(entry) || !tainted.has(entry.cutFrom)) continue;
                const certain = tainted.get(entry.cutFrom);
                tainted.set(key, certain);
                found.push({ path: `assets/${key}`, of: w.rel, how: 'cut', certain });
                grew = true;
            }
        }
    }
    if (found.length === 0) return [];
    const refs = pageReferences(dir);
    return found.map((f) => ({
        ...f,
        referenced: refs.exact.includes(f.path)
            ? 'exact'
            : refs.prefixes.some((prefix) => f.path.startsWith(prefix))
              ? 'prefix'
              : 'none',
    }));
}

/**
 * What a composition directory shows, beyond its video and reports: the
 * timeline and story, a hash of its page scripts, the runtime functions they
 * call, where its pictures came from, its brand, which of the case's files
 * exist, and the files that come from watched workspace files.
 */
export function inspect(dir, { spec, wsRoot, workspaceFiles }) {
    const e = spec.expect;
    const timeline = readJson(join(dir, 'timeline.json'));
    const scripts = pageScripts(dir).map(({ file, code }) => `${file}\n${code}`);
    const files = listFiles(dir, HOST_DIRS);
    const watched = (e.notCopied ?? []).map((rel) => ({ rel, ...workspaceFiles[rel] }));
    return {
        timeline,
        story: readJson(join(dir, 'story.json')),
        sourceSha256: createHash('sha256').update(scripts.join('\n')).digest('hex'),
        runtime: runtimeUse(dir),
        sources: sourcesSummary(dir),
        brand: brandFacts(dir, timeline),
        audioFile: audioFacts(dir, timeline),
        files: Object.fromEntries(
            (e.files ?? []).map((pattern) => [
                pattern,
                files.some((rel) => globMatches(pattern, rel)),
            ]),
        ),
        watched: watchedFiles(dir, wsRoot, watched),
    };
}

function getPath(object, dotted) {
    return dotted.split('.').reduce((at, key) => (isObject(at) ? at[key] : undefined), object);
}

/**
 * Why the delivered film falls short of acceptance, or nothing. Links the
 * recheck copy did not follow go to `review`, and when the recheck then
 * fails, the failure does too: the copy, not the film, may be what broke.
 */
function filmGate(c, review) {
    const reasons = [];
    if (!c.video) reasons.push('no out/video.mp4');
    if (!c.lastRender?.ok) reasons.push('last render report is missing or not ok');
    if (c.lastRender?.stop || c.lastCheck?.stop) reasons.push('the CLI asked the agent to stop');
    const notes = c.recheck?.notes ?? [];
    for (const note of notes) review.push(`${c.dir}: ${note}. Check the film does not need it.`);
    if (c.recheck?.exitCode !== 0) {
        const failed = `independent check exited ${c.recheck?.exitCode}`;
        if (notes.length > 0)
            review.push(
                `${c.dir}: ${failed} on a copy that left out the links above. Check whether the film fails without them or for another reason.`,
            );
        else reasons.push(failed);
    }
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
    if (e.audioFile !== undefined) {
        const want = workspaceFiles[e.audioFile]?.sha256;
        if (!c.audioFile) reasons.push(`the timeline plays no music file, expected ${e.audioFile}`);
        else if (!c.audioFile.sha256)
            reasons.push(`the timeline plays ${c.audioFile.file}, which is not a file`);
        else if (c.audioFile.sha256 !== want)
            reasons.push(
                `the timeline plays ${c.audioFile.file}, whose bytes differ from ${e.audioFile}`,
            );
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

/**
 * Rules that hold whether or not a film came out: watched workspace files
 * stay out of the film. A file that surely comes from one and that the page
 * names fails the run. Everything less sure goes to `review`, and so do
 * pictures whose source entry is neither stock fetch nor generated, which
 * could be a watched file re-encoded or cropped.
 */
function ruleReasons(e, compositions, review) {
    const reasons = [];
    if ((e.notCopied ?? []).length === 0) return reasons;
    const REFERENCED = {
        exact: 'The page names it.',
        prefix: 'The page builds a file name that could be it.',
        none: 'No page, script or stylesheet names it.',
    };
    for (const c of compositions) {
        for (const f of c.watched ?? []) {
            const what = `${c.dir}/${f.path} ${HOW[f.how]} ${f.of}, whose source is unknown.`;
            if (f.certain && f.referenced === 'exact') reasons.push(`${what} The page uses it.`);
            else
                review.push(
                    `${what} ${REFERENCED[f.referenced]} Check by eye that the film does not show it.`,
                );
        }
        const other = c.sources?.other ?? [];
        if (other.length > 0)
            review.push(
                `${c.dir}: assets/SOURCES.json lists ${other.join(', ')} with a source that is neither stock fetch nor generated. Check none of them is ${e.notCopied.join(' or ')} re-encoded or cropped.`,
            );
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
    reasons.push(...ruleReasons(e, compositions, needsReview));
    const withVideo = compositions.filter((c) => c.video);
    let delivered = false;
    let story = null;
    if ((e.film ?? 'required') === 'required' || withVideo.length > 0) {
        const gate = [];
        if (compositions.length !== 1)
            gate.push(`${compositions.length} compositions found, expected 1`);
        const c = withVideo[0] ?? compositions[0];
        if (c) {
            gate.push(...filmGate(c, needsReview));
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

/**
 * Where a person's review of one run stands. `complete` once every item that
 * applies has an answer: `retold`, `turnOnScreen`, `beatsMatch`,
 * `silentBadFilm` and `movingSlides` when a film was made, every case
 * question (true, false, or "n/a" when it does not apply to this run), and
 * `notes` when the runner left items in `needsReview`. `passed`: an
 * automatic one-shot pass whose review is complete and clean, null until
 * the review is complete.
 */
export function reviewOutcome(evidence) {
    const { verdict } = evidence;
    const h = verdict.humanReview;
    const missing = [];
    const failed = [];
    const want = (name, value, good) => {
        if (value === null || value === undefined) missing.push(name);
        else if (value !== good) failed.push(name);
    };
    if ((evidence.compositions ?? []).some((c) => c.video)) {
        if (!h.retold) missing.push('retold');
        want('turnOnScreen', h.turnOnScreen, true);
        want('beatsMatch', h.beatsMatch, true);
        want('silentBadFilm', h.silentBadFilm, false);
        want('movingSlides', h.movingSlides, false);
    }
    h.case.forEach((q, i) => {
        if (q.answer !== 'n/a') want(`case[${i}]`, q.answer, true);
    });
    if ((verdict.needsReview ?? []).length > 0 && !h.notes) missing.push('notes');
    const complete = missing.length === 0;
    return {
        complete,
        missing,
        failed,
        passed: complete ? verdict.oneShot && failed.length === 0 : null,
    };
}

/**
 * A round's results by target, from its evidence files: runs, films
 * delivered, automatic one-shot passes, reviews complete, runs passed
 * (automatic and by eye), and passes by question. `cases` and `runsPerCase`
 * say which rounds can be compared with it.
 */
export function tally(evidences) {
    const byTarget = {};
    for (const evidence of evidences) {
        const name = evidence.target.name;
        byTarget[name] ??= {
            label: evidence.target.label,
            cases: new Set(),
            runs: 0,
            delivered: 0,
            oneShot: 0,
            reviewed: 0,
            passed: 0,
            silentBadFilms: 0,
            movingSlides: 0,
            byQuestion: {},
            toReview: [],
        };
        const t = byTarget[name];
        const outcome = reviewOutcome(evidence);
        const h = evidence.verdict.humanReview;
        t.cases.add(evidence.case);
        t.runs++;
        if (evidence.verdict.delivered) t.delivered++;
        if (evidence.verdict.oneShot) t.oneShot++;
        if (outcome.complete) t.reviewed++;
        else t.toReview.push(`${evidence.case} run ${evidence.run}: ${outcome.missing.join(', ')}`);
        if (outcome.passed) t.passed++;
        if (h.silentBadFilm === true) t.silentBadFilms++;
        if (h.movingSlides === true) t.movingSlides++;
        for (const q of evidence.asks ?? []) {
            t.byQuestion[q] ??= { runs: 0, passed: 0 };
            t.byQuestion[q].runs++;
            if (outcome.passed) t.byQuestion[q].passed++;
        }
    }
    for (const t of Object.values(byTarget)) {
        t.runsPerCase = t.runs / t.cases.size;
        t.cases = [...t.cases].sort();
    }
    return byTarget;
}
