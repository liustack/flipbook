import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { ENV_CODES, FINDING_CODES } from '../src/cli/codes.ts';
import { LIMITS, recordCheck, recordRender } from '../src/engine/attempts.ts';
import { covered, uncoveredChars } from '../src/engine/fonts.ts';
import { psnr, sheetLayout } from '../src/engine/pixels.ts';
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
            `import { acquireLock } from ${JSON.stringify(path.join(repoRoot, 'src/engine/workspace.ts'))};`,
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

describe('pixel math', () => {
    it('computes PSNR and contact sheet layouts', () => {
        const a = new Uint8Array([10, 20, 30, 40]);
        expect(psnr(a, a)).toBe(Number.POSITIVE_INFINITY);
        expect(psnr(a, new Uint8Array([11, 20, 30, 40]))).toBeCloseTo(54.15, 1);
        const layout = sheetLayout(12, 1920, 1080);
        expect(layout.cols * layout.rows).toBeGreaterThanOrEqual(12);
        expect(layout.cols * (layout.tileWidth + 8) + 8).toBeLessThanOrEqual(1568);
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
});

describe('report contract', () => {
    it('documents every finding and environment code in docs/report-schema.md', () => {
        const doc = fs.readFileSync(path.join(repoRoot, 'docs', 'report-schema.md'), 'utf-8');
        for (const code of [...Object.keys(FINDING_CODES), ...Object.keys(ENV_CODES)]) {
            expect(doc, code).toContain(`\`${code}\``);
        }
    });
});
