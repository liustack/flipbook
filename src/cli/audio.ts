import * as path from 'path';
import { needsSynthesis, synthesize } from '../engine/audio.ts';
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

/** Synthesize the preset music and effect cues to WAV files under .flipbook/audio/. */
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
    if (!needsSynthesis(timeline)) {
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
        progress(`audio: synthesizing ${timeline.durationSec.toFixed(2)} s`);
        const stems = await synthesize(session, timeline, ws, { force: true });
        rb.report.audio = {
            mode: timeline.audio.mode,
            preset: stems.preset,
            key: stems.keyName,
            progression: stems.progression,
            sampleRate: stems.sampleRate,
            samples: stems.length,
            durationSec: stems.durationSec,
            synthMs: stems.synthMs,
            music: stems.music,
            sfx: stems.sfx,
        };
        if (stems.music) rb.report.artifacts.music = stems.music.file;
        if (stems.sfx) rb.report.artifacts.sfx = stems.sfx.file;
        return rb.finish();
    } finally {
        release();
        if (!options.session) await session.close();
    }
}
