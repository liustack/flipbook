// Parallel pages: the same raw frames as one page, only after a passing check.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../src/cli/check.ts';
import { runRender } from '../src/cli/render.ts';
import { saveReport } from '../src/cli/report.ts';
import { planJobs } from '../src/engine/capture.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps, copyFixture } from './helpers.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

interface RenderSection {
    digest: string;
    parallel: { jobs: number; reason?: string };
    pages: { opened: number };
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

    it('gives the same raw frames as one page', async () => {
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
