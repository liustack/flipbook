// The instruments of a written score. playNote renders one note of a pitched
// instrument into a bus, playHit one drum hit. New voices live here; the
// preset voices (pluck, mallet, bell, pad, sub, shaker, knock) are reused.
// Everything is plain math on Float32Arrays with seeded noise.

import { midiToHz } from '../../engine/audioScore.ts';
import type { DrumPiece, InstrumentName } from '../../engine/audioSheet.ts';
import { rng } from '../core/random.ts';
import { Biquad, type Bus, onePole, panGains, sinc } from './dsp.ts';
import { bell, knock, mallet, pad, pluck, shaker, sub } from './voices.ts';

export type PitchedInstrument = Exclude<InstrumentName, 'drums'>;

export interface PlayOptions {
    /** 0 to 1: how hard the note is played, which also sets its tone. */
    velocity: number;
    /** Extra gain on top of the velocity that leaves the tone alone. Defaults to 1. */
    gain?: number;
    /** -1 left to 1 right. */
    pan: number;
    /** Samples the key is held. Struck instruments ring on past it or are damped at it. */
    gate: number;
    seed: number;
}

/** Instruments sent harder to the reverb. */
export const AIR_INSTRUMENTS: ReadonlySet<InstrumentName> = new Set([
    'celesta',
    'musicbox',
    'bells',
    'harp',
]);

/** Level of one note of each instrument, so a mix of parts starts out balanced. */
export const INSTRUMENT_GAIN: Record<PitchedInstrument, number> = {
    piano: 0.4,
    celesta: 0.36,
    musicbox: 0.3,
    bells: 0.35,
    marimba: 0.55,
    pluck: 1,
    harp: 0.95,
    strings: 0.21,
    pad: 0.23,
    flute: 0.34,
    clarinet: 0.38,
    bass: 0.6,
    sub: 0.27,
};

export const DRUM_GAIN: Record<DrumPiece, number> = {
    kick: 0.75,
    snare: 0.32,
    hat: 0.16,
    shaker: 0.16,
    knock: 0.3,
    clap: 0.3,
};

function seconds(s: number, sr: number): number {
    return Math.round(s * sr);
}

/** Add a mono signal made by `sample(n)` for n in [0, length) into the bus. */
function write(
    out: Bus,
    start: number,
    length: number,
    pan: number,
    sample: (n: number) => number,
): void {
    const total = Math.min(length, out.L.length - start);
    if (total <= 0) return;
    const [gl, gr] = panGains(pan);
    for (let n = 0; n < total; n++) {
        const s = sample(n);
        out.L[start + n] += s * gl;
        out.R[start + n] += s * gr;
    }
}

/** Options inside a voice: `level` is velocity times gain, the output amplitude. */
type Voice = PlayOptions & { level: number };

/** 1 until the gate, then an exponential fall with time constant `tau` samples. */
function damper(n: number, gate: number, tau: number): number {
    return n < gate ? 1 : Math.exp(-(n - gate) / tau);
}

/** A few samples of fade-in so no note starts with a click. */
function onset(n: number, samples: number): number {
    return n < samples ? n / samples : 1;
}

// --- piano ------------------------------------------------------------------

/**
 * A piano string: partials with a little stiffness (each one slightly sharp),
 * higher partials dying faster, a fast then slow decay, a felt hammer thump,
 * and brighter tone when struck harder. The damper falls when the key is let go.
 */
