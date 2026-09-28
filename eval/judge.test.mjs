import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { sha256File } from './files.mjs';
import { inspect, judge } from './judge.mjs';

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
        expect(composition.runtime).toEqual({ imports: true, calls: ['paperLayer', 'puppet'] });
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
            'the page scripts never call riso from the runtime',
            'no file matches assets/sprites/*/clips.json',
        ]);
    });

    it('leaves uses to a person when no page script imports the runtime', () => {
        const spec = baseCase({ uses: ['riso'] });
        const { composition, workspaceFiles } = finishedRun(spec, {
            files: { 'index.html': '<script type="module">riso(1, 2);</script>' },
        });
        const verdict = judge(spec, { host: HOST_OK, compositions: [composition], workspaceFiles });
        expect(verdict.reasons).toEqual([]);
        expect(verdict.needsReview).toEqual([
            'no page script imports /__flipbook/runtime.js, so expect.uses (riso) was not checked',
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
