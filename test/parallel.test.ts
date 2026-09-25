// Parallel pages and page recycling: page counts, reopening intervals and
// memory lines, the gate on the last check, and renders of small fixtures
// that give the same raw frames as one page.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../src/cli/check.ts';
import { parallelGate, runRender } from '../src/cli/render.ts';
import { saveReport } from '../src/cli/report.ts';
import {
    autoRecycle,
    HEAP_GROWTH_BUDGET,
    MAX_AUTO_JOBS,
    MIN_PAGE_FRAMES,
    MIN_PAGE_HEAP_GROWTH,
    PAGE_FRAMES_1080P,
    pageLimit,
    planJobs,
} from '../src/engine/capture.ts';
import type { Session } from '../src/engine/session.ts';
import { parseSize } from '../src/engine/size.ts';
import { Workspace } from '../src/engine/workspace.ts';
import { appVersion } from '../src/paths.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps, copyFixture, tempDir } from './helpers.ts';

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

    it('takes at most 6 pages for a long 1080p film, even with more cores to spare', () => {
        const plan = planJobs(720, 1920 * 1080, undefined, machine);
        expect(plan).toMatchObject({ jobs: 6, cpu: 9, frames: 15, max: MAX_AUTO_JOBS });
        expect(MAX_AUTO_JOBS).toBe(6);
    });

    it('takes CPU cores minus one when that is fewer than 6', () => {
        const small = { cores: 4, memoryBytes: 16 * 1024 ** 3 };
        expect(planJobs(720, 1920 * 1080, undefined, small)).toMatchObject({ jobs: 3, cpu: 3 });
    });

    it('gives short films fewer pages and big frames less memory', () => {
        expect(planJobs(120, 1920 * 1080, undefined, machine).jobs).toBe(2);
        const uhd = planJobs(4320, 3840 * 2160, undefined, {
            ...machine,
            memoryBytes: 8 * 1024 ** 3,
        });
        expect(uhd.memory).toBeLessThan(MAX_AUTO_JOBS);
        expect(uhd.jobs).toBe(uhd.memory);
    });

    it('keeps an explicit --jobs, never above the frame count', () => {
        expect(planJobs(720, 1920 * 1080, 3, machine).jobs).toBe(3);
        expect(planJobs(720, 1920 * 1080, 8, machine).jobs).toBe(8);
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

describe('parallelGate', () => {
    const session = { chromium: { revision: '1243' } } as Session;
    const hash = 'sha256:abc';
    const stage = { hash, width: 640, height: 360, scale: 1 };

    function gate(check: Record<string, unknown>, extra: Record<string, unknown> = {}) {
        const dir = tempDir('gate');
        fs.mkdirSync(path.join(dir, '.flipbook', 'reports'), { recursive: true });
        const report = {
            command: 'check',
            ok: false,
            composition: { dir, hash, width: 640, height: 360, scale: 1 },
            flipbook: { version: appVersion() },
            environment: { chromium: { revision: '1243' } },
            check,
            ...extra,
        };
        fs.writeFileSync(
            path.join(dir, '.flipbook', 'reports', 'check.json'),
            JSON.stringify(report),
        );
        return parallelGate(Workspace.open(dir), stage, session);
    }

    const passed = { seekOrder: 'pass', perturbation: 'pass', latePaint: 'pass' };

    it('allows pages after a check that failed on other things but passed all three determinism checks', () => {
        expect(gate({ determinism: passed })).toEqual({ allowed: true });
    });

    it('refuses pages when a determinism check failed, and names it', () => {
        const result = gate({ determinism: { ...passed, seekOrder: 'fail', latePaint: 'fail' } });
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe(
            'the last check failed the determinism checks: seek order, late paint',
        );
    });

    it('refuses pages when a determinism check never ran', () => {
        expect(gate({ determinism: { ...passed, perturbation: 'skipped' } })).toEqual({
            allowed: false,
            reason: 'the last check did not finish the determinism checks',
        });
        expect(gate({})).toEqual({
            allowed: false,
            reason: 'the last check did not finish the determinism checks',
        });
    });

    it('still refuses a check of other files', () => {
        expect(
            gate({ determinism: passed }, { composition: { dir: '.', hash: 'sha256:other' } }),
        ).toEqual({ allowed: false, reason: 'the last check ran on other files' });
    });

    it('refuses a check made at another stage size or scale', () => {
        const at = (width: number, height: number, scale: number) =>
            gate(
                { determinism: passed },
                { composition: { dir: '.', hash, width, height, scale } },
            );
        expect(at(360, 640, 1)).toEqual({
            allowed: false,
            reason: 'the last check ran at 360x640, this render is 640x360: run check with the same --size',
        });
        expect(at(640, 360, 2)).toEqual({
            allowed: false,
            reason: 'the last check ran at --scale 2, this render at --scale 1: run check with the same --scale',
        });
    });
});

describe('parallel render', () => {
    it('renders one page until a check of these files passed', async () => {
        const dir = copyFixture('stage');
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
        const dir = copyFixture('stage');
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
            recycleFrames: 5,
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
        const dir = copyFixture('stage');
        const s = await session();
        saveReport(await runCheck({ dir, session: s, recordAttempts: false }));
        fs.appendFileSync(path.join(dir, 'index.html'), '\n<!-- edited -->\n');
        const report = await runRender({ dir, session: s, jobs: 3, recordAttempts: false });
        const render = report.render as RenderSection;
        expect(render.parallel.jobs).toBe(1);
        expect(render.parallel.reason).toBe('the last check ran on other files');
    });

    it('stays on one page for another stage size than the check, and uses pages after a check at it', async () => {
        const dir = copyFixture('stage');
        const s = await session();
        const size = parseSize('1:1');
        saveReport(await runCheck({ dir, session: s, recordAttempts: false }));
        let report = await runRender({ dir, session: s, size, jobs: 3, recordAttempts: false });
        let render = report.render as RenderSection;
        expect(render.parallel.jobs).toBe(1);
        expect(render.parallel.reason).toBe(
            'the last check ran at 640x360, this render is 360x360: run check with the same --size',
        );
        saveReport(await runCheck({ dir, session: s, size, recordAttempts: false }));
        report = await runRender({ dir, session: s, size, jobs: 3, recordAttempts: false });
        render = report.render as RenderSection;
        expect(render.parallel.jobs).toBe(3);
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