function piano(out: Bus, start: number, midi: number, o: Voice, sr: number): void {
    const f = midiToHz(midi);
    const stiffness = 0.00008 * 2 ** ((midi - 60) / 18);
    const slow = Math.min(9, Math.max(0.5, 4.2 * (261.6 / f) ** 0.65));
    const fast = slow * 0.12;
    const release = seconds(0.12, sr);
    const length = Math.min(
        o.gate + release * 6,
        seconds(Math.min(10, slow * 5), sr),
        out.L.length - start,
    );
    if (length <= 0) return;
    const signal = new Float64Array(length);
    const tilt = 1.25 - o.velocity * 0.7;
    const r = rng(o.seed);
    for (let k = 1; k <= 14; k++) {
        const fk = k * f * Math.sqrt(1 + stiffness * k * k);
        if (fk > sr * 0.42) break;
        const amp = (1 / k ** 1.05) * Math.exp(-(k - 1) * tilt * 0.55);
        if (amp < 0.002) break;
        const scale = 1 + 0.35 * (k - 1);
        const kFast = Math.exp(-1 / ((fast / scale) * sr));
        const kSlow = Math.exp(-1 / ((slow / scale) * sr));
        let eFast = 0.65;
        let eSlow = 0.35;
        const inc = fk / sr;
        let ph = r.next();
        for (let n = 0; n < length; n++) {
            signal[n] += sinc(ph) * (eFast + eSlow) * amp;
            ph += inc;
            eFast *= kFast;
            eSlow *= kSlow;
        }
    }
    // The hammer: a short, low thump of filtered noise.
    const thump = onePole(1200 + 2000 * o.velocity, sr);
    let lp = 0;
    const hammer = seconds(0.012, sr);
    for (let n = 0; n < Math.min(hammer * 4, length); n++) {
        lp += thump * (r.next() * 2 - 1 - lp);
        signal[n] += lp * 0.25 * o.velocity * Math.exp(-n / hammer);
    }
    const attack = seconds(0.002, sr);
    write(
        out,
        start,
        length,
        o.pan,
        (n) =>
            signal[n] *
            o.level *
            onset(n, attack) *
            damper(n, o.gate, release) *
            Math.min(1, (length - n) / 64),
    );
}

// --- struck metal: celesta and music box ----------------------------------

interface Partial {
    ratio: number;
    amp: number;
    /** Decay time constant in seconds. */
    tau: number;
}

function struck(
    out: Bus,
    start: number,
    midi: number,
    o: Voice,
    sr: number,
    partials: Partial[],
    click: { freq: number; amp: number; tau: number },
): void {
    const f = midiToHz(midi);
    const longest = Math.max(...partials.map((p) => p.tau));
    const length = Math.min(seconds(longest * 6, sr), out.L.length - start);
    if (length <= 0) return;
    const signal = new Float64Array(length);
    for (const p of partials) {
        const fp = f * p.ratio;
        if (fp > sr * 0.45) continue;
        const k = Math.exp(-1 / (p.tau * sr));
        let e = p.amp;
        const inc = fp / sr;
        let ph = 0;
        for (let n = 0; n < length; n++) {
            signal[n] += sinc(ph) * e;
            ph += inc;
            e *= k;
        }
    }
    const r = rng(o.seed);
    const band = new Biquad(sr).set('bandpass', click.freq, 1.5);
    const clickLen = Math.min(length, seconds(click.tau * 6, sr));
    for (let n = 0; n < clickLen; n++) {
        signal[n] += band.run(r.next() * 2 - 1) * click.amp * Math.exp(-n / (click.tau * sr));
    }
    const attack = seconds(0.001, sr);
    const fade = Math.min(length, seconds(0.04, sr));
    write(
        out,
        start,
        length,
        o.pan,
        (n) => signal[n] * o.level * onset(n, attack) * Math.min(1, (length - n) / fade),
    );
}

function celesta(out: Bus, start: number, midi: number, o: Voice, sr: number): void {
    const f = midiToHz(midi);
    const tau = Math.min(1.6, Math.max(0.35, 1.1 * (880 / f) ** 0.4));
    struck(
        out,
        start,
        midi,
        o,
        sr,
        [
            { ratio: 1, amp: 1, tau },
            { ratio: 2, amp: 0.22, tau: tau * 0.45 },
            { ratio: 4.02, amp: 0.1, tau: tau * 0.18 },
            { ratio: 6.1, amp: 0.04, tau: tau * 0.08 },
        ],
        { freq: Math.min(9000, f * 6), amp: 0.5, tau: 0.0025 },
    );
}

