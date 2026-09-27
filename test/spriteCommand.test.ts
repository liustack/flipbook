// flipbook sprite on small drawn sheets: stick figures standing in a row.
// It cuts and orders the drawings, scales a sheet drawn smaller to the same
// height, takes the stride from the feet, and warns about drawings that drift.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runSprite } from '../src/cli/sprite.ts';
import { requireFfmpeg } from '../src/engine/ffmpeg.ts';
import { run } from '../src/engine/proc.ts';
import type { SpriteFile } from '../src/runtime/sprite.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps, codes, copyFixture } from './helpers.ts';

/** The alpha of every pixel of a PNG, decoded by ffmpeg. */
async function readPixels(file: string): Promise<{ alphas: number[] }> {
    const { ffmpeg } = await requireFfmpeg([]);
    const result = await run(
        ffmpeg,
        ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
        {
            timeoutMs: 30_000,
        },
    );
    const alphas: number[] = [];
    for (let i = 3; i < result.stdout.length; i += 4) alphas.push(result.stdout[i]);
    return { alphas };
}

/** The RGBA bytes of a PNG, decoded by ffmpeg. */
async function readRgba(file: string): Promise<Buffer> {
    const { ffmpeg } = await requireFfmpeg([]);
    const result = await run(
        ffmpeg,
        ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
        { timeoutMs: 30_000 },
    );
    return result.stdout;
}

