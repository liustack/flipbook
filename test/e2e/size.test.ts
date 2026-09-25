// --size and --scale on the hello example: snapshot tiles for a tall stage,
// and whole renders at 9:16 and at scale 2 that pass acceptance.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../../src/cli/check.ts';
import { runRender } from '../../src/cli/render.ts';
import { saveReport } from '../../src/cli/report.ts';
import { runSnapshot } from '../../src/cli/snapshot.ts';
import { parseSize } from '../../src/engine/size.ts';
import { probeVideo } from '../../src/engine/verify.ts';
import { closeSession, session } from '../browser.ts';
import { cleanTemps, copyFixture, repoRoot } from '../helpers.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

describe('render and snapshot in other shapes', () => {
    it('snapshot lays a 9:16 stage out in tall tiles', async () => {
        const dir = copyFixture('hello', 'examples');
        const snap = await runSnapshot({ dir, session: await session(), size: parseSize('9:16') });
        expect(snap.failures).toEqual([]);
        expect(snap.composition).toMatchObject({ width: 1080, height: 1920 });
        const layout = (snap.snapshot as { layout: { tileWidth: number; tileHeight: number } })
            .layout;
        expect(layout.tileHeight).toBeGreaterThan(layout.tileWidth);
    });

    for (const [label, options, want] of [
        ['9:16', { size: parseSize('9:16') }, [1080, 1920]],
        ['scale 2', { scale: 2 }, [3840, 2160]],
    ] as const) {
        it(`examples/hello renders at ${label}`, async () => {
            const expected = JSON.parse(
                fs.readFileSync(path.join(repoRoot, 'examples/hello/expected.json'), 'utf-8'),
            );
            const dir = copyFixture('hello', 'examples');
            const s = await session();
            saveReport(await runCheck({ dir, session: s, recordAttempts: false }));
            const report = await runRender({ dir, session: s, ...options, recordAttempts: false });
            expect(report.failures).toEqual([]);
            expect(report.warnings).toEqual([]);
            const probe = await probeVideo(s.ffmpeg.ffprobe, report.artifacts.video);
            expect([probe.width, probe.height, probe.frames]).toEqual([...want, expected.frames]);
        });
    }
});
