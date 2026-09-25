// examples/beat-title: the preset-music example passes the A-level gates.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../../src/cli/check.ts';
import { runRender } from '../../src/cli/render.ts';
import type { Report } from '../../src/cli/report.ts';
import { runSnapshot } from '../../src/cli/snapshot.ts';
import { type AudioCheck, probeVideo } from '../../src/engine/verify.ts';
import { closeSession, session } from '../browser.ts';
import { cleanTemps, copyFixture, repoRoot } from '../helpers.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

function audioOf(report: Report): AudioCheck {
    return (report.render as { audio: AudioCheck }).audio;
}

describe('examples/beat-title', () => {
    it('passes check, snapshot and render and matches expected.json', async () => {
        const expected = JSON.parse(
            fs.readFileSync(path.join(repoRoot, 'examples/beat-title/expected.json'), 'utf-8'),
        );
        const dir = copyFixture('beat-title', 'examples');
        const s = await session();
        const checked = await runCheck({ dir, session: s, recordAttempts: false });
        expect(checked.failures).toEqual([]);
        expect(checked.warnings).toEqual([]);
        const snap = await runSnapshot({ dir, session: s });
        expect(snap.failures).toEqual([]);
        const rendered = await runRender({ dir, session: s, recordAttempts: false });
        expect(rendered.failures).toEqual([]);
        expect(rendered.warnings).toEqual([]);
        const probe = await probeVideo(s.ffmpeg.ffprobe, rendered.artifacts.video);
        expect(probe.frames).toBe(expected.frames);
        expect(probe.durationSec).toBeCloseTo(expected.durationSec, 2);
        expect([probe.width, probe.height]).toEqual([expected.width, expected.height]);
        const audio = audioOf(rendered);
        expect([audio.codec, audio.sampleRate, audio.channels]).toEqual([
            expected.audio.codec,
            expected.audio.sampleRate,
            expected.audio.channels,
        ]);
        expect(
            Math.abs((audio.integratedLufs as number) - expected.audio.integratedLufs),
        ).toBeLessThanOrEqual(0.5);
        expect(audio.cues).toHaveLength(expected.audio.sfxCues);
    });

    it('renders the same frames and the same stems twice', async () => {
        const dir = copyFixture('beat-title', 'examples');
        const first = await runRender({ dir, recordAttempts: false });
        const read = () => ({
            frames: JSON.parse(
                fs.readFileSync(path.join(dir, '.flipbook', 'frame-hashes.json'), 'utf-8'),
            ).hashes,
            stems: JSON.parse(
                fs.readFileSync(path.join(dir, '.flipbook', 'audio', 'audio.json'), 'utf-8'),
            ),
        });
        const a = read();
        fs.rmSync(path.join(dir, '.flipbook', 'audio'), { recursive: true });
        const second = await runRender({ dir, recordAttempts: false });
        const b = read();
        expect(first.failures).toEqual([]);
        expect(second.failures).toEqual([]);
        expect(b.frames).toEqual(a.frames);
        expect(b.stems.reused).toBe(false);
        expect([b.stems.music.sha256, b.stems.sfx.sha256]).toEqual([
            a.stems.music.sha256,
            a.stems.sfx.sha256,
        ]);
    });
});
