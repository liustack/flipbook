// --size and --scale: a stage in another shape, and output at a device scale
// factor with canvases drawn at full resolution.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../src/cli/check.ts';
import { runRender } from '../src/cli/render.ts';
import { UsageError } from '../src/cli/report.ts';
import { runSnapshot } from '../src/cli/snapshot.ts';
import { run } from '../src/engine/proc.ts';
import { openPage } from '../src/engine/session.ts';
import { outputSize, parseSize, stageSize } from '../src/engine/size.ts';
import { loadTimeline } from '../src/engine/timeline.ts';
import { probeVideo } from '../src/engine/verify.ts';
import { sha256 } from '../src/engine/workspace.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps, copyFixture, tempDir } from './helpers.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

const HD = { width: 1920, height: 1080 };

describe('--size', () => {
    it('keeps the short edge for a ratio', () => {
        expect(stageSize(parseSize('9:16'), HD)).toEqual({ width: 1080, height: 1920 });
        expect(stageSize(parseSize('1:1'), HD)).toEqual({ width: 1080, height: 1080 });
        expect(stageSize(parseSize('4:5'), HD)).toEqual({ width: 1080, height: 1350 });
        expect(stageSize(parseSize('16:9'), HD)).toEqual(HD);
        expect(stageSize(parseSize('9:16'), { width: 640, height: 360 })).toEqual({
            width: 360,
            height: 640,
        });
    });

    it('takes exact pixels', () => {
        expect(stageSize(parseSize('1080x1920'), HD)).toEqual({ width: 1080, height: 1920 });
    });

    it('refuses what the timeline would refuse', () => {
        expect(() => parseSize('tall')).toThrow(UsageError);
        expect(() => stageSize(parseSize('1081x1920'), HD)).toThrow(/even/);
        expect(() => stageSize(parseSize('9000x1000'), HD)).toThrow(/7680/);
    });
});

describe('check --size', () => {
    it('checks the page at the new stage size, so text past a tall frame is caught before render', async () => {
        const dir = tempDir('check-size');
        fs.writeFileSync(
            path.join(dir, 'timeline.json'),
            JSON.stringify({
                version: 1,
                width: 640,
                height: 360,
                fps: 12,
                seed: 7,
                bpm: 120,
                beatsPerBar: 4,
                scenes: [{ id: 'title', bars: 1, hold: true }],
                audio: { mode: 'none' },
            }),
        );
        fs.writeFileSync(
            path.join(dir, 'index.html'),
            `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 100vw; height: 100vh; overflow: hidden; background: #f4efe4; }
  #title { position: absolute; left: 380px; top: 150px; margin: 0; white-space: nowrap;
           font: 600 40px "Noto Serif SC"; color: #2b2622; }
</style></head>
<body><p id="title">翻页书</p>
<script type="module">
import { composition } from '/__flipbook/runtime.js';
composition({ seek() {} });
</script></body></html>
`,
        );
        const s = await session();
        const wide = await runCheck({ dir, session: s, recordAttempts: false });
        expect(wide.failures).toEqual([]);
        const tall = await runCheck({
            dir,
            session: s,
            size: parseSize('9:16'),
            recordAttempts: false,
        });
        expect(tall.composition).toMatchObject({ width: 360, height: 640 });
        expect(tall.failures.map((f) => f.code)).toContain('text-offstage');
    });
});

