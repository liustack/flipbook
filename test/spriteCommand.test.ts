// flipbook sprite on small drawn sheets: stick figures standing in a row.
// It cuts and orders the drawings, scales a sheet drawn smaller to the same
// height, takes the stride from the feet, and warns about drawings that drift.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runSprite } from '../src/cli/sprite.ts';
import type { SpriteFile } from '../src/runtime/sprite.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps, codes, copyFixture } from './helpers.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

function writeSpec(dir: string, spec: unknown): void {
    const folder = path.join(dir, 'assets', 'sprites', 'kid');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'sprite.json'), JSON.stringify(spec));
}

describe('flipbook sprite', () => {
    let dir: string;

    beforeAll(() => {
        dir = copyFixture('sprite');
    });

    it('cuts the drawings in order, brings both sheets to one height and measures the stride', async () => {
        writeSpec(dir, {
            version: 1,
            clips: {
                walk: { image: 'assets/walk.png', frames: 4, fps: 6, loop: true, walk: true },
                wave: { image: 'assets/wave.png', frames: 3 },
            },
        });
        const report = await runSprite({ dir, name: 'kid', session: await session() });
        expect(codes(report)).toEqual([]);
        const file = JSON.parse(
            fs.readFileSync(path.join(dir, 'assets/sprites/kid/clips.json'), 'utf-8'),
        ) as SpriteFile;
        // The walk sheet sets the height: 100 px from the top of the head to the soles.
        expect(Math.abs(file.height - 101)).toBeLessThanOrEqual(2);
        const walk = file.clips.walk;
        expect(walk).toMatchObject({ fps: 6, loop: true });
        expect(walk.frames.map((f) => f.file)).toEqual([
            'assets/sprites/kid/frames/walk-01.png',
            'assets/sprites/kid/frames/walk-02.png',
            'assets/sprites/kid/frames/walk-03.png',
            'assets/sprites/kid/frames/walk-04.png',
        ]);
        // Reading order: both feet down, one lifted, both down, the other lifted.
        const widths = walk.frames.map((f) => f.width);
        expect(widths[0]).toBeGreaterThan(widths[1] + 20);
        expect(widths[2]).toBeGreaterThan(widths[3] + 20);
        // The planted foot moves back 16 px a drawing: 64 px a pass through four.
        expect(Math.abs((walk.stride as number) - 64)).toBeLessThanOrEqual(2);
        // The wave sheet was drawn at 80 px: scaled up to the walk's height.
        const wave = file.clips.wave;
        expect(wave).toMatchObject({ fps: 8, loop: false });
        expect(wave.stride).toBeUndefined();
        for (const f of wave.frames) {
            expect(Math.abs(f.anchor[1] - file.height)).toBeLessThanOrEqual(3);
        }
        const done = report.sprite as { clips: Record<string, { scale: number }> };
        expect(done.clips.wave.scale).toBeCloseTo(1.25, 1);
        const sources = JSON.parse(fs.readFileSync(path.join(dir, 'assets/SOURCES.json'), 'utf-8'));
        expect(sources['sprites/kid/frames/wave-02.png']).toEqual({
            source: 'drawn by the flipbook tests',
            license: 'generated',
            cutFrom: 'wave.png',
        });
        expect(fs.existsSync(report.artifacts.sheet)).toBe(true);
    });

    it('warns about a drawing too tall and feet that wander in a still clip', async () => {
        writeSpec(dir, {
            version: 1,
            clips: { stand: { image: 'assets/drift.png', frames: 3 } },
        });
        const report = await runSprite({ dir, name: 'kid', session: await session() });
        expect(report.exitCode).toBe(0);
        expect(report.warnings.map((w) => [w.code, w.detail?.frame, w.detail?.kind])).toEqual([
            ['sprite-drift', 2, 'height'],
            ['sprite-drift', 3, 'feet'],
        ]);
    });

    it('counts a small drawing on a big sheet, so a wrong frame count is refused', async () => {
        // Three drawings and a fourth a third their size, all tiny beside the sheet.
        writeSpec(dir, { version: 1, clips: { stand: { image: 'assets/sparse.png', frames: 3 } } });
        const three = await runSprite({ dir, name: 'kid', session: await session() });
        expect(three.failures[0].detail).toMatchObject({ clip: 'stand', found: 4, frames: 3 });
        writeSpec(dir, { version: 1, clips: { stand: { image: 'assets/sparse.png', frames: 4 } } });
        const four = await runSprite({ dir, name: 'kid', session: await session() });
        expect(codes(four)).toEqual([]);
        // However small: 140 px of ink each, and a fourth of 48.
        writeSpec(dir, {
            version: 1,
            clips: { stand: { image: 'assets/tiny.png', frames: 3, gap: 0 } },
        });
        const tiny = await runSprite({ dir, name: 'kid', session: await session() });
        expect(tiny.failures[0].detail).toMatchObject({ clip: 'stand', found: 4, frames: 3 });
    });

    it('refuses more frames than the sheet shows, and a sheet without its prompt', async () => {
        writeSpec(dir, {
            version: 1,
            clips: { walk: { image: 'assets/walk.png', frames: 6 } },
        });
        const short = await runSprite({ dir, name: 'kid', session: await session() });
        expect(codes(short)).toEqual(['sprite-invalid']);
        expect(short.failures[0].detail).toMatchObject({ clip: 'walk', found: 4, frames: 6 });
        // Fewer frames than drawings would drop a drawing from the middle of the cycle.
        writeSpec(dir, { version: 1, clips: { walk: { image: 'assets/walk.png', frames: 3 } } });
        const long = await runSprite({ dir, name: 'kid', session: await session() });
        expect(long.failures[0].detail).toMatchObject({ clip: 'walk', found: 4, frames: 3 });

        const sourcesFile = path.join(dir, 'assets/SOURCES.json');
        const sources = JSON.parse(fs.readFileSync(sourcesFile, 'utf-8'));
        sources['walk.png'] = { ...sources['walk.png'], prompt: '' };
        fs.writeFileSync(sourcesFile, JSON.stringify(sources));
        writeSpec(dir, {
            version: 1,
            clips: { walk: { image: 'assets/walk.png', frames: 4, fps: 0 } },
        });
        const bad = await runSprite({ dir, name: 'kid', session: await session() });
        expect(bad.failures.map((f) => f.detail?.path)).toEqual([
            '$.clips.walk.image',
            '$.clips.walk.fps',
        ]);
    });
});
