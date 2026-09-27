// Frames decoded for analysis: every picture handed to ffmpeg must come
// back, or the analysis would pair the wrong frames.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { requireFfmpeg } from '../src/engine/ffmpeg.ts';
import { decodeGraySequence } from '../src/engine/pixels.ts';
import { cleanTemps, tempDir } from './helpers.ts';

afterAll(() => cleanTemps());

// A 2 by 2 PNG.
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4//8/AxJgZEDnAwBUMwX7qKvdAAAAAElFTkSuQmCC',
    'base64',
);

describe('decodeGraySequence', () => {
    it('returns one frame per picture, and fails when a picture does not decode', async () => {
        const { ffmpeg } = await requireFfmpeg([]);
        const dir = tempDir('sequence');
        for (let i = 0; i < 3; i++)
            fs.writeFileSync(path.join(dir, `f_${String(i).padStart(5, '0')}.png`), PNG);
        const pattern = path.join(dir, 'f_%05d.png');
        const frames = await decodeGraySequence(ffmpeg, pattern, 3, 2, 2);
        expect(frames).toHaveLength(3);
        expect(frames[0]).toHaveLength(4);
        // The middle picture cut short: ffmpeg skips it and still exits 0.
        fs.writeFileSync(path.join(dir, 'f_00001.png'), PNG.subarray(0, 40));
        const error = await decodeGraySequence(ffmpeg, pattern, 3, 2, 2).catch((e: Error) => e);
        expect(String(error)).toMatch(/decoded [0-2] of the 3 frames/);
        // ffmpeg's own words about the broken picture come along.
        expect(String(error)).not.toContain('ffmpeg said nothing');
    });
});
