// The Web Audio stage: the pre-mixed buses go through one fixed effect chain
// in an OfflineAudioContext. Every node takes at most two inputs, because a
// node that sums three or more inputs does not add them in a fixed order and
// the output then differs in the last bit from run to run.
import { rng } from '../core/random.ts';
import type { Bus } from './dsp.ts';

export interface ChainOptions {
    reverbSec: number;
    sendMain: number;
    sendAir: number;
    wet: number;
    /** High-pass corner in Hz, 0 for none. */
    highpass: number;
    /** Low-pass corner in Hz, 0 for none. */
    lowpass: number;
    /** Glue compressor on the sum (music only: it delays the signal slightly). */
    compress: boolean;
    /** Seconds of fade to silence at the very end. */
    fadeOut: number;
    seed: number;
}

/** A stereo room: seeded noise under an exponential decay that darkens over time. */
function impulse(ctx: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
    const sr = ctx.sampleRate;
    const predelay = Math.round(0.016 * sr);
    const length = predelay + Math.round(seconds * 1.1 * sr);
    const ir = ctx.createBuffer(2, length, sr);
    for (let ch = 0; ch < 2; ch++) {
        const data = ir.getChannelData(ch);
        const r = rng(seed + ch * 7919);
        let lp = 0;
        for (let n = predelay; n < length; n++) {
            const t = (n - predelay) / sr;
            const decay = Math.exp((-6.9 * t) / seconds);
            const cutoff = 9000 * Math.exp(-t / (seconds * 0.45)) + 900;
            const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
            lp += a * (r.next() * 2 - 1 - lp);
            data[n] = lp * decay * Math.min(1, t / 0.004);
        }
    }
    return ir;
}

/** A stereo AudioBuffer whose channels double as a bus to write notes into. */
export function audioBus(length: number, sampleRate: number): { buffer: AudioBuffer; bus: Bus } {
    const buffer = new AudioBuffer({ numberOfChannels: 2, length, sampleRate });
    return { buffer, bus: { L: buffer.getChannelData(0), R: buffer.getChannelData(1) } };
}

/** Run the main and air buffers through the chain and return the rendered stereo buffer. */
export async function runChain(
    main: AudioBuffer,
    air: AudioBuffer,
    o: ChainOptions,
): Promise<AudioBuffer> {
    const sr = main.sampleRate;
    const length = main.length;
    const ctx = new OfflineAudioContext(2, length, sr);

    const srcMain = new AudioBufferSourceNode(ctx, { buffer: main });
    const srcAir = new AudioBufferSourceNode(ctx, { buffer: air });

    const sendMain = new GainNode(ctx, { gain: o.sendMain });
    const sendAir = new GainNode(ctx, { gain: o.sendAir });
    const reverbIn = new GainNode(ctx);
    srcMain.connect(sendMain).connect(reverbIn);
    srcAir.connect(sendAir).connect(reverbIn);
    const reverb = new ConvolverNode(ctx, { buffer: impulse(ctx, o.reverbSec, o.seed) });
    const wet = new GainNode(ctx, { gain: o.wet });
    reverbIn.connect(reverb).connect(wet);

    const dry = new GainNode(ctx);
    srcMain.connect(dry);
    srcAir.connect(dry);
    const sum = new GainNode(ctx);
    dry.connect(sum);
    wet.connect(sum);

    let tail: AudioNode = sum;
    if (o.highpass > 0) {
        tail = tail.connect(
            new BiquadFilterNode(ctx, { type: 'highpass', frequency: o.highpass, Q: Math.SQRT1_2 }),
        );
    }
    if (o.lowpass > 0) {
        tail = tail.connect(
            new BiquadFilterNode(ctx, { type: 'lowpass', frequency: o.lowpass, Q: Math.SQRT1_2 }),
        );
    }
    if (o.compress) {
        const glue = new DynamicsCompressorNode(ctx, {
            threshold: -20,
            knee: 12,
            ratio: 2.5,
            attack: 0.012,
            release: 0.25,
        });
        const peaks = new DynamicsCompressorNode(ctx, {
            threshold: -9,
            knee: 4,
            ratio: 8,
            attack: 0.001,
            release: 0.08,
        });
        tail = tail.connect(glue).connect(peaks);
    }
    const out = new GainNode(ctx, { gain: 1 });
    if (o.fadeOut > 0) {
        const end = length / sr;
        const from = Math.max(0, end - o.fadeOut);
        out.gain.setValueAtTime(1, from);
        out.gain.linearRampToValueAtTime(0, end);
    }
    tail.connect(out).connect(ctx.destination);

    srcMain.start(0);
    srcAir.start(0);
    return ctx.startRendering();
}
