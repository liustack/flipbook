import * as fs from 'fs';
import * as path from 'path';
import { type Finding, finding } from '../cli/report.ts';
import { sequencePattern } from './capture.ts';
import type { Ffmpeg } from './ffmpeg.ts';
import {
    decodeGray,
    decodeRgb,
    extractFrame,
    isFlat,
    matchesBaseline,
    psnr,
    selectExpr,
    streamGray,
} from './pixels.ts';
import { run, tail } from './proc.ts';
import type { ResolvedTimeline } from './timelineResolve.ts';

/** Seconds of blank, paper-only or frozen picture allowed in a row. */
export const STILL_LIMIT_SEC = 1.5;
/** PSNR (dB) below which a decoded frame no longer matches its capture. */
export const GLITCH_PSNR_DB = 30;

export interface VideoProbe {
    frames: number;
    durationSec: number;
    width: number;
    height: number;
    pixFmt: string;
    colorSpace: string;
    colorPrimaries: string;
    colorTransfer: string;
    colorRange: string;
    comment: string | null;
}

export async function probeVideo(ffprobe: string, video: string): Promise<VideoProbe> {
    const result = await run(
        ffprobe,
        [
            '-v',
            'error',
            '-select_streams',
            'v:0',
            '-count_frames',
            '-show_entries',
            'stream=nb_read_frames,width,height,pix_fmt,color_space,color_primaries,color_transfer,color_range:format=duration:format_tags=comment',
            '-of',
            'json',
            video,
        ],
        { timeoutMs: 300_000 },
    );
    if (result.code !== 0) throw new Error(`ffprobe failed: ${tail(result.stderr)}`);
    const data = JSON.parse(result.stdout.toString('utf-8')) as {
        streams?: Record<string, string | number>[];
        format?: { duration?: string; tags?: { comment?: string } };
    };
    const stream = data.streams?.[0] ?? {};
    return {
        frames: Number(stream.nb_read_frames ?? 0),
        durationSec: Number(data.format?.duration ?? 0),
        width: Number(stream.width ?? 0),
        height: Number(stream.height ?? 0),
        pixFmt: String(stream.pix_fmt ?? ''),
        colorSpace: String(stream.color_space ?? ''),
        colorPrimaries: String(stream.color_primaries ?? ''),
        colorTransfer: String(stream.color_transfer ?? ''),
        colorRange: String(stream.color_range ?? ''),
        comment: data.format?.tags?.comment ?? null,
    };
}

export interface VerifyOptions {
    ffmpeg: Ffmpeg;
    video: string;
    timeline: ResolvedTimeline;
    samples: Map<number, string>;
    baselines: Map<number, string>;
    evidenceDir: string;
}

/**
 * Audio acceptance: sfx peaks against cue frames and loudness. The audio
 * track arrives with the audio command (v0.3); until then the video is
 * silent, and a timeline that asks for sound gets a warning.
 */
export function verifyAudio(timeline: ResolvedTimeline): Finding[] {
    if (timeline.audio.mode === 'none') return [];
    return [
        finding(
            'audio-skipped',
            `audio mode "${timeline.audio.mode}" is not rendered in this version; the video is silent.`,
            {
                severity: 'warning',
                detail: { audio: timeline.audio },
            },
        ),
    ];
}

export interface VerifyOutput {
    findings: Finding[];
    probe: VideoProbe;
}

type Kind = 'blank' | 'paper' | 'content';

interface Run {
    kind: Kind;
    from: number;
    to: number;
}

