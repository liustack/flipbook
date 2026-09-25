// Planning parallel pages and page recycling: page counts, reopening intervals
// and memory lines. The renders that prove the frames stay the same are in
// test/e2e/parallel.test.ts.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { parallelGate } from '../src/cli/render.ts';
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
import { Workspace } from '../src/engine/workspace.ts';
import { appVersion } from '../src/paths.ts';
import { cleanTemps, tempDir } from './helpers.ts';

afterAll(() => cleanTemps());

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

    function gate(check: Record<string, unknown>, extra: Record<string, unknown> = {}) {
        const dir = tempDir('gate');
        fs.mkdirSync(path.join(dir, '.flipbook', 'reports'), { recursive: true });
        const report = {
            command: 'check',
            ok: false,
            composition: { dir, hash },
            flipbook: { version: appVersion() },
            environment: { chromium: { revision: '1243' } },
            check,
            ...extra,
        };
        fs.writeFileSync(
            path.join(dir, '.flipbook', 'reports', 'check.json'),
            JSON.stringify(report),
        );
        return parallelGate(Workspace.open(dir), hash, session);
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
});
