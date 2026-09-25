// Parallel pages and page recycling: the same raw frames as one page, only
// after a passing check, and pages that grow get reopened.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../src/cli/check.ts';
import { runRender } from '../src/cli/render.ts';
import { saveReport } from '../src/cli/report.ts';
import {
    autoRecycle,
    HEAP_GROWTH_BUDGET,
    MIN_PAGE_FRAMES,
    MIN_PAGE_HEAP_GROWTH,
    PAGE_FRAMES_1080P,
    pageLimit,
    planJobs,
} from '../src/engine/capture.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps, copyFixture } from './helpers.ts';

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

describe('planJobs', () => {
    const machine = { cores: 10, memoryBytes: 16 * 1024 ** 3 };

    it('takes CPU cores minus one for a long 1080p film', () => {
        const plan = planJobs(720, 1920 * 1080, undefined, machine);
        expect(plan).toMatchObject({ jobs: 9, cpu: 9, frames: 15 });
    });

    it('gives short films fewer pages and big frames less memory', () => {
        expect(planJobs(120, 1920 * 1080, undefined, machine).jobs).toBe(2);
        const uhd = planJobs(4320, 3840 * 2160, undefined, machine);
        expect(uhd.memory).toBeLessThan(9);
        expect(uhd.jobs).toBe(uhd.memory);
    });

    it('keeps an explicit --jobs, never above the frame count', () => {
        expect(planJobs(720, 1920 * 1080, 3, machine).jobs).toBe(3);
        expect(planJobs(4, 1920 * 1080, 16, machine).jobs).toBe(4);
    });
});

describe('autoRecycle', () => {
    it('reopens pages sooner for bigger frames, within bounds', () => {
        expect(autoRecycle(1920 * 1080)).toEqual({
            everyFrames: PAGE_FRAMES_1080P,
            watchMemory: true,
        });
        expect(autoRecycle(3840 * 2160).everyFrames).toBe(MIN_PAGE_FRAMES);
        expect(autoRecycle(640 * 360).everyFrames).toBe(PAGE_FRAMES_1080P);
    });
});

describe('pageLimit', () => {
    it('splits a growth budget between the pages, down to a floor', () => {
        expect(pageLimit(HEAP_GROWTH_BUDGET, MIN_PAGE_HEAP_GROWTH, 1)).toBe(HEAP_GROWTH_BUDGET);
        expect(pageLimit(HEAP_GROWTH_BUDGET, MIN_PAGE_HEAP_GROWTH, 4)).toBe(HEAP_GROWTH_BUDGET / 4);
        expect(pageLimit(HEAP_GROWTH_BUDGET, MIN_PAGE_HEAP_GROWTH, 16)).toBe(MIN_PAGE_HEAP_GROWTH);
    });
});

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
