import * as path from 'path';
import { needsSynthesis, type StemSet, synthesize } from '../engine/audio.ts';
import { AudioFileError, fileEffects, placeFileEffects } from '../engine/audioFiles.ts';
import { SAMPLE_RATE, scoreLength } from '../engine/audioScore.ts';
import {
    compositionDir,
    openSession,
    outputLinksFinding,
    type Session,
} from '../engine/session.ts';
import { loadTimeline } from '../engine/timeline.ts';
import { acquireLock, Workspace } from '../engine/workspace.ts';
import { finding, progress, type Report, ReportBuilder } from './report.ts';

export interface AudioOptions {
    dir: string;
    env?: NodeJS.ProcessEnv;
    session?: Session;
}

/**
 * Synthesize the preset or score music and effect cues to WAV files under
 * .flipbook/audio/, and lay effects from files over them into effects.wav.
 */
export async function runAudio(options: AudioOptions): Promise<Report> {
    const dir = compositionDir(options.dir);
    const rb = new ReportBuilder('audio', dir);
    const ws = Workspace.open(dir);
    const unsafe = outputLinksFinding(ws);
    if (unsafe) {
        rb.add(unsafe);
        return rb.finish();
    }
    const loaded = loadTimeline(dir);
    rb.addAll(loaded.findings);
    const timeline = loaded.resolved;
    if (!timeline) return rb.finish();
    rb.report.composition = {
        dir,
        width: timeline.width,
        height: timeline.height,
        fps: timeline.fps,
        frames: timeline.frameCount,
        durationSec: timeline.durationSec,
    };
    if (!needsSynthesis(timeline) && fileEffects(timeline).length === 0) {
        rb.add(
            finding(
                'audio-skipped',
                `Nothing to synthesize: audio.mode is "${timeline.audio.mode}" and there are no sfx cues.`,
                { severity: 'warning', detail: { audio: timeline.audio } },
            ),
        );
        return rb.finish();
    }
    const release = acquireLock(dir);
    if (!release) {
        rb.add(
            finding(
                'render-busy',
                `Another render holds ${path.join(dir, '.flipbook', 'render.lock')}.`,
            ),
        );
        return rb.finish();
    }
    const session =
        options.session ??
        (await openSession(options.env).catch((error) => {
            release();
            throw error;
        }));
    try {
        rb.report.environment.chromium = session.chromium;
        rb.report.environment.ffmpeg = session.ffmpeg.version ?? undefined;
        let stems: StemSet | null = null;
        if (needsSynthesis(timeline)) {
            progress(`audio: synthesizing ${timeline.durationSec.toFixed(2)} s`);
            stems = await synthesize(session, timeline, ws, { force: true });
        }
        let effects: StemSet['sfx'];
        try {
            effects = await placeFileEffects(
                session.ffmpeg.ffmpeg,
                dir,
                timeline,
                ws,
                stems?.sfx ?? null,
            );
        } catch (error) {
            if (!(error instanceof AudioFileError)) throw error;
            rb.add(
                finding('timeline-invalid', error.message.split('\n')[0], {
                    element: error.file,
                    detail: { path: error.at, log: error.message },
                }),
            );
            return rb.finish();
        }
        const length = stems?.length ?? scoreLength(timeline);
        rb.report.audio = {
            mode: timeline.audio.mode,
            preset: stems?.preset ?? null,
            key: stems?.keyName ?? null,
            progression: stems?.progression ?? null,
            sampleRate: stems?.sampleRate ?? SAMPLE_RATE,
            samples: length,
            durationSec: length / SAMPLE_RATE,
            synthMs: stems?.synthMs ?? null,
            music: stems?.music ?? null,
            sfx: effects,
        };
        if (stems?.music) rb.report.artifacts.music = stems.music.file;
        if (effects) rb.report.artifacts.sfx = effects.file;
        return rb.finish();
    } finally {
        release();
        if (!options.session) await session.close();
    }
}
