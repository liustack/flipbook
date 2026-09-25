// Parallel pages and page recycling: the same raw frames as one page, only
// after a passing check, and pages that grow get reopened.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../../src/cli/check.ts';
import { runRender } from '../../src/cli/render.ts';
import { saveReport } from '../../src/cli/report.ts';
import { closeSession, session } from '../browser.ts';
import { cleanTemps, copyFixture } from '../helpers.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

interface RenderSection {
    digest: string;
    parallel: { jobs: number; reason?: string };
    pages: { opened: number; recycled: { frames: number; heap: number; nodes: number } };
}

function hashes(dir: string): string[] {
    return JSON.parse(fs.readFileSync(path.join(dir, '.flipbook', 'frame-hashes.json'), 'utf-8'))
        .hashes;
}

describe('parallel render', () => {
    it('renders one page until a check of these files passed', async () => {
        const dir = copyFixture('hello', 'examples');
        const report = await runRender({
            dir,
            session: await session(),
            jobs: 3,
            recordAttempts: false,
        });
        expect(report.failures).toEqual([]);
        const render = report.render as RenderSection;
        expect(render.parallel.jobs).toBe(1);
        expect(render.parallel.reason).toBe('no check report for this composition');
    });

    it('gives the same raw frames as one page, with and without recycling', async () => {
        const dir = copyFixture('hello', 'examples');
        const s = await session();
        const single = await runRender({ dir, session: s, jobs: 1, recordAttempts: false });
        expect(single.failures).toEqual([]);
        const singleHashes = hashes(dir);
        saveReport(await runCheck({ dir, session: s, recordAttempts: false }));

        const parallel = await runRender({ dir, session: s, jobs: 3, recordAttempts: false });
        expect(parallel.failures).toEqual([]);
        const render = parallel.render as RenderSection;
        expect(render.parallel.jobs).toBe(3);
        expect(render.pages.opened).toBe(3);
        expect(hashes(dir)).toEqual(singleHashes);
        expect(render.digest).toBe((single.render as RenderSection).digest);

        const recycled = await runRender({
            dir,
            session: s,
            jobs: 2,
            recycleFrames: 25,
            recordAttempts: false,
        });
        expect(recycled.failures).toEqual([]);
        const pages = (recycled.render as RenderSection).pages;
        expect(pages.recycled.frames).toBeGreaterThan(0);
        expect(pages.opened).toBe(2 + pages.recycled.frames);
        expect(hashes(dir)).toEqual(singleHashes);
    });

    it('uses parallel pages after a check that failed on text, not on determinism', async () => {
        const dir = copyFixture('bad/offstage');
        const s = await session();
        const checked = await runCheck({ dir, session: s, recordAttempts: false });
        expect(checked.ok).toBe(false);
        saveReport(checked);
        const report = await runRender({ dir, session: s, jobs: 3, recordAttempts: false });
        expect((report.render as RenderSection).parallel).toMatchObject({ jobs: 3 });
    });

    it('stays on one page after a check that failed on seek order', async () => {
        const dir = copyFixture('bad/state');
        const s = await session();
        saveReport(await runCheck({ dir, session: s, recordAttempts: false }));
        const report = await runRender({ dir, session: s, jobs: 3, recordAttempts: false });
        expect((report.render as RenderSection).parallel).toMatchObject({
            jobs: 1,
            reason: 'the last check failed the determinism checks: seek order',
        });
    });

    it('goes back to one page once the files change after check', async () => {
        const dir = copyFixture('hello', 'examples');
        const s = await session();
        saveReport(await runCheck({ dir, session: s, recordAttempts: false }));
        fs.appendFileSync(path.join(dir, 'index.html'), '\n<!-- edited -->\n');
        const report = await runRender({ dir, session: s, jobs: 3, recordAttempts: false });
        const render = report.render as RenderSection;
        expect(render.parallel.jobs).toBe(1);
        expect(render.parallel.reason).toBe('the last check ran on other files');
    });
});

describe('page recycling by memory', () => {
    it('reopens a page whose JS heap keeps growing, frames unchanged', async () => {
        const dir = copyFixture('leak');
        const s = await session();
        const kept = await runRender({ dir, session: s, recycleFrames: 0, recordAttempts: false });
        expect(kept.failures).toEqual([]);
        expect((kept.render as RenderSection).pages.opened).toBe(1);
        const keptHashes = hashes(dir);
        const report = await runRender({
            dir,
            session: s,
            recycle: {
                everyFrames: Number.POSITIVE_INFINITY,
                watchMemory: true,
                heapGrowthBytes: 8 << 20,
            },
            recordAttempts: false,
        });
        expect(report.failures).toEqual([]);
        const pages = (report.render as RenderSection).pages;
        expect(pages.recycled.heap).toBeGreaterThan(0);
        expect(pages.recycled.frames).toBe(0);
        expect(hashes(dir)).toEqual(keptHashes);
    });

    it('reopens a page whose DOM keeps growing', async () => {
        const dir = copyFixture('leak');
        const report = await runRender({
            dir,
            session: await session(),
            recycle: {
                everyFrames: Number.POSITIVE_INFINITY,
                watchMemory: true,
                heapGrowthBytes: 2 ** 40,
                nodeGrowth: 1000,
            },
            recordAttempts: false,
        });
        expect(report.failures).toEqual([]);
        const pages = (report.render as RenderSection).pages;
        expect(pages.recycled.nodes).toBeGreaterThan(0);
        expect(pages.recycled.heap).toBe(0);
    });
});
