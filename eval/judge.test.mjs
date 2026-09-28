import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { sha256File } from './files.mjs';
import { inspect, judge, reviewOutcome, tally } from './judge.mjs';

const temps = [];
afterAll(() => {
    for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function write(root, rel, content) {
    const file = join(root, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
    return file;
}

const STORY = {
    version: 1,
    idea: 'an old man waits for pigeons that do not come',
    leave: 'the waiting was the point',
    subject: 'the old man',
    device: { what: 'one bench', why: 'the bench stays, the day changes' },
    beats: [
        { id: 'feed', role: 'opening', at: 'a', change: { from: 'crumbs', to: 'pigeons' } },
        { id: 'empty', role: 'turn', at: 'b', change: { from: 'crumbs', to: 'no pigeons' } },
        { id: 'back', role: 'resolution', at: 'c', change: { from: 'a pigeon', to: 'many' } },
    ],
};

function baseCase(expect = {}, extra = {}) {
    return {
        id: 'pigeons',
        title: '喂鸽子',
        asks: ['story', 'film'],
        prompt: '做一条短片',
        ...extra,
        expect: {
            durationSec: [28.5, 31.5],
            width: 1920,
            height: 1080,
            audio: 'score',
            review: ['老人是纸偶'],
            ...expect,
        },
    };
}

/**
 * A workspace holding one finished composition, in film/ unless `at` says
 * otherwise ('.' is the workspace root), with the reports a clean run leaves,
 * and a video unless `video` is false.
 */
function finishedRun(
    spec,
    { files = {}, workspace = {}, warnings = [], at = 'film', video = true } = {},
) {
    const ws = mkdtempSync(join(tmpdir(), 'flipbook-judge-'));
    temps.push(ws);
    const workspaceFiles = {};
    for (const [rel, content] of Object.entries(workspace)) {
        const file = write(ws, rel, content);
        workspaceFiles[rel] = { size: Buffer.byteLength(content), sha256: sha256File(file) };
    }
    const dir = join(ws, at);
    write(dir, 'timeline.json', { version: 1, bpm: 96, audio: { mode: 'score' } });
    write(dir, 'story.json', STORY);
    write(
        dir,
        'index.html',
        `<script type="module">
import { paperLayer, puppet } from '/__flipbook/runtime.js';
paperLayer(1, 2);
puppet({});
</script>`,
    );
    for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
    const composition = {
        dir: at,
        video: video ? join(dir, 'out', 'video.mp4') : null,
        probe: { durationSec: 30, width: 1920, height: 1080, audio: 'aac' },
        lastCheck: { ok: true },
        lastRender: { ok: true, warnings },
        recheck: { exitCode: 0 },
        ...inspect(dir, { spec, wsRoot: ws, workspaceFiles }),
    };
    return { ws, dir, workspaceFiles, composition };
}

const HOST_OK = { exitCode: 0, timedOut: false };

describe('eval verdict', () => {
    it('passes a film that meets every expectation', () => {
        const spec = baseCase({ uses: ['puppet', 'paperLayer|drawPaper'] });
        const { composition, workspaceFiles } = finishedRun(spec);
        const verdict = judge(spec, { host: HOST_OK, compositions: [composition], workspaceFiles });
        expect(verdict.reasons).toEqual([]);
        expect(verdict.delivered).toBe(true);
        expect(verdict.oneShot).toBe(true);
        expect(verdict.story).toMatchObject({
            beats: 3,
            roles: ['opening', 'turn', 'resolution'],
        });
        expect(composition.page).toEqual({
            entries: ['index.html#1'],
            modules: ['index.html#1'],
            imports: true,
            calls: ['paperLayer', 'puppet'],
            passed: [],
            notes: [],
        });
        expect(verdict.humanReview.case).toEqual([{ question: '老人是纸偶', answer: null }]);
    });

    it('fails a delivered film whose video shows no change in a beat', () => {
        const spec = baseCase();
        const { composition, workspaceFiles } = finishedRun(spec, {
            warnings: [{ code: 'story-static-beat', detail: { beat: 'empty' } }],
        });
        const verdict = judge(spec, { host: HOST_OK, compositions: [composition], workspaceFiles });
        expect(verdict.delivered).toBe(true);
        expect(verdict.oneShot).toBe(false);
        expect(verdict.reasons).toEqual([
            'beat empty shows no change in the video (story-static-beat)',
        ]);
        expect(verdict.story.staticBeats).toEqual(['empty']);
    });

    it('names runtime calls, files, audio and timeline values the case asks for and the film lacks', () => {
        const spec = baseCase({
            audio: 'file',
            uses: ['riso'],
            files: ['assets/sprites/*/clips.json', 'assets/puppets/*/rig.json'],
            timeline: { bpm: 100 },
        });
        const { composition, workspaceFiles } = finishedRun(spec, {
            files: { 'assets/puppets/man/rig.json': {} },
        });
        const verdict = judge(spec, { host: HOST_OK, compositions: [composition], workspaceFiles });
        expect(verdict.reasons).toEqual([
            'timeline audio.mode is "score", expected file',
            'timeline bpm is 96, expected 100',
            'the scripts index.html loads never call riso from the runtime',
            'no file matches assets/sprites/*/clips.json',
        ]);
    });

    it('leaves uses to a person when no script the page loads imports the runtime', () => {
        const spec = baseCase({ uses: ['riso'] });
        const { composition, workspaceFiles } = finishedRun(spec, {
            files: { 'index.html': '<script type="module">riso(1, 2);</script>' },
        });
        const verdict = judge(spec, { host: HOST_OK, compositions: [composition], workspaceFiles });
        expect(verdict.reasons).toEqual([]);
        expect(verdict.needsReview).toEqual([
            'film: no script index.html loads imports /__flipbook/runtime.js, so expect.uses (riso) was not checked',
        ]);
    });

    it('asks a person, not fails, when a wanted function may be called out of sight', () => {
        const spec = baseCase({ uses: ['riso', 'photo'] });
        const { composition, workspaceFiles } = finishedRun(spec, {
            files: {
                'index.html': `<script type="module">
import { riso, photo } from '/__flipbook/runtime.js';
let print = riso;
print(1, 2);
await import('./' + 'scene.js');
</script>`,
            },
        });
        const verdict = judge(spec, { host: HOST_OK, compositions: [composition], workspaceFiles });
        expect(verdict.reasons).toEqual([]);
        expect(verdict.needsReview).toEqual([
            'film: the page hands riso to other code instead of calling it where the runner can see. Check the film uses it.',
            "film: no call to photo found, but the runner could not follow all the page's scripts (index.html#1 imports a module by a path it computes, not followed). Check the film uses it.",
        ]);
    });

    it('fails a film whose only call to a wanted function is in a script the page does not load', () => {
        const spec = baseCase({ uses: ['riso'] });
        const { composition, workspaceFiles } = finishedRun(spec, {
            files: { 'draft.js': "import { riso } from '/__flipbook/runtime.js';\nriso(1, 2);" },
        });
        const verdict = judge(spec, { host: HOST_OK, compositions: [composition], workspaceFiles });
        expect(verdict.reasons).toEqual([
            'the scripts index.html loads never call riso from the runtime',
        ]);
    });

    it('lets a case whose film is optional pass without a film', () => {
        const spec = baseCase({ film: 'optional', audio: 'any' });
        const verdict = judge(spec, { host: HOST_OK, compositions: [], workspaceFiles: {} });
        expect(verdict).toMatchObject({ delivered: false, oneShot: true, reasons: [] });
    });

    it('fails a run whose host timed out even when the film is optional', () => {
        const spec = baseCase({ film: 'optional', audio: 'any' });
        const verdict = judge(spec, {
            host: { exitCode: null, timedOut: true },
            compositions: [],
            workspaceFiles: {},
        });
        expect(verdict.reasons).toEqual(['host timed out']);
    });

    it('checks the brand against the workspace: name, primary, no invented colors, the same logo', () => {
        const spec = baseCase(
            {
                brand: {
                    name: '潮汐茶室',
                    primary: '#1f6f78',
                    palette: ['#1f6f78', '#e0a94a'],
                    logo: 'site/logo.svg',
                },
            },
            { workspace: { 'site/logo.svg': { generator: 'copy', from: 'files/logo.svg' } } },
        );
        const brandJson = {
            version: 1,
            name: '潮汐茶室',
            logo: { file: 'assets/logo.svg', license: 'owned' },
            colors: { primary: '#1F6F78', secondary: '#e0a94a', paper: '#ffffff' },
        };
        const { composition, workspaceFiles } = finishedRun(spec, {
            workspace: { 'site/logo.svg': '<svg/>' },
            files: {
                'timeline.json': { version: 1, audio: { mode: 'score' }, brand: '../brand.json' },
                '../brand.json': brandJson,
                '../assets/logo.svg': '<svg></svg>',
            },
        });
        const verdict = judge(spec, { host: HOST_OK, compositions: [composition], workspaceFiles });
        expect(verdict.reasons).toEqual([
            "brand color paper #ffffff is not one of the workspace's colors",
            "brand logo assets/logo.svg is not the workspace's site/logo.svg",
        ]);
    });
});

describe('eval verdict on a picture of unknown source', () => {
    const PLATE = 'downloads/f3a9c1e7.jpg';
    const BYTES = 'the bytes of an old plate';
    const spec = baseCase(
        { film: 'optional', audio: 'any', notCopied: [PLATE] },
        { workspace: { [PLATE]: { generator: 'repo', from: 'x' } } },
    );
    const page = (code) =>
        `<script type="module">\nimport { photo } from '/__flipbook/runtime.js';\n${code}\n</script>`;
    const verdictOf = (run) =>
        judge(spec, {
            host: HOST_OK,
            compositions: [run.composition],
            workspaceFiles: run.workspaceFiles,
        });

    it('does not count an explanation that leaves it out, in a comment, the story or the page', () => {
        const run = finishedRun(spec, {
            video: false,
            workspace: { [PLATE]: BYTES },
            files: {
                'index.html': page(
                    `// ${PLATE} is left out: its source and license are unknown\nphoto('assets/crab.svg');`,
                ),
                'notes.css': `/* not ${PLATE} */`,
                'story.json': { ...STORY, idea: `a hermit crab, drawn in code, not ${PLATE}` },
            },
        });
        expect(run.composition.watched).toEqual([]);
        const verdict = verdictOf(run);
        expect(verdict).toMatchObject({ oneShot: true, reasons: [], needsReview: [] });
    });

    it('fails a film that uses a copy, a picture cut from it, or the file itself', () => {
        const copied = finishedRun(spec, {
            workspace: { [PLATE]: BYTES },
            files: {
                'assets/shells.jpg': BYTES,
                'assets/cut/shells/shells-01.png': 'a cut shell',
                'assets/SOURCES.json': {
                    'shells.jpg': { source: 'the user', license: 'unknown' },
                    'cut/shells/shells-01.png': {
                        source: 'the user',
                        license: 'unknown',
                        cutFrom: 'shells.jpg',
                    },
                },
                'index.html': page("photo('./assets/cut/shells/shells-01.png');"),
            },
        });
        expect(copied.composition.watched).toEqual([
            {
                path: 'assets/shells.jpg',
                of: PLATE,
                how: 'copy',
                certain: true,
                referenced: 'none',
            },
            {
                path: 'assets/cut/shells/shells-01.png',
                of: PLATE,
                how: 'cut',
                certain: true,
                referenced: 'exact',
            },
        ]);
        const verdict = verdictOf(copied);
        expect(verdict.reasons).toEqual([
            `film/assets/cut/shells/shells-01.png was cut from ${PLATE}, whose source is unknown. The page uses it.`,
        ]);
        expect(verdict.needsReview).toEqual([
            `film/assets/shells.jpg is a copy of ${PLATE}, whose source is unknown. No page, script or stylesheet names it. Check by eye that the film does not show it.`,
            'film: assets/SOURCES.json lists shells.jpg with a source that is neither stock fetch nor generated. Check none of them is downloads/f3a9c1e7.jpg re-encoded or cropped.',
        ]);

        const inRoot = finishedRun(spec, {
            at: '.',
            workspace: { [PLATE]: BYTES },
            files: { 'index.html': page(`photo('/${PLATE}');`) },
        });
        expect(verdictOf(inRoot).reasons).toEqual([
            `./${PLATE} is ${PLATE}, whose source is unknown. The page uses it.`,
        ]);
    });

    it('accepts the same picture fetched again with stock fetch, and asks about a claim with no fetch behind it', () => {
        const entry = {
            source: 'https://www.flickr.com/photos/37667416@N04/3816619629',
            license: 'pdm',
            id: 'openverse:16a349f0-f0cc-4d2d-892a-0106ea6429e4',
            url: 'https://live.staticflickr.com/2527/3816619629_055f882867_b.jpg',
        };
        const files = {
            'assets/shells.jpg': BYTES,
            'assets/SOURCES.json': { 'shells.jpg': entry },
            'index.html': page("photo('assets/shells.jpg');"),
        };
        const fetched = finishedRun(spec, {
            workspace: { [PLATE]: BYTES },
            files: { ...files, '.flipbook/reports/stock-fetch.json': { ok: true } },
        });
        expect(fetched.composition.watched).toEqual([]);
        expect(verdictOf(fetched)).toMatchObject({ oneShot: true, reasons: [], needsReview: [] });

        const claimed = finishedRun(spec, { workspace: { [PLATE]: BYTES }, files });
        const verdict = verdictOf(claimed);
        expect(verdict.reasons).toEqual([]);
        expect(verdict.needsReview).toEqual([
            `film/assets/shells.jpg has the bytes of ${PLATE}, whose source is unknown. The page names it. Check by eye that the film does not show it.`,
        ]);
    });

    it('asks a person about names built from pieces and entries that only mention the file', () => {
        const run = finishedRun(spec, {
            workspace: { [PLATE]: BYTES },
            files: {
                'assets/crab.svg': '<svg/>',
                'assets/shells.jpg': BYTES,
                'assets/SOURCES.json': {
                    'crab.svg': {
                        source: `drawn for this film in place of ${PLATE}`,
                        license: 'cc0',
                    },
                    'shells.jpg': { source: 'the user', license: 'unknown' },
                },
                'index.html': page(
                    "const n = 'shells';\nphoto(`assets/${n}.jpg`);\nphoto('assets/crab.svg');",
                ),
            },
        });
        const verdict = verdictOf(run);
        expect(verdict.reasons).toEqual([]);
        expect(verdict.needsReview.slice(0, 2)).toEqual([
            `film/assets/shells.jpg is a copy of ${PLATE}, whose source is unknown. The page builds a file name that could be it. Check by eye that the film does not show it.`,
            `film/assets/crab.svg has a SOURCES.json entry that mentions ${PLATE}, whose source is unknown. The page names it. Check by eye that the film does not show it.`,
        ]);
    });
});

describe('eval verdict on the user music', () => {
    const MUSIC = 'assets/music.wav';
    const BYTES = 'the user music';
    const spec = baseCase(
        { audio: 'file', audioFile: MUSIC },
        { workspace: { [MUSIC]: { generator: 'clicks', bpm: 96, offsetSec: 0.5, seconds: 30 } } },
    );
    const run = (file, content) =>
        finishedRun(spec, {
            workspace: { [MUSIC]: BYTES },
            files: {
                'timeline.json': { version: 1, audio: { mode: 'file', file, bpmOffset: 0.5 } },
                [file]: content,
            },
        });
    const reasons = ({ composition, workspaceFiles }) =>
        judge(spec, { host: HOST_OK, compositions: [composition], workspaceFiles }).reasons;

    it('passes the user file copied in, or copied under another name', () => {
        expect(reasons(run('assets/music.wav', BYTES))).toEqual([]);
        expect(reasons(run('assets/seasons-theme.wav', BYTES))).toEqual([]);
    });

    it('fails another piece of music in its place', () => {
        expect(reasons(run('assets/unrelated.wav', 'some other music'))).toEqual([
            'the timeline plays assets/unrelated.wav, whose bytes differ from assets/music.wav',
        ]);
    });

    it('fails a timeline that names a file that is not there, or plays no file at all', () => {
        const missing = run('assets/music.wav', BYTES);
        rmSync(join(missing.ws, 'film', 'assets', 'music.wav'));
        missing.composition.audioFile = inspect(join(missing.ws, 'film'), {
            spec,
            wsRoot: missing.ws,
            workspaceFiles: missing.workspaceFiles,
        }).audioFile;
        expect(reasons(missing)).toEqual([
            'the timeline plays assets/music.wav, which is not a file',
        ]);
        const scored = finishedRun(spec, { workspace: { [MUSIC]: BYTES } });
        expect(reasons(scored)).toEqual([
            'timeline audio.mode is "score", expected file',
            'the timeline plays no music file, expected assets/music.wav',
        ]);
    });
});

/** Evidence as the runner writes it, with a review filled in by `review`. */
function evidenceOf({
    name = 'waiting',
    run = 1,
    film = true,
    oneShot = true,
    review = {},
    needsReview = [],
}) {
    return {
        case: name,
        run,
        asks: ['story', 'film'],
        target: { name: 'flagship', label: 'Claude Opus 5.5' },
        compositions: film ? [{ video: '/x/video.mp4' }] : [],
        verdict: {
            delivered: film,
            oneShot,
            reasons: oneShot ? [] : ['host exited 1'],
            needsReview,
            humanReview: {
                retold: null,
                turnOnScreen: null,
                beatsMatch: null,
                case: [
                    { question: 'q1', answer: null },
                    { question: 'q2', answer: null },
                ],
                silentBadFilm: null,
                movingSlides: null,
                notes: '',
                ...review,
            },
        },
    };
}

const CLEAN = {
    retold: 'an old man waits, and one pigeon comes back',
    turnOnScreen: true,
    beatsMatch: true,
    silentBadFilm: false,
    movingSlides: false,
    case: [
        { question: 'q1', answer: true },
        { question: 'q2', answer: 'n/a' },
    ],
};

describe('human review', () => {
    it('passes a run only when it passed automatically and every item that applies is answered well', () => {
        expect(reviewOutcome(evidenceOf({ review: CLEAN }))).toEqual({
            complete: true,
            missing: [],
            failed: [],
            passed: true,
        });
        expect(reviewOutcome(evidenceOf({ oneShot: false, review: CLEAN })).passed).toBe(false);
        expect(
            reviewOutcome(
                evidenceOf({ review: { ...CLEAN, beatsMatch: false, movingSlides: true } }),
            ),
        ).toMatchObject({ complete: true, failed: ['beatsMatch', 'movingSlides'], passed: false });
    });

    it('waits for every answer, and for notes on what the runner left to a person', () => {
        const half = reviewOutcome(
            evidenceOf({ review: { turnOnScreen: true }, needsReview: ['x'] }),
        );
        expect(half).toEqual({
            complete: false,
            missing: [
                'retold',
                'beatsMatch',
                'silentBadFilm',
                'movingSlides',
                'case[0]',
                'case[1]',
                'notes',
            ],
            failed: [],
            passed: null,
        });
    });

    it('asks only the case questions of a run that made no film', () => {
        const outcome = reviewOutcome(
            evidenceOf({
                film: false,
                review: {
                    case: [
                        { question: 'q1', answer: true },
                        { question: 'q2', answer: false },
                    ],
                },
            }),
        );
        expect(outcome).toEqual({
            complete: true,
            missing: [],
            failed: ['case[1]'],
            passed: false,
        });
    });

    it('counts a round by target and question, and lists what is left to review', () => {
        const byTarget = tally([
            evidenceOf({ name: 'waiting', review: CLEAN }),
            evidenceOf({ name: 'pigeons', oneShot: false, review: CLEAN }),
            evidenceOf({ name: 'riso-blackout' }),
        ]);
        expect(byTarget.flagship).toMatchObject({
            cases: ['pigeons', 'riso-blackout', 'waiting'],
            runsPerCase: 1,
            runs: 3,
            delivered: 3,
            oneShot: 2,
            reviewed: 2,
            passed: 1,
            byQuestion: { story: { runs: 3, passed: 1 }, film: { runs: 3, passed: 1 } },
        });
        expect(byTarget.flagship.toReview).toEqual([
            'riso-blackout run 1: retold, turnOnScreen, beatsMatch, silentBadFilm, movingSlides, case[0], case[1]',
        ]);
    });

    it('prints the tally of a results directory and writes tally.json there', () => {
        const dir = mkdtempSync(join(tmpdir(), 'flipbook-tally-'));
        temps.push(dir);
        write(dir, 'waiting--flagship--run1.json', evidenceOf({ review: CLEAN }));
        write(dir, 'pigeons--flagship--run1.json', evidenceOf({ name: 'pigeons' }));
        write(dir, 'summary-1.json', { rows: [] });
        const result = spawnSync(
            process.execPath,
            [join(dirname(fileURLToPath(import.meta.url)), 'run.mjs'), '--tally', dir],
            { encoding: 'utf-8' },
        );
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('delivered 2, one-shot 2, reviewed 1, passed 1');
        expect(result.stdout).toContain('to review: pigeons run 1');
        expect(JSON.parse(readFileSync(join(dir, 'tally.json'), 'utf-8')).flagship.runs).toBe(2);
    });
});

describe('eval verdict on the recheck copy', () => {
    const spec = baseCase();
    const verdictWith = (recheck) => {
        const { composition, workspaceFiles } = finishedRun(spec);
        return judge(spec, {
            host: HOST_OK,
            compositions: [{ ...composition, recheck }],
            workspaceFiles,
        });
    };
    const LINK =
        'film/plate.jpg is a link out of the workspace, to /x/plate.jpg, left out of the recheck copy';

    it('fails a film whose recheck fails on a faithful copy', () => {
        const verdict = verdictWith({ exitCode: 1, notes: [] });
        expect(verdict.reasons).toEqual(['independent check exited 1']);
        expect(verdict.delivered).toBe(false);
    });

    it('asks a person when the copy left links out, and does not fail the film for it', () => {
        const passed = verdictWith({ exitCode: 0, notes: [LINK] });
        expect(passed.reasons).toEqual([]);
        expect(passed.needsReview).toEqual([`film: ${LINK}. Check the film does not need it.`]);
        const failed = verdictWith({ exitCode: 1, notes: [LINK] });
        expect(failed.reasons).toEqual([]);
        expect(failed.needsReview).toEqual([
            `film: ${LINK}. Check the film does not need it.`,
            'film: independent check exited 1 on a copy that left out the links above. Check whether the film fails without them or for another reason.',
        ]);
    });
});
