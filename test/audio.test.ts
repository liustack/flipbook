// The audio command, the soundtrack mix and its acceptance checks, in a real browser.
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runAudio } from '../src/cli/audio.ts';
import { runRender } from '../src/cli/render.ts';
import type { Report } from '../src/cli/report.ts';
import type { StemSet } from '../src/engine/audio.ts';
import { PRESETS } from '../src/engine/audioScore.ts';
import { loadTimeline } from '../src/engine/timeline.ts';
import { type AudioCheck, probeAudio } from '../src/engine/verify.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps, copyFixture, runCli, warningCodes } from './helpers.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

function editTimeline(dir: string, edit: (t: Record<string, unknown>) => void): void {
    const file = path.join(dir, 'timeline.json');
    const t = JSON.parse(fs.readFileSync(file, 'utf-8'));
    edit(t);
    fs.writeFileSync(file, JSON.stringify(t, null, 2));
}

function sha256(file: string): string {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** The stems are stereo float WAV with a 58-byte header. */
function readStem(file: string): { L: Float32Array; R: Float32Array } {
    const bytes = fs.readFileSync(file);
    const frames = bytes.readUInt32LE(54) / 8;
    const L = new Float32Array(frames);
    const R = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
        L[i] = bytes.readFloatLE(58 + i * 8);
        R[i] = bytes.readFloatLE(62 + i * 8);
    }
    return { L, R };
}

/** Write a sound made by an ffmpeg lavfi source into the composition, with its source and license. */
async function addSound(dir: string, name: string, lavfi: string, filter?: string): Promise<void> {
    const s = await session();
    const { run } = await import('../src/engine/proc.ts');
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    const made = await run(s.ffmpeg.ffmpeg, [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        lavfi,
        ...(filter ? ['-af', filter] : []),
        path.join(dir, 'assets', name),
    ]);
    expect(made.code).toBe(0);
    const file = path.join(dir, 'assets', 'SOURCES.json');
    const sources = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : {};
    sources[name] = { source: 'made by the test with ffmpeg', license: 'cc0' };
    fs.writeFileSync(file, JSON.stringify(sources, null, 4));
}

/** A tap: a quiet 44.1 kHz tone with one loud click 0.3 s in, so its peak sits well inside. */
const addTap = (dir: string) =>
    addSound(
        dir,
        'tap.wav',
        'sine=frequency=660:sample_rate=44100:duration=0.8',
        "volume='if(between(t,0.3,0.304),6,0.1)':eval=frame",
    );

function audioOf(report: Report): AudioCheck & { mix: Record<string, number> } {
    return (report.render as { audio: AudioCheck & { mix: Record<string, number> } }).audio;
}

