// The release gate's full renders: hello (plain paper) and eggs-five/five
// (textured paper) pass check and render, match expected.json, and render the
// same raw frames again in a separate browser. long-scroll renders once and
// must keep its frame count and duration. The other examples are rendered by
// release.yml for the Release assets and are not compared here.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../../src/cli/check.ts';
import { runRender } from '../../src/cli/render.ts';
import { saveReport } from '../../src/cli/report.ts';
import { probeVideo } from '../../src/engine/verify.ts';
import { closeSession, session } from '../browser.ts';
import { cleanTemps, copyFixture, repoRoot } from '../helpers.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

function expectedOf(name: string) {
    return JSON.parse(
        fs.readFileSync(path.join(repoRoot, 'examples', name, 'expected.json'), 'utf-8'),
    );
}

function hashes(dir: string): string[] {
    return JSON.parse(fs.readFileSync(path.join(dir, '.flipbook', 'frame-hashes.json'), 'utf-8'))
        .hashes;
}

/** Check (saved, so render may use parallel pages), then render and probe. */
async function checkAndRender(name: string) {
    const expected = expectedOf(name);
    const dir = copyFixture(name, 'examples');
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
    return { dir, expected, rendered, probe };
}

describe.each(['hello', 'eggs-five/five'])('examples/%s', (name) => {
    it('passes check and render, matches expected.json, and renders the same raw frames in a separate browser', async () => {
        const { dir, expected, rendered, probe } = await checkAndRender(name);
        const comment = JSON.parse(probe.comment ?? '{}');
        expect(comment.flipbook).toBe(rendered.flipbook.version);
        expect(comment.chromiumRevision).toBe(rendered.environment.chromium?.revision);
        expect(comment.composition).toBe(rendered.composition?.hash);
        const first = hashes(dir);
        expect(first).toHaveLength(expected.frames);
        // No shared session: the second render starts its own browser.
        const second = await runRender({ dir, recordAttempts: false });
        expect(second.failures).toEqual([]);
        expect(hashes(dir)).toEqual(first);
        expect((second.render as { digest: string }).digest).toBe(
            (rendered.render as { digest: string }).digest,
        );
    }, 900_000);
});

describe('examples/long-scroll', () => {
    it('renders three minutes once with the frame count and duration in expected.json', async () => {
        await checkAndRender('long-scroll');
    }, 900_000);
});
