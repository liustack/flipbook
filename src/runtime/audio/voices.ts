// Instrument voices. Each call renders one note into a bus.
//
// The Karplus-Strong pluck follows scripts/music.mjs of
// buildwithhanif/claude-animation-skill (MIT, Copyright (c) 2026 Hanif),
// rewritten with an all-pass tuning stage, a pick-position notch and a
// decay time per note. See THIRD_PARTY_NOTICES.md.
import { midiToHz } from '../../engine/audioScore.ts';
import { rng } from '../core/random.ts';
import { type Bus, onePole, panGains, sinc, TAU } from './dsp.ts';

export interface NoteOptions {
    /** 0 to 1. */
    velocity: number;
    /** -1 left to 1 right. */
    pan: number;
}

/** Linear ramps at both ends: `attack` samples in, `fade` samples out, over `length`. */
function edge(n: number, length: number, attack: number, fade: number): number {
    let g = 1;
    if (n < attack) g = n / attack;
    const left = length - n;
    if (left < fade) g *= left / fade;
    return g;
}

export interface PluckOptions extends NoteOptions {
    /** Seconds for the string to fall by 60 dB. */
    t60: number;
    /** 0 dark (thumb) to 1 bright (nail). */
    bright: number;
    seed: number;
    /** Samples until the note is damped. */
    length: number;
}

/** A plucked string (Karplus-Strong with all-pass fine tuning). */
export function pluck(out: Bus, start: number, midi: number, o: PluckOptions, sr: number): void {
    if (start >= out.L.length || o.velocity <= 0) return;
    const f = midiToHz(midi);
    const period = sr / f;
    const n0 = Math.max(2, Math.floor(period - 0.6));
    const frac = period - 0.5 - n0;
    const c = (1 - frac) / (1 + frac);
    const rho = 10 ** (-3 / (o.t60 * f));
    const line = new Float64Array(n0);
    const r = rng(o.seed);
    const a = onePole(700 + 7000 * o.bright * o.bright, sr);
    let lp1 = 0;
    let lp2 = 0;
    const raw = new Float64Array(n0);
    for (let i = 0; i < n0; i++) {
        lp1 += a * (r.next() * 2 - 1 - lp1);
        lp2 += a * (lp1 - lp2);
        raw[i] = lp2;
    }
    const pick = Math.max(1, Math.round(n0 * 0.13));
    let mean = 0;
    for (let i = 0; i < n0; i++) {
        line[i] = raw[i] - 0.9 * (i >= pick ? raw[i - pick] : 0);
        mean += line[i];
    }
    mean /= n0;
    let energy = 1e-12;
    for (let i = 0; i < n0; i++) {
        line[i] -= mean;
        energy += line[i] * line[i];
    }
    // Scale the burst by its RMS and round off its spikes, so a note's attack
    // is not much louder than its ring.
    const rms = Math.sqrt(energy / n0);
    for (let i = 0; i < n0; i++) line[i] = Math.tanh((line[i] / rms) * 0.6);
    const gain = o.velocity * 0.9;
    const [gl, gr] = panGains(o.pan);
    const length = Math.min(o.length, out.L.length - start);
    const fade = Math.min(length, Math.round(0.05 * sr));
    let idx = 0;
    let prev = 0;
    let apIn = 0;
    let apOut = 0;
    for (let n = 0; n < length; n++) {
        const v = line[idx];
        const avg = 0.5 * (v + prev) * rho;
        prev = v;
        const ap = c * avg + apIn - c * apOut;
        apIn = avg;
        apOut = ap;
        line[idx] = ap;
        idx = idx + 1 === n0 ? 0 : idx + 1;
        const s = v * gain * edge(n, length, 16, fade);
        out.L[start + n] += s * gl;
        out.R[start + n] += s * gr;
    }
}

export interface MalletOptions extends NoteOptions {
    /** 0 soft yarn to 1 hard rubber: brightness of the strike. */
    hardness: number;
    /** Samples until the bar is damped, or undefined to let it ring. */
    length?: number;
}

