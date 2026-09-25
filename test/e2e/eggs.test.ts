// examples/eggs-five: both films pass check with no warnings, render and pass
// acceptance, match expected.json, and render the same frames twice.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../../src/cli/check.ts';
import { runRender } from '../../src/cli/render.ts';
import { probeVideo } from '../../src/engine/verify.ts';
import { closeSession, session } from '../browser.ts';
import { cleanTemps, copyFixture, repoRoot } from '../helpers.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

const FILMS = ['five', 'shu'];

describe('examples/eggs-five', () => {
    it('shares one film.js and one eggs.js between the two films', () => {
        for (const file of ['film.js', 'eggs.js']) {
            const [a, b] = FILMS.map((film) =>
                fs.readFileSync(path.join(repoRoot, 'examples', 'eggs-five', film, file), 'utf-8'),
            );
            expect(b, file).toBe(a);
        }
    });

    for (const film of FILMS) {
        it(`${film}: passes check and render, matches expected.json, renders the same frames twice`, async () => {
            const expected = JSON.parse(
                fs.readFileSync(
                    path.join(repoRoot, 'examples', 'eggs-five', film, 'expected.json'),
                    'utf-8',
                ),
            );
            const dir = copyFixture(`eggs-five/${film}`, 'examples');
            const s = await session();
            const checked = await runCheck({ dir, session: s, recordAttempts: false });
            expect(checked.failures).toEqual([]);
            expect(checked.warnings).toEqual([]);
            const first = await runRender({ dir, session: s, recordAttempts: false });
            expect(first.failures).toEqual([]);
            const probe = await probeVideo(s.ffmpeg.ffprobe, first.artifacts.video);
            expect(probe.frames).toBe(expected.frames);
            expect(probe.durationSec).toBeCloseTo(expected.durationSec, 2);
            expect([probe.width, probe.height]).toEqual([expected.width, expected.height]);
            const hashes = () =>
                JSON.parse(
                    fs.readFileSync(path.join(dir, '.flipbook', 'frame-hashes.json'), 'utf-8'),
                ).hashes;
            const firstHashes = hashes();
            const second = await runRender({ dir, session: s, recordAttempts: false });
            expect(second.failures).toEqual([]);
            expect(firstHashes).toHaveLength(expected.frames);
            expect(hashes()).toEqual(firstHashes);
        });
    }
});
