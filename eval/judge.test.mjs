import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { inspect, judge, sha256File, sourceUses } from './judge.mjs';

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

/** A workspace holding one finished composition in film/, with the reports a clean run leaves. */
function finishedRun(spec, { files = {}, workspace = {}, warnings = [] } = {}) {
    const ws = mkdtempSync(join(tmpdir(), 'flipbook-judge-'));
    temps.push(ws);
    const workspaceFiles = {};
    for (const [rel, content] of Object.entries(workspace)) {
        const file = write(ws, rel, content);
        workspaceFiles[rel] = { size: Buffer.byteLength(content), sha256: sha256File(file) };
    }
    const dir = join(ws, 'film');
    write(dir, 'timeline.json', { version: 1, bpm: 96, audio: { mode: 'score' } });
    write(dir, 'story.json', STORY);
    write(dir, 'index.html', '<script type="module">paperLayer(1, 2); puppet({});</script>');
    for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
    const composition = {
        dir: 'film',
        video: join(dir, 'out', 'video.mp4'),
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
        const spec = baseCase({ uses: ['puppet(', 'paperLayer(|drawPaper('] });
        const { composition, workspaceFiles } = finishedRun(spec);
        const verdict = judge(spec, { host: HOST_OK, compositions: [composition], workspaceFiles });
        expect(verdict.reasons).toEqual([]);
        expect(verdict.delivered).toBe(true);
        expect(verdict.oneShot).toBe(true);
        expect(verdict.story).toMatchObject({
            beats: 3,
            roles: ['opening', 'turn', 'resolution'],
        });
        expect(composition.features).toEqual(['paper', 'puppet']);
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
            uses: ['riso('],
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
            'the source never calls riso(',
            'no file matches assets/sprites/*/clips.json',
        ]);
    });

    it('tells a call from the tail of a longer name', () => {
        expect(sourceUses('const g = pixel(320, 180);', 'pixel(')).toBe(true);
        expect(sourceUses('pixelArt(rows); toPixel(3);', 'pixel(')).toBe(false);
        expect(sourceUses('drawPaper(ctx)', 'paperLayer(|drawPaper(')).toBe(true);
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

    it('fails a film that uses a picture of unknown source, copied or referred to', () => {
        const plate = 'not really a plate';
        const spec = baseCase(
            { film: 'optional', audio: 'any', notCopied: ['downloads/f3a9c1e7.jpg'] },
            { workspace: { 'downloads/f3a9c1e7.jpg': { generator: 'repo', from: 'x' } } },
        );
        const copied = finishedRun(spec, {
            workspace: { 'downloads/f3a9c1e7.jpg': plate },
            files: {
                'assets/shells.jpg': plate,
                'assets/SOURCES.json': { 'shells.jpg': { source: 'the user', license: 'unknown' } },
            },
        });
        expect(copied.composition.copies).toEqual([
            { path: 'assets/shells.jpg', of: 'downloads/f3a9c1e7.jpg', fetched: false },
        ]);
        expect(
            judge(spec, {
                host: HOST_OK,
                compositions: [copied.composition],
                workspaceFiles: copied.workspaceFiles,
            }).reasons,
        ).toEqual([
            'film/assets/shells.jpg is a copy of downloads/f3a9c1e7.jpg, whose source is unknown',
        ]);

        const referred = finishedRun(spec, {
            workspace: { 'downloads/f3a9c1e7.jpg': plate },
            files: { 'scene.js': "photo('assets/f3a9c1e7.png')" },
        });
        expect(
            judge(spec, {
                host: HOST_OK,
                compositions: [referred.composition],
                workspaceFiles: referred.workspaceFiles,
            }).reasons,
        ).toEqual(['film refers to downloads/f3a9c1e7.jpg']);
    });

    it('accepts the same picture when stock fetch brought it in with its license', () => {
        const plate = 'a public domain plate';
        const spec = baseCase(
            { film: 'optional', audio: 'any', notCopied: ['downloads/f3a9c1e7.jpg'] },
            { workspace: { 'downloads/f3a9c1e7.jpg': { generator: 'repo', from: 'x' } } },
        );
        const { composition, workspaceFiles } = finishedRun(spec, {
            workspace: { 'downloads/f3a9c1e7.jpg': plate },
            files: {
                'assets/shells.jpg': plate,
                'assets/SOURCES.json': {
                    'shells.jpg': {
                        source: 'https://example.org/1',
                        license: 'pdm',
                        id: 'openverse:1',
                    },
                },
            },
        });
        const verdict = judge(spec, { host: HOST_OK, compositions: [composition], workspaceFiles });
        expect(verdict.reasons).toEqual([]);
        expect(composition.sources).toEqual({
            stock: ['shells.jpg'],
            cut: 0,
            generated: [],
            other: [],
        });
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
