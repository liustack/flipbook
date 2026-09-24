// Broken compositions, one per failure class. Every one must be caught.
import * as fs from 'fs';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../src/cli/check.ts';
import { runRender } from '../src/cli/render.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps, codes, copyFixture } from './helpers.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

async function check(name: string, seekTimeoutMs?: number) {
    return runCheck({
        dir: copyFixture(`bad/${name}`),
        session: await session(),
        seekTimeoutMs,
        recordAttempts: false,
    });
}

/** Render a bad fixture; every evidence image the report names must still exist. */
async function render(name: string, dropFrames?: number[]) {
    const report = await runRender({
        dir: copyFixture(`bad/${name}`),
        session: await session(),
        dropFrames,
        recordAttempts: false,
    });
    for (const item of [...report.failures, ...report.warnings]) {
        for (const file of item.evidence ?? []) {
            expect(fs.existsSync(file), `${item.code} evidence ${file}`).toBe(true);
        }
    }
    return report;
}

describe('bad composition corpus', () => {
    it('blank: nothing drawn', async () => {
        const checked = await check('blank');
        expect(codes(checked)).toContain('blank-frame');
        const rendered = await render('blank');
        expect(codes(rendered)).toContain('blank-frame');
        expect(rendered.exitCode).toBe(1);
        expect(rendered.artifacts.video).toBeUndefined();
    });

    it('paper only: the content script failed, the paper layer drew', async () => {
        const checked = await check('paper-only');
        expect(codes(checked)).toContain('page-error');
        expect(codes(checked)).toContain('paper-only');
        const rendered = await render('paper-only');
        expect(codes(rendered)).toContain('paper-only');
    });

    it('freeze: a still scene without hold', async () => {
        const rendered = await render('freeze');
        const freezes = rendered.failures.filter((f) => f.code === 'freeze');
        expect(freezes.map((f) => f.element)).toEqual(['scene still']);
    });

    it('freeze: one still picture across several short scenes', async () => {
        const rendered = await render('freeze-split');
        const freezes = rendered.failures.filter((f) => f.code === 'freeze');
        expect(freezes).toHaveLength(1);
        expect(freezes[0].element).toBe('scenes one, two, three, four');
        expect(freezes[0].detail?.seconds as number).toBeGreaterThan(3.5);
    });

    it('empty: bare paper and a flat fill taking turns, never content', async () => {
        const rendered = await render('empty-alternate');
        const empty = rendered.failures.filter(
            (f) => f.code === 'blank-frame' || f.code === 'paper-only',
        );
        expect(empty).toHaveLength(1);
        expect(empty[0].detail?.seconds as number).toBeGreaterThan(3.5);
        expect(empty[0].detail?.blankFrames as number).toBeGreaterThan(0);
        expect(empty[0].detail?.paperFrames as number).toBeGreaterThan(0);
    });

    it('glitch: a frame lost in the pipe to ffmpeg', async () => {
        const rendered = await render('glitch', [3]);
        expect(codes(rendered)).toContain('glitch');
        const glitch = rendered.failures.find((f) => f.code === 'glitch');
        expect(glitch?.evidence).toHaveLength(2);
        expect(codes(rendered)).toContain('frame-count');
    });

    it('missing glyph: a character no font has, and a system font', async () => {
        const checked = await check('missing-glyph');
        const glyph = checked.failures.find((f) => f.code === 'missing-glyph');
        expect(glyph?.detail?.chars).toEqual(['\u{20000}']);
        const fallback = checked.failures
            .filter((f) => f.code === 'font-fallback')
            .map((f) => f.element);
        expect(fallback).toContain('#system');
        const hexagram = checked.failures.find(
            (f) => f.code === 'font-fallback' && f.element === 'canvas text "hexagram"',
        );
        expect(hexagram?.detail?.chars).toEqual(['\u4DC0']);
    });

    it('clock: drawing from Date.now', async () => {
        expect(codes(await check('clock'))).toContain('clock-dependent');
    });

    it('clock delta: Date.now() - start draws the same under any origin, and is still caught', async () => {
        const checked = await check('clock-delta');
        const calls = checked.failures.filter((f) => f.code === 'forbidden-api-call');
        expect(calls.map((f) => f.detail?.api)).toEqual(['Date.now()']);
        expect(calls[0].element).toBe('index.html:15');
        expect(calls[0].detail?.count as number).toBeGreaterThan(8);
        expect(codes(checked)).not.toContain('clock-dependent');
    });

    it('fails only under the shifted clock: every perturbed failure counts', async () => {
        const checked = await check('clock-crash');
        const seek = checked.failures.find((f) => f.code === 'seek-failed');
        expect(seek?.detail?.perturbation).toMatchObject({ change: 'clock' });
        expect(seek?.message).toContain('only draws on the first of the month');
        const network = checked.failures.find((f) => f.code === 'external-request');
        expect(network?.detail?.perturbation).toMatchObject({ change: 'clock' });
        expect(checked.exitCode).toBe(1);
    });

    it('random: drawing from Math.random', async () => {
        const checked = await check('random');
        expect(codes(checked)).toContain('random-dependent');
        const calls = checked.failures.filter((f) => f.code === 'forbidden-api-call');
        expect(calls.map((f) => f.detail?.api)).toEqual(['Math.random()']);
        expect(codes(checked)).not.toContain('clock-dependent');
    });

    it('state: position carried from frame to frame', async () => {
        const checked = await check('state');
        expect(codes(checked)).toContain('seek-order-dependent');
        expect(codes(checked)).not.toContain('clock-dependent');
    });

    it('seek waits on requestAnimationFrame', async () => {
        const checked = await check('raf-wait', 1500);
        expect(codes(checked)).toContain('seek-timeout');
    });

    it('text past the frame edge, in the margin, and a marked bleed', async () => {
        const checked = await check('offstage');
        const cut = checked.failures
            .filter((f) => f.code === 'text-offstage')
            .map((f) => f.element);
        expect(cut).toEqual(['#cut', '#gone']);
        const margin = checked.warnings
            .filter((f) => f.code === 'text-safe-area')
            .map((f) => f.element);
        expect(margin).toEqual(['#edge']);
    });

    it('low contrast text is measured in pixels', async () => {
        const checked = await check('low-contrast');
        const low = checked.warnings.filter((f) => f.code === 'low-contrast');
        expect(low.map((f) => f.element)).toEqual(['#pale']);
        expect(low[0].detail?.ratio as number).toBeLessThan(3);
        expect(checked.failures).toEqual([]);
    });

    it.todo('audio out of sync with its sfx cue (v0.3, needs the audio command)');
});
