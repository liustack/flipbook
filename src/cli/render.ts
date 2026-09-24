import * as path from 'path';
import { recordRender } from '../engine/attempts.ts';
import { type CaptureOutput, captureFrames, evenFrames } from '../engine/capture.ts';
import { Encoder, EncoderError, muxSoundtrack } from '../engine/encode.ts';
import { contactSheet, selectExpr, sheetLayout } from '../engine/pixels.ts';
import {
    compositionDir,
    indexFinding,
    openPage,
    openSession,
    outputLinksFinding,
    type Session,
} from '../engine/session.ts';
import { dedupe } from '../engine/textAudit.ts';
import { audioSource, loadTimeline } from '../engine/timeline.ts';
import type { ResolvedTimeline } from '../engine/timelineResolve.ts';
import { verifySoundtrack, verifyVideo } from '../engine/verify.ts';
import { acquireLock, compositionHash, Workspace } from '../engine/workspace.ts';
import { appVersion } from '../paths.ts';
import { finding, platformId, progress, type Report, ReportBuilder } from './report.ts';

export interface RenderOptions {
    dir: string;
    seekTimeoutMs?: number;
    readyTimeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    session?: Session;
    recordAttempts?: boolean;
    /** Test hook: frames captured but never handed to the encoder. */
    dropFrames?: number[];
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
    const timeline = loaded.resolved;
    if (!timeline || missingIndex) return finish();
    const hash = compositionHash(dir);
    rb.report.composition = {
        dir,
        hash,
        width: timeline.width,
        height: timeline.height,
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
    timeline: ResolvedTimeline;
    hash: string;
    session: Session;
    tmp: string;
    evidenceDir: string;
    started: number;
}

/**
 * Open the page, feed every frame to ffmpeg and wait for the video. Null when
 * the page or the encoder failed; the reason is in the report.
 */
async function encodeFrames(
    ctx: RenderContext,
    video: string,
): Promise<{ captured: CaptureOutput; encodeMs: number } | null> {
    const { options, rb, session, timeline } = ctx;
    let encoder: Encoder | null = null;
    let finishing = false;
    try {
        const { page, findings } = await openPage(session, {
            dir: ctx.dir,
            timeline,
            readyTimeoutMs: options.readyTimeoutMs,
            env: options.env,
        });
        let captured: CaptureOutput;
        try {
            rb.addAll(findings);
            if (page.broken || findings.length > 0) return null;
            const metadata = {
                flipbook: appVersion(),
                chromium: session.chromium.version,
                chromiumRevision: session.chromium.revision,
                launchMode: session.mode,
                platform: platformId(),
                composition: ctx.hash,
            };
            rb.report.metadata = metadata;
            encoder = Encoder.start(session.ffmpeg.ffmpeg, {
                fps: timeline.fps,
                output: video,
                metadata,
            });
            const textFrames = [
                ...new Set([
                    ...timeline.cues.filter((c) => c.kind === 'text').map((c) => c.settleFrame),
                    ...evenFrames(timeline.frameCount, 3),
                ]),
            ];
            progress(`render: ${timeline.frameCount} frames at ${timeline.fps} fps`);
            try {
                captured = await captureFrames({
                    page,
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
            } catch (error) {
                // A crashed page is already in page.issues as page-error.
                if (page.broken) return null;
                if (!(error instanceof EncoderError)) throw error;
                rb.add(
                    finding(
                        'glitch',
                        `The frame pipeline to ffmpeg broke: ${error.message.split('\n')[0]}`,
                        { detail: { log: error.message } },
                    ),
                );
                return null;
            }
        } finally {
            rb.addAll(page.issues);
            await page.close();
        }
        rb.addAll(dedupe(captured.findings));
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
        if (encoder && !finishing) await encoder.abort();
    }
}

/** Render, verify, and move the video to out/ (passed) or .flipbook/rejected/ (failed). */
async function renderVideo(ctx: RenderContext): Promise<void> {
    const { rb, ws, dir, timeline, session, tmp, evidenceDir } = ctx;
    const video = path.join(tmp, 'video.mp4');
    const encoded = await encodeFrames(ctx, video);
    if (!encoded) return;
    const { captured, encodeMs } = encoded;
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
    let soundtrack: Awaited<ReturnType<typeof verifySoundtrack>>['audio'] = null;
    if (timeline.audio.mode === 'file' && timeline.audio.file) {
        progress('render: adding the soundtrack');
        delivered = path.join(tmp, 'video-with-audio.mp4');
        try {
            const source = audioSource(dir, timeline.audio.file);
            if ('problem' in source) throw new Error(source.problem);
            await muxSoundtrack(session.ffmpeg.ffmpeg, {
                video,
                audio: source.file,
                offsetSec: timeline.audio.bpmOffset ?? 0,
                durationSec: timeline.frameCount / timeline.fps,
                output: delivered,
            });
            const checked = await verifySoundtrack(session.ffmpeg.ffprobe, delivered, timeline);
            rb.addAll(checked.findings);
            soundtrack = checked.audio;
        } catch (error) {
            delivered = video;
            rb.add(
                finding(
                    'timeline-invalid',
                    `$.audio.file could not be used as a soundtrack: ${(error as Error).message.split('\n')[0]}`,
                    {
                        detail: { path: '$.audio.file', log: (error as Error).message },
                    },
                ),
            );
        }
    }
    const verifyMs = Date.now() - verifyStart;
    rb.report.render = {
        frames: timeline.frameCount,
        fps: timeline.fps,
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