/** A marimba bar: FM strike on a sine with the tuned fourth partial. */
export function mallet(out: Bus, start: number, midi: number, o: MalletOptions, sr: number): void {
    if (start >= out.L.length || o.velocity <= 0) return;
    const f = midiToHz(midi);
    const tau = Math.min(0.9, Math.max(0.12, 0.5 * (220 / f) ** 0.7));
    const ring = Math.round(Math.min(4, tau * 7) * sr);
    const length = Math.min(o.length ?? ring, ring, out.L.length - start);
    const fade = Math.min(length, Math.round(0.04 * sr));
    const [gl, gr] = panGains(o.pan);
    const kA = Math.exp(-1 / (tau * sr));
    const k4 = Math.exp(-1 / (tau * 0.3 * sr));
    const kI = Math.exp(-1 / (0.02 * sr));
    const kK = Math.exp(-1 / (0.012 * sr));
    const knockOn = f * 9.8 < sr * 0.35;
    let eA = 1;
    let e4 = 1;
    let eI = 1;
    let eK = 1;
    const index = 1.6 * o.hardness;
    const attack = Math.round(0.0015 * sr);
    for (let n = 0; n < length; n++) {
        const t = n / sr;
        const ph = f * t;
        const body = sinc(ph + (index * eI * sinc(ph)) / TAU) * eA;
        const over = 0.25 * o.hardness * sinc(4 * ph) * e4;
        const knock = knockOn ? 0.1 * o.hardness * sinc(9.8 * ph) * eK : 0;
        const s = (body + over + knock) * o.velocity * edge(n, length, attack, fade);
        out.L[start + n] += s * gl;
        out.R[start + n] += s * gr;
        eA *= kA;
        e4 *= k4;
        eI *= kI;
        eK *= kK;
    }
}

/** A glockenspiel-like bell: FM with an inharmonic 3.5 ratio. */
export function bell(out: Bus, start: number, midi: number, o: NoteOptions, sr: number): void {
    if (start >= out.L.length || o.velocity <= 0) return;
    const f = midiToHz(midi);
    const tau = Math.min(2.2, Math.max(0.5, 1.4 * (880 / f) ** 0.35));
    const length = Math.min(Math.round(Math.min(6, tau * 5) * sr), out.L.length - start);
    const fade = Math.min(length, Math.round(0.05 * sr));
    const [gl, gr] = panGains(o.pan);
    const kA = Math.exp(-1 / (tau * sr));
    const kI = Math.exp(-1 / (0.35 * sr));
    const k2 = Math.exp(-1 / (tau * 0.35 * sr));
    let eA = 1;
    let eI = 1;
    let e2 = 1;
    const attack = Math.round(0.0015 * sr);
    for (let n = 0; n < length; n++) {
        const ph = (f * n) / sr;
        const body = sinc(ph + (1.2 * eI * sinc(3.5 * ph)) / TAU) * eA;
        const partial = 0.25 * sinc(2.76 * ph) * e2;
        const s = (body + partial) * 0.8 * o.velocity * edge(n, length, attack, fade);
        out.L[start + n] += s * gl;
        out.R[start + n] += s * gr;
        eA *= kA;
        eI *= kI;
        e2 *= k2;
    }
}

const WAVE_SIZE = 2048;
/** One cycle of a soft sawtooth: ten harmonics, falling faster than 1/k. */
const SOFT_SAW = (() => {
    const table = new Float64Array(WAVE_SIZE + 1);
    let peak = 0;
    for (let i = 0; i <= WAVE_SIZE; i++) {
        let v = 0;
        for (let k = 1; k <= 10; k++)
            v += (0.8 ** (k - 1) / k) * Math.sin((TAU * k * i) / WAVE_SIZE);
        table[i] = v;
        peak = Math.max(peak, Math.abs(v));
    }
    for (let i = 0; i <= WAVE_SIZE; i++) table[i] /= peak;
    return table;
})();

function softSaw(phase: number): number {
    const x = (phase - Math.floor(phase)) * WAVE_SIZE;
    const i = x | 0;
    return SOFT_SAW[i] + (SOFT_SAW[i + 1] - SOFT_SAW[i]) * (x - i);
}

export interface PadOptions extends NoteOptions {
    /** Samples at full level before the release starts. */
    hold: number;
    attack: number;
    release: number;
    /** Low-pass cutoff in Hz. */
    cutoff: number;
    /** Stereo spread of the two detuned oscillators, 0 to 1. */
    spread: number;
    seed: number;
}