/** The colors a PNG uses where it is not transparent, as rrggbb. */
async function readColors(file: string): Promise<Set<string>> {
    const { ffmpeg } = await requireFfmpeg([]);
    const result = await run(
        ffmpeg,
        ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
        { timeoutMs: 30_000 },
    );
    const colors = new Set<string>();
    const px = result.stdout;
    for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] === 0) continue;
        colors.add(((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]).toString(16).padStart(6, '0'));
    }
    return colors;
}

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

    it('keeps pixel art as it is: same size, every cell in or out, whole-pixel anchors', async () => {
        writeSpec(dir, {
            version: 1,
            pixel: true,
            clips: {
                walk: {
                    image: 'assets/pixel-walk.png',
                    frames: 4,
                    loop: true,
                    gap: 0.01,
                },
                wave: { image: 'assets/pixel-wave.png', frames: 2 },
            },
        });
        const report = await runSprite({ dir, name: 'kid', session: await session() });
        expect(codes(report)).toEqual([]);
        // The wave sheet is two cells taller: said, not stretched.
        expect(report.warnings.map((w) => [w.code, w.detail?.clip, w.detail?.kind])).toEqual([
            ['sprite-drift', 'wave', 'clip-height'],
        ]);
        expect(report.warnings[0].message).toContain('2 px taller');
        const file = JSON.parse(
            fs.readFileSync(path.join(dir, 'assets/sprites/kid/clips.json'), 'utf-8'),
        ) as SpriteFile;
        for (const clip of Object.values(file.clips)) {
            for (const f of clip.frames) {
                expect(Number.isInteger(f.anchor[0]) && Number.isInteger(f.anchor[1])).toBe(true);
            }
        }
        const done = report.sprite as { clips: Record<string, { scale: number }> };
        expect(done.clips.wave.scale).toBe(1);
        // Every drawing as drawn: its own size (8 by 21 walking, 8 by 23 waving),
        // every cell in or out, and no color the sheet does not have.
        for (const [name, clip] of Object.entries(file.clips)) {
            const sheet = await readColors(path.join(dir, `assets/pixel-${name}.png`));
            for (const f of clip.frames) {
                expect([f.width, f.height]).toEqual(name === 'walk' ? [8, 21] : [8, 23]);
                const png = path.join(dir, f.file);
                const frame = await readPixels(png);
                expect(frame.alphas.every((a) => a === 0 || a === 255)).toBe(true);
                const extra = [...(await readColors(png))].filter((c) => !sheet.has(c));
                expect(extra, `${f.file} has colors the sheet does not`).toEqual([]);
            }
        }
    });

    it('parts pixel drawings a pixel apart with gap 0, drawn right up to the edge of the sheet', async () => {
        // Three 5 by 12 figures, one pixel apart, top and bottom on the sheet's
        // edges: the ground cannot be read off the edge, so it is given.
        const spec = (gap?: number) => ({
            version: 1,
            pixel: true,
            clips: {
                walk: { image: 'assets/pixel-tight.png', frames: 3, paper: '#f2e8cf', gap },
            },
        });
        writeSpec(dir, spec());
        const joined = await runSprite({ dir, name: 'kid', session: await session() });
        expect(codes(joined)).toEqual(['sprite-invalid']);
        writeSpec(dir, spec(0));
        const report = await runSprite({ dir, name: 'kid', session: await session() });
        expect(codes(report)).toEqual([]);
        const file = JSON.parse(
            fs.readFileSync(path.join(dir, 'assets/sprites/kid/clips.json'), 'utf-8'),
        ) as SpriteFile;
        expect(file.clips.walk.frames.map((f) => [f.width, f.height, ...f.anchor])).toEqual([
            [5, 12, 2, 12],
            [5, 12, 2, 12],
            [5, 12, 2, 12],
        ]);
        const sheet = await readColors(path.join(dir, 'assets/pixel-tight.png'));
        for (const f of file.clips.walk.frames) {
            const extra = [...(await readColors(path.join(dir, f.file)))].filter(
                (c) => !sheet.has(c),
            );
            expect(extra).toEqual([]);
        }
    });

    it('finds and keeps each pixel drawing as drawn, in reading order, on big sheets', async () => {
        // Each drawing has a mark in its own row, so a frame that is its
        // neighbour, or out of order, shows. The sheets are wide or tall, so
        // they are never looked for scaled down, and the room around each crop
        // is wide enough to take in the neighbours. [left, top, width, height]
        // of every drawing, in reading order.
        const sheets: [string, number, [number, number, number, number][]][] = [
            [
                'pixel-wide',
                1600,
                [
                    [10, 14, 8, 20],
                    [19, 14, 8, 20],
                    [28, 14, 8, 20],
                ],
            ],
            [
                'pixel-tall',
                100,
                [
                    [10, 50, 8, 1300],
                    [40, 50, 8, 1300],
                    [70, 50, 8, 1300],
                ],
            ],
            [
                'pixel-varied',
                1600,
                [
                    [10, 10, 8, 20],
                    [19, 10, 8, 21],
                    [28, 10, 8, 22],
                ],
            ],
            [
                'pixel-diagonal',
                1600,
                [
                    [28, 10, 8, 20],
                    [19, 31, 8, 20],
                    [10, 52, 8, 20],
                ],
            ],
        ];
        for (const [sheet, sheetWidth, drawings] of sheets) {
            writeSpec(dir, {
                version: 1,
                pixel: true,
                clips: {
                    idle: { image: `assets/${sheet}.png`, frames: 3, paper: '#faf5eb', gap: 0 },
                },
            });
            const report = await runSprite({ dir, name: 'kid', session: await session() });
            expect(codes(report), sheet).toEqual([]);
            const file = JSON.parse(
                fs.readFileSync(path.join(dir, 'assets/sprites/kid/clips.json'), 'utf-8'),
            ) as SpriteFile;
            expect(
                file.clips.idle.frames.map((f) => [f.width, f.height]),
                sheet,
            ).toEqual(drawings.map(([, , w, h]) => [w, h]));
            const done = report.sprite as { clips: Record<string, { scale: number }> };
            expect(done.clips.idle.scale).toBe(1);
            // Every pixel of every frame is the pixel of its own drawing on the
            // sheet: the ground transparent, the rest as it is.
            const source = await readRgba(path.join(dir, `assets/${sheet}.png`));
            for (const [i, f] of file.clips.idle.frames.entries()) {
                const [left, top, w, h] = drawings[i];
                const frame = await readRgba(path.join(dir, f.file));
                let wrong = 0;
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        const s = ((top + y) * sheetWidth + left + x) * 4;
                        const o = (y * w + x) * 4;
                        const ground =
                            source[s] === 0xfa && source[s + 1] === 0xf5 && source[s + 2] === 0xeb;
                        const same = ground
                            ? frame[o + 3] === 0
                            : frame[o + 3] === 255 &&
                              frame[o] === source[s] &&
                              frame[o + 1] === source[s + 1] &&
                              frame[o + 2] === source[s + 2];
                        if (!same) wrong++;
                    }
                }
                expect(wrong, `${sheet} frame ${i + 1}`).toBe(0);
            }
        }
    });

    it('refuses a height for pixel sprites', async () => {
        writeSpec(dir, {
            version: 1,
            pixel: true,
            height: 40,
            clips: { walk: { image: 'assets/pixel-walk.png', frames: 4 } },
        });
        const report = await runSprite({ dir, name: 'kid', session: await session() });
        expect(report.failures.map((f) => f.detail?.path)).toEqual(['$.height']);
    });
});
