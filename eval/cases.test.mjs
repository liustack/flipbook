import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { validateCase } from './cases.mjs';
import { runtimeExports } from './scripts.mjs';

const evalDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(evalDir, '..');
const temps = [];
afterAll(() => {
    for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const runtimeNames = runtimeExports(repoRoot);
const dirs = {
    name: 'four-seasons',
    caseDir: join(evalDir, 'cases', 'four-seasons'),
    repoRoot,
    runtimeNames,
};

/** four-seasons as shipped, changed by `edit`. */
function fourSeasons(edit = () => {}) {
    const spec = JSON.parse(readFileSync(join(dirs.caseDir, 'case.json'), 'utf-8'));
    edit(spec);
    return spec;
}

describe('eval case validation', () => {
    it('accepts every shipped case', () => {
        for (const name of readdirSync(join(evalDir, 'cases'))) {
            const caseDir = join(evalDir, 'cases', name);
            const spec = JSON.parse(readFileSync(join(caseDir, 'case.json'), 'utf-8'));
            expect(validateCase(spec, { name, caseDir, repoRoot, runtimeNames }), name).toEqual([]);
        }
    });

    it('names a misspelled field inside a workspace file, and the field it lacks', () => {
        const spec = fourSeasons((s) => {
            const clicks = s.workspace['assets/music.wav'];
            clicks.offsetSecs = clicks.offsetSec;
            delete clicks.offsetSec;
        });
        expect(validateCase(spec, dirs)).toEqual([
            'workspace["assets/music.wav"].offsetSecs: unknown field for clicks',
            'workspace["assets/music.wav"].offsetSec: missing, clicks needs it',
        ]);
    });

    it('names misspelled fields in expect and in the brand, and retired ones', () => {
        const spec = fourSeasons((s) => {
            s.notes = 'x';
            s.expect.textInSource = ['x'];
            s.expect.brand = { name: '潮汐茶室', primay: '#1f6f78' };
        });
        expect(validateCase(spec, dirs)).toEqual([
            'notes: unknown field',
            'expect.textInSource: unknown field',
            'expect.brand.primay: unknown field',
        ]);
    });

    it('keeps workspace files inside the workspace and their sources inside the case or the repository', () => {
        const spec = fourSeasons((s) => {
            const clicks = s.workspace['assets/music.wav'];
            delete s.expect.audioFile;
            s.workspace = {
                '../escaped.wav': clicks,
                '/tmp/abs.wav': clicks,
                'a/../../b.wav': clicks,
                '.claude/skills/x.wav': clicks,
                'plate.jpg': { generator: 'repo', from: '../outside.jpg' },
                'notes.md': { generator: 'copy', from: 'files/none.md' },
                'examples.jpg': { generator: 'repo', from: 'examples' },
                'x.png': { generator: 'download', url: 'https://example.org/x.png' },
            };
        });
        expect(validateCase(spec, dirs)).toEqual([
            'workspace["../escaped.wav"]: leaves the workspace',
            'workspace["/tmp/abs.wav"]: must be a relative path',
            'workspace["a/../../b.wav"]: leaves the workspace',
            'workspace[".claude/skills/x.wav"]: lands in a folder kept for the host or the eval',
            'workspace["plate.jpg"].from: leaves the repository',
            'workspace["notes.md"].from: no file files/none.md in the case directory',
            'workspace["examples.jpg"].from: examples is not a regular file',
            'workspace["x.png"].generator: must be one of clicks, copy, repo, not "download"',
        ]);
    });

    it('refuses wrong types without walking into them', () => {
        const spec = fourSeasons((s) => {
            s.prompt = {};
            s.asks = ['story', 'vibes', 'story'];
            s.timeoutMin = '45';
            s.expect.width = 0;
            s.expect.height = 1919;
            s.expect.durationSec = [0, 20];
            s.expect.audio = ['file', 'file'];
            s.expect.timeline = { bpm: { value: 96 }, 'audio..x': 1 };
            s.expect.uses = 'puppet';
            s.expect.files = ['', '../x'];
            s.expect.notCopied = {};
            s.expect.review = [];
            s.workspace['assets/music.wav'].bpm = '96';
        });
        expect(validateCase(spec, dirs)).toEqual([
            'prompt: must be a non-empty string',
            'asks: "vibes" is none of story, film, characters, looks, pictures, brand, rules',
            'asks: lists a question twice',
            'timeoutMin: must be a number of minutes above 0',
            'workspace["assets/music.wav"].bpm: must be a number above 0',
            'expect.durationSec: must be [min, max] seconds with 0 < min < max',
            'expect.width: must be a positive even whole number of pixels',
            'expect.height: must be a positive even whole number of pixels',
            'expect.audio: must be "any", or one or a list of preset, score, file, none',
            'expect.timeline["bpm"]: must be a string, number or boolean',
            'expect.timeline["audio..x"]: must be a dotted path such as audio.bpmOffset',
            'expect.uses: must be a list',
            'expect.files[0]: must be a non-empty string',
            'expect.files[1]: leaves the directory',
            'expect.notCopied: must be a list',
            'expect.review: must list at least one question for the person reviewing',
        ]);
    });

    it('lets --dry-run name the broken field of a case kept elsewhere, and fail', () => {
        const casesDir = mkdtempSync(join(tmpdir(), 'flipbook-eval-cases-'));
        temps.push(casesDir);
        const spec = fourSeasons((s) => {
            s.workspace['assets/music.wav'].offsetSecs = 0.5;
        });
        mkdirSync(join(casesDir, 'four-seasons'));
        writeFileSync(join(casesDir, 'four-seasons', 'case.json'), JSON.stringify(spec));
        const result = spawnSync(
            process.execPath,
            [join(evalDir, 'run.mjs'), '--dry-run', '--cases', casesDir],
            { encoding: 'utf-8', timeout: 60_000 },
        );
        expect(result.status).toBe(1);
        expect(result.stdout).toContain(
            '!! four-seasons: workspace["assets/music.wav"].offsetSecs: unknown field for clicks',
        );
        expect(result.stdout).toContain('0/1 cases valid');
    });
});

describe('eval case uses', () => {
    it('takes runtime function names, alone or as alternatives, and refuses others', () => {
        const spec = fourSeasons((s) => {
            s.expect.uses = [
                'puppet',
                'paperLayer|drawPaper',
                'puppet(',
                'loadRigs',
                'riso|nothing',
            ];
        });
        expect(validateCase(spec, dirs)).toEqual([
            'expect.uses[2]: "puppet(" is not a function name',
            'expect.uses[3]: "loadRigs" is not a function the runtime exports',
            'expect.uses[4]: "nothing" is not a function the runtime exports',
        ]);
    });

    it('reads the runtime exports, not its types', () => {
        expect(runtimeNames.has('puppet')).toBe(true);
        expect(runtimeNames.has('loadSprite')).toBe(true);
        expect(runtimeNames.has('paperLayer')).toBe(true);
        expect(runtimeNames.has('Puppet')).toBe(false);
    });
});

describe('eval case audioFile', () => {
    it('names a workspace file and goes with the file audio mode', () => {
        const spec = fourSeasons((s) => {
            s.expect.audioFile = 'assets/other.wav';
            s.expect.audio = ['file', 'score'];
        });
        expect(validateCase(spec, dirs)).toEqual([
            'expect.audioFile: "assets/other.wav" is not a workspace file',
            'expect.audioFile: goes with expect.audio "file"',
        ]);
    });
});