function musicbox(out: Bus, start: number, midi: number, o: Voice, sr: number): void {
    const f = midiToHz(midi);
    const tau = Math.min(2.4, Math.max(0.5, 1.5 * (1000 / f) ** 0.45));
    struck(
        out,
        start,
        midi,
        o,
        sr,
        [
            { ratio: 1, amp: 1, tau },
            // A second tine a hair off pitch: the slow shimmer of a comb.
            { ratio: 1.0025, amp: 0.3, tau: tau * 0.8 },
            { ratio: 6.27, amp: 0.16, tau: 0.12 },
            { ratio: 17.55, amp: 0.05, tau: 0.02 },
        ],
        { freq: Math.min(10000, f * 9), amp: 0.7, tau: 0.0015 },
    );
}

// --- sustained: strings and winds -----------------------------------------

/** One cycle of a band-limited wave from harmonic amplitudes, peak 1. */
function wave(harmonics: number[]): Float64Array {
    const size = 2048;
    const table = new Float64Array(size + 1);
    let peak = 0;
    for (let i = 0; i <= size; i++) {
        let v = 0;
        harmonics.forEach((a, k) => {
            v += a * Math.sin((2 * Math.PI * (k + 1) * i) / size);
        });
        table[i] = v;
        peak = Math.max(peak, Math.abs(v));
    }
    for (let i = 0; i <= size; i++) table[i] /= peak;
    return table;
}

function lookup(table: Float64Array, phase: number): number {
    const size = table.length - 1;
    const x = (phase - Math.floor(phase)) * size;
    const i = x | 0;
    return table[i] + (table[i + 1] - table[i]) * (x - i);
}

/** Harmonics of a bowed string: all of them, falling as 1/k. */
const BOWED = wave(Array.from({ length: 24 }, (_, k) => 1 / (k + 1)));
/** A clarinet: odd harmonics strong, even ones faint. */
const REED = wave([1, 0.04, 0.55, 0.03, 0.32, 0.02, 0.16, 0.01, 0.08, 0.01, 0.04]);
/** A flute: nearly a sine with a soft second and third harmonic. */
const FLUTE = wave([1, 0.2, 0.07, 0.02]);

/** Attack, hold to the gate, release: a squared linear envelope. */
function hold(n: number, attack: number, gate: number, release: number): number {
    let e: number;
    if (n < attack) e = n / attack;
    else if (n < gate) e = 1;
    else e = Math.max(0, 1 - (n - gate) / release);
    return e * e;
}

/** Vibrato in semitones at sample n: none at first, easing in. */
function vibrato(n: number, sr: number, rate: number, cents: number, delay: number): number {
    const t = n / sr;
    const depth = Math.min(1, Math.max(0, (t - delay) / 0.4));
    return (depth * cents * Math.sin(2 * Math.PI * rate * t)) / 100;
}

/**
 * A string section: three bowed tones slightly out of tune with each other,
 * spread across the stereo field, a slow bow attack, late vibrato and a
 * low-pass that opens with the velocity.
 */
