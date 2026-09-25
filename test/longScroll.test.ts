// examples/long-scroll: three minutes that never stop moving. Passes check
// with no warnings, renders on parallel pages and matches expected.json.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../src/cli/check.ts';
import { runRender } from '../src/cli/render.ts';
import { saveReport } from '../src/cli/report.ts';
import { probeVideo } from '../src/engine/verify.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps, copyFixture, repoRoot } from './helpers.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

describe('examples/long-scroll', () => {
    it('passes check and render and matches expected.json', async () => {
        const expected = JSON.parse(
            fs.readFileSync(path.join(repoRoot, 'examples/long-scroll/expected.json'), 'utf-8'),
        );
        const dir = copyFixture('long-scroll', 'examples');
        const s = await session();
        const checked = await runCheck({ dir, session: s, recordAttempts: false });
        expect(checked.failures).toEqual([]);
        expect(checked.warnings).toEqual([]);
        saveReport(checked);
        const rendered = await runRender({ dir, session: s, recordAttempts: false });
        expect(rendered.failures).toEqual([]);
        expect(rendered.warnings).toEqual([]);
        const probe = await probeVideo(s.ffmpeg.ffprobe, rendered.artifacts.video);
        expect(probe.frames).toBe(expected.frames);
        expect(probe.durationSec).toBeCloseTo(expected.durationSec, 2);
        expect([probe.width, probe.height]).toEqual([expected.width, expected.height]);
    }, 900_000);
});
