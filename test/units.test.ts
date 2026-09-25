import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { describe, expect, it } from 'vitest';
import { ENV_CODES, FINDING_CODES } from '../src/cli/codes.ts';
import { LIMITS, recordCheck, recordRender } from '../src/engine/attempts.ts';
import { covered, uncoveredChars } from '../src/engine/fonts.ts';
import { analysisSize, psnr, RGB_H, RGB_W, sheetLayout } from '../src/engine/pixels.ts';
import { findOnPath } from '../src/engine/proc.ts';
import { auditCanvasText } from '../src/engine/textAudit.ts';
import { acquireLock } from '../src/engine/workspace.ts';
import { repoRoot, tempDir } from './helpers.ts';

describe('font coverage tables', () => {
    it('cover common Chinese, punctuation and Latin, and not rare or emoji code points', () => {
        expect(uncoveredChars('你好，翻页书！Hello, flipbook 1234')).toEqual([]);
        expect(uncoveredChars('龘')).toEqual([]);
        expect(uncoveredChars('\u{20000}😀')).toEqual(['\u{20000}', '😀']);
        expect(covered(0x4f60, 'noto-serif-sc')).toBe(true);
        expect(covered(0x4f60, 'lxgw-wenkai')).toBe(true);
    });
});

describe('canvas text against the font it is drawn with', () => {
    const audit = (text: string, font: string) =>
        auditCanvasText(
            [{ id: 't', text, font, box: { x: 0, y: 0, width: 1, height: 1 } }],
            0,
            12,
        ).map((f) => [f.code, f.detail?.chars ?? null]);

    it('checks each character against the listed fonts in order', () => {
        expect(audit('\u4DC0', '40px "Noto Serif SC"')).toEqual([['font-fallback', ['\u4DC0']]]);
        expect(audit('\u4DC0', '40px "LXGW WenKai"')).toEqual([]);
        expect(audit('\u4DC0', '40px "Noto Serif SC", "LXGW WenKai"')).toEqual([]);
        expect(audit('Hello 你好', '600 44px "Noto Serif SC", serif')).toEqual([]);
    });

    it('treats any other family before a flipbook font as a system font', () => {
        expect(audit('Hello', '40px Arial')).toEqual([['font-fallback', ['H', 'e', 'l', 'o']]]);
        expect(audit('Hello', '40px serif, "Noto Serif SC"')).toEqual([
            ['font-fallback', ['H', 'e', 'l', 'o']],
        ]);
    });

    it('reports characters no flipbook font has as missing', () => {
        expect(audit('\u{20000}', '40px "Noto Serif SC"')).toEqual([
            ['missing-glyph', ['\u{20000}']],
        ]);
    });
});

describe('attempt limits', () => {
    it('stops after the same code fails three runs in a row', () => {
        const dir = tempDir('attempts');
        expect(recordCheck(dir, ['clock-dependent']).stop).toBe(false);
        expect(recordCheck(dir, ['clock-dependent']).stop).toBe(false);
        const third = recordCheck(dir, ['clock-dependent']);
        expect(third.stop).toBe(true);
        expect(third.reason).toContain('clock-dependent');
    });

    it('resets a streak when the code goes away and stops after eight check rounds', () => {
        const dir = tempDir('attempts-rounds');
        for (let i = 0; i < LIMITS.checkRounds - 1; i++) {
            expect(recordCheck(dir, [i % 2 === 0 ? 'freeze' : 'blank-frame']).stop).toBe(false);
        }
        expect(recordCheck(dir, ['freeze']).stop).toBe(true);
    });

    it('stops after three failed renders and clears on a passing one', () => {
        const dir = tempDir('attempts-render');
        expect(recordRender(dir, ['freeze']).stop).toBe(false);
        expect(recordRender(dir, ['glitch']).stop).toBe(false);
        expect(recordRender(dir, ['paper-only']).stop).toBe(true);
        expect(recordRender(dir, []).summary.renderFailures).toBe(0);
    });
});

