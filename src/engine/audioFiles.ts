// Sound effects from files in the composition (sfx cues with `file`): each
// file is decoded to 48 kHz stereo, its loudest sample is found and placed on
// the cue frame, the same rule the synthesized effects follow. Together with
// the synthesized effects stem, if there is one, they become one effects
// track, .flipbook/audio/effects.wav, which render mixes and checks.
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { SOUNDTRACK_FORMATS, type StemCue, type StemSet, wavHeader } from './audio.ts';
import { frameSample, SAMPLE_RATE, scoreLength } from './audioScore.ts';
import { run, tail } from './proc.ts';
import type { ResolvedCue, ResolvedTimeline } from './timelineResolve.ts';
import type { Workspace } from './workspace.ts';

/** Where each effect file's loudest sample sits after scaling: about as loud as the built-in effects. */
export const FILE_SFX_PEAK = 0.6;
export const EFFECTS_FILE = 'effects.wav';

type EffectsStem = NonNullable<StemSet['sfx']>;

/** An audio file the timeline names that ffmpeg could not use. `at` is its JSON path. */
export class AudioFileError extends Error {
    readonly at: string;
    readonly file: string;

    constructor(at: string, file: string, message: string) {
        super(message);
        this.name = 'AudioFileError';
        this.at = at;
        this.file = file;
    }
}

/** The sfx cues that play a file, with the JSON path of their `file`. */
export function fileEffects(tl: ResolvedTimeline): { cue: ResolvedCue; at: string }[] {
    const out: { cue: ResolvedCue; at: string }[] = [];
    tl.cues.forEach((cue, i) => {
        if (cue.kind === 'sfx' && cue.file) out.push({ cue, at: `$.cues[${i}].file` });
    });
    return out;
}

interface Stereo {
    L: Float32Array;
    R: Float32Array;
}

/** A local audio file as 48 kHz stereo float samples, read only through the soundtrack demuxers. */
export async function decodeStereo(ffmpeg: string, file: string): Promise<Stereo> {
    const result = await run(
        ffmpeg,
        [
            '-v',
            'error',
            '-protocol_whitelist',
            'file',
            '-format_whitelist',
            SOUNDTRACK_FORMATS.join(','),
            '-i',
            file,
            '-map',
            '0:a:0',
            '-ac',
            '2',
            '-ar',
            String(SAMPLE_RATE),
            '-f',
            'f32le',
            '-',
        ],
        { timeoutMs: 600_000 },
    );
    if (result.code !== 0) throw new Error(tail(result.stderr, 3));
    const bytes = result.stdout;
    const frames = Math.floor(bytes.length / 8);
    const L = new Float32Array(frames);
    const R = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
        L[i] = bytes.readFloatLE(i * 8);
        R[i] = bytes.readFloatLE(i * 8 + 4);
    }
    return { L, R };
}

/** A stereo float WAV as written by wavHeader. */
function readFloatWav(file: string): Stereo {
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

/** Index and value of the loudest sample over both channels. */
function peakOf(
    sound: Stereo,
    from = 0,
    to = sound.L.length - 1,
): { index: number; value: number } {
    let index = Math.max(0, from);
    let value = -1;
    for (let i = Math.max(0, from); i <= Math.min(sound.L.length - 1, to); i++) {
        const v = Math.max(Math.abs(sound.L[i]), Math.abs(sound.R[i]));
        if (v > value) {
            value = v;
            index = i;
        }
    }
    return { index, value };
}

function toDb(value: number): number {
    return value > 0 ? Number((20 * Math.log10(value)).toFixed(2)) : Number.NEGATIVE_INFINITY;
}

/**
 * The effects track for a timeline with file effects: the synthesized
 * effects stem (when there is one) plus every file effect, its loudest sample
 * on its cue frame and scaled to FILE_SFX_PEAK. The part of a file before its
 * peak that would land before t = 0 is cut, and so is what runs past the end.
 * Returns `synthesized` untouched when no cue plays a file.
 */
export async function placeFileEffects(
    ffmpeg: string,
    dir: string,
    tl: ResolvedTimeline,
    ws: Workspace,
    synthesized: EffectsStem | null,
): Promise<EffectsStem | null> {
    const out = ws.path('.flipbook', 'audio', EFFECTS_FILE);
    const files = fileEffects(tl);
    if (files.length === 0) {
        ws.remove(out);
        return synthesized;
    }
    const length = scoreLength(tl);
    const mix: Stereo = { L: new Float32Array(length), R: new Float32Array(length) };
    if (synthesized) {
        const stem = readFloatWav(synthesized.file);
        mix.L.set(stem.L.subarray(0, length));
        mix.R.set(stem.R.subarray(0, length));
    }
    const decoded = new Map<string, Stereo>();
    for (const { cue, at } of files) {
        const file = cue.file as string;
        let sound = decoded.get(file);
        if (!sound) {
            try {
                sound = await decodeStereo(ffmpeg, path.resolve(dir, file));
            } catch (error) {
                throw new AudioFileError(
                    at,
                    file,
                    `${at} names ${file}, which ffmpeg could not read as audio: ${(error as Error).message}`,
                );
            }
            decoded.set(file, sound);
        }
        const peak = peakOf(sound);
        if (peak.value <= 0) {
            throw new AudioFileError(at, file, `${at} names ${file}, which is silent`);
        }
        const gain = FILE_SFX_PEAK / peak.value;
        const start = frameSample(cue.frame, tl.fps) - peak.index;
        const from = Math.max(0, -start);
        const to = Math.min(sound.L.length, length - start);
        for (let k = from; k < to; k++) {
            mix.L[start + k] += sound.L[k] * gain;
            mix.R[start + k] += sound.R[k] * gain;
        }
    }

    // Where each effect actually peaks in the track: the loudest sample near
    // its cue, looking no further than halfway to the next effect.
    const sfxCues = tl.cues.filter((cue) => cue.kind === 'sfx');
    const targets = sfxCues.map((cue) => frameSample(cue.frame, tl.fps));
    const cues: StemCue[] = sfxCues.map((cue, i) => {
        const target = targets[i];
        const gaps = targets
            .filter((other, j) => j !== i && other !== target)
            .map((other) => Math.abs(other - target) >> 1);
        const radius = Math.max(1, Math.min(Math.round(0.05 * SAMPLE_RATE), ...gaps));
        return {
            id: cue.id,
            sfx: cue.file ?? (cue.sfx as string),
            frame: cue.frame,
            target,
            peakSample: peakOf(mix, target - radius, target + radius).index,
        };
    });

    const body = Buffer.alloc(length * 8);
    for (let i = 0; i < length; i++) {
        body.writeFloatLE(mix.L[i], i * 8);
        body.writeFloatLE(mix.R[i], i * 8 + 4);
    }
    const bytes = Buffer.concat([wavHeader(length, SAMPLE_RATE), body]);
    const file = ws.writeFile(out, bytes);
    return {
        file,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        peakDb: toDb(peakOf(mix).value),
        cues,
    };
}
