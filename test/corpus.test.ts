// Broken compositions, one per failure class. Every one must be caught.
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

async function render(name: string, dropFrames?: number[]) {
    return runRender({
        dir: copyFixture(`bad/${name}`),
        session: await session(),
        dropFrames,
        recordAttempts: false,
    });
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

    it('glitch: a frame lost in the pipe to ffmpeg', async () => {
        const rendered = await render('glitch', [3]);
        expect(codes(rendered)).toContain('glitch');
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
    });

    it('clock: drawing from Date.now', async () => {
        expect(codes(await check('clock'))).toContain('clock-dependent');
    });

    it('random: drawing from Math.random', async () => {
        const checked = await check('random');
        expect(codes(checked)).toContain('random-dependent');
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

    it.todo('audio out of sync with its sfx cue (v0.3, needs the audio command)');
});