/** Frozen spans reported by ffmpeg freezedetect on the downscaled, blurred video. */
export async function freezeSpans(
    ffmpeg: string,
    video: string,
    durationSec: number,
): Promise<{ start: number; end: number }[]> {
    const result = await run(
        ffmpeg,
        [
            '-hide_banner',
            '-nostats',
            '-i',
            video,
            '-vf',
            `scale=320:180:flags=area,gblur=sigma=1.5,freezedetect=n=-60dB:d=${STILL_LIMIT_SEC}`,
            '-map',
            '0:v',
            '-f',
            'null',
            '-',
        ],
        { timeoutMs: 600_000 },
    );
    if (result.code !== 0) throw new Error(`ffmpeg freezedetect failed: ${tail(result.stderr)}`);
    const spans: { start: number; end: number }[] = [];
    let open: number | null = null;
    for (const line of result.stderr.split('\n')) {
        const start = /freeze_start:\s*([\d.]+)/.exec(line);
        if (start) open = Number(start[1]);
        const end = /freeze_end:\s*([\d.]+)/.exec(line);
        if (end && open !== null) {
            spans.push({ start: open, end: Number(end[1]) });
            open = null;
        }
    }
    if (open !== null) spans.push({ start: open, end: durationSec });
    return spans;
}