/** A held pad note: two detuned soft saws through a two-pole low-pass. */
export function pad(out: Bus, start: number, midi: number, o: PadOptions, sr: number): void {
    if (start >= out.L.length || o.velocity <= 0) return;
    const f = midiToHz(midi);
    const detune = 2 ** (7 / 1200);
    const fa = f * detune;
    const fb = f / detune;
    const r = rng(o.seed);
    let pa = r.next();
    let pb = r.next();
    const total = Math.min(o.hold + o.release, out.L.length - start);
    const coef = onePole(o.cutoff, sr);
    const [al, ar] = panGains(-o.spread);
    const [bl, br] = panGains(o.spread);
    const pan = panGains(o.pan);
    let la1 = 0;
    let la2 = 0;
    let lb1 = 0;
    let lb2 = 0;
    for (let n = 0; n < total; n++) {
        let env: number;
        if (n < o.attack) env = n / o.attack;
        else if (n < o.hold) env = 1;
        else env = Math.max(0, 1 - (n - o.hold) / o.release);
        env *= env;
        la1 += coef * (softSaw(pa) - la1);
        la2 += coef * (la1 - la2);
        lb1 += coef * (softSaw(pb) - lb1);
        lb2 += coef * (lb1 - lb2);
        pa += fa / sr;
        pb += fb / sr;
        if (pa > 1) pa -= 1;
        if (pb > 1) pb -= 1;
        const g = env * o.velocity * 0.5;
        out.L[start + n] += (la2 * al + lb2 * bl) * g * pan[0] * Math.SQRT2;
        out.R[start + n] += (la2 * ar + lb2 * br) * g * pan[1] * Math.SQRT2;
    }
}

/** A sine sub bass under the pad. */
export function sub(
    out: Bus,
    start: number,
    midi: number,
    o: NoteOptions & { hold: number; attack: number; release: number },
    sr: number,
): void {
    if (start >= out.L.length || o.velocity <= 0) return;
    const f = midiToHz(midi);
    const total = Math.min(o.hold + o.release, out.L.length - start);
    const [gl, gr] = panGains(o.pan);
    for (let n = 0; n < total; n++) {
        let env: number;
        if (n < o.attack) env = n / o.attack;
        else if (n < o.hold) env = 1;
        else env = Math.max(0, 1 - (n - o.hold) / o.release);
        const s = sinc((f * n) / sr) * env * env * o.velocity;
        out.L[start + n] += s * gl;
        out.R[start + n] += s * gr;
    }
}

/** A short shaker grain: high-passed noise under a sine-squared swell. */
export function shaker(
    out: Bus,
    start: number,
    o: NoteOptions & { seed: number },
    sr: number,
): void {
    if (start >= out.L.length || o.velocity <= 0) return;
    const length = Math.min(Math.round(0.055 * sr), out.L.length - start);
    const r = rng(o.seed);
    const [gl, gr] = panGains(o.pan);
    let prev = 0;
    let lp = 0;
    const a = onePole(9000, sr);
    for (let n = 0; n < length; n++) {
        const w = r.next() * 2 - 1;
        lp += a * (w - lp);
        const hp = lp - prev;
        prev = lp;
        const e = Math.sin((Math.PI * n) / length) ** 2;
        const s = hp * e * o.velocity;
        out.L[start + n] += s * gl;
        out.R[start + n] += s * gr;
    }
}

/** A soft knock on a wooden body: a low sine blip with a little noise. */
export function knock(
    out: Bus,
    start: number,
    o: NoteOptions & { seed: number },
    sr: number,
): void {
    if (start >= out.L.length || o.velocity <= 0) return;
    const length = Math.min(Math.round(0.08 * sr), out.L.length - start);
    const r = rng(o.seed);
    const [gl, gr] = panGains(o.pan);
    const k = Math.exp(-1 / (0.018 * sr));
    const kn = Math.exp(-1 / (0.004 * sr));
    let e = 1;
    let en = 1;
    let lp = 0;
    const a = onePole(2500, sr);
    for (let n = 0; n < length; n++) {
        const fq = 150 + 90 * en;
        lp += a * (r.next() * 2 - 1 - lp);
        const s = (sinc((fq * n) / sr) * e + lp * en * 0.6) * o.velocity * edge(n, length, 8, 64);
        out.L[start + n] += s * gl;
        out.R[start + n] += s * gr;
        e *= k;
        en *= kn;
    }
}