describe('render lock', () => {
    const lockFile = (dir: string) => path.join(dir, '.flipbook', 'render.lock');

    it('refuses a second holder and takes over a dead one', () => {
        const dir = tempDir('lock');
        const release = acquireLock(dir);
        expect(release).not.toBeNull();
        fs.writeFileSync(lockFile(dir), String(process.ppid));
        expect(acquireLock(dir)).toBeNull();
        fs.writeFileSync(lockFile(dir), '999999');
        const again = acquireLock(dir);
        expect(again).not.toBeNull();
        again?.();
    });

    it('refuses a second acquire from the same process', () => {
        const dir = tempDir('lock-same');
        const release = acquireLock(dir);
        expect(release).not.toBeNull();
        expect(acquireLock(dir)).toBeNull();
        release?.();
        expect(fs.existsSync(lockFile(dir))).toBe(false);
    });

    it('treats a just-created empty lock as held and an old one as stale', () => {
        const dir = tempDir('lock-empty');
        fs.mkdirSync(path.join(dir, '.flipbook'));
        fs.writeFileSync(lockFile(dir), '');
        expect(acquireLock(dir)).toBeNull();
        const old = new Date(Date.now() - 60_000);
        fs.utimesSync(lockFile(dir), old, old);
        const release = acquireLock(dir);
        expect(release).not.toBeNull();
        release?.();
    });

    it('releases only its own lock', () => {
        const dir = tempDir('lock-owner');
        const release = acquireLock(dir);
        expect(release).not.toBeNull();
        const other = JSON.stringify({ pid: process.ppid, token: 'someone-else' });
        fs.writeFileSync(lockFile(dir), other);
        release?.();
        expect(fs.readFileSync(lockFile(dir), 'utf-8')).toBe(other);
    });

    it('lets exactly one of several processes in', async () => {
        const dir = tempDir('lock-race');
        fs.mkdirSync(path.join(dir, '.flipbook'));
        const go = path.join(dir, 'go');
        const script = [
            `import { existsSync } from 'node:fs';`,
            `import { acquireLock } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, 'src/engine/workspace.ts')).href)};`,
            `while (!existsSync(${JSON.stringify(go)})) await new Promise((r) => setTimeout(r, 2));`,
            `const release = acquireLock(${JSON.stringify(dir)});`,
            `process.stdout.write(release ? 'got' : 'busy');`,
            `await new Promise((r) => setTimeout(r, 400));`,
            'release?.();',
        ].join('\n');
        const children = Array.from({ length: 8 }, () =>
            spawn(process.execPath, ['--input-type=module', '-e', script], {
                stdio: ['ignore', 'pipe', 'pipe'],
            }),
        );
        const results = children.map(
            (child) =>
                new Promise<string>((resolve) => {
                    let out = '';
                    let err = '';
                    child.stdout.on('data', (chunk) => {
                        out += chunk;
                    });
                    child.stderr.on('data', (chunk) => {
                        err += chunk;
                    });
                    child.on('close', () => resolve(out || `error: ${err}`));
                }),
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
        fs.writeFileSync(go, '');
        const outcomes = await Promise.all(results);
        expect(
            outcomes.filter((o) => o === 'got'),
            outcomes.join(', '),
        ).toHaveLength(1);
        expect(outcomes.filter((o) => o === 'busy')).toHaveLength(7);
        expect(fs.existsSync(lockFile(dir))).toBe(false);
    });
});

describe('finding programs on PATH', () => {
    /** A directory holding one executable file called `name`. */
    function binDir(name: string): string {
        const dir = tempDir('path-bin');
        fs.writeFileSync(path.join(dir, name), '', { mode: 0o755 });
        return dir;
    }

    it('adds .exe on win32 and reads the PATH key in any case', () => {
        const dir = binDir('ffmpeg.exe');
        const env = { Path: `C:\\nowhere;${dir}` };
        expect(findOnPath('ffmpeg', env, 'win32')).toBe(path.join(dir, 'ffmpeg.exe'));
        expect(findOnPath('ffmpeg.exe', env, 'win32')).toBe(path.join(dir, 'ffmpeg.exe'));
        expect(findOnPath('ffprobe', env, 'win32')).toBeNull();
    });

    // A Windows path has a drive colon, which the POSIX PATH split would cut.
    it.skipIf(process.platform === 'win32')(
        'keeps the exact name and the PATH key on other platforms',
        () => {
            const dir = binDir('ffmpeg');
            expect(findOnPath('ffmpeg', { PATH: `/nowhere:${dir}` }, 'linux')).toBe(
                path.join(dir, 'ffmpeg'),
            );
            expect(findOnPath('ffmpeg', { Path: dir }, 'linux')).toBeNull();
            expect(findOnPath('ffmpeg', { PATH: binDir('ffmpeg.exe') }, 'darwin')).toBeNull();
        },
    );
});

describe('pixel math', () => {
    it('computes PSNR and contact sheet layouts', () => {
        const a = new Uint8Array([10, 20, 30, 40]);
        expect(psnr(a, a)).toBe(Number.POSITIVE_INFINITY);
        expect(psnr(a, new Uint8Array([11, 20, 30, 40]))).toBeCloseTo(54.15, 1);
        const layout = sheetLayout(12, 1920, 1080);
        expect(layout.cols * layout.rows).toBeGreaterThanOrEqual(12);
        expect(layout.cols * (layout.tileWidth + 8) + 8).toBeLessThanOrEqual(1568);
    });

    it('analyses a frame in its own shape, with the pixel count of 320x180 or 480x270', () => {
        expect(analysisSize(1920, 1080)).toEqual({ width: 320, height: 180 });
        expect(analysisSize(640, 360)).toEqual({ width: 320, height: 180 });
        expect(analysisSize(1080, 1920)).toEqual({ width: 180, height: 320 });
        expect(analysisSize(1080, 1080)).toEqual({ width: 240, height: 240 });
        expect(analysisSize(1080, 1350)).toEqual({ width: 214, height: 268 });
        const rgb = { width: RGB_W, height: RGB_H };
        expect(analysisSize(3840, 2160, rgb)).toEqual({ width: 480, height: 270 });
        expect(analysisSize(1080, 1920, rgb)).toEqual({ width: 270, height: 480 });
    });
});

describe('package contract', () => {
    it('pins every runtime dependency to an exact version', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')) as {
            dependencies: Record<string, string>;
        };
        for (const [name, range] of Object.entries(pkg.dependencies)) {
            expect(range, name).toMatch(/^\d+\.\d+\.\d+$/);
        }
    });

    it('ships the docs pages but not the sample images', () => {
        // Through a shell: on Windows npm is a .cmd shim.
        const out = execSync('npm pack --dry-run --json --ignore-scripts', {
            cwd: repoRoot,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
        });
        const files = (JSON.parse(out) as { files: { path: string }[] }[])[0].files.map(
            (f) => f.path,
        );
        expect(files).toContain('docs/report-schema.md');
        expect(files).toContain('THIRD_PARTY_NOTICES.md');
        expect(files.filter((f) => f.startsWith('docs/samples'))).toEqual([]);
    });
});

describe('report contract', () => {
    it.each(['report-schema.md', 'report-schema.zh-CN.md'])(
        'documents every finding and environment code in docs/%s',
        (name) => {
            const doc = fs.readFileSync(path.join(repoRoot, 'docs', name), 'utf-8');
            for (const code of [...Object.keys(FINDING_CODES), ...Object.keys(ENV_CODES)]) {
                expect(doc, code).toContain(`\`${code}\``);
            }
        },
    );
});
