import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { ENV_CODES, FINDING_CODES } from '../src/cli/codes.ts';
import { LIMITS, recordCheck, recordRender } from '../src/engine/attempts.ts';
import { covered, uncoveredChars } from '../src/engine/fonts.ts';
import { psnr, sheetLayout } from '../src/engine/pixels.ts';
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
    it('refuses a second holder and takes over a dead one', () => {
        const dir = tempDir('lock');
        const release = acquireLock(dir);
        expect(release).not.toBeNull();
        fs.writeFileSync(path.join(dir, '.flipbook', 'render.lock'), String(process.ppid));
        expect(acquireLock(dir)).toBeNull();
        fs.writeFileSync(path.join(dir, '.flipbook', 'render.lock'), '999999');
        const again = acquireLock(dir);
        expect(again).not.toBeNull();
        again?.();
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

describe('report contract', () => {
    it('documents every finding and environment code in docs/report-schema.md', () => {
        const doc = fs.readFileSync(path.join(repoRoot, 'docs', 'report-schema.md'), 'utf-8');
        for (const code of [...Object.keys(FINDING_CODES), ...Object.keys(ENV_CODES)]) {
            expect(doc, code).toContain(`\`${code}\``);
        }
    });
});
