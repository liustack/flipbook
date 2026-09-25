import * as path from 'path';
import { recordRender } from '../engine/attempts.ts';
import {
    type MixOptions,
    type MixResult,
    mixSoundtrack,
    needsSoundtrack,
    needsSynthesis,
    requireAudioFfmpeg,
    type StemSet,
    synthesize,
} from '../engine/audio.ts';
import { AudioFileError, placeFileEffects } from '../engine/audioFiles.ts';
import {
    autoRecycle,
    type CaptureOutput,
    captureFrames,
    evenFrames,
    type JobsPlan,
    NO_RECYCLE,
    planJobs,
    type RecyclePolicy,
} from '../engine/capture.ts';
import { Encoder, EncoderError } from '../engine/encode.ts';
import { contactSheet, selectExpr, sheetLayout } from '../engine/pixels.ts';
import {
    compositionDir,
    indexFinding,
    openSession,
    outputLinksFinding,
    type PageSlot,
    pageSlot,
    type Session,
} from '../engine/session.ts';
import { applySize, outputSize, type SizeSpec } from '../engine/size.ts';
import { dedupe } from '../engine/textAudit.ts';
import { audioSource, loadTimeline } from '../engine/timeline.ts';
import type { ResolvedTimeline } from '../engine/timelineResolve.ts';
import { verifyAudio, verifyVideo } from '../engine/verify.ts';
import { acquireLock, compositionHash, Workspace } from '../engine/workspace.ts';
import { appVersion } from '../paths.ts';
import {
    type Determinism,
    finding,
    platformId,
    progress,
    type Report,
    ReportBuilder,
} from './report.ts';

export interface RenderOptions {
    dir: string;
    /** Stage size in place of the timeline's width and height. */
    size?: SizeSpec;
    /** Device scale factor: output pixels per CSS pixel. Default 1. */
    scale?: number;
    /** Pages rendering at once. Default: planJobs. More than 1 needs a passing check. */
    jobs?: number;
    /** Frames per page before it is reopened; 0 never reopens. Default: autoRecycle. */
    recycleFrames?: number;
    /** Test hook: the whole recycle policy, in place of recycleFrames. */
    recycle?: RecyclePolicy;
    seekTimeoutMs?: number;
    readyTimeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    session?: Session;
    recordAttempts?: boolean;
    /** Test hook: frames captured but never handed to the encoder. */
    dropFrames?: number[];
    /** Test hook: seconds the effects are moved later in the mix. */
    audioShiftSec?: number;
}

/** Every second of frames, plus the last one. */
function baselineFrames(frameCount: number, fps: number): number[] {
    const frames: number[] = [];
    for (let frame = 0; frame < frameCount; frame += fps) frames.push(frame);
    if (frameCount > 0 && frames[frames.length - 1] !== frameCount - 1) frames.push(frameCount - 1);
    return frames;
}

