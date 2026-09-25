// Planning parallel pages and page recycling: page counts, reopening intervals
// and memory lines. The renders that prove the frames stay the same are in
// test/e2e/parallel.test.ts.
import { describe, expect, it } from 'vitest';
import {
    autoRecycle,
    HEAP_GROWTH_BUDGET,
    MIN_PAGE_FRAMES,
    MIN_PAGE_HEAP_GROWTH,
    PAGE_FRAMES_1080P,
    pageLimit,
    planJobs,
} from '../src/engine/capture.ts';

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