/** Acceptance checks on the encoded video. */
export async function verifyVideo(options: VerifyOptions): Promise<VerifyOutput> {
    const { ffmpeg, video, timeline } = options;
    const findings: Finding[] = [];
    const fps = timeline.fps;
    const probe = await probeVideo(ffmpeg.ffprobe, video);

    if (probe.frames !== timeline.frameCount) {
        findings.push(
            finding(
                'frame-count',
                `The video has ${probe.frames} frames; the timeline has ${timeline.frameCount}.`,
                {
                    detail: { video: probe.frames, timeline: timeline.frameCount },
                },
            ),
        );
    }
    const expected = timeline.frameCount / fps;
    if (Math.abs(probe.durationSec - expected) > 1 / fps + 1e-6) {
        findings.push(
            finding(
                'duration-mismatch',
                `The video lasts ${probe.durationSec.toFixed(3)} s; the timeline lasts ${expected.toFixed(3)} s.`,
                {
                    detail: { video: probe.durationSec, timeline: expected },
                },
            ),
        );
    }
    const tags = [probe.pixFmt, probe.colorSpace, probe.colorPrimaries, probe.colorTransfer];
    if (tags[0] !== 'yuv420p' || tags.slice(1).some((tag) => tag !== 'bt709')) {
        findings.push(
            finding(
                'color-tags',
                `Stream reports ${probe.pixFmt} ${probe.colorSpace}/${probe.colorPrimaries}/${probe.colorTransfer}; expected yuv420p bt709.`,
                {
                    detail: { ...probe },
                },
            ),
        );
    }

    // Blank and paper-only runs, frame by frame against the nearest baseline.
    const baselineFrames = [...options.baselines.keys()].sort((a, b) => a - b);
    const baselineGray =
        baselineFrames.length > 0
            ? await decodeGray(ffmpeg.ffmpeg, [
                  '-i',
                  sequencePattern(path.dirname(options.baselines.get(baselineFrames[0]) as string)),
              ])
            : [];
    const byFrame = new Map<number, Uint8Array>();
    baselineFrames.forEach((frame, i) => {
        if (baselineGray[i]) byFrame.set(frame, baselineGray[i]);
    });
    const nearestBaseline = (frame: number): Uint8Array | null => {
        let best: number | null = null;
        for (const candidate of baselineFrames) {
            if (best === null || Math.abs(candidate - frame) < Math.abs(best - frame))
                best = candidate;
        }
        return best === null ? null : (byFrame.get(best) ?? null);
    };
    const runs: Run[] = [];
    let current: Run | null = null;
    await streamGray(ffmpeg.ffmpeg, video, (index, pixels) => {
        let kind: Kind = 'content';
        if (isFlat(pixels)) kind = 'blank';
        else {
            const base = nearestBaseline(index);
            if (base && matchesBaseline(pixels, base)) kind = 'paper';
        }
        if (current && current.kind === kind && current.to === index - 1) {
            current.to = index;
        } else {
            if (current) runs.push(current);
            current = { kind, from: index, to: index };
        }
    });
    if (current) runs.push(current);
    const minFrames = Math.ceil(STILL_LIMIT_SEC * fps);
    for (const r of runs) {
        if (r.kind === 'content' || r.to - r.from + 1 < minFrames) continue;
        const evidence = path.join(
            options.evidenceDir,
            `${r.kind === 'blank' ? 'blank-frame' : 'paper-only'}-f${r.from}.png`,
        );
        await extractFrame(ffmpeg.ffmpeg, video, r.from, evidence).catch(() => undefined);
        const seconds = (r.to - r.from + 1) / fps;
        findings.push(
            finding(
                r.kind === 'blank' ? 'blank-frame' : 'paper-only',
                `${seconds.toFixed(2)} s of ${r.kind === 'blank' ? 'flat, empty' : 'paper-only'} frames from ${(r.from / fps).toFixed(2)} s to ${((r.to + 1) / fps).toFixed(2)} s.`,
                {
                    time: r.from / fps,
                    frame: r.from,
                    evidence: fs.existsSync(evidence) ? [evidence] : [],
                    detail: { fromFrame: r.from, toFrame: r.to, seconds },
                },
            ),
        );
    }

    // Freezes longer than the limit inside scenes without hold.
    for (const span of await freezeSpans(ffmpeg.ffmpeg, video, probe.durationSec)) {
        for (const scene of timeline.scenes) {
            if (scene.hold) continue;
            const overlap = Math.min(span.end, scene.end) - Math.max(span.start, scene.start);
            if (overlap < STILL_LIMIT_SEC - 1e-6) continue;
            const from = Math.max(span.start, scene.start);
            const frame = Math.round(from * fps);
            const evidence = path.join(options.evidenceDir, `freeze-f${frame}.png`);
            await extractFrame(
                ffmpeg.ffmpeg,
                video,
                Math.min(frame, Math.max(0, probe.frames - 1)),
                evidence,
            ).catch(() => undefined);
            findings.push(
                finding(
                    'freeze',
                    `The picture does not change for ${overlap.toFixed(2)} s in scene "${scene.id}" (from ${from.toFixed(2)} s).`,
                    {
                        time: from,
                        frame,
                        element: `scene ${scene.id}`,
                        evidence: fs.existsSync(evidence) ? [evidence] : [],
                        detail: {
                            scene: scene.id,
                            start: span.start,
                            end: span.end,
                            seconds: overlap,
                        },
                    },
                ),
            );
        }
    }

    // Decoded frames against their captures.
    const sampleFrames = [...options.samples.keys()].sort((a, b) => a - b);
    if (sampleFrames.length > 0) {
        const decoded = await decodeRgb(
            ffmpeg.ffmpeg,
            ['-i', video],
            undefined,
            undefined,
            selectExpr(sampleFrames),
        );
        const captured = await decodeRgb(ffmpeg.ffmpeg, [
            '-i',
            sequencePattern(path.dirname(options.samples.get(sampleFrames[0]) as string)),
        ]);
        const worst: { frame: number; db: number }[] = [];
        sampleFrames.forEach((frame, i) => {
            const a = decoded[i];
            const b = captured[i];
            const db = a && b ? psnr(a, b) : 0;
            if (db < GLITCH_PSNR_DB) worst.push({ frame, db });
        });
        if (worst.length > 0) {
            const first = worst[0];
            findings.push(
                finding(
                    'glitch',
                    `${worst.length} of ${sampleFrames.length} sampled frames differ from their captures (lowest ${Math.min(...worst.map((w) => w.db)).toFixed(1)} dB, threshold ${GLITCH_PSNR_DB} dB).`,
                    {
                        time: first.frame / fps,
                        frame: first.frame,
                        evidence: [options.samples.get(first.frame) as string],
                        detail: {
                            frames: worst.map((w) => ({
                                frame: w.frame,
                                psnrDb: Number(w.db.toFixed(2)),
                            })),
                        },
                    },
                ),
            );
        }
    }
    findings.push(...verifyAudio(timeline));
    return { findings, probe };
}