function strings(out: Bus, start: number, midi: number, o: Voice, sr: number): void {
    const f = midiToHz(midi);
    const attack = Math.min(seconds(0.18 + (1 - o.velocity) * 0.2, sr), Math.max(1, o.gate >> 1));
    const release = seconds(0.5, sr);
    const length = Math.min(o.gate + release, out.L.length - start);
    if (length <= 0) return;
    const r = rng(o.seed);
    const voices = [
        { detune: -0.09, pan: -0.5, phase: r.next(), rate: 5.1 },
        { detune: 0, pan: 0, phase: r.next(), rate: 5.5 },
        { detune: 0.08, pan: 0.5, phase: r.next(), rate: 4.8 },
    ];
    const cutoff = Math.min(f * 7, 900 + 2800 * o.velocity);
    const a = onePole(cutoff, sr);
    const [pl, pr] = panGains(o.pan);
    const gains = voices.map((v) => panGains(v.pan));
    const lp1 = [0, 0, 0];
    const lp2 = [0, 0, 0];
    const total = Math.min(length, out.L.length - start);
    for (let n = 0; n < total; n++) {
        const env = hold(n, attack, o.gate, release) * o.level * 0.6;
        let l = 0;
        let rr = 0;
        for (let v = 0; v < 3; v++) {
            const voice = voices[v];
            const semis = voice.detune + vibrato(n, sr, voice.rate, 11, 0.3);
            voice.phase += (f * 2 ** (semis / 12)) / sr;
            lp1[v] += a * (lookup(BOWED, voice.phase) - lp1[v]);
            lp2[v] += a * (lp1[v] - lp2[v]);
            l += lp2[v] * gains[v][0];
            rr += lp2[v] * gains[v][1];
        }
        out.L[start + n] += l * env * pl * Math.SQRT2;
        out.R[start + n] += rr * env * pr * Math.SQRT2;
    }
}

interface WindShape {
    table: Float64Array;
    attack: number;
    release: number;
    /** Breath noise level relative to the tone. */
    breath: number;
    vibratoCents: number;
    /** Low-pass corner as a multiple of the pitch, before velocity. */
    bright: number;
}

function wind(out: Bus, start: number, midi: number, o: Voice, sr: number, shape: WindShape): void {
    const f = midiToHz(midi);
    const attack = Math.min(seconds(shape.attack, sr), Math.max(1, o.gate >> 1));
    const release = seconds(shape.release, sr);
    const length = Math.min(o.gate + release, out.L.length - start);
    if (length <= 0) return;
    const r = rng(o.seed);
    const noise = new Biquad(sr).set('bandpass', Math.min(sr * 0.4, f * 2), 2.5);
    const a = onePole(Math.min(sr * 0.4, f * shape.bright * (0.6 + o.velocity)), sr);
    let phase = r.next();
    let lp = 0;
    const chiff = seconds(0.03, sr);
    write(out, start, length, o.pan, (n) => {
        const env = hold(n, attack, o.gate, release);
        phase += (f * 2 ** (vibrato(n, sr, 5, shape.vibratoCents, 0.25) / 12)) / sr;
        lp += a * (lookup(shape.table, phase) - lp);
        const puff = n < chiff * 4 ? Math.exp(-n / chiff) : 0;
        const air = noise.run(r.next() * 2 - 1) * (shape.breath * env + 0.5 * puff);
        return (lp * env + air) * o.level;
    });
}

function flute(out: Bus, start: number, midi: number, o: Voice, sr: number): void {
    wind(out, start, midi, o, sr, {
        table: FLUTE,
        attack: 0.06,
        release: 0.12,
        breath: 0.08,
        vibratoCents: 12,
        bright: 6,
    });
}

function clarinet(out: Bus, start: number, midi: number, o: Voice, sr: number): void {
    wind(out, start, midi, o, sr, {
        table: REED,
        attack: 0.04,
        release: 0.1,
        breath: 0.03,
        vibratoCents: 0,
        bright: 5,
    });
}

// --- plucked: bass and harp -------------------------------------------------

