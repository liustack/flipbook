import * as os from 'os';
import * as path from 'path';
import { type Finding, progress } from '../cli/report.ts';
import { type Encoder, EncoderError } from './encode.ts';
import type { CompositionPage } from './page.ts';
import { auditFrameText } from './textAudit.ts';
import { sha256, type Workspace } from './workspace.ts';

/** Opens a page for render worker `worker`; called again each time the worker reopens its page. */
export type PageOpener = (
    worker: number,
) => Promise<{ page: CompositionPage; findings: Finding[] }>;

/** When a worker closes its page and opens a fresh one before the next frame. */
export interface RecyclePolicy {
    /** Frames on one page before it is reopened. Infinity keeps the page to the end. */
    everyFrames: number;
    /** Also reopen a page whose JS heap or DOM keeps growing. */
    watchMemory: boolean;
    /** JS heap growth that reopens the page. Default HEAP_GROWTH_LIMIT. */
    heapGrowthBytes?: number;
    /** DOM node growth that reopens the page. Default NODE_GROWTH_LIMIT. */
    nodeGrowth?: number;
}

export const NO_RECYCLE: RecyclePolicy = {
    everyFrames: Number.POSITIVE_INFINITY,
    watchMemory: false,
};

/** Frames between two memory readings of a page; the first reading is the baseline. */
export const MEMORY_CHECK_FRAMES = 48;
/** JS heap growth over the baseline, after a garbage collection, that reopens the page. */
export const HEAP_GROWTH_LIMIT = 256 * 1024 * 1024;
/** DOM node growth over the baseline, after a garbage collection, that reopens the page. */
export const NODE_GROWTH_LIMIT = 20_000;
/** Frames a page renders at 1920x1080 before it is reopened; larger frames reopen sooner. */
export const PAGE_FRAMES_1080P = 2400;
export const MIN_PAGE_FRAMES = 600;

/**
 * The default recycling: a frame budget per page that shrinks with the
 * output size, plus the memory watch for pages that grow faster.
 */
export function autoRecycle(outputPixels: number): RecyclePolicy {
    const scaled = Math.round((PAGE_FRAMES_1080P * 1920 * 1080) / outputPixels);
    return {
        everyFrames: Math.min(PAGE_FRAMES_1080P, Math.max(MIN_PAGE_FRAMES, scaled)),
        watchMemory: true,
    };
}

/** Fewest frames worth a worker of its own: opening a page costs about a second. */
export const MIN_FRAMES_PER_JOB = 48;
/** Memory one worker (a browser with one page) takes, before its frame buffers. */
export const WORKER_BASE_BYTES = 300 * 1024 * 1024;
/** Frame-sized buffers one worker holds: layers, raster tiles, the screenshot and its copies. */
export const WORKER_FRAME_COPIES = 24;
/** Share of the machine's memory parallel workers may take. */
export const MEMORY_SHARE = 0.5;

export interface JobsPlan {
    jobs: number;
    /** Limit from CPU cores (cores - 1). */
    cpu: number;
    /** Limit from memory: half the machine's memory over one worker's estimate. */
    memory: number;
    /** Limit from length: one worker per MIN_FRAMES_PER_JOB frames. */
    frames: number;
}

/** How many workers render in parallel: `requested`, or the smallest of the three limits. */
export function planJobs(
    frameCount: number,
    outputPixels: number,
    requested?: number,
    machine: { cores: number; memoryBytes: number } = {
        cores: os.availableParallelism(),
        memoryBytes: os.totalmem(),
    },
): JobsPlan {
    const cpu = Math.max(1, machine.cores - 1);
    const perWorker = WORKER_BASE_BYTES + WORKER_FRAME_COPIES * outputPixels * 4;
    const memory = Math.max(1, Math.floor((machine.memoryBytes * MEMORY_SHARE) / perWorker));
    const frames = Math.max(1, Math.floor(frameCount / MIN_FRAMES_PER_JOB));
    const jobs = requested ?? Math.min(cpu, memory, frames);
    return { jobs: Math.max(1, Math.min(jobs, frameCount)), cpu, memory, frames };
}

export interface CaptureOptions {
    /** Opens pages. Workers run in parallel, each on its own page. */
    open: PageOpener;
    /** Called once per worker after its last page closed, to let go of its browser. */
    release?: (worker: number) => Promise<void>;
    /** Workers rendering at once. Default 1. */
    jobs?: number;
    recycle?: RecyclePolicy;
    encoder: Encoder;
    frameCount: number;
    /** Frames kept as PNG for the PSNR check. */
    sampleFrames: number[];
    /** Frames also captured with the content layer hidden. */
    baselineFrames: number[];
    /** Frames that get the glyph and font audit. */
    textFrames: number[];
    workspace: Workspace;
    /** Scratch directory inside the workspace for sample and baseline PNGs. */
    workDir: string;
    seekTimeoutMs?: number;
    /** Test hook: frames never written to the encoder. */
    dropFrames?: number[];
}