describe('--scale', () => {
    it('multiplies the stage into whole, even output pixels', () => {
        expect(outputSize(HD, 2)).toEqual({ width: 3840, height: 2160 });
        expect(outputSize(HD, 1.5)).toEqual({ width: 2880, height: 1620 });
        expect(() => outputSize({ width: 1080, height: 1350 }, 1.5)).toThrow(/even/);
        expect(() => outputSize({ width: 3840, height: 2160 }, 3)).toThrow(/larger/);
    });

    it('captures device pixels, with a canvas backing store at the same scale, frame after frame', async () => {
        const dir = copyFixture('stage');
        const timeline = loadTimeline(dir, false).resolved;
        if (!timeline) throw new Error('stage fixture has no timeline');
        const s = await session();
        const column = async (scale: number) => {
            const { page, findings } = await openPage(s, {
                dir,
                timeline,
                deviceScaleFactor: scale,
            });
            expect(findings).toEqual([]);
            await page.seek(0);
            await page.capture();
            // A clipped capture (snapshot --zoom) must leave the device metrics alone.
            await page.capture({ x: 80, y: 0, width: 64, height: 36, scale: 2 });
            await page.seek(5);
            const png = await page.capture();
            const metrics = await page.page.evaluate(() => [
                devicePixelRatio,
                screen.width,
                screen.height,
            ]);
            await page.close();
            expect(metrics).toEqual([scale, 640, 360]);
            expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([
                640 * scale,
                360 * scale,
            ]);
            const file = path.join(tempDir('scale'), 'frame.png');
            fs.writeFileSync(file, png);
            const gray = await run(s.ffmpeg.ffmpeg, [
                '-v',
                'error',
                '-i',
                file,
                '-f',
                'rawvideo',
                '-pix_fmt',
                'gray',
                '-',
            ]);
            // Row 10, the pixels around the half-pixel line from x = 100 to 100.5 CSS px.
            const row = 10 * 640 * scale;
            return [...gray.stdout.subarray(row + 99 * scale, row + 102 * scale)];
        };
        const one = await column(1);
        expect(one[1]).toBeGreaterThan(90);
        expect(one[1]).toBeLessThan(170);
        const two = await column(2);
        expect(two[2]).toBeLessThan(20);
        expect(two[1]).toBeGreaterThan(235);
        expect(two[3]).toBeGreaterThan(235);
    });
});

describe('render in other shapes', () => {
    it('renders the stage fixture at 9:16 and at scale 2', async () => {
        const dir = copyFixture('stage');
        const s = await session();
        const tall = await runRender({
            dir,
            session: s,
            size: parseSize('9:16'),
            recordAttempts: false,
        });
        expect(tall.failures).toEqual([]);
        let probe = await probeVideo(s.ffmpeg.ffprobe, tall.artifacts.video);
        expect([probe.width, probe.height, probe.frames]).toEqual([360, 640, 24]);
        expect((tall.render as { output: unknown }).output).toEqual({
            width: 360,
            height: 640,
            scale: 1,
        });
        const sharp = await runRender({ dir, session: s, scale: 2, recordAttempts: false });
        expect(sharp.failures).toEqual([]);
        probe = await probeVideo(s.ffmpeg.ffprobe, sharp.artifacts.video);
        expect([probe.width, probe.height]).toEqual([1280, 720]);
        expect(JSON.parse(probe.comment ?? '{}')).toMatchObject({ stage: '640x360', scale: 2 });
    });
});

describe('snapshot in another shape', () => {
    it('lays a 9:16 stage out in tall tiles, with a hash per tile and one digest over them', async () => {
        const dir = copyFixture('stage');
        const s = await session();
        const take = async () => {
            const snap = await runSnapshot({ dir, session: s, size: parseSize('9:16') });
            expect(snap.failures).toEqual([]);
            return snap.snapshot as {
                layout: { tileWidth: number; tileHeight: number };
                tiles: { frame: number; sha256: string }[];
                digest: string;
            };
        };
        const first = await take();
        expect(first.layout.tileHeight).toBeGreaterThan(first.layout.tileWidth);
        expect(first.tiles.every((tile) => /^[0-9a-f]{64}$/.test(tile.sha256))).toBe(true);
        expect(first.digest).toBe(sha256(first.tiles.map((tile) => tile.sha256).join('\n')));
        const second = await take();
        expect(second.digest).toBe(first.digest);
    });
});