/** A plucked upright bass: a round tone with a short finger transient, damped at release. */
function bass(out: Bus, start: number, midi: number, o: Voice, sr: number): void {
    const f = midiToHz(midi);
    const tau = Math.min(1.6, Math.max(0.5, 1.1 * (55 / f) ** 0.3));
    const release = seconds(0.08, sr);
    const length = Math.min(o.gate + release * 6, seconds(tau * 5, sr), out.L.length - start);
    if (length <= 0) return;
    const partials = [
        { ratio: 1, amp: 1, tau },
        { ratio: 2, amp: 0.45, tau: tau * 0.5 },
        { ratio: 3, amp: 0.2, tau: tau * 0.2 },
        { ratio: 4, amp: 0.08, tau: tau * 0.08 },
    ];
    const signal = new Float64Array(length);
    for (const p of partials) {
        const k = Math.exp(-1 / (p.tau * sr));
        let e = p.amp;
        const inc = (f * p.ratio) / sr;
        let ph = 0;
        for (let n = 0; n < length; n++) {
            signal[n] += sinc(ph) * e;
            ph += inc;
            e *= k;
        }
    }
    const r = rng(o.seed);
    const thump = onePole(900, sr);
    let lp = 0;
    const finger = seconds(0.006, sr);
    for (let n = 0; n < Math.min(finger * 5, length); n++) {
        lp += thump * (r.next() * 2 - 1 - lp);
        signal[n] += lp * 0.4 * Math.exp(-n / finger);
    }
    const attack = seconds(0.004, sr);
    write(
        out,
        start,
        length,
        o.pan,
        (n) =>
            signal[n] *
            o.level *
            onset(n, attack) *
            damper(n, o.gate, release) *
            Math.min(1, (length - n) / 64),
    );
}

/** A harp string: the nylon pluck, brighter, left to ring. */
function harp(out: Bus, start: number, midi: number, o: Voice, sr: number): void {
    const f = midiToHz(midi);
    const t60 = Math.min(6, Math.max(1.2, 4 * (261.6 / f) ** 0.5));
    pluck(
        out,
        start,
        midi,
        {
            velocity: o.level,
            pan: o.pan,
            t60,
            bright: 0.62,
            seed: o.seed,
            length: seconds(t60 * 1.05, sr),
        },
        sr,
    );
}

// --- the dispatch -----------------------------------------------------------

/** Render one note of a pitched instrument at `start` into `out`. */
export function playNote(
    out: Bus,
    instrument: PitchedInstrument,
    start: number,
    midi: number,
    options: PlayOptions,
    sr: number,
): void {
    if (start >= out.L.length || options.velocity <= 0 || options.gate <= 0) return;
    const o: Voice = { ...options, level: options.velocity * (options.gain ?? 1) };
    const gate = Math.max(1, o.gate);
    switch (instrument) {
        case 'piano':
            piano(out, start, midi, o, sr);
            break;
        case 'celesta':
            celesta(out, start, midi, o, sr);
            break;
        case 'musicbox':
            musicbox(out, start, midi, o, sr);
            break;
        case 'bells':
            bell(out, start, midi, { velocity: o.level, pan: o.pan }, sr);
            break;
        case 'marimba':
            mallet(
                out,
                start,
                midi,
                { velocity: o.level, pan: o.pan, hardness: 0.3 + 0.5 * o.velocity },
                sr,
            );
            break;
        case 'pluck':
            pluck(
                out,
                start,
                midi,
                {
                    velocity: o.level,
                    pan: o.pan,
                    t60: 2.2,
                    bright: 0.25 + 0.3 * o.velocity,
                    seed: o.seed,
                    length: gate + seconds(0.12, sr),
                },
                sr,
            );
            break;
        case 'harp':
            harp(out, start, midi, o, sr);
            break;
        case 'strings':
            strings(out, start, midi, o, sr);
            break;
        case 'pad':
            pad(
                out,
                start,
                midi,
                {
                    velocity: o.level,
                    pan: o.pan,
                    hold: gate,
                    attack: Math.min(seconds(0.3, sr), Math.max(1, gate >> 1)),
                    release: seconds(0.9, sr),
                    cutoff: 700 + 1100 * o.velocity,
                    spread: 0.5,
                    seed: o.seed,
                },
                sr,
            );
            break;
        case 'flute':
            flute(out, start, midi, o, sr);
            break;
        case 'clarinet':
            clarinet(out, start, midi, o, sr);
            break;
        case 'bass':
            bass(out, start, midi, o, sr);
            break;
        case 'sub':
            sub(
                out,
                start,
                midi,
                {
                    velocity: o.level,
                    pan: o.pan,
                    hold: gate,
                    attack: seconds(0.03, sr),
                    release: seconds(0.25, sr),
                },
                sr,
            );
            break;
    }
}