export interface PageStats {
    /** Pages opened over the whole render, the first page of every worker included. */
    opened: number;
    /** Pages reopened, by reason. */
    recycled: { frames: number; heap: number; nodes: number };
}

export interface CaptureOutput {
    hashes: string[];
    /** sha256 over the per-frame sha256 list. */
    digest: string;
    samples: Map<number, string>;
    baselines: Map<number, string>;
    /** Load problems, a failed seek, and the text audit, in frame order. */
    findings: Finding[];
    /** What the pages reported while they were open: console errors, a crash. */
    issues: Finding[];
    /** Set when the pipe to ffmpeg broke; the frames stop there. */
    pipeError: EncoderError | null;
    completed: boolean;
    captureMs: number;
    jobs: number;
    pages: PageStats;
}

/** Sequence file for the n-th kept frame; ffmpeg reads these back as f_%05d.png. */
export function sequenceFile(dir: string, ordinal: number): string {
    return path.join(dir, `f_${String(ordinal).padStart(5, '0')}.png`);
}

/** The ffmpeg input pattern for a directory written with sequenceFile. */
export function sequencePattern(dir: string): string {
    return path.join(dir, 'f_%05d.png');
}

function ordinals(frames: number[]): Map<number, number> {
    return new Map([...new Set(frames)].sort((a, b) => a - b).map((frame, i) => [frame, i]));
}

/**
 * Capture every frame and feed the encoder in frame order. `jobs` workers
 * each hold one page and take the next frame still to render, so a slow
 * worker never holds the others up; finished frames wait in a short queue
 * until the frames before them are written. Every frame is a pure function
 * of t, which check verifies, so which page draws which frame does not
 * change the pixels.
 *
 * Each worker reopens its page by the recycle policy. Nothing thrown by one
 * worker leaves another page open: all pages are closed before this returns
 * or throws.
 */