/** Render every frame to MP4, verify the result, and publish it to out/ only when it passes. */
export async function runRender(options: RenderOptions): Promise<Report> {
    const dir = compositionDir(options.dir);
    const rb = new ReportBuilder('render', dir);
    const ws = Workspace.open(dir);
    const unsafe = outputLinksFinding(ws);
    if (unsafe) {
        rb.add(unsafe);
        return rb.finish();
    }
    const started = Date.now();
    let counted = true;
    const finish = () => {
        if (counted && options.recordAttempts !== false) {
            const verdict = recordRender(dir, [...new Set(rb.report.failures.map((f) => f.code))]);
            rb.report.attempts = verdict.summary;
            rb.report.stop = verdict.stop;
            if (verdict.reason) rb.report.stopReason = verdict.reason;
        }
        return rb.finish();
    };

    const missingIndex = indexFinding(dir);
    if (missingIndex) rb.add(missingIndex);
    const loaded = loadTimeline(dir);
    rb.addAll(loaded.findings);
    if (!loaded.resolved || missingIndex) return finish();
    const timeline = applySize(loaded.resolved, options.size);
    const scale = options.scale ?? 1;
    const output = outputSize(timeline, scale);
    const hash = compositionHash(dir, timeline);
    rb.report.composition = {
        dir,
        hash,
        width: timeline.width,
        height: timeline.height,
        scale,
        fps: timeline.fps,
        frames: timeline.frameCount,
        durationSec: timeline.durationSec,
    };

    const release = acquireLock(dir);
    if (!release) {
        counted = false;
        rb.add(
            finding(
                'render-busy',
                `Another render holds ${path.join(dir, '.flipbook', 'render.lock')}.`,
            ),
        );
        return finish();
    }
    // Each resource is released in its own finally, so one failing cleanup never skips the rest.
    try {
        const tmp = ws.fresh(ws.path('.flipbook', 'tmp', `render-${process.pid}-${Date.now()}`));
        try {
            const evidenceDir = ws.fresh(ws.path('.flipbook', 'evidence', 'render'));
            const session = options.session ?? (await openSession(options.env));
            try {
                rb.report.environment.chromium = session.chromium;
                rb.report.environment.ffmpeg = session.ffmpeg.version ?? undefined;
                await renderVideo({
                    options,
                    rb,
                    ws,
                    dir,
                    timeline,
                    scale,
                    output,
                    hash,
                    session,
                    tmp,
                    evidenceDir,
                    started,
                });
            } finally {
                if (!options.session) await session.close();
            }
        } finally {
            ws.remove(tmp);
        }
    } finally {
        release();
    }
    return finish();
}

interface RenderContext {
    options: RenderOptions;
    rb: ReportBuilder;
    ws: Workspace;
    dir: string;
    /** The timeline with --size applied. */
    timeline: ResolvedTimeline;
    scale: number;
    output: { width: number; height: number };
    hash: string;
    session: Session;
    tmp: string;
    evidenceDir: string;
    started: number;
}

/** Why the last check lets render run pages in parallel, or why it does not. */
export interface ParallelGate {
    allowed: boolean;
    reason?: string;
}

/** What the gate calls each determinism check in a reason. */
const DETERMINISM_LABELS: Record<keyof Determinism, string> = {
    seekOrder: 'seek order',
    perturbation: 'shifted clock and seed',
    latePaint: 'late paint',
};

/** What a check has to have run on for its determinism checks to cover this render. */
export interface GateInput {
    hash: string;
    width: number;
    height: number;
    scale: number;
}

/**
 * Parallel pages only for a composition whose determinism checks passed: the
 * saved report of the last check must be for these exact files at this stage
 * size and scale (a composition may lay out differently at another size),
 * this flipbook and this Chromium, and its seek order, perturbation and late
 * paint checks must all have passed. Other failures in that check do not matter
 * here, since pages only differ from one another in which frames they draw.
 */
