import * as path from 'path';
import { recordRender } from '../engine/attempts.ts';
import { captureFrames, evenFrames } from '../engine/capture.ts';
import { Encoder, muxSoundtrack } from '../engine/encode.ts';
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
import { loadTimeline } from '../engine/timeline.ts';
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
    const session =
        options.session ??
        (await openSession(options.env).catch((error) => {
            release();
            throw error;
        }));
    rb.report.environment.chromium = session.chromium;
    rb.report.environment.ffmpeg = session.ffmpeg.version ?? undefined;
    const tmp = ws.fresh(ws.path('.flipbook', 'tmp', `render-${process.pid}-${Date.now()}`));
    const evidenceDir = ws.fresh(ws.path('.flipbook', 'evidence', 'render'));
    try {
        const { page, findings } = await openPage(session, {
            dir,
            timeline,
            readyTimeoutMs: options.readyTimeoutMs,
            env: options.env,
        });
        rb.addAll(findings);
        if (page.broken || findings.length > 0) {
            rb.addAll(page.issues);
            await page.close();
            return finish();
        }
        const video = path.join(tmp, 'video.mp4');
        const metadata = {
            flipbook: appVersion(),
            chromium: session.chromium.version,
            chromiumRevision: session.chromium.revision,
            launchMode: session.mode,
            platform: platformId(),
            composition: hash,
        };
        rb.report.metadata = metadata;
        const encoder = Encoder.start(session.ffmpeg.ffmpeg, {
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
        let captured: Awaited<ReturnType<typeof captureFrames>>;
        try {
            captured = await captureFrames({
                page,
                encoder,
                frameCount: timeline.frameCount,
                sampleFrames: evenFrames(timeline.frameCount, 8),
                baselineFrames: baselineFrames(timeline.frameCount, timeline.fps),
                textFrames,
                workspace: ws,
                workDir: tmp,
                seekTimeoutMs: options.seekTimeoutMs,
                dropFrames: options.dropFrames,
            });
        } catch (error) {
            encoder.abort();
            rb.addAll(page.issues);
            await page.close();
            rb.add(
                finding(
                    'glitch',
                    `The frame pipeline to ffmpeg broke: ${(error as Error).message.split('\n')[0]}`,
                    {
                        detail: { log: (error as Error).message },
                    },
                ),
            );
            return finish();
        }
        rb.addAll(page.issues);
        await page.close();
        rb.addAll(dedupe(captured.findings));
        if (!captured.completed) {
            encoder.abort();
            return finish();
        }
        const encodeStart = Date.now();
        try {
            await encoder.finish();
        } catch (error) {
            rb.add(
                finding(
                    'glitch',
                    `ffmpeg failed while encoding: ${(error as Error).message.split('\n')[0]}`,
                    {
                        detail: { log: (error as Error).message },
                    },
                ),
            );
            return finish();
        }
        const encodeMs = Date.now() - encodeStart;
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
                await muxSoundtrack(session.ffmpeg.ffmpeg, {
                    video,
                    audio: path.resolve(dir, timeline.audio.file),
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
            totalMs: Date.now() - started,
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
            rb.report.artifacts.rejectedVideo = ws.move(
                delivered,
                path.join(rejected, 'video.mp4'),
            );
            rb.report.artifacts.contactSheet = ws.move(
                sheet,
                path.join(rejected, 'contact-sheet.png'),
            );
        } else {
            rb.report.artifacts.video = ws.move(delivered, ws.path('out', 'video.mp4'));
            rb.report.artifacts.contactSheet = ws.move(sheet, ws.path('out', 'contact-sheet.png'));
        }
        return finish();
    } finally {
        ws.remove(tmp);
        release();
        if (!options.session) await session.close();
    }
}
