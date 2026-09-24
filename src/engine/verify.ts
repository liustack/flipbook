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
import type { Workspace } from './workspace.ts';

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
    /** Where evidence images are kept; inside the workspace, outliving the render's tmp. */
    evidenceDir: string;
    workspace: Workspace;
}

/**
 * Audio acceptance: sfx peaks against cue frames and loudness. The audio
 * track arrives with the audio command (v0.3); until then the video is
 * silent, and a timeline that asks for sound gets a warning.
 */
export function verifyAudio(timeline: ResolvedTimeline): Finding[] {
    if (timeline.audio.mode !== 'preset') return [];
    return [
        finding(
            'audio-skipped',
            `audio mode "${timeline.audio.mode}" is not rendered in this version, so the video is silent.`,
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

/** Consecutive frames without content, whether flat or paper only. */
interface EmptyRun {
    from: number;
    to: number;
    blank: number;
    paper: number;
}

/** Part of a frozen span that lies in consecutive scenes without hold. */
export interface FreezePiece {
    start: number;
    end: number;
    scenes: string[];
}

/**
 * Cut a frozen span at the scenes marked hold. Neighbouring scenes without
 * hold stay together: a scene boundary does not mean the picture changed.
 */
export function freezePieces(
    span: { start: number; end: number },
    scenes: ResolvedTimeline['scenes'],
): FreezePiece[] {
    const pieces: FreezePiece[] = [];
    let current: FreezePiece | null = null;
    for (const scene of scenes) {
        const from = Math.max(span.start, scene.start);
        const to = Math.min(span.end, scene.end);
        if (to <= from) continue;
        if (scene.hold) {
            if (current) pieces.push(current);
            current = null;
        } else if (current && Math.abs(current.end - from) < 1e-9) {
            current.end = to;
            current.scenes.push(scene.id);
        } else {
            if (current) pieces.push(current);
            current = { start: from, end: to, scenes: [scene.id] };
        }
    }
    if (current) pieces.push(current);
    return pieces.filter((piece) => piece.end - piece.start >= STILL_LIMIT_SEC - 1e-6);
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
                `The video has ${probe.frames} frames, the timeline has ${timeline.frameCount}.`,
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
                `The video lasts ${probe.durationSec.toFixed(3)} s, the timeline lasts ${expected.toFixed(3)} s.`,
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
                `Stream reports ${probe.pixFmt} ${probe.colorSpace}/${probe.colorPrimaries}/${probe.colorTransfer}, expected yuv420p bt709.`,
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
    const runs: EmptyRun[] = [];
    let current: EmptyRun | null = null;
    await streamGray(ffmpeg.ffmpeg, video, (index, pixels) => {
        let kind: 'blank' | 'paper' | 'content' = 'content';
        if (isFlat(pixels)) kind = 'blank';
        else {
            const base = nearestBaseline(index);
            if (base && matchesBaseline(pixels, base)) kind = 'paper';
        }
        if (kind === 'content') {
            if (current) runs.push(current);
            current = null;
            return;
        }
        current ??= { from: index, to: index, blank: 0, paper: 0 };
        current.to = index;
        current[kind] += 1;
    });
    if (current) runs.push(current);
    const minFrames = Math.ceil(STILL_LIMIT_SEC * fps);
    for (const r of runs) {
        if (r.to - r.from + 1 < minFrames) continue;
        // One run of frames without content; the code names the more common reason.
        const code = r.blank >= r.paper ? 'blank-frame' : 'paper-only';
        const evidence = path.join(options.evidenceDir, `${code}-f${r.from}.png`);
        await extractFrame(ffmpeg.ffmpeg, video, r.from, evidence);
        const seconds = (r.to - r.from + 1) / fps;
        const reason =
            r.blank > 0 && r.paper > 0
                ? `${r.blank} flat and ${r.paper} paper-only`
                : r.blank > 0
                  ? 'flat, empty'
                  : 'paper-only';
        findings.push(
            finding(
                code,
                `${seconds.toFixed(2)} s without content (${reason} frames) from ${(r.from / fps).toFixed(2)} s to ${((r.to + 1) / fps).toFixed(2)} s.`,
                {
                    time: r.from / fps,
                    frame: r.from,
                    evidence: [evidence],
                    detail: {
                        fromFrame: r.from,
                        toFrame: r.to,
                        seconds,
                        blankFrames: r.blank,
                        paperFrames: r.paper,
                    },
                },
            ),
        );
    }

    // Freezes longer than the limit, outside scenes marked hold.
    for (const span of await freezeSpans(ffmpeg.ffmpeg, video, probe.durationSec)) {
        for (const piece of freezePieces(span, timeline.scenes)) {
            const seconds = piece.end - piece.start;
            const frame = Math.round(piece.start * fps);
            const evidence = path.join(options.evidenceDir, `freeze-f${frame}.png`);
            await extractFrame(
                ffmpeg.ffmpeg,
                video,
                Math.min(frame, Math.max(0, probe.frames - 1)),
                evidence,
            );
            const where =
                piece.scenes.length === 1
                    ? `in scene "${piece.scenes[0]}"`
                    : `across scenes ${piece.scenes.map((id) => `"${id}"`).join(', ')}`;
            findings.push(
                finding(
                    'freeze',
                    `The picture does not change for ${seconds.toFixed(2)} s ${where} (from ${piece.start.toFixed(2)} s).`,
                    {
                        time: piece.start,
                        frame,
                        element:
                            piece.scenes.length === 1
                                ? `scene ${piece.scenes[0]}`
                                : `scenes ${piece.scenes.join(', ')}`,
                        evidence: [evidence],
                        detail: {
                            scene: piece.scenes[0],
                            scenes: piece.scenes,
                            start: piece.start,
                            end: piece.end,
                            seconds,
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
            const captured = options.workspace.copyFile(
                options.samples.get(first.frame) as string,
                path.join(options.evidenceDir, `glitch-f${first.frame}-captured.png`),
            );
            const decodedFile = path.join(
                options.evidenceDir,
                `glitch-f${first.frame}-decoded.png`,
            );
            await extractFrame(ffmpeg.ffmpeg, video, first.frame, decodedFile);
            findings.push(
                finding(
                    'glitch',
                    `${worst.length} of ${sampleFrames.length} sampled frames differ from their captures (lowest ${Math.min(...worst.map((w) => w.db)).toFixed(1)} dB, threshold ${GLITCH_PSNR_DB} dB).`,
                    {
                        time: first.frame / fps,
                        frame: first.frame,
                        evidence: [captured, decodedFile],
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

export interface AudioProbe {
    codec: string;
    sampleRate: number;
    channels: number;
    durationSec: number;
}

export async function probeAudio(ffprobe: string, file: string): Promise<AudioProbe | null> {
    const result = await run(
        ffprobe,
        [
            '-v',
            'error',
            '-select_streams',
            'a:0',
            '-show_entries',
            'stream=codec_name,sample_rate,channels,duration',
            '-of',
            'json',
            file,
        ],
        { timeoutMs: 120_000 },
    );
    if (result.code !== 0) return null;
    const stream = (
        JSON.parse(result.stdout.toString('utf-8')) as {
            streams?: Record<string, string | number>[];
        }
    ).streams?.[0];
    if (!stream) return null;
    return {
        codec: String(stream.codec_name ?? ''),
        sampleRate: Number(stream.sample_rate ?? 0),
        channels: Number(stream.channels ?? 0),
        durationSec: Number(stream.duration ?? 0),
    };
}

/**
 * The muxed soundtrack against the picture: an audio stream must exist and
 * its length must match the video within one frame or one AAC packet,
 * whichever is longer.
 */
export async function verifySoundtrack(
    ffprobe: string,
    video: string,
    timeline: ResolvedTimeline,
): Promise<{ findings: Finding[]; audio: AudioProbe | null }> {
    const audio = await probeAudio(ffprobe, video);
    const expected = timeline.frameCount / timeline.fps;
    if (!audio) {
        return {
            audio,
            findings: [
                finding(
                    'duration-mismatch',
                    'The video has no audio stream although timeline.json sets audio.mode "file".',
                    {
                        detail: { audio: timeline.audio },
                    },
                ),
            ],
        };
    }
    const tolerance = Math.max(1 / timeline.fps, 1024 / (audio.sampleRate || 48000));
    const drift = Math.abs(audio.durationSec - expected);
    return {
        audio,
        findings:
            drift > tolerance + 1e-6
                ? [
                      finding(
                          'duration-mismatch',
                          `The audio lasts ${audio.durationSec.toFixed(3)} s, the picture lasts ${expected.toFixed(3)} s.`,
                          {
                              detail: { audio: audio.durationSec, video: expected, tolerance },
                          },
                      ),
                  ]
                : [],
    };
}