export function parallelGate(ws: Workspace, input: GateInput, session: Session): ParallelGate {
    let text: string | null;
    try {
        text = ws.readText(ws.path('.flipbook', 'reports', 'check.json'));
    } catch {
        text = null;
    }
    if (text === null) return { allowed: false, reason: 'no check report for this composition' };
    let report: Partial<Report>;
    try {
        report = JSON.parse(text) as Partial<Report>;
    } catch {
        return { allowed: false, reason: 'the saved check report is not valid JSON' };
    }
    const checked = report.composition;
    if (report.command !== 'check' || checked?.hash !== input.hash) {
        return { allowed: false, reason: 'the last check ran on other files' };
    }
    if (checked.width !== input.width || checked.height !== input.height) {
        return {
            allowed: false,
            reason: `the last check ran at ${checked.width}x${checked.height}, this render is ${input.width}x${input.height}: run check with the same --size`,
        };
    }
    if ((checked.scale ?? 1) !== input.scale) {
        return {
            allowed: false,
            reason: `the last check ran at --scale ${checked.scale ?? 1}, this render at --scale ${input.scale}: run check with the same --scale`,
        };
    }
    if (report.flipbook?.version !== appVersion()) {
        return { allowed: false, reason: 'the last check ran on another flipbook version' };
    }
    if (report.environment?.chromium?.revision !== session.chromium.revision) {
        return { allowed: false, reason: 'the last check ran on another Chromium' };
    }
    const determinism = (report.check as { determinism?: Partial<Determinism> } | undefined)
        ?.determinism;
    const keys = Object.keys(DETERMINISM_LABELS) as (keyof Determinism)[];
    const failed = keys.filter((key) => determinism?.[key] === 'fail');
    if (failed.length > 0) {
        return {
            allowed: false,
            reason: `the last check failed the determinism checks: ${failed.map((key) => DETERMINISM_LABELS[key]).join(', ')}`,
        };
    }
    if (!keys.every((key) => determinism?.[key] === 'pass')) {
        return { allowed: false, reason: 'the last check did not finish the determinism checks' };
    }
    return { allowed: true };
}

/**
 * Open the pages, feed every frame to ffmpeg and wait for the video. Null when
 * a page or the encoder failed; the reason is in the report.
 */
async function encodeFrames(
    ctx: RenderContext,
    video: string,
): Promise<{ captured: CaptureOutput; encodeMs: number } | null> {
    const { options, rb, session, timeline, output } = ctx;
    const pixels = output.width * output.height;
    const plan: JobsPlan = planJobs(timeline.frameCount, pixels, options.jobs);
    const requested = plan.jobs;
    let gate: ParallelGate = { allowed: true };
    if (plan.jobs > 1) {
        gate = parallelGate(
            ctx.ws,
            { hash: ctx.hash, width: timeline.width, height: timeline.height, scale: ctx.scale },
            session,
        );
        if (!gate.allowed) {
            plan.jobs = 1;
            progress(`render: one page, ${gate.reason}. Run check first for parallel pages.`);
        }
    }
    const recycle: RecyclePolicy =
        options.recycle ??
        (options.recycleFrames === undefined
            ? autoRecycle(pixels)
            : options.recycleFrames === 0
              ? NO_RECYCLE
              : { everyFrames: options.recycleFrames, watchMemory: false });
    // Filled in again with the rest of the render section once the video passes through.
    rb.report.render = {
        output: { ...output, scale: ctx.scale },
        parallel: {
            jobs: plan.jobs,
            requested: options.jobs ?? 'auto',
            planned: requested,
            limits: { cpu: plan.cpu, memory: plan.memory, frames: plan.frames, max: plan.max },
            ...(gate.reason ? { reason: gate.reason } : {}),
        },
        recycle: {
            everyFrames: Number.isFinite(recycle.everyFrames) ? recycle.everyFrames : null,
            watchMemory: recycle.watchMemory,
        },
    };
    const metadata = {
        flipbook: appVersion(),
        chromium: session.chromium.version,
        chromiumRevision: session.chromium.revision,
        launchMode: session.mode,
        platform: platformId(),
        composition: ctx.hash,
        stage: `${timeline.width}x${timeline.height}`,
        scale: ctx.scale,
    };
    rb.report.metadata = metadata;
    const encoder = Encoder.start(session.ffmpeg.ffmpeg, {
        fps: timeline.fps,
        output: video,
        metadata,
    });
    let finishing = false;
    const slots = new Map<number, PageSlot>();
    try {
        const textFrames = [
            ...new Set([
                ...timeline.cues.filter((c) => c.kind === 'text').map((c) => c.settleFrame),
                ...evenFrames(timeline.frameCount, 3),
            ]),
        ];
        progress(
            `render: ${timeline.frameCount} frames at ${timeline.fps} fps, ${output.width}x${output.height}, ${plan.jobs} page${plan.jobs === 1 ? '' : 's'}`,
        );
        const captured = await captureFrames({
            open: (worker) => {
                let slot = slots.get(worker);
                if (!slot) {
                    slot = pageSlot(session, worker);
                    slots.set(worker, slot);
                }
                return slot.open({
                    dir: ctx.dir,
                    timeline,
                    deviceScaleFactor: ctx.scale,
                    readyTimeoutMs: options.readyTimeoutMs,
                    env: options.env,
                });
            },
            release: async (worker) => {
                await slots.get(worker)?.close();
            },
            jobs: plan.jobs,
            recycle,
            encoder,
            frameCount: timeline.frameCount,
            sampleFrames: evenFrames(timeline.frameCount, 8),
            baselineFrames: baselineFrames(timeline.frameCount, timeline.fps),
            textFrames,
            workspace: ctx.ws,
            workDir: ctx.tmp,
            seekTimeoutMs: options.seekTimeoutMs,
            dropFrames: options.dropFrames,
        });
        rb.addAll(dedupe(captured.issues));
        rb.addAll(dedupe(captured.findings));
        if (captured.pipeError) {
            rb.add(
                finding(
                    'glitch',
                    `The frame pipeline to ffmpeg broke: ${captured.pipeError.message.split('\n')[0]}`,
                    { detail: { log: captured.pipeError.message } },
                ),
            );
            return null;
        }
        if (!captured.completed) return null;
        const encodeStart = Date.now();
        finishing = true;
        try {
            await encoder.finish();
        } catch (error) {
            if (!(error instanceof EncoderError)) throw error;
            rb.add(
                finding('glitch', `ffmpeg failed while encoding: ${error.message.split('\n')[0]}`, {
                    detail: { log: error.message },
                }),
            );
            return null;
        }
        return { captured, encodeMs: Date.now() - encodeStart };
    } finally {
        // finish() stops ffmpeg itself when it fails; before that, stop it here.
        if (!finishing) await encoder.abort();
    }
}

