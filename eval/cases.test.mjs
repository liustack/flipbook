import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { validateCase } from './cases.mjs';
import { runtimeExports } from './page.mjs';

const evalDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(evalDir, '..');
const temps = [];
afterAll(() => {
    for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const runtimeNames = runtimeExports(repoRoot);
// A case written for these tests: eval/cases/ ships none until the cases are rewritten.
const caseDir = mkdtempSync(join(tmpdir(), 'flipbook-eval-case-'));
temps.push(caseDir);
const dirs = { name: 'four-seasons', caseDir, repoRoot, runtimeNames };

const FOUR_SEASONS = {
    id: 'four-seasons',
    title: '一年四季，跟着用户的曲子',
    asks: ['story', 'film'],
    prompt: '用我放在 assets/music.wav 的曲子（96 BPM，第一拍在 0.5 秒）做一条 20 秒的短片，讲一年四季。',
    workspace: {
        'assets/music.wav': { generator: 'clicks', bpm: 96, offsetSec: 0.5, seconds: 30 },
    },
    expect: {
        durationSec: [19, 21],
        width: 1920,
        height: 1080,
        audio: 'file',
        audioFile: 'assets/music.wav',
        timeline: { bpm: 96, 'audio.bpmOffset': 0.5 },
        uses: ['paperLayer|drawPaper'],
        review: ['春夏秋冬四季在画面上都认得出来'],
    },
};

/** The four-seasons case above, changed by `edit`. */
function fourSeasons(edit = () => {}) {
    const spec = structuredClone(FOUR_SEASONS);
    edit(spec);
    return spec;
}

describe('eval case validation', () => {
    it('accepts a valid case', () => {
        expect(validateCase(fourSeasons(), dirs)).toEqual([]);
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
                'folder.jpg': { generator: 'repo', from: 'docs' },
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
            'workspace["folder.jpg"].from: docs is not a regular file',
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

describe('eval case sources behind links', () => {
    /** A cases directory with four-seasons whose music is copied from `from`, set up by `arrange`. */
    function linkedCase(from, arrange) {
        const root = mkdtempSync(join(tmpdir(), 'flipbook-eval-links-'));
        temps.push(root);
        const casesDir = join(root, 'cases');
        const caseDir = join(casesDir, 'four-seasons');
        mkdirSync(join(caseDir, 'files'), { recursive: true });
        mkdirSync(join(root, 'outside'));
        writeFileSync(join(root, 'outside', 'music.wav'), 'outside the case');
        writeFileSync(join(caseDir, 'files', 'music.wav'), 'inside the case');
        arrange({ root, caseDir });
        const spec = fourSeasons((s) => {
            s.workspace['assets/music.wav'] = { generator: 'copy', from };
        });
        writeFileSync(join(caseDir, 'case.json'), JSON.stringify(spec));
        return { casesDir, caseDir, spec };
    }
    const dryRun = (casesDir) =>
        spawnSync(process.execPath, [join(evalDir, 'run.mjs'), '--dry-run', '--cases', casesDir], {
            encoding: 'utf-8',
            timeout: 60_000,
        });

    it('refuses a source whose folder is a link out of the case directory', () => {
        const { casesDir, caseDir, spec } = linkedCase('linked/music.wav', ({ root, caseDir }) =>
            symlinkSync(join(root, 'outside'), join(caseDir, 'linked')),
        );
        const problems = validateCase(spec, { ...dirs, caseDir });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(
            /^workspace\["assets\/music\.wav"\]\.from: linked\/music\.wav leads out of the case directory, to .*outside[\\/]music\.wav$/,
        );
        const result = dryRun(casesDir);
        expect(result.status).toBe(1);
        expect(result.stdout).toContain('leads out of the case directory');
        expect(result.stdout).toContain('0/1 cases valid');
    });

    it('follows a link that stays inside the case directory, and copies the file it leads to', () => {
        const { casesDir, caseDir, spec } = linkedCase('shared/music.wav', ({ caseDir }) =>
            symlinkSync('files', join(caseDir, 'shared')),
        );
        expect(validateCase(spec, { ...dirs, caseDir })).toEqual([]);
        const result = dryRun(casesDir);
        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(result.stdout).toContain('ok four-seasons workspace files');
    });

    it('names a generator that is no generator, even one an object inherits', () => {
        const spec = fourSeasons((s) => {
            s.workspace['assets/music.wav'] = { generator: 'constructor', from: 'x' };
            delete s.expect.audioFile;
        });
        expect(validateCase(spec, dirs)).toEqual([
            'workspace["assets/music.wav"].generator: must be one of clicks, copy, repo, not "constructor"',
        ]);
    });
});
