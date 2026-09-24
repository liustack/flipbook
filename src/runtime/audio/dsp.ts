// Sample-level building blocks for the audio runtime. Everything here is
// plain JavaScript math on Float32Arrays, so the output depends only on the
// inputs: notes are summed in a fixed order, never by a Web Audio mixer.

/** A stereo bus: two channels of equal length. */
export interface Bus {
    L: Float32Array;
    R: Float32Array;
}

export function bus(length: number): Bus {
    return { L: new Float32Array(length), R: new Float32Array(length) };
}

export const TAU = Math.PI * 2;

const SINE_SIZE = 4096;
const SINE = (() => {
    const table = new Float64Array(SINE_SIZE + 1);
    for (let i = 0; i <= SINE_SIZE; i++) table[i] = Math.sin((TAU * i) / SINE_SIZE);
    return table;
})();

/** sin(2π·phase) for a phase in cycles, from a table with linear interpolation. */
export function sinc(phase: number): number {
    const x = (phase - Math.floor(phase)) * SINE_SIZE;
    const i = x | 0;
    const f = x - i;
    return SINE[i] + (SINE[i + 1] - SINE[i]) * f;
}

/** Equal-power pan: -1 left, 0 center, 1 right. */
export function panGains(pan: number): [number, number] {
    const a = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
    return [Math.cos(a), Math.sin(a)];
}

export function dbToGain(db: number): number {
    return 10 ** (db / 20);
}

/** Add a mono signal into a bus at `start`, panned, clipped to the bus. */
export function addMono(
    out: Bus,
    start: number,
    signal: Float32Array,
    gain: number,
    pan: number,
): void {
    const [gl, gr] = panGains(pan);
    const from = Math.max(0, -start);
    const to = Math.min(signal.length, out.L.length - start);
    for (let i = from; i < to; i++) {
        const v = signal[i] * gain;
        out.L[start + i] += v * gl;
        out.R[start + i] += v * gr;
    }
}

/** Add a stereo bus into another at `start`. */
export function addBus(out: Bus, start: number, source: Bus, gain: number): void {
    const from = Math.max(0, -start);
    const to = Math.min(source.L.length, out.L.length - start);
    for (let i = from; i < to; i++) {
        out.L[start + i] += source.L[i] * gain;
        out.R[start + i] += source.R[i] * gain;
    }
}

/** One-pole low-pass coefficient for a cutoff in Hz. */
export function onePole(cutoff: number, sampleRate: number): number {
    return 1 - Math.exp((-TAU * cutoff) / sampleRate);
}

/** RBJ biquad (Direct Form I), coefficients set per filter type. */
export class Biquad {
    private b0 = 1;
    private b1 = 0;
    private b2 = 0;
    private a1 = 0;
    private a2 = 0;
    private x1 = 0;
    private x2 = 0;
    private y1 = 0;
    private y2 = 0;

    constructor(private readonly sampleRate: number) {}

    set(type: 'lowpass' | 'highpass' | 'bandpass', freq: number, q: number): this {
        const w = (TAU * Math.min(freq, this.sampleRate * 0.45)) / this.sampleRate;
        const cos = Math.cos(w);
        const alpha = Math.sin(w) / (2 * q);
        let b0: number;
        let b1: number;
        let b2: number;
        if (type === 'lowpass') {
            b0 = (1 - cos) / 2;
            b1 = 1 - cos;
            b2 = (1 - cos) / 2;
        } else if (type === 'highpass') {
            b0 = (1 + cos) / 2;
            b1 = -(1 + cos);
            b2 = (1 + cos) / 2;
        } else {
            b0 = alpha;
            b1 = 0;
            b2 = -alpha;
        }
        const a0 = 1 + alpha;
        this.b0 = b0 / a0;
        this.b1 = b1 / a0;
        this.b2 = b2 / a0;
        this.a1 = (-2 * cos) / a0;
        this.a2 = (1 - alpha) / a0;
        return this;
    }

    run(x: number): number {
        const y =
            this.b0 * x +
            this.b1 * this.x1 +
            this.b2 * this.x2 -
            this.a1 * this.y1 -
            this.a2 * this.y2;
        this.x2 = this.x1;
        this.x1 = x;
        this.y2 = this.y1;
        this.y1 = y;
        return y;
    }
}

/** Seconds to samples, rounded. */
export function samples(seconds: number, sampleRate: number): number {
    return Math.round(seconds * sampleRate);
}

/** Largest absolute sample over both channels, and where it is. */
export function peakOf(b: Bus): { index: number; value: number } {
    let index = 0;
    let value = 0;
    for (let i = 0; i < b.L.length; i++) {
        const v = Math.max(Math.abs(b.L[i]), Math.abs(b.R[i]));
        if (v > value) {
            value = v;
            index = i;
        }
    }
    return { index, value };
}