describe('flipbook audio', () => {
    it('writes the same WAV bytes on every run', async () => {
        const dir = copyFixture('audio');
        const s = await session();
        const first = await runAudio({ dir, session: s });
        expect(first.failures).toEqual([]);
        expect(first.command).toBe('audio');
        const hashes = [sha256(first.artifacts.music), sha256(first.artifacts.sfx)];
        const second = await runAudio({ dir, session: s });
        expect([sha256(second.artifacts.music), sha256(second.artifacts.sfx)]).toEqual(hashes);
        const music = readStem(first.artifacts.music);
        expect(music.L.length).toBe(8 * 48000);
        const loudest = music.L.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
        expect(loudest).toBeGreaterThan(0.05);
    });

    it('puts the peak of every effect on its cue frame', async () => {
        const dir = copyFixture('audio');
        editTimeline(dir, (t) => {
            t.fps = 30;
            t.bpm = 110;
            t.audio = { mode: 'none', key: 'E' };
            t.cues = [
                { id: 'p', scene: 'a', beat: 0.5, kind: 'sfx', sfx: 'paper' },
                { id: 'd', scene: 'a', beat: 2.25, kind: 'sfx', sfx: 'drop' },
                { id: 's', scene: 'a', beat: 5, kind: 'sfx', sfx: 'sweep' },
                { id: 'g', scene: 'b', beat: 1.75, kind: 'sfx', sfx: 'ding' },
                { id: 'd2', scene: 'b', beat: 2.25, kind: 'sfx', sfx: 'drop' },
            ];
        });
        const report = await runAudio({ dir, session: await session() });
        expect(report.failures).toEqual([]);
        expect(report.artifacts.music).toBeUndefined();
        const stem = readStem(report.artifacts.sfx);
        const tl = loadTimeline(dir, false).resolved;
        const cues = (tl?.cues ?? []).filter((c) => c.kind === 'sfx');
        expect(cues).toHaveLength(5);
        const targets = cues.map((c) => Math.round((c.frame * 48000) / 30));
        targets.forEach((target, i) => {
            const gap = Math.min(
                ...targets.filter((_, j) => j !== i).map((other) => Math.abs(other - target)),
            );
            const radius = Math.min(Math.round(0.06 * 48000), gap >> 1);
            let peak = target;
            let value = -1;
            for (let k = target - radius; k <= target + radius; k++) {
                const v = Math.max(Math.abs(stem.L[k]), Math.abs(stem.R[k]));
                if (v > value) {
                    value = v;
                    peak = k;
                }
            }
            expect(
                Math.abs(peak - target),
                `${cues[i].id} peaks at ${peak}, cue at ${target}`,
            ).toBeLessThanOrEqual(48);
        });
        const meta = report.audio as { sfx: StemSet['sfx'] };
        expect(meta.sfx?.cues.map((c) => c.target)).toEqual(targets);
    });

    it("puts a sound file's loudest sample on its cue frame, without a browser for files alone", async () => {
        const dir = copyFixture('audio');
        await addTap(dir);
        editTimeline(dir, (t) => {
            t.fps = 30;
            t.audio = { mode: 'none' };
            t.cues = [
                { id: 'one', scene: 'a', beat: 1.5, kind: 'sfx', file: 'assets/tap.wav' },
                { id: 'two', scene: 'b', beat: 2, kind: 'sfx', file: 'assets/tap.wav' },
            ];
        });
        const report = await runAudio({ dir, session: await session() });
        expect(report.failures).toEqual([]);
        expect(report.artifacts.sfx).toBe(path.join(dir, '.flipbook', 'audio', 'effects.wav'));
        expect(fs.existsSync(path.join(dir, '.flipbook', 'audio', 'sfx.wav'))).toBe(false);
        const stem = readStem(report.artifacts.sfx);
        expect(stem.L.length).toBe(8 * 48000);
        const meta = report.audio as { sfx: NonNullable<StemSet['sfx']> };
        const cues = loadTimeline(dir, false).resolved?.cues ?? [];
        const targets = cues.map((c) => Math.round((c.frame * 48000) / 30));
        expect(targets).toEqual([36800, 240000]);
        expect(meta.sfx.cues.map((c) => [c.id, c.sfx, c.target])).toEqual([
            ['one', 'assets/tap.wav', targets[0]],
            ['two', 'assets/tap.wav', targets[1]],
        ]);
        for (const [i, target] of targets.entries()) {
            let peak = 0;
            for (let k = target - 4800; k <= target + 4800; k++) {
                if (Math.abs(stem.L[k]) > Math.abs(stem.L[peak])) peak = k;
            }
            expect(Math.abs(peak - target), `cue ${i}`).toBeLessThanOrEqual(2);
            expect(meta.sfx.cues[i].peakSample).toBe(peak);
        }
    });

    it('warns when there is nothing to synthesize', async () => {
        const dir = copyFixture('hello', 'examples');
        const report = await runAudio({ dir, session: await session() });
        expect(report.exitCode).toBe(0);
        expect(warningCodes(report)).toEqual(['audio-skipped']);
        expect(fs.existsSync(path.join(dir, '.flipbook', 'audio', 'music.wav'))).toBe(false);
    });

    it('runs from the built CLI', () => {
        const dir = copyFixture('audio');
        const result = runCli(['audio', dir]);
        expect(result.status).toBe(0);
        const report = result.json as { command: string; artifacts: Record<string, string> };
        expect(report.command).toBe('audio');
        expect(fs.existsSync(report.artifacts.music)).toBe(true);
        expect(fs.existsSync(report.artifacts.sfx)).toBe(true);
    });
});

