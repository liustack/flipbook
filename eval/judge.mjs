// What a finished workspace shows and the verdict on a run. Reads files
// only, starts nothing and spends nothing, so the rules can be tested on
// their own. The case format is in cases.mjs, the criteria in docs/eval.md.
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { HOST_DIRS } from './cases.mjs';
import { globMatches, listFiles, workspaceReader } from './files.mjs';
import { pageModel } from './page.mjs';

/** What `stock fetch` writes as an entry's id: the picture came with a known license. */
const STOCK_ID = /^(openverse|pexels|pixabay):/;

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Folders whose files the judging code does not read as the agent's work. */
const LEFT_OUT = [...HOST_DIRS, '.flipbook', 'out'];

/** assets/SOURCES.json sorted by where each picture or sound came from. */
function sourcesSummary(dir, reader) {
    const sources = reader.json(join(dir, 'assets', 'SOURCES.json'));
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
function audioFacts(dir, timeline, reader) {
    const audio = timeline?.audio;
    if (audio?.mode !== 'file' || typeof audio.file !== 'string') return null;
    return { file: audio.file, sha256: reader.sha256(resolve(dir, audio.file)) };
}

/** The brand.json timeline.json names, as far as the verdict needs it. */
function brandFacts(dir, timeline, reader) {
    if (typeof timeline?.brand !== 'string') return null;
    const file = resolve(dir, timeline.brand);
    const data = reader.json(file);
    if (!isObject(data)) return { file, readable: false };
    const logo = isObject(data.logo) && typeof data.logo.file === 'string' ? data.logo.file : null;
    const logoFile = logo ? resolve(dirname(file), logo) : null;
    return {
        file,
        readable: true,
        name: data.name ?? null,
        colors: isObject(data.colors) ? data.colors : null,
        logo,
        logoSha256: logoFile ? reader.sha256(logoFile) : null,
    };
}

/** How a file came from a watched workspace file, for the verdict's wording. */
const HOW = {
    original: 'is',
    copy: 'is a copy of',
    claimed: 'has the bytes of',
    fetched: 'has the bytes of',
    cut: 'was cut from',
    named: 'has a SOURCES.json entry that mentions',
    link: 'is a link to',
};

/** Where the page names a file, for the evidence's wording (see page.mjs). */
const WHERE = {
    element: 'an element attribute such as img src',
    attribute: 'another attribute',
    css: 'a CSS url()',
    loader: 'a runtime loader call such as photo()',
    script: 'a string in a script',
};

/** Whether two directories are the same place, following links. */
function sameDir(a, b) {
    try {
        return realpathSync(a) === realpathSync(b);
    } catch {
        return false;
    }
}

/**
 * How sure it is that `stock fetch` brought in the file at `path` of the
 * composition in `dir`, whose SOURCES.json entry is `entry`: `proven` when a
 * stock fetch report that succeeded (`ok` true) names this composition,
 * this file and the entry's id, `claimed` when the entry has a stock id but
 * no such report backs it, `none` when it does not even claim one.
 * `reports` are every stock fetch report the eval kept, one per run of the
 * command, plus the last one saved in the composition.
 */
function stockProof(reports, dir, path, entry) {
    if (!isObject(entry) || !STOCK_ID.test(String(entry.id ?? ''))) return 'none';
    const backed = reports.some(
        (r) =>
            r?.command === 'stock-fetch' &&
            r.ok === true &&
            r.stock?.id === entry.id &&
            r.stock?.file === path &&
            typeof r.composition?.dir === 'string' &&
            sameDir(r.composition.dir, dir),
    );
    return backed ? 'proven' : 'claimed';
}

/**
 * Files in the composition that come from a watched workspace file, as
 * evidence for a person. `how`: the file itself or a link to it, a byte
 * copy (`copy` with no stock id, `claimed` with a stock id no successful
 * stock fetch report backs, `fetched` when one does), a picture cut from one
 * of those, or an entry whose SOURCES.json text mentions the file.
 * `certain` says whether it surely comes from the watched file. `named`
 * lists where the page names it (see page.mjs), `built` whether a path the
 * page builds for a runtime loader could be it. None of this says the page
 * loads it: comments name nothing, and markup or a string may load nothing.
 */
function watchedFiles(dir, wsRoot, watched, page, stockReports, readers) {
    if (watched.length === 0) return [];
    const { reader, outputs } = readers;
    const sources = reader.json(join(dir, 'assets', 'SOURCES.json'));
    const entries = isObject(sources) ? sources : {};
    const saved = outputs.json(join(dir, '.flipbook', 'reports', 'stock-fetch.json'));
    const reports = saved ? [...stockReports, saved] : stockReports;
    const proof = (key) => stockProof(reports, dir, `assets/${key}`, entries[key]);
    const originals = watched.map((w) => {
        try {
            return realpathSync(join(wsRoot, w.rel));
        } catch {
            return null;
        }
    });
    const found = [];
    for (const rel of listFiles(dir, LEFT_OUT, { links: true })) {
        const full = join(dir, rel);
        const wsRel = relative(wsRoot, full).split(sep).join('/');
        const isLink = lstatSync(full).isSymbolicLink();
        const target = reader.real(full);
        if (!target) continue;
        const size = reader.size(full);
        for (const [i, w] of watched.entries()) {
            if (w.rel === wsRel || target === originals[i]) {
                const how = w.rel === wsRel ? 'original' : isLink ? 'link' : 'original';
                found.push({ path: rel, of: w.rel, how, certain: true });
                continue;
            }
            if (w.size !== size || reader.sha256(full) !== w.sha256) continue;
            const stock = rel.startsWith('assets/') ? proof(rel.slice('assets/'.length)) : 'none';
            const how = { proven: 'fetched', claimed: 'claimed', none: 'copy' }[stock];
            found.push({ path: rel, of: w.rel, how, certain: how === 'copy' });
        }
    }
    for (const w of watched) {
        const stem = basename(w.rel).replace(/\.[^.]+$/, '');
        const tainted = new Map();
        for (const f of found) {
            if (f.of === w.rel && f.path.startsWith('assets/'))
                tainted.set(f.path.slice('assets/'.length), f.certain && f.how !== 'fetched');
        }
        for (const [key, entry] of Object.entries(entries)) {
            if (tainted.has(key) || proof(key) === 'proven') continue;
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
    return found.map((f) => ({
        ...f,
        named: page.references?.[f.path] ?? [],
        built: (page.builtPaths ?? []).some((prefix) => f.path.startsWith(prefix)),
    }));
}

/**
 * What a composition directory shows: its video and contact sheet (real
 * paths), flipbook's last reports and frame digest, the timeline and story, a hash of its page scripts, the runtime functions they
 * call, where its pictures came from, its brand, which of the case's files
 * exist, and the files that come from watched workspace files. Everything
 * is read through the workspace reader (files.mjs), and `refused` lists the
 * files it would not read: links out of the workspace, broken links, files
 * in folders left out.
 */
export function inspect(dir, { spec, wsRoot, workspaceFiles, stockReports = [] }) {
    const e = spec.expect;
    const reader = workspaceReader(wsRoot, { leftOut: LEFT_OUT });
    const outputs = workspaceReader(wsRoot, { leftOut: HOST_DIRS });
    const timeline = reader.json(join(dir, 'timeline.json'));
    const { program, files: moduleFiles, texts, ...page } = pageModel(dir, { wsRoot });
    const loaded = [...(moduleFiles ?? new Map())].map(
        ([file, label]) => `${label}\n${texts.get(file)}`,
    );
    const files = listFiles(dir, HOST_DIRS);
    const watched = (e.notCopied ?? []).map((rel) => ({ rel, ...workspaceFiles[rel] }));
    const video = outputs.real(join(dir, 'out', 'video.mp4'));
    const sheet = outputs.real(join(dir, 'out', 'contact-sheet.png'));
    const report = (name) => outputs.json(join(dir, '.flipbook', 'reports', `${name}.json`));
    return {
        video,
        contactSheet: sheet,
        frameDigest: outputs.json(join(dir, '.flipbook', 'frame-hashes.json'))?.digest ?? null,
        lastCheck: report('check'),
        lastSnapshot: report('snapshot'),
        lastRender: report('render'),
        attempts: outputs.json(join(dir, '.flipbook', 'attempts.json')),
        timeline,
        story: reader.json(join(dir, 'story.json')),
        sourceSha256: createHash('sha256').update(loaded.join('\n')).digest('hex'),
        page,
        sources: sourcesSummary(dir, reader),
        brand: brandFacts(dir, timeline, reader),
        audioFile: audioFacts(dir, timeline, reader),
        files: Object.fromEntries(
            (e.files ?? []).map((pattern) => [
                pattern,
                files.some((rel) => globMatches(pattern, rel)),
            ]),
        ),
        watched: watchedFiles(dir, wsRoot, watched, page, stockReports, { reader, outputs }),
        refused: [...new Set([...page.refused, ...reader.refused, ...outputs.refused])],
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
    reasons.push(...usesReasons(e.uses ?? [], c, review));
    for (const [pattern, found] of Object.entries(c.files ?? {})) {
        if (!found) reasons.push(`no file matches ${pattern}`);
    }
    if (e.brand) reasons.push(...brandReasons(e.brand, c.brand, workspaceFiles));
    return reasons;
}

/**
 * Runtime functions the case wants called and the page never calls. When
 * the page hands a wanted function to other code, or the runner could not
 * follow all its scripts, the call may be out of sight: that goes to
 * `review` with the page's notes instead of failing.
 */
function usesReasons(uses, c, review) {
    if (uses.length === 0) return [];
    const page = c.page;
    if (!page?.imports) {
        review.push(
            `${c.dir}: no script index.html loads imports /__flipbook/runtime.js, so expect.uses (${uses.join(', ')}) was not checked`,
        );
        return [];
    }
    const missing = [];
    for (const token of uses) {
        const names = token.split('|');
        if (names.some((name) => page.calls.includes(name))) continue;
        const handed = names.filter((name) => page.passed.includes(name));
        if (handed.length > 0)
            review.push(
                `${c.dir}: the page hands ${handed.join(', ')} to other code instead of calling it where the runner can see. Check the film uses it.`,
            );
        else if (page.notes.length > 0)
            review.push(
                `${c.dir}: no call to ${token} found, but the runner could not follow all the page's scripts (${page.notes.join('. ')}). Check the film uses it.`,
            );
        else missing.push(token);
    }
    return missing.length > 0
        ? [`the scripts index.html loads never call ${missing.join(', ')} from the runtime`]
        : [];
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
 * What a case's `notCopied` files leave in the compositions, listed in
 * `review` as evidence for a person: every file that comes from one (see
 * watchedFiles) with where the page names it, runtime loader calls whose
 * path the runner cannot read, and pictures whose source entry is neither
 * stock fetch nor generated, which could be a watched file re-encoded or
 * cropped. Reading markup and code cannot tell whether the page really
 * loads a file, so none of it fails the run.
 */
function watchedEvidence(e, compositions, review) {
    if ((e.notCopied ?? []).length === 0) return;
    const STOCK = {
        fetched: 'A successful stock fetch of its SOURCES.json id into this file backs it.',
        claimed: 'Its SOURCES.json entry claims a stock id no successful stock fetch report backs.',
    };
    for (const c of compositions) {
        for (const f of c.watched ?? []) {
            const where =
                f.named.length > 0
                    ? `The page names it in ${f.named.map((kind) => WHERE[kind]).join(', ')}.`
                    : f.built
                      ? 'A path the page builds for a runtime loader could be it.'
                      : 'Nothing the runner read in the page names it.';
            review.push(
                [
                    `${c.dir}/${f.path} ${HOW[f.how]} ${f.of}, whose source is unknown.`,
                    STOCK[f.how],
                    where,
                    'Check whether the film shows it.',
                ]
                    .filter(Boolean)
                    .join(' '),
            );
        }
        const computed = c.page?.computedPaths ?? 0;
        if (computed > 0)
            review.push(
                `${c.dir}: ${computed} runtime loader call(s) get a path the runner cannot read. Check none of them is ${e.notCopied.join(' or ')}.`,
            );
        const other = c.sources?.other ?? [];
        if (other.length > 0)
            review.push(
                `${c.dir}: assets/SOURCES.json lists ${other.join(', ')} with a source that is neither stock fetch nor generated. Check none of them is ${e.notCopied.join(' or ')} re-encoded or cropped.`,
            );
    }
}

/**
 * The verdict on one run. `delivered`: exactly one composition with a video
 * that passed acceptance. `oneShot`: the run met everything the case checks
 * automatically, with nobody stepping in. A case whose film is optional
 * passes without a film. `needsReview` lists
 * what the runner could not settle from the files, starting with `runNotes`
 * about the run itself, and `humanReview` is
 * left for a person to fill in.
 */
export function judge(spec, { host, compositions, workspaceFiles, runNotes = [] }) {
    const e = spec.expect;
    const reasons = [];
    const needsReview = [...runNotes];
    if (host.timedOut) reasons.push('host timed out');
    else if (host.exitCode !== 0) reasons.push(`host exited ${host.exitCode}`);
    for (const c of compositions) {
        for (const line of c.refused ?? [])
            needsReview.push(`${c.dir}: ${line}. Check the film does not depend on it.`);
    }
    watchedEvidence(e, compositions, needsReview);
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
    const review = [...new Set(needsReview)];
    return {
        delivered,
        oneShot: reasons.length === 0,
        reasons,
        needsReview: review,
        story,
        humanReview: {
            retold: null,
            turnOnScreen: null,
            beatsMatch: null,
            case: e.review.map((question) => ({ question, answer: null })),
            settle: review.map((item) => ({ item, ok: null, note: '' })),
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
 * one `settle` entry for each item in `needsReview`, the source of what must
 * be answered: its `item` the item's text, its `ok` true when a person finds
 * it fine and false when not. A missing `settle`, an item without its entry
 * or with two, an `ok` that is not true or false, and an entry that matches
 * no item all leave the review incomplete. `passed`: an automatic one-shot
 * pass whose review is complete and clean, null until the review is
 * complete.
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
    const items = verdict.needsReview;
    if (!Array.isArray(items)) {
        missing.push('needsReview (the evidence has none to check settle against)');
    } else if (items.length > 0 && !Array.isArray(h.settle)) {
        missing.push('settle');
    } else {
        const entries = Array.isArray(h.settle) ? h.settle : [];
        items.forEach((item, i) => {
            const answers = entries.filter((entry) => isObject(entry) && entry.item === item);
            const name = `settle for needsReview[${i}]`;
            if (answers.length === 0) missing.push(name);
            else if (answers.length > 1) missing.push(`${name}, given ${answers.length} times`);
            else if (typeof answers[0].ok !== 'boolean') missing.push(`${name}, ok`);
            else if (!answers[0].ok) failed.push(name);
        });
        entries.forEach((entry, k) => {
            if (!isObject(entry) || !items.includes(entry.item))
                missing.push(`settle[${k}], which matches no needsReview item`);
        });
    }
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
 * (automatic and by eye), and passes by question. `runsByCase` counts the
 * runs of each case, `even` is true when every case ran as often, and
 * `repeated` lists a case and run number that came twice: they say which
 * rounds can be compared with this one.
 */
export function tally(evidences) {
    const byTarget = {};
    for (const evidence of evidences) {
        const name = evidence.target.name;
        byTarget[name] ??= {
            label: evidence.target.label,
            runsByCase: {},
            seen: new Set(),
            repeated: [],
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
        t.runsByCase[evidence.case] = (t.runsByCase[evidence.case] ?? 0) + 1;
        const key = `${evidence.case} run ${evidence.run}`;
        if (t.seen.has(key)) t.repeated.push(key);
        t.seen.add(key);
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
        delete t.seen;
        t.runsByCase = Object.fromEntries(Object.entries(t.runsByCase).sort());
        t.even = new Set(Object.values(t.runsByCase)).size === 1;
    }
    return byTarget;
}