// --- drums --------------------------------------------------------------------

/** A soft kick: a sine falling from 120 Hz to 48 Hz with a felt click. */
function kick(out: Bus, start: number, o: Omit<PlayOptions, 'gate'>, sr: number): void {
    const length = seconds(0.45, sr);
    const r = rng(o.seed);
    let phase = 0;
    let lp = 0;
    const a = onePole(2500, sr);
    write(out, start, length, o.pan, (n) => {
        const t = n / sr;
        phase += (48 + 72 * Math.exp(-t / 0.035)) / sr;
        lp += a * (r.next() * 2 - 1 - lp);
        const body = sinc(phase) * Math.exp(-t / 0.16);
        const click = lp * Math.exp(-t / 0.002) * 0.5;
        return (body + click) * o.velocity * onset(n, 24) * Math.min(1, (length - n) / 256);
    });
}

/** A brushed snare: band-passed noise over a short drum tone. */
function snare(out: Bus, start: number, o: Omit<PlayOptions, 'gate'>, sr: number): void {
    const length = seconds(0.32, sr);
    const r = rng(o.seed);
    const band = new Biquad(sr).set('bandpass', 2600, 0.7);
    write(out, start, length, o.pan, (n) => {
        const t = n / sr;
        const brush = band.run(r.next() * 2 - 1) * Math.exp(-t / 0.08) * 1.6;
        const tone = sinc(190 * t) * Math.exp(-t / 0.045) * 0.5;
        return (brush + tone) * o.velocity * onset(n, 48) * Math.min(1, (length - n) / 256);
    });
}

/** A closed hat: high-passed noise, very short. */
function hat(out: Bus, start: number, o: Omit<PlayOptions, 'gate'>, sr: number): void {
    const length = seconds(0.12, sr);
    const r = rng(o.seed);
    const high = new Biquad(sr).set('highpass', 7000, 0.8);
    write(out, start, length, o.pan, (n) => {
        const t = n / sr;
        return (
            high.run(r.next() * 2 - 1) *
            Math.exp(-t / 0.022) *
            2 *
            o.velocity *
            onset(n, 8) *
            Math.min(1, (length - n) / 128)
        );
    });
}

/** A clap: three quick bursts of band-passed noise and a short tail. */
function clap(out: Bus, start: number, o: Omit<PlayOptions, 'gate'>, sr: number): void {
    const length = seconds(0.3, sr);
    const r = rng(o.seed);
    const band = new Biquad(sr).set('bandpass', 1300, 1.1);
    const bursts = [0, 0.011, 0.023];
    write(out, start, length, o.pan, (n) => {
        const t = n / sr;
        let env = 0;
        for (const b of bursts) if (t >= b) env += Math.exp(-(t - b) / 0.006);
        if (t >= 0.023) env += 0.5 * Math.exp(-(t - 0.023) / 0.07);
        return (
            band.run(r.next() * 2 - 1) *
            env *
            1.8 *
            o.velocity *
            onset(n, 16) *
            Math.min(1, (length - n) / 256)
        );
    });
}

/** Render one drum hit at `start` into `out`. */
export function playHit(
    out: Bus,
    piece: DrumPiece,
    start: number,
    o: Omit<PlayOptions, 'gate'>,
    sr: number,
): void {
    if (start >= out.L.length || o.velocity <= 0) return;
    switch (piece) {
        case 'kick':
            kick(out, start, o, sr);
            break;
        case 'snare':
            snare(out, start, o, sr);
            break;
        case 'hat':
            hat(out, start, o, sr);
            break;
        case 'shaker':
            shaker(out, start, { velocity: o.velocity * 1.6, pan: o.pan, seed: o.seed }, sr);
            break;
        case 'knock':
            knock(out, start, { velocity: o.velocity, pan: o.pan, seed: o.seed }, sr);
            break;
        case 'clap':
            clap(out, start, o, sr);
            break;
    }
}
