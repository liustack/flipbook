import * as path from 'path';
import { evenFrames } from '../engine/capture.ts';
import { contactSheet, sheetLayout, writeSequence } from '../engine/pixels.ts';
import {
    compositionDir,
    indexFinding,
    openPage,
    openSession,
    outputLinksFinding,
    type Session,
} from '../engine/session.ts';
import { applySize, type SizeSpec } from '../engine/size.ts';
import { loadTimeline } from '../engine/timeline.ts';
import { type ResolvedTimeline, sceneAtFrame } from '../engine/timelineResolve.ts';
import { compositionHash, sha256, Workspace } from '../engine/workspace.ts';
import { progress, type Report, ReportBuilder, UsageError } from './report.ts';

export interface Region {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface SnapshotOptions {
    dir: string;
    /** Stage size in place of the timeline's width and height. */
    size?: SizeSpec;
    /** Evenly spaced frames on top of one per scene. */
    count?: number;
    /** Region (CSS px) to capture enlarged at each `at` time. */
    zoom?: Region;
    /** Seconds to capture the zoom at; defaults to each scene's middle. */
    at?: number[];
    /** Enlargement for zoom captures. */
    scale?: number;
    seekTimeoutMs?: number;
    readyTimeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    session?: Session;
}

/** Scene middles plus `count` even frames, distinct and sorted. */
export function snapshotFrames(timeline: ResolvedTimeline, count: number): number[] {
    const mids = timeline.scenes.map((scene) =>
        Math.min(timeline.frameCount - 1, Math.floor((scene.startFrame + scene.endFrame) / 2)),
    );
    return [...new Set([...mids, ...evenFrames(timeline.frameCount, count)])].sort((a, b) => a - b);
}

export function parseRegion(raw: string): Region {
    const parts = raw.split(',').map((part) => Number(part.trim()));
    if (
        parts.length !== 4 ||
        parts.some((n) => !Number.isFinite(n)) ||
        parts[2] <= 0 ||
        parts[3] <= 0
    ) {
        throw new UsageError(
            '--zoom takes x,y,width,height in CSS pixels, e.g. --zoom 100,80,640,360',
        );
    }
    return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

/** Frames at scene middles and even times, tiled into one contact sheet PNG. */
export async function runSnapshot(options: SnapshotOptions): Promise<Report> {
    const dir = compositionDir(options.dir);
    const rb = new ReportBuilder('snapshot', dir);
    const ws = Workspace.open(dir);
    const unsafe = outputLinksFinding(ws);
    if (unsafe) {
        rb.add(unsafe);
        return rb.finish();
    }
    const missingIndex = indexFinding(dir);
    if (missingIndex) rb.add(missingIndex);
    const loaded = loadTimeline(dir);
    rb.addAll(loaded.findings);
    if (!loaded.resolved || missingIndex) return rb.finish();
    const timeline = applySize(loaded.resolved, options.size);
    rb.report.composition = {
        dir,
        hash: compositionHash(dir),
        width: timeline.width,
        height: timeline.height,
        fps: timeline.fps,
        frames: timeline.frameCount,
        durationSec: timeline.durationSec,
    };
    const stage = ws.fresh(ws.path('.flipbook', 'snapshot'));
    const session = options.session ?? (await openSession(options.env));
    rb.report.environment.chromium = session.chromium;
    rb.report.environment.ffmpeg = session.ffmpeg.version ?? undefined;
    try {
        const { page, findings } = await openPage(session, {
            dir,
            timeline,
            readyTimeoutMs: options.readyTimeoutMs,
            env: options.env,
        });
        rb.addAll(findings);
        const frames = snapshotFrames(timeline, options.count ?? 12);
        const shots: Buffer[] = [];
        const zoomFrames: number[] = [];
        try {
            if (!page.broken && findings.length === 0) {
                for (const frame of frames) {
                    const failed = await page.seek(frame, options.seekTimeoutMs);
                    if (failed) {
                        rb.add(failed);
                        break;
                    }
                    shots.push(await page.capture());
                }
                if (options.zoom && !rb.hasErrors()) {
                    const times =
                        options.at && options.at.length > 0
                            ? options.at.map((t) =>
                                  Math.min(
                                      timeline.frameCount - 1,
                                      Math.max(0, Math.round(t * timeline.fps)),
                                  ),
                              )
                            : timeline.scenes.map((scene) =>
                                  Math.min(
                                      timeline.frameCount - 1,
                                      Math.floor((scene.startFrame + scene.endFrame) / 2),
                                  ),
                              );
                    for (const frame of times) {
                        const failed = await page.seek(frame, options.seekTimeoutMs);
                        if (failed) {
                            rb.add(failed);
                            break;
                        }
                        ws.writeFile(
                            path.join(stage, `zoom-f${frame}.png`),
                            await page.capture({ ...options.zoom, scale: options.scale ?? 2 }),
                        );
                        zoomFrames.push(frame);
                    }
                }
            }
        } finally {
            rb.addAll(page.issues);
            await page.close();
        }
        const outDir = ws.path('out', 'snapshot');
        const zooms = zoomFrames.map((frame) =>
            ws.move(
                path.join(stage, `zoom-f${frame}.png`),
                path.join(outDir, `zoom-f${frame}.png`),
            ),
        );
        if (shots.length > 0) {
            const layout = sheetLayout(shots.length, timeline.width, timeline.height);
            const pattern = writeSequence(ws, path.join(stage, 'frames'), shots);
            const staged = path.join(stage, 'contact-sheet.png');
            progress(`snapshot: tiling ${shots.length} frames ${layout.cols}x${layout.rows}`);
            await contactSheet(session.ffmpeg.ffmpeg, ['-i', pattern], layout, staged);
            const sheet = ws.move(staged, path.join(outDir, 'contact-sheet.png'));
            rb.report.artifacts.contactSheet = sheet;
            // Hashed the way render hashes its frames, so a digest pins these exact pixels.
            const hashes = shots.map((shot) => sha256(shot));
            rb.report.snapshot = {
                layout,
                tiles: frames.slice(0, shots.length).map((frame, index) => ({
                    index,
                    row: Math.floor(index / layout.cols),
                    col: index % layout.cols,
                    frame,
                    time: Number((frame / timeline.fps).toFixed(3)),
                    scene: sceneAtFrame(timeline, frame).id,
                    sha256: hashes[index],
                })),
                digest: sha256(hashes.join('\n')),
                zooms,
            };
        }
        zooms.forEach((file, i) => {
            rb.report.artifacts[`zoom${i + 1}`] = file;
        });
    } finally {
        if (!options.session) await session.close();
    }
    return rb.finish();
}
