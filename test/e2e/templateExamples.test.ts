// The template and brand examples: each passes check with no warnings, renders
// and passes acceptance, matches expected.json, and renders the same frames
// twice.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../../src/cli/check.ts';
import { runRender } from '../../src/cli/render.ts';
import type { Report } from '../../src/cli/report.ts';
import { type AudioCheck, probeVideo } from '../../src/engine/verify.ts';
import { closeSession, session } from '../browser.ts';
import { cleanTemps, copyFixture, repoRoot } from '../helpers.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

const EXAMPLES = ['page-turn', 'lens-montage', 'arc-cuts', 'brand-intro'];

function audioOf(report: Report): AudioCheck {
    return (report.render as { audio: AudioCheck }).audio;
}

describe('template examples', () => {
    for (const name of EXAMPLES) {
        it(`${name}: passes check and render, matches expected.json, renders the same frames twice`, async () => {
            const expected = JSON.parse(
                fs.readFileSync(path.join(repoRoot, 'examples', name, 'expected.json'), 'utf-8'),
            );
            const dir = copyFixture(name, 'examples');
            const s = await session();
            const checked = await runCheck({ dir, session: s, recordAttempts: false });
            expect(checked.failures).toEqual([]);
            expect(checked.warnings).toEqual([]);
            const first = await runRender({ dir, session: s, recordAttempts: false });
            expect(first.failures).toEqual([]);
            expect(first.warnings).toEqual([]);
            const probe = await probeVideo(s.ffmpeg.ffprobe, first.artifacts.video);
            expect(probe.frames).toBe(expected.frames);
            expect(probe.durationSec).toBeCloseTo(expected.durationSec, 2);
            expect([probe.width, probe.height]).toEqual([expected.width, expected.height]);
            const audio = audioOf(first);
            expect([audio.codec, audio.sampleRate, audio.channels]).toEqual([
                expected.audio.codec,
                expected.audio.sampleRate,
                expected.audio.channels,
            ]);
            expect(
                Math.abs((audio.integratedLufs as number) - expected.audio.integratedLufs),
            ).toBeLessThanOrEqual(0.5);
            expect(audio.cues).toHaveLength(expected.audio.sfxCues);
            const hashes = () =>
                JSON.parse(
                    fs.readFileSync(path.join(dir, '.flipbook', 'frame-hashes.json'), 'utf-8'),
                ).hashes;
            const firstHashes = hashes();
            const second = await runRender({ dir, session: s, recordAttempts: false });
            expect(second.failures).toEqual([]);
            expect(firstHashes).toHaveLength(expected.frames);
            expect(hashes()).toEqual(firstHashes);
        }, 900_000);
    }
});
