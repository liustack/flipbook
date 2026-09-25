// DOM text whose rotate() and scale() change every frame: with the frame
// rate limit Chromium used to hand out the screenshot before the new raster
// scale was painted, so two separate renders differed on a dozen frames.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runRender } from '../src/cli/render.ts';
import { openPage } from '../src/engine/session.ts';
import { loadTimeline } from '../src/engine/timeline.ts';
import { sha256 } from '../src/engine/workspace.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps, copyFixture } from './helpers.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

describe('bad/dom-scale-drift', () => {
    it('shows the settled frame at the first capture after every seek', async () => {
        const dir = copyFixture('bad/dom-scale-drift');
        const timeline = loadTimeline(dir, false).resolved;
        if (!timeline) throw new Error('fixture has no timeline');
        const { page, findings } = await openPage(await session(), { dir, timeline });
        expect(findings).toEqual([]);
        const late: number[] = [];
        try {
            for (let frame = 0; frame < timeline.frameCount; frame++) {
                await page.seek(frame);
                const first = sha256(await page.capture());
                if (sha256(await page.capture()) !== first) late.push(frame);
            }
        } finally {
            await page.close();
        }
        expect(late).toEqual([]);
    });

    it('renders the same raw frames twice, each render in its own browser', async () => {
        const dir = copyFixture('bad/dom-scale-drift');
        const hashes = () =>
            JSON.parse(fs.readFileSync(path.join(dir, '.flipbook', 'frame-hashes.json'), 'utf-8'))
                .hashes as string[];
        const first = await runRender({ dir, jobs: 1, recordAttempts: false });
        expect(first.failures).toEqual([]);
        const firstHashes = hashes();
        const second = await runRender({ dir, jobs: 1, recordAttempts: false });
        expect(second.failures).toEqual([]);
        expect(hashes()).toEqual(firstHashes);
    });
});
