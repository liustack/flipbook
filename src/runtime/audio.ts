// flipbook audio runtime, served at /__flipbook/audio.js. `flipbook audio`
// and `flipbook render` open a blank page, import this module, call
// render(score) and pull the PCM back with chunk(). Compositions never
// import it.
import type { Score, SfxName } from '../engine/audioScore.ts';
import { addBus, peakOf } from './audio/dsp.ts';
import { audioBus, runChain } from './audio/master.ts';
import { arrange, MASTER } from './audio/presets.ts';
import { renderSfx, SFX_GAIN } from './audio/sfx.ts';
import { hash32 } from './core/random.ts';

export const AUDIO_PROTOCOL = 1;
/** Stereo frames per chunk handed back to Node: 2 MB of float32. */
export const CHUNK_FRAMES = 1 << 18;
/** RMS the music pre-mix is scaled to before the compressor. */
const PREMIX_RMS = 0.1;

export type StemName = 'music' | 'sfx';

export interface StemInfo {
    chunks: number;
    /** Largest absolute sample. */
    peak: number;
}

export interface SfxPlacement {
    id: string;
    name: SfxName;
    /** The cue frame on the sample grid. */
    target: number;
    /** Where the loudest sample of the rendered stem sits near the cue. */
    peakSample: number;
}

export interface RenderResult {
    protocol: typeof AUDIO_PROTOCOL;
    sampleRate: number;
    length: number;
    channels: 2;
    chunkFrames: number;
    stems: Partial<Record<StemName, StemInfo>>;
    sfx: SfxPlacement[];
}

const rendered = new Map<StemName, AudioBuffer>();

function stemInfo(buffer: AudioBuffer): StemInfo {
    const { value } = peakOf({ L: buffer.getChannelData(0), R: buffer.getChannelData(1) });
    return { chunks: Math.ceil(buffer.length / CHUNK_FRAMES), peak: value };
}

async function renderMusic(score: Score): Promise<AudioBuffer | null> {
    if (!score.preset) return null;
    const sr = score.sampleRate;
    const main = audioBus(score.length, sr);
    const air = audioBus(score.length, sr);
    arrange(score, score.preset, { main: main.bus, air: air.bus }, sr);
    let energy = 0;
    for (let i = 0; i < score.length; i++) {
        const l = main.bus.L[i] + air.bus.L[i];
        const r = main.bus.R[i] + air.bus.R[i];
        energy += l * l + r * r;
    }
    const rms = Math.sqrt(energy / (2 * score.length));
    if (rms > 0) {
        const gain = PREMIX_RMS / rms;
        for (const b of [main.bus, air.bus]) {
            for (let i = 0; i < score.length; i++) {
                b.L[i] *= gain;
                b.R[i] *= gain;
            }
        }
    }
    const settings = MASTER[score.preset];
    return runChain(main.buffer, air.buffer, {
        ...settings,
        highpass: 40,
        compress: true,
        fadeOut: Math.min(0.3, score.durationSec / 4),
        seed: hash32(score.seed, 'room'),
    });
}

/** Loudest sample within `radius` of `center`. */
function localPeak(buffer: AudioBuffer, center: number, radius: number): number {
    const L = buffer.getChannelData(0);
    const R = buffer.getChannelData(1);
    let best = Math.min(Math.max(0, center), buffer.length - 1);
    let value = -1;
    for (
        let i = Math.max(0, center - radius);
        i <= Math.min(buffer.length - 1, center + radius);
        i++
    ) {
        const v = Math.max(Math.abs(L[i]), Math.abs(R[i]));
        if (v > value) {
            value = v;
            best = i;
        }
    }
    return best;
}

async function renderEffects(
    score: Score,
): Promise<{ buffer: AudioBuffer; placed: SfxPlacement[] } | null> {
    if (score.sfx.length === 0) return null;
    const sr = score.sampleRate;
    const main = audioBus(score.length, sr);
    const air = audioBus(score.length, sr);
    for (const cue of score.sfx) {
        const effect = renderSfx(cue.name, score.key, hash32(score.seed, 'sfx', cue.id), sr);
        const peak = peakOf(effect);
        if (peak.value <= 0) continue;
        addBus(main.bus, cue.sample - peak.index, effect, SFX_GAIN[cue.name] / peak.value);
    }
    const buffer = await runChain(main.buffer, air.buffer, {
        reverbSec: 0.7,
        sendMain: 0.25,
        sendAir: 0,
        wet: 0.2,
        highpass: 0,
        lowpass: 0,
        compress: false,
        fadeOut: 0,
        seed: hash32(score.seed, 'sfx-room'),
    });
    const placed = score.sfx.map((cue, i) => {
        const gaps = [score.sfx[i - 1]?.sample, score.sfx[i + 1]?.sample]
            .filter((s): s is number => s !== undefined && s !== cue.sample)
            .map((s) => Math.abs(s - cue.sample));
        const radius = Math.max(1, Math.min(Math.round(0.05 * sr), ...gaps.map((g) => g >> 1)));
        return {
            id: cue.id,
            name: cue.name,
            target: cue.sample,
            peakSample: localPeak(buffer, cue.sample, radius),
        };
    });
    return { buffer, placed };
}

/** Synthesize the music and effect stems for a score and keep them for chunk(). */
export async function render(score: Score): Promise<RenderResult> {
    rendered.clear();
    const stems: Partial<Record<StemName, StemInfo>> = {};
    const music = await renderMusic(score);
    if (music) {
        rendered.set('music', music);
        stems.music = stemInfo(music);
    }
    const effects = await renderEffects(score);
    if (effects) {
        rendered.set('sfx', effects.buffer);
        stems.sfx = stemInfo(effects.buffer);
    }
    return {
        protocol: AUDIO_PROTOCOL,
        sampleRate: score.sampleRate,
        length: score.length,
        channels: 2,
        chunkFrames: CHUNK_FRAMES,
        stems,
        sfx: effects?.placed ?? [],
    };
}

function base64(bytes: Uint8Array): string {
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(text);
}

/** Interleaved little-endian float32 frames of one chunk, as base64. */
export function chunk(stem: StemName, index: number): string {
    const buffer = rendered.get(stem);
    if (!buffer) throw new Error(`no ${stem} stem was rendered`);
    const L = buffer.getChannelData(0);
    const R = buffer.getChannelData(1);
    const from = index * CHUNK_FRAMES;
    const to = Math.min(buffer.length, from + CHUNK_FRAMES);
    if (from >= to) throw new Error(`chunk ${index} is past the end of the ${stem} stem`);
    const frames = new Float32Array((to - from) * 2);
    for (let i = from; i < to; i++) {
        frames[(i - from) * 2] = L[i];
        frames[(i - from) * 2 + 1] = R[i];
    }
    return base64(new Uint8Array(frames.buffer));
}

/** Drop the rendered stems. */
export function release(): void {
    rendered.clear();
}