describe('soundtrack', () => {
    for (const preset of PRESETS) {
        it(`${preset}: -14 LUFS, true peak under -1 dBTP, effects on their frames`, async () => {
            const dir = copyFixture('audio');
            editTimeline(dir, (t) => {
                (t.audio as Record<string, unknown>).preset = preset;
            });
            const rendered = await runRender({
                dir,
                session: await session(),
                recordAttempts: false,
            });
            expect(rendered.failures).toEqual([]);
            const audio = audioOf(rendered);
            expect(audio.codec).toBe('aac');
            expect(audio.loudnessChecked).toBe(true);
            expect(Math.abs((audio.integratedLufs as number) + 14)).toBeLessThanOrEqual(0.5);
            expect(audio.truePeakDbtp as number).toBeLessThanOrEqual(-1);
            expect(audio.cues).toHaveLength(4);
            for (const cue of audio.cues) {
                expect(Math.abs(cue.offsetMs as number), cue.id).toBeLessThanOrEqual(1);
            }
        });
    }

    it('effects alone: no loudness target, true peak checked', async () => {
        const dir = copyFixture('audio');
        editTimeline(dir, (t) => {
            t.audio = { mode: 'none' };
        });
        const rendered = await runRender({ dir, session: await session(), recordAttempts: false });
        expect(rendered.failures).toEqual([]);
        const audio = audioOf(rendered);
        expect(audio.loudnessChecked).toBe(false);
        expect(audio.integratedLufs as number).toBeLessThan(-15);
        expect(audio.truePeakDbtp as number).toBeLessThanOrEqual(-1);
        expect(audio.cues.every((c) => Math.abs(c.offsetMs as number) <= 1)).toBe(true);
    });

    it('no music and no effects: a silent video and no audio checks', async () => {
        const dir = copyFixture('audio');
        editTimeline(dir, (t) => {
            t.audio = { mode: 'none' };
            t.cues = [];
        });
        const s = await session();
        const rendered = await runRender({ dir, session: s, recordAttempts: false });
        expect(rendered.failures).toEqual([]);
        expect((rendered.render as { audio: unknown }).audio).toBeNull();
        expect(await probeAudio(s.ffmpeg.ffprobe, rendered.artifacts.video)).toBeNull();
        expect(fs.existsSync(path.join(dir, '.flipbook', 'audio', 'sfx.wav'))).toBe(false);
    });

    it("the user's music is brought to -14 LUFS with the effects on top", async () => {
        const dir = copyFixture('audio');
        const s = await session();
        await addSound(
            dir,
            'song.wav',
            'sine=frequency=330:sample_rate=48000:duration=10',
            'volume=0.05',
        );
        editTimeline(dir, (t) => {
            t.audio = { mode: 'file', file: 'assets/song.wav', bpmOffset: 0.25 };
        });
        const rendered = await runRender({ dir, session: s, recordAttempts: false });
        expect(rendered.failures).toEqual([]);
        const audio = audioOf(rendered);
        expect(audio.loudnessChecked).toBe(true);
        expect(Math.abs((audio.integratedLufs as number) + 14)).toBeLessThanOrEqual(0.5);
        expect(audio.mix.musicLufs).toBeLessThan(-25);
        expect(audio.cues.every((c) => Math.abs(c.offsetMs as number) <= 1)).toBe(true);
    });

    it('found sounds: preset music, built-in and file effects all land on their frames', async () => {
        const dir = copyFixture('audio');
        await addTap(dir);
        editTimeline(dir, (t) => {
            (t.cues as unknown[]).push({
                id: 'tap',
                scene: 'b',
                beat: 2,
                kind: 'sfx',
                file: 'assets/tap.wav',
            });
        });
        const rendered = await runRender({ dir, session: await session(), recordAttempts: false });
        expect(rendered.failures).toEqual([]);
        const audio = audioOf(rendered);
        expect(audio.cues.map((c) => c.id)).toEqual(['flip', 'land', 'whoosh', 'bell', 'tap']);
        for (const cue of audio.cues) {
            expect(Math.abs(cue.offsetMs as number), cue.id).toBeLessThanOrEqual(1);
        }
    });

    it('music from a file: offset skips into it, fadeIn and fadeOut shape it', async () => {
        const dir = copyFixture('audio');
        const s = await session();
        // Silent for 2 s, then a steady tone.
        await addSound(
            dir,
            'song.flac',
            'sine=frequency=330:sample_rate=48000:duration=12',
            "volume='if(gte(t,2),0.3,0)':eval=frame",
        );
        editTimeline(dir, (t) => {
            t.cues = [];
            t.audio = { mode: 'file', file: 'assets/song.flac', offset: 2, fadeIn: 1, fadeOut: 2 };
        });
        const rendered = await runRender({ dir, session: s, recordAttempts: false });
        expect(rendered.failures).toEqual([]);
        const { decodeMono } = await import('../src/engine/audio.ts');
        const pcm = await decodeMono(s.ffmpeg.ffmpeg, rendered.artifacts.video, 8000);
        const rms = (from: number, to: number) => {
            let sum = 0;
            for (let i = Math.round(from * 8000); i < Math.round(to * 8000); i++)
                sum += pcm[i] ** 2;
            return Math.sqrt(sum / ((to - from) * 8000));
        };
        const steady = rms(2, 5);
        expect(steady).toBeGreaterThan(0.05);
        // offset 2 skips the silence: the fade in starts right away.
        expect(rms(0.45, 0.55)).toBeGreaterThan(steady * 0.3);
        expect(rms(0.45, 0.55)).toBeLessThan(steady * 0.7);
        expect(rms(0, 0.05)).toBeLessThan(steady * 0.1);
        expect(rms(6.95, 7.05)).toBeGreaterThan(steady * 0.3);
        expect(rms(6.95, 7.05)).toBeLessThan(steady * 0.7);
        expect(rms(7.95, 8)).toBeLessThan(steady * 0.1);
    });
});
