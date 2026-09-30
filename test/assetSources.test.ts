// Where the pictures under assets/ came from: every one needs a source and a
// license, and a generated one the tool and prompt that made it.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../src/cli/check.ts';
import { runRender } from '../src/cli/render.ts';
import {
    cutEntry,
    pictureSourceFindings,
    putSources,
    sourceProblem,
} from '../src/engine/assetSources.ts';
import { loadTimeline } from '../src/engine/timeline.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps, codes, copyFixture, TEST_SEEK_TIMEOUT_MS } from './helpers.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

describe('picture sources', () => {
    it('needs source and license, and a tool and prompt for a generated picture', () => {
        const one = (entry: unknown) => sourceProblem({ 'a.png': entry }, 'a.png');
        expect(one({ source: 'Rijksmuseum', license: 'cc0' })).toBeNull();
        expect(one(undefined)).toBe('has no entry');
        expect(one({ license: 'cc0' })).toBe('has no source');
        expect(one({ source: 'me', license: 'generated', prompt: 'a cat' })).toBe(
            'is generated but names no tool',
        );
        expect(one({ source: 'me', license: 'generated', tool: 'Codex' })).toBe(
            'is generated but gives no prompt',
        );
        expect(
            one({ source: 'me', license: 'generated', tool: 'Codex', prompt: 'a cat' }),
        ).toBeNull();
    });

    it('finds the tool and prompt of a cut piece on the plate it was cut from', () => {
        const plate = { source: 'me', license: 'generated', tool: 'Codex', prompt: 'a cat' };
        const piece = { source: 'me', license: 'generated', cutFrom: 'sheet.png' };
        const part = { source: 'me', license: 'generated', cutFrom: 'cut/sheet-01.png' };
        const sources = { 'sheet.png': plate, 'cut/sheet-01.png': piece, 'part.png': part };
        expect(sourceProblem(sources, 'part.png')).toBeNull();
        expect(
            sourceProblem({ ...sources, 'sheet.png': { ...plate, prompt: '' } }, 'part.png'),
        ).toBe('is generated but gives no prompt');
        expect(sourceProblem({ 'cut/sheet-01.png': piece }, 'cut/sheet-01.png')).toBe(
            'is cut from sheet.png, which has no entry of its own',
        );
        const loop = { source: 'me', license: 'generated', cutFrom: 'b.png' };
        expect(
            sourceProblem({ 'a.png': loop, 'b.png': { ...loop, cutFrom: 'a.png' } }, 'a.png'),
        ).toBe('is cut from a.png, which leads back to itself');
    });

    it('leaves fonts and a picture licensed elsewhere alone, and names every other picture without an entry', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flipbook-sources-'));
        try {
            fs.mkdirSync(path.join(dir, 'assets', 'fonts'), { recursive: true });
            for (const f of ['logo.svg', 'fonts/specimen.png', 'plate.png', 'notes.txt']) {
                fs.writeFileSync(path.join(dir, 'assets', f), 'x');
            }
            const logo = fs.realpathSync(path.join(dir, 'assets', 'logo.svg'));
            expect(pictureSourceFindings(dir, [logo]).map((f) => f.element)).toEqual([
                'assets/plate.png',
            ]);
            expect(pictureSourceFindings(dir).map((f) => f.element)).toEqual([
                'assets/logo.svg',
                'assets/plate.png',
            ]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('one spelling for every reader of assets/SOURCES.json', () => {
    const cc0 = { source: 'https://example.org/a', license: 'cc0' };
    const made = { source: 'me', license: 'generated', tool: 'Codex', prompt: 'a red square' };

    it('finds an entry and the plate it was cut from under any spelling, own keys only', () => {
        expect(sourceProblem({ './a.png': cc0 }, 'a.png')).toBeNull();
        expect(sourceProblem({ 'a.png': cc0 }, 'sub/../a.png')).toBeNull();
        const leaf = { source: 'me', license: 'generated', cutFrom: './root.png' };
        expect(sourceProblem({ 'root.png': made, 'leaf.png': leaf }, 'leaf.png')).toBeNull();
        expect(sourceProblem({}, 'toString')).toBe('has no entry');
        expect(sourceProblem({ 'leaf.png': { ...leaf, cutFrom: 'constructor' } }, 'leaf.png')).toBe(
            'is cut from constructor, which has no entry of its own',
        );
    });

    it('refuses two keys for one file, never picking one of them', () => {
        const twice = { 'a.png': cc0, './a.png': { source: 'other', license: 'cc-by' } };
        expect(sourceProblem(twice, 'a.png')).toBe('has 2 entries ("a.png", "./a.png")');
        const leaf = { source: 'me', license: 'generated', cutFrom: 'a.png' };
        expect(sourceProblem({ ...twice, 'leaf.png': leaf }, 'leaf.png')).toBe(
            'is cut from a.png, which has 2 entries ("a.png", "./a.png")',
        );
        // A key or cutFrom that is no path inside assets/ names no file.
        expect(sourceProblem({ 'a\u0000.png': cc0 }, 'a.png')).toBe('has no entry');
        expect(sourceProblem({ 'leaf.png': { ...leaf, cutFrom: '../a.png' } }, 'leaf.png')).toBe(
            'is cut from ../a.png, which is not a path inside assets/',
        );
    });

    it("writes its own entries in the one spelling and leaves the user's keys as written", () => {
        const current: Record<string, unknown> = {
            './plate.png': made,
            './cut/plate/plate-01.png': cc0,
            'cut/plate/old-02.png': cc0,
            'notes/../other.png': cc0,
        };
        const piece = cutEntry(current, 'plate.png');
        expect(piece).toEqual({ source: 'me', license: 'generated', cutFrom: 'plate.png' });
        putSources(current, { 'cut/plate/plate-01.png': piece }, 'cut/plate/');
        expect(current).toEqual({
            './plate.png': made,
            'notes/../other.png': cc0,
            'cut/plate/plate-01.png': piece,
        });
        // A single entry replaces the other spelling of its file.
        putSources(current, { 'plate.png': cc0 });
        expect(Object.keys(current)).toEqual([
            'notes/../other.png',
            'cut/plate/plate-01.png',
            'plate.png',
        ]);
    });

    it('reads the sound of the timeline the same way', () => {
        const dir = copyFixture('music');
        // Only its entry is read here, so any bytes do for the sound.
        fs.writeFileSync(path.join(dir, 'assets', 'music.wav'), 'RIFF');
        const file = path.join(dir, 'assets', 'SOURCES.json');
        const entry = JSON.parse(fs.readFileSync(file, 'utf-8'))['music.wav'];
        fs.writeFileSync(file, JSON.stringify({ './music.wav': entry }));
        expect(loadTimeline(dir, false).findings).toEqual([]);
        fs.writeFileSync(file, JSON.stringify({ './music.wav': entry, 'music.wav': entry }));
        const twice = loadTimeline(dir, false).findings;
        expect(twice.map((f) => f.code)).toEqual(['audio-unlicensed']);
        expect(twice[0].message).toContain('has 2 entries');
    });

    /**
     * A story told from a record over real pictures: bad/story-record with its
     * clue put back and the pictures and SOURCES.json given.
     */
    function recordFilm(pictures: string[], sources: Record<string, unknown>, materials: string[]) {
        const dir = copyFixture('bad/story-record');
        fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
        const svg =
            '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="red"/></svg>';
        for (const name of pictures) fs.writeFileSync(path.join(dir, 'assets', name), svg);
        fs.writeFileSync(path.join(dir, 'assets', 'SOURCES.json'), JSON.stringify(sources));
        const storyFile = path.join(dir, 'story.json');
        const story = JSON.parse(fs.readFileSync(storyFile, 'utf-8'));
        story.record.key = '到了';
        story.record.materials = Object.fromEntries(materials.map((m) => [m, 'part']));
        fs.writeFileSync(storyFile, JSON.stringify(story));
        return dir;
    }

    async function checkAndRender(dir: string) {
        const s = await session();
        const checked = await runCheck({
            dir,
            session: s,
            seekTimeoutMs: TEST_SEEK_TIMEOUT_MS,
            recordAttempts: false,
        });
        const rendered = await runRender({ dir, session: s, recordAttempts: false });
        return { checked, rendered };
    }

    it('check and render accept a SOURCES.json key written as ./a.svg', async () => {
        const dir = recordFilm(['a.svg'], { './a.svg': cc0 }, ['assets/a.svg']);
        const { checked, rendered } = await checkAndRender(dir);
        expect(codes(checked)).toEqual([]);
        expect(codes(rendered)).toEqual([]);
        expect(rendered.exitCode).toBe(0);
    });

    it('check and render accept a cutFrom written as ./root.svg', async () => {
        const dir = recordFilm(
            ['root.svg', 'leaf.svg'],
            {
                'root.svg': { ...made, prompt: 'red rectangle' },
                'leaf.svg': { source: 'me', license: 'generated', cutFrom: './root.svg' },
            },
            ['assets/root.svg'],
        );
        const { checked, rendered } = await checkAndRender(dir);
        expect(codes(checked)).toEqual([]);
        expect(codes(rendered)).toEqual([]);
        expect(rendered.exitCode).toBe(0);
    });

    it('check refuses a picture two SOURCES.json keys name', async () => {
        const dir = recordFilm(['a.svg'], { 'a.svg': cc0, './a.svg': cc0 }, ['assets/a.svg']);
        const s = await session();
        const checked = await runCheck({
            dir,
            session: s,
            seekTimeoutMs: TEST_SEEK_TIMEOUT_MS,
            recordAttempts: false,
        });
        expect(codes(checked)).toEqual(['asset-unlicensed']);
        expect(checked.failures[0].message).toContain('has 2 entries');
    });
});