/** Render, verify, and move the video to out/ (passed) or .flipbook/rejected/ (failed). */
async function renderVideo(ctx: RenderContext): Promise<void> {
    const { options, rb, ws, dir, timeline, session, tmp, evidenceDir } = ctx;
    const audioFfmpeg = needsSoundtrack(timeline) ? await requireAudioFfmpeg(options.env) : null;
    let stems: StemSet | null = null;
    if (needsSynthesis(timeline)) {
        progress('render: synthesizing audio');
        stems = await synthesize(session, timeline, ws);
    }
    let effects = stems?.sfx ?? null;
    if (audioFfmpeg) {
        try {
            effects = await placeFileEffects(audioFfmpeg.ffmpeg, dir, timeline, ws, effects);
        } catch (error) {
            if (!(error instanceof AudioFileError)) throw error;
            rb.add(
                finding('timeline-invalid', error.message.split('\n')[0], {
                    element: error.file,
                    detail: { path: error.at, log: error.message },
                }),
            );
            return;
        }
    }
    const video = path.join(tmp, 'video.mp4');
    const encoded = await encodeFrames(ctx, video);
    if (!encoded) return;
    const { captured, encodeMs } = encoded;
    const early = rb.report.render as Record<string, unknown>;
    ws.writeFile(
        ws.path('.flipbook', 'frame-hashes.json'),
        `${JSON.stringify({ digest: captured.digest, hashes: captured.hashes }, null, 2)}\n`,
    );
    progress('render: verifying the video');
    const verifyStart = Date.now();
    const verified = await verifyVideo({
        ffmpeg: session.ffmpeg,
        video,
        timeline,
        samples: captured.samples,
        baselines: captured.baselines,
        evidenceDir,
        workDir: tmp,
        workspace: ws,
    });
    rb.addAll(verified.findings);
    const sheetFrames = evenFrames(
        Math.min(timeline.frameCount, verified.probe.frames || timeline.frameCount),
        12,
    );
    const layout = sheetLayout(sheetFrames.length, timeline.width, timeline.height);
    const sheet = path.join(tmp, 'contact-sheet.png');
    await contactSheet(
        session.ffmpeg.ffmpeg,
        ['-i', video],
        layout,
        sheet,
        selectExpr(sheetFrames),
    );
    let delivered = video;
    let soundtrack: Record<string, unknown> | null = null;
    if (audioFfmpeg) {
        progress('render: mixing the soundtrack');
        const withAudio = path.join(tmp, 'video-with-audio.mp4');
        const userFile = timeline.audio.mode === 'file' ? timeline.audio.file : undefined;
        const userProblem = (message: string) =>
            rb.add(
                finding(
                    'timeline-invalid',
                    `$.audio.file could not be used as a soundtrack: ${message.split('\n')[0]}`,
                    { detail: { path: '$.audio.file', log: message } },
                ),
            );
        let music: MixOptions['music'];
        if (userFile) {
            const source = audioSource(dir, userFile);
            if ('problem' in source) {
                userProblem(source.problem);
            } else {
                music = {
                    file: source.file,
                    offsetSec: timeline.audio.offset ?? timeline.audio.bpmOffset ?? 0,
                    user: true,
                    fadeInSec: timeline.audio.fadeIn,
                    fadeOutSec: timeline.audio.fadeOut,
                };
            }
        } else if (stems?.music) {
            music = { file: stems.music.file, offsetSec: 0, user: false };
        }
        const mixOptions: MixOptions = {
            ffmpeg: audioFfmpeg.ffmpeg,
            video,
            output: withAudio,
            durationSec: timeline.frameCount / timeline.fps,
            music,
            sfx: effects ? { file: effects.file, peakDb: effects.peakDb } : undefined,
            shiftSfxSec: options.audioShiftSec,
        };
        let mixed: MixResult | null = null;
        if (mixOptions.music || mixOptions.sfx) {
            try {
                mixed = await mixSoundtrack(mixOptions);
                delivered = withAudio;
            } catch (error) {
                if (!userFile) throw error;
                userProblem((error as Error).message);
            }
        }
        if (mixed) {
            const checked = await verifyAudio({
                ffmpeg: audioFfmpeg,
                video: delivered,
                timeline,
                effects: effects ? { file: effects.file, cues: effects.cues } : null,
                mix: mixOptions,
            });
            rb.addAll(checked.findings);
            soundtrack = {
                ...checked.audio,
                preset: stems?.preset ?? null,
                key: stems?.keyName ?? null,
                synthMs: stems?.synthMs ?? null,
                stemsReused: stems?.reused ?? null,
                mix: mixed,
            };
        }
    }
    const verifyMs = Date.now() - verifyStart;
    rb.report.render = {
        ...early,
        frames: timeline.frameCount,
        fps: timeline.fps,
        pages: captured.pages,
        digest: captured.digest,
        captureMs: captured.captureMs,
        encodeMs,
        verifyMs,
        totalMs: Date.now() - ctx.started,
        captureFps: Number((timeline.frameCount / (captured.captureMs / 1000)).toFixed(1)),
        probe: verified.probe,
        audio: soundtrack,
        contactSheetTiles: sheetFrames.map((frame) => ({
            frame,
            time: Number((frame / timeline.fps).toFixed(3)),
        })),
    };
    if (rb.hasErrors()) {
        const rejected = ws.fresh(ws.path('.flipbook', 'rejected'));
        rb.report.artifacts.rejectedVideo = ws.move(delivered, path.join(rejected, 'video.mp4'));
        rb.report.artifacts.contactSheet = ws.move(sheet, path.join(rejected, 'contact-sheet.png'));
    } else {
        rb.report.artifacts.video = ws.move(delivered, ws.path('out', 'video.mp4'));
        rb.report.artifacts.contactSheet = ws.move(sheet, ws.path('out', 'contact-sheet.png'));
    }
}
