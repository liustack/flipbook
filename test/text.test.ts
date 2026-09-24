import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../src/cli/check.ts';
import type { RegisteredText } from '../src/engine/host.ts';
import { openPage } from '../src/engine/session.ts';
import { loadTimeline } from '../src/engine/timeline.ts';
import { graphemes, wordReveal, words } from '../src/runtime/text.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps, codes, tempDir } from './helpers.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

describe('words and reveal', () => {
    it('splits Chinese into words and keeps punctuation and spaces with their neighbor', () => {
        expect(words('Hello, flipbook world')).toEqual(['Hello, ', 'flipbook ', 'world']);
        expect(words('「你好」，翻页书。').join('')).toBe('「你好」，翻页书。');
        const zh = words('「你好」，翻页书。');
        expect(zh[0].startsWith('「')).toBe(true);
        expect(zh.every((w) => !/^[，。」]/.test(w))).toBe(true);
        expect(graphemes('蛋🥚é')).toEqual(['蛋', '🥚', 'é']);
    });

    it('reveals words in order, all shown at 1 and none at 0', () => {
        expect(wordReveal(0, 0, 5)).toBe(0);
        expect(wordReveal(1, 4, 5)).toBe(1);
        const mid = [0, 1, 2, 3, 4].map((i) => wordReveal(0.5, i, 5));
        for (let i = 1; i < mid.length; i++) expect(mid[i]).toBeLessThanOrEqual(mid[i - 1]);
        expect(mid[0]).toBe(1);
        expect(mid[4]).toBe(0);
    });
});

const TIMELINE = {
    version: 1,
    width: 640,
    height: 360,
    fps: 12,
    seed: 3,
    bpm: 120,
    beatsPerBar: 4,
    scenes: [{ id: 'main', bars: 2 }],
    cues: [
        { id: 'line', scene: 'main', beat: 1, kind: 'text', text: '鸟蛋落在纸上', settleBeats: 2 },
    ],
};

function composition(body: string): string {
    const dir = tempDir('text');
    fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(TIMELINE));
    fs.writeFileSync(
        path.join(dir, 'index.html'),
        `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; width: 640px; height: 360px; overflow: hidden; background: #f1e9d8; }
canvas { position: absolute; left: 0; top: 0; }
</style></head><body><canvas id="stage"></canvas><script type="module">
import { composition, timeline, setupCanvas, cueProgress, handText, writeText, textOnPath, arcPoints } from '/__flipbook/runtime.js';
const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
composition({
  seek(t) {
    ctx.clearRect(0, 0, tl.width, tl.height);
    ctx.fillStyle = '#2b2622';
    ctx.fillRect(20 + t * 30, 320, 20, 20);
${body}
  },
});
</script></body></html>`,
    );
    return dir;
}

const GOOD = `
    const p = cueProgress(tl, t, 'line');
    handText(ctx, '鸟蛋落在纸上', 60, 50, { id: 'hand', font: '400 40px "LXGW WenKai"', progress: p });
    writeText(ctx, 'Five eggs make a figure', 320, 150, { id: 'serif', font: '500 28px "Noto Serif SC"', align: 'center', maxWidth: 260, progress: p });
    textOnPath(ctx, 'along an arc', arcPoints(320, 420, 180, -2.4, -0.7), { id: 'arc', font: '500 26px "Noto Serif SC"', align: 'center', offset: 180 * 0.85, progress: p });`;

describe('canvas text registers with check', () => {
    it('passes check and registers every visible piece with its box', async () => {
        const dir = composition(GOOD);
        const s = await session();
        const report = await runCheck({ dir, session: s, recordAttempts: false });
        expect(report.failures).toEqual([]);
        expect(report.warnings).toEqual([]);

        const tl = loadTimeline(dir).resolved;
        if (!tl) throw new Error('timeline did not load');
        const { page } = await openPage(s, { dir, timeline: tl });
        try {
            const settle = tl.cues[0].settleFrame;
            await page.seek(settle);
            const settled = await page.registeredTexts();
            const byId = new Map(settled.map((e: RegisteredText) => [e.id, e]));
            expect([...byId.keys()].sort()).toEqual(['arc', 'hand', 'serif']);
            expect(byId.get('hand')?.text).toBe('鸟蛋落在纸上');
            expect(byId.get('serif')?.text.replace(/\s+/g, ' ').trim()).toBe(
                'Five eggs make a figure',
            );
            expect(byId.get('arc')?.text).toBe('along an arc');
            expect(byId.get('hand')?.font).toContain('LXGW WenKai');
            for (const entry of settled) {
                expect(entry.box.x).toBeGreaterThan(0);
                expect(entry.box.y).toBeGreaterThan(0);
                expect(entry.box.x + entry.box.width).toBeLessThan(640);
                expect(entry.box.y + entry.box.height).toBeLessThan(360);
            }
            const serif = byId.get('serif');
            expect(serif && serif.box.height > 60).toBe(true);

            await page.seek(tl.cues[0].frame + 3);
            const partial = await page.registeredTexts();
            const hand = partial.find((e) => e.id === 'hand');
            expect(hand).toBeDefined();
            expect('鸟蛋落在纸上'.startsWith(hand?.text ?? 'x')).toBe(true);
            expect(hand?.text.length).toBeLessThan(6);

            await page.seek(0);
            expect(await page.registeredTexts()).toEqual([]);
        } finally {
            await page.close();
        }
    });

    it('reports a system font and text past the frame edge', async () => {
        const dir = composition(`
    writeText(ctx, 'wrong face', 40, 40, { id: 'system', font: '400 30px "Comic Sans MS"' });
    textOnPath(ctx, 'running off the page', [[420, 200], [760, 200]], { id: 'off', font: '500 30px "Noto Serif SC"' });`);
        const report = await runCheck({ dir, session: await session(), recordAttempts: false });
        expect(codes(report)).toContain('font-fallback');
        expect(codes(report)).toContain('text-offstage');
        const fallback = report.failures.find((f) => f.code === 'font-fallback');
        expect(fallback?.element).toBe('canvas text "system"');
    });
});