export async function captureFrames(options: CaptureOptions): Promise<CaptureOutput> {
    const { encoder, frameCount, workspace: ws } = options;
    const jobs = Math.max(1, Math.min(options.jobs ?? 1, Math.max(1, frameCount)));
    const recycle = options.recycle ?? NO_RECYCLE;
    const samplesDir = ws.fresh(path.join(options.workDir, 'samples'));
    const baselineDir = ws.fresh(path.join(options.workDir, 'baseline'));
    const sampleSet = ordinals(options.sampleFrames);
    const baselineSet = ordinals(options.baselineFrames);
    const textSet = new Set(options.textFrames);
    const dropSet = new Set(options.dropFrames ?? []);
    const hashes: string[] = new Array(frameCount);
    const samples = new Map<number, string>();
    const baselines = new Map<number, string>();
    const findings: Finding[] = [];
    const issues: Finding[] = [];
    const pages: PageStats = { opened: 0, recycled: { frames: 0, heap: 0, nodes: 0 } };
    // Frames finished ahead of the writer. Workers stop taking frames this far ahead.
    const maxAhead = Math.max(4, jobs * 2);
    const ready = new Map<number, Buffer>();
    const waiters: (() => void)[] = [];
    let nextClaim = 0;
    let nextWrite = 0;
    let stopped = false;
    let failure: unknown = null;
    let pipeError: EncoderError | null = null;
    const started = Date.now();
    let lastReport = started;

    const wake = () => {
        for (const waiter of waiters.splice(0)) waiter();
    };
    const halt = () => {
        stopped = true;
        wake();
    };
    const fail = (error: unknown) => {
        if (error instanceof EncoderError) pipeError ??= error;
        else failure ??= error;
        halt();
    };

    const claim = async (): Promise<number | null> => {
        for (;;) {
            if (stopped || nextClaim >= frameCount) return null;
            if (nextClaim - nextWrite < maxAhead) return nextClaim++;
            await new Promise<void>((resolve) => waiters.push(resolve));
        }
    };

    const drain = async () => {
        while (!stopped && ready.has(nextWrite)) {
            const frame = nextWrite;
            const png = ready.get(frame) as Buffer;
            ready.delete(frame);
            try {
                if (!dropSet.has(frame)) await encoder.write(png);
            } catch (error) {
                fail(error);
                return;
            }
            nextWrite += 1;
            wake();
            const now = Date.now();
            if (now - lastReport > 2000) {
                lastReport = now;
                const rate = nextWrite / ((now - started) / 1000);
                progress(
                    `frame ${nextWrite}/${frameCount} (${rate.toFixed(1)} fps${jobs > 1 ? `, ${jobs} pages` : ''})`,
                );
            }
        }
    };
    let writing: Promise<void> = Promise.resolve();
    const deliver = (frame: number, png: Buffer) => {
        ready.set(frame, png);
        writing = writing.then(drain);
    };

    /** Reason to reopen `page` now, reading its memory every MEMORY_CHECK_FRAMES frames. */
    const memoryVerdict = async (
        page: CompositionPage,
        state: { onPage: number; base: { heapBytes: number; nodes: number } | null },
    ): Promise<'heap' | 'nodes' | null> => {
        if (!recycle.watchMemory || state.onPage % MEMORY_CHECK_FRAMES !== 0) return null;
        if (!state.base) {
            state.base = await page.memory(true);
            return null;
        }
        const base = state.base;
        const heapLimit = recycle.heapGrowthBytes ?? HEAP_GROWTH_LIMIT;
        const nodeLimit = recycle.nodeGrowth ?? NODE_GROWTH_LIMIT;
        const grown = (m: { heapBytes: number; nodes: number }) =>
            m.heapBytes - base.heapBytes >= heapLimit
                ? 'heap'
                : m.nodes - base.nodes >= nodeLimit
                  ? 'nodes'
                  : null;
        if (!grown(await page.memory())) return null;
        // Garbage not yet collected is not growth: decide after a full collection.
        return grown(await page.memory(true));
    };

    const work = async (worker: number) => {
        let page: CompositionPage | null = null;
        const state: { onPage: number; base: { heapBytes: number; nodes: number } | null } = {
            onPage: 0,
            base: null,
        };
        const closePage = async () => {
            const current = page;
            page = null;
            if (!current) return;
            issues.push(...current.issues);
            try {
                await current.close();
            } catch (error) {
                fail(error);
            }
        };
        try {
            for (;;) {
                const frame = await claim();
                if (frame === null) break;
                if (page && state.onPage > 0) {
                    let reason: 'frames' | 'heap' | 'nodes' | null =
                        state.onPage >= recycle.everyFrames ? 'frames' : null;
                    reason ??= await memoryVerdict(page, state);
                    if (reason) {
                        pages.recycled[reason] += 1;
                        await closePage();
                    }
                }
                if (!page) {
                    if (stopped) break;
                    const opened = await options.open(worker);
                    pages.opened += 1;
                    page = opened.page;
                    state.onPage = 0;
                    state.base = null;
                    if (opened.findings.length > 0 || page.broken) {
                        findings.push(...opened.findings);
                        halt();
                        break;
                    }
                }
                const failed = await page.seek(frame, options.seekTimeoutMs);
                if (failed) {
                    findings.push(failed);
                    halt();
                    break;
                }
                const png = await page.capture();
                hashes[frame] = sha256(png);
                const sampleOrdinal = sampleSet.get(frame);
                if (sampleOrdinal !== undefined) {
                    const file = sequenceFile(samplesDir, sampleOrdinal);
                    ws.writeFile(file, png);
                    samples.set(frame, file);
                }
                if (textSet.has(frame)) findings.push(...(await auditFrameText(page, frame)));
                const baselineOrdinal = baselineSet.get(frame);
                if (baselineOrdinal !== undefined) {
                    await page.setContent(false);
                    const base = await page.capture();
                    await page.setContent(true);
                    const file = sequenceFile(baselineDir, baselineOrdinal);
                    ws.writeFile(file, base);
                    baselines.set(frame, file);
                }
                state.onPage += 1;
                deliver(frame, png);
            }
        } catch (error) {
            // A crashed page reports itself in its issues, and closing it tells
            // whether the system killed it; anything else is a real failure.
            if ((page as CompositionPage | null)?.broken) halt();
            else fail(error);
        } finally {
            await closePage();
            if (options.release) await options.release(worker).catch(fail);
        }
    };

    await Promise.all(Array.from({ length: jobs }, (_, worker) => work(worker)));
    await writing;
    if (failure) throw failure;
    const completed = !stopped && !pipeError && nextWrite === frameCount;
    const byFrame = (a: Finding, b: Finding) => (a.frame ?? -1) - (b.frame ?? -1);
    return {
        hashes: completed ? hashes : hashes.slice(0, nextWrite),
        digest: completed ? sha256(hashes.join('\n')) : '',
        samples,
        baselines,
        findings: findings.sort(byFrame),
        issues,
        pipeError,
        completed,
        captureMs: Date.now() - started,
        jobs,
        pages,
    };
}

/** Frames spread evenly over [0, frameCount), `count` of them, distinct and sorted. */
export function evenFrames(frameCount: number, count: number): number[] {
    if (frameCount <= 0) return [];
    if (count >= frameCount) return Array.from({ length: frameCount }, (_, i) => i);
    const out = new Set<number>();
    for (let i = 0; i < count; i++) {
        out.add(Math.round((i * (frameCount - 1)) / Math.max(1, count - 1)));
    }
    return [...out].sort((a, b) => a - b);
}
