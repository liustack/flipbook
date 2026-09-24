import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../src/cli/check.ts';
import { runRender } from '../src/cli/render.ts';
import { runSnapshot } from '../src/cli/snapshot.ts';
import { run } from '../src/engine/proc.ts';
import { probeVideo } from '../src/engine/verify.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps, copyFixture, repoRoot } from './helpers.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

describe('examples/hello', () => {
    it('passes check, snapshot and render and matches expected.json', async () => {
        const expected = JSON.parse(
            fs.readFileSync(path.join(repoRoot, 'examples/hello/expected.json'), 'utf-8'),
        );
        const dir = copyFixture('hello', 'examples');
        const s = await session();
        const checked = await runCheck({ dir, session: s, recordAttempts: false });
        expect(checked.failures).toEqual([]);
        expect(checked.warnings).toEqual([]);
        const snap = await runSnapshot({ dir, session: s });
        expect(snap.failures).toEqual([]);
        expect(fs.existsSync(snap.artifacts.contactSheet)).toBe(true);
        const rendered = await runRender({ dir, session: s, recordAttempts: false });
        expect(rendered.failures).toEqual([]);
        const video = rendered.artifacts.video;
        expect(fs.existsSync(video)).toBe(true);
        const probe = await probeVideo(s.ffmpeg.ffprobe, video);
        expect(probe.frames).toBe(expected.frames);
        expect(probe.durationSec).toBeCloseTo(expected.durationSec, 2);
        expect([probe.width, probe.height]).toEqual([expected.width, expected.height]);
        const comment = JSON.parse(probe.comment ?? '{}');
        expect(comment.flipbook).toBe(rendered.flipbook.version);
        expect(comment.chromiumRevision).toBe(rendered.environment.chromium?.revision);
        expect(comment.composition).toBe(rendered.composition?.hash);
    });
});

describe('determinism', () => {
    it('two independent renders give identical raw frames', async () => {
        const dir = copyFixture('hello', 'examples');
        const first = await runRender({ dir, recordAttempts: false });
        const firstHashes = JSON.parse(
            fs.readFileSync(path.join(dir, '.flipbook', 'frame-hashes.json'), 'utf-8'),
        );
        const second = await runRender({ dir, recordAttempts: false });
        const secondHashes = JSON.parse(
            fs.readFileSync(path.join(dir, '.flipbook', 'frame-hashes.json'), 'utf-8'),
        );
        expect(first.failures).toEqual([]);
        expect(second.failures).toEqual([]);
        expect(firstHashes.hashes).toHaveLength(120);
        expect(secondHashes.hashes).toEqual(firstHashes.hashes);
        expect((second.render as { digest: string }).digest).toBe(
            (first.render as { digest: string }).digest,
        );
    });
});

describe('color', () => {
    it('keeps #3366CC and pure red within 3 levels through yuv420p bt709', async () => {
        const dir = copyFixture('color');
        const s = await session();
        const rendered = await runRender({ dir, session: s, recordAttempts: false });
        expect(rendered.failures).toEqual([]);
        const video = rendered.artifacts.video;
        const probe = await probeVideo(s.ffmpeg.ffprobe, video);
        expect([
            probe.pixFmt,
            probe.colorSpace,
            probe.colorPrimaries,
            probe.colorTransfer,
            probe.colorRange,
        ]).toEqual(['yuv420p', 'bt709', 'bt709', 'bt709', 'tv']);
        const decoded = await run(s.ffmpeg.ffmpeg, [
            '-v',
            'error',
            '-i',
            video,
            '-frames:v',
            '1',
            '-vf',
            'scale=in_color_matrix=bt709:in_range=tv,format=rgb24',
            '-f',
            'rawvideo',
            '-',
        ]);
        const px = (x: number, y: number) => {
            const i = (y * 640 + x) * 3;
            return [decoded.stdout[i], decoded.stdout[i + 1], decoded.stdout[i + 2]];
        };
        const blue = px(160, 180);
        const red = px(480, 180);
        const error = (got: number[], want: number[]) =>
            Math.max(...got.map((v, i) => Math.abs(v - want[i])));
        expect(error(blue, [0x33, 0x66, 0xcc]), `blue decoded as ${blue}`).toBeLessThanOrEqual(3);
        expect(error(red, [0xff, 0x00, 0x00]), `red decoded as ${red}`).toBeLessThanOrEqual(3);
        fs.writeFileSync(path.join(dir, 'decoded.json'), JSON.stringify({ blue, red }));
    });
});

describe('user soundtrack', () => {
    it('lands the first beat of music.wav on t = 0 and matches the picture length', async () => {
        const dir = copyFixture('music');
        const s = await session();
        const clicks = "volume='if(gte(t,0.5)*lt(mod(t-0.5,0.5),0.04),1,0)':eval=frame";
        const made = await run(s.ffmpeg.ffmpeg, [
            '-v',
            'error',
            '-y',
            '-f',
            'lavfi',
            '-i',
            'sine=frequency=880:sample_rate=48000:duration=6',
            '-af',
            clicks,
            path.join(dir, 'music.wav'),
        ]);
        expect(made.code).toBe(0);
        const rendered = await runRender({ dir, session: s, recordAttempts: false });
        expect(rendered.failures).toEqual([]);
        const audio = (rendered.render as { audio: { codec: string; durationSec: number } }).audio;
        expect(audio.codec).toBe('aac');
        expect(Math.abs(audio.durationSec - 2)).toBeLessThan(1 / 12);
        const pcm = await run(s.ffmpeg.ffmpeg, [
            '-v',
            'error',
            '-i',
            rendered.artifacts.video,
            '-map',
            '0:a',
            '-ac',
            '1',
            '-ar',
            '48000',
            '-f',
            's16le',
            '-',
        ]);
        const samples = new Int16Array(
            pcm.stdout.buffer,
            pcm.stdout.byteOffset,
            pcm.stdout.length / 2,
        );
        const first = samples.findIndex((v) => Math.abs(v) > 1000);
        expect(first).toBeGreaterThanOrEqual(0);
        expect(first / 48000).toBeLessThan(1 / 12);
    });
});
