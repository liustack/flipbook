// Sound effects for sfx cues. Each generator returns the effect on its own
// bus; the caller finds its loudest sample and lines that sample up with the
// cue frame.
import { type Key, midiToHz, type SfxName } from '../../engine/audioScore.ts';
import { rand, rng } from '../core/random.ts';
import { Biquad, type Bus, bus, onePole, panGains, sinc } from './dsp.ts';

/** A page turning over: crinkles, a swish and the flap of the page landing. */
function paper(seed: number, sr: number): Bus {
    const length = Math.round(0.5 * sr);
    const out = bus(length);
    const r = rng(seed);
    const swish = new Biquad(sr).set('bandpass', 2800, 0.7);
    const flapFilter = new Biquad(sr).set('bandpass', 650, 1.1);
    const crinkleFilter = new Biquad(sr).set('highpass', 3500, 0.7);
    const flapAt = Math.round(0.14 * sr);
    const crinkles: { at: number; len: number; amp: number }[] = [];
    for (let k = 0; k < 6; k++) {
        crinkles.push({
            at: Math.round(r.range(0.015, 0.13) * sr),
            len: Math.round(r.range(0.002, 0.007) * sr),
            amp: r.range(0.25, 0.5),
        });
    }
    const [sl, sr2] = panGains(-0.15);
    for (let n = 0; n < length; n++) {
        const t = n / sr;
        const w = r.next() * 2 - 1;
        const swishEnv =
            t < 0.12 ? Math.sin(((t / 0.12) * Math.PI) / 2) ** 2 : Math.exp(-(t - 0.12) / 0.07);
        let v = swish.run(w) * swishEnv * 0.9;
        let c = 0;
        for (const k of crinkles) {
            if (n >= k.at && n < k.at + k.len)
                c += k.amp * Math.sin((Math.PI * (n - k.at)) / k.len);
        }
        v += crinkleFilter.run(w) * c;
        const f = n - flapAt;
        if (f >= 0)
            v += flapFilter.run(w) * 3.2 * Math.exp(-f / (0.012 * sr)) * Math.min(1, f / 24);
        else flapFilter.run(0);
        out.L[n] = v * sl;
        out.R[n] = v * sr2;
    }
    return out;
}

/** Something light landing on paper: a falling thump, a click and a paper slap. */
function drop(seed: number, sr: number): Bus {
    const length = Math.round(0.4 * sr);
    const out = bus(length);
    const r = rng(seed);
    const slap = new Biquad(sr).set('bandpass', 1900, 0.9);
    const clickLp = onePole(3000, sr);
    let lp = 0;
    let phase = 0;
    for (let n = 0; n < length; n++) {
        const t = n / sr;
        const fq = 55 + 95 * Math.exp(-t / 0.03);
        phase += fq / sr;
        const thump = sinc(phase) * Math.exp(-t / 0.09) * Math.min(1, n / 20);
        const w = r.next() * 2 - 1;
        lp += clickLp * (w - lp);
        const click = lp * Math.exp(-t / 0.004) * 1.4;
        const paperSlap = slap.run(w) * Math.exp(-t / 0.015) * 0.9;
        const v = thump + click + paperSlap;
        out.L[n] = v * Math.SQRT1_2;
        out.R[n] = v * Math.SQRT1_2;
    }
    return out;
}

/** A small bell on the tonic of the key. */
function ding(key: Key, sr: number): Bus {
    const length = Math.round(1.8 * sr);
    const out = bus(length);
    let midi = 84 + key.tonic;
    if (midi > 90) midi -= 12;
    const f = midiToHz(midi);
    const partials: [number, number, number][] = [
        [1, 1, 1.5],
        [2, 0.3, 0.8],
        [2.76, 0.25, 0.55],
        [5.4, 0.12, 0.22],
        [8.93, 0.06, 0.1],
    ];
    const [gl, gr] = panGains(0.1);
    const r = rng(key.tonic + 1);
    const strike = new Biquad(sr).set('bandpass', 3200, 1.2);
    for (let n = 0; n < length; n++) {
        const t = n / sr;
        let v = strike.run(r.next() * 2 - 1) * 1.6 * Math.exp(-t / 0.004);
        for (const [ratio, amp, tau] of partials) {
            if (f * ratio > sr * 0.45) continue;
            v += sinc(f * ratio * t) * amp * Math.exp(-t / tau);
        }
        v *= Math.min(1, n / 72) * Math.min(1, (length - n) / (0.05 * sr));
        out.L[n] = v * gl * 0.7;
        out.R[n] = v * gr * 0.7;
    }
    return out;
}

/** A whoosh: band-passed noise sweeping up to the peak, then falling away fast. */
function sweep(seed: number, sr: number): Bus {
    const peakAt = 0.32;
    const length = Math.round(0.6 * sr);
    const out = bus(length);
    const r = rng(seed);
    const left = new Biquad(sr);
    const right = new Biquad(sr);
    for (let n = 0; n < length; n++) {
        const t = n / sr;
        const u = Math.min(1, t / peakAt);
        const center = t < peakAt ? 350 * (2800 / 350) ** u : 2800 * Math.exp(-(t - peakAt) / 0.3);
        if (n % 32 === 0) {
            left.set('bandpass', center, 1.4);
            right.set('bandpass', center * 1.06, 1.4);
        }
        const env = t < peakAt ? u ** 3 : Math.exp(-(t - peakAt) / 0.06);
        out.L[n] = left.run(r.next() * 2 - 1) * env * 2.2;
        out.R[n] = right.run(r.next() * 2 - 1) * env * 2.2;
    }
    return out;
}

/** Level of each effect relative to the others. */
export const SFX_GAIN: Record<SfxName, number> = {
    paper: 0.55,
    drop: 0.8,
    ding: 0.5,
    sweep: 0.5,
};

/** Render one effect on its own bus. `seed` varies repeats of the same effect. */
export function renderSfx(name: SfxName, key: Key, seed: number, sr: number): Bus {
    const s = Math.floor(rand(seed, name) * 4294967296);
    switch (name) {
        case 'paper':
            return paper(s, sr);
        case 'drop':
            return drop(s, sr);
        case 'ding':
            return ding(key, sr);
        case 'sweep':
            return sweep(s, sr);
    }
}
