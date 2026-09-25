// The instruments a written score plays. They are plain math on Float32Arrays,
// so they run in Node here without a browser.
import { describe, expect, it } from 'vitest';
import { DRUM_PIECES, INSTRUMENT_NAMES, INSTRUMENTS } from '../src/engine/audioSheet.ts';
import { bus } from '../src/runtime/audio/dsp.ts';
import { playHit, playNote } from '../src/runtime/audio/instruments.ts';

const SR = 48000;
const START = 4800;

/** A in the middle of each instrument's range. */
function testNote(name: string): number {
    const [low, high] = INSTRUMENTS[name as keyof typeof INSTRUMENTS].range;
    let midi = 69;
    while (midi > high) midi -= 12;
    while (midi < low) midi += 12;
    return midi;
}

function mono(b: { L: Float32Array; R: Float32Array }): Float32Array {
    const out = new Float32Array(b.L.length);
    for (let i = 0; i < out.length; i++) out[i] = b.L[i] + b.R[i];
    return out;
}

/** Fundamental in Hz from the autocorrelation of a stretch of signal. */
function pitchOf(signal: Float32Array, from: number, length: number): number {
    const minLag = Math.floor(SR / 2500);
    const maxLag = Math.ceil(SR / 30);
    const scores: number[] = [];
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
        let d = 0;
        let e1 = 0;
        let e2 = 0;
        for (let i = from; i < from + length; i++) {
            d += signal[i] * signal[i + lag];
            e1 += signal[i] * signal[i];
            e2 += signal[i + lag] * signal[i + lag];
        }
        const r = d / Math.sqrt(e1 * e2 + 1e-20);
        scores.push(r);
        best = Math.max(best, r);
    }
    // The first lag that is a local maximum close to the best one: the period, not a multiple.
    for (let k = 1; k < scores.length - 1; k++) {
        if (scores[k] >= best * 0.9 && scores[k] >= scores[k - 1] && scores[k] >= scores[k + 1]) {
            const lag = minLag + k;
            const [a, b, c] = [scores[k - 1], scores[k], scores[k + 1]];
            const shift = (a - c) / (2 * (a - 2 * b + c));
            return SR / (lag + (Number.isFinite(shift) ? shift : 0));
        }
    }
    return 0;
}

function render(name: string, midi: number) {
    const out = bus(SR * 3);
    playNote(
        out,
        name as Parameters<typeof playNote>[1],
        START,
        midi,
        { velocity: 0.8, pan: 0, gate: SR, seed: 7 },
        SR,
    );
    return out;
}

describe('instruments', () => {
    const pitched = INSTRUMENT_NAMES.filter((n) => n !== 'drums');

    for (const name of pitched) {
        it(`${name}: sounds from its start, in tune, the same every time`, () => {
            const midi = testNote(name);
            const out = render(name, midi);
            const signal = mono(out);
            let peak = 0;
            for (let i = 0; i < signal.length; i++) {
                expect(Number.isFinite(signal[i])).toBe(true);
                peak = Math.max(peak, Math.abs(signal[i]));
            }
            expect(peak).toBeGreaterThan(0.05);
            expect(peak).toBeLessThan(2);
            for (let i = 0; i < START; i++) expect(signal[i]).toBe(0);
            expect(render(name, midi)).toEqual(out);
            if (name === 'bells') return; // inharmonic by design
            const f = 440 * 2 ** ((midi - 69) / 12);
            const measured = pitchOf(signal, START + SR * 0.4, Math.round(SR * 0.1));
            expect(
                Math.abs(measured / f - 1),
                `${name} measured ${measured} Hz, wants ${f}`,
            ).toBeLessThan(0.02);
        });
    }

    it('lets the key go: a short note is quiet well before a long one', () => {
        for (const name of ['piano', 'strings', 'flute', 'clarinet', 'bass', 'sub'] as const) {
            const short = bus(SR * 3);
            playNote(
                short,
                name,
                0,
                testNote(name),
                { velocity: 0.8, pan: 0, gate: SR * 0.25, seed: 1 },
                SR,
            );
            const long = bus(SR * 3);
            playNote(
                long,
                name,
                0,
                testNote(name),
                { velocity: 0.8, pan: 0, gate: SR * 2, seed: 1 },
                SR,
            );
            const energy = (b: { L: Float32Array }, from: number, to: number) => {
                let e = 0;
                for (let i = from; i < to; i++) e += b.L[i] * b.L[i];
                return e;
            };
            const at = [Math.round(SR * 1), Math.round(SR * 1.2)] as const;
            expect(energy(short, ...at), name).toBeLessThan(energy(long, ...at) * 0.05);
        }
    });

    for (const piece of DRUM_PIECES) {
        it(`drums ${piece}: a short hit, the same every time`, () => {
            const hit = () => {
                const out = bus(SR);
                playHit(out, piece, START, { velocity: 0.9, pan: 0, seed: 5 }, SR);
                return out;
            };
            const out = hit();
            const signal = mono(out);
            let peak = 0;
            let last = 0;
            for (let i = 0; i < signal.length; i++) {
                expect(Number.isFinite(signal[i])).toBe(true);
                if (Math.abs(signal[i]) > 1e-4) last = i;
                peak = Math.max(peak, Math.abs(signal[i]));
            }
            expect(peak).toBeGreaterThan(0.03);
            expect(last - START).toBeLessThan(SR * 0.6);
            expect(hit()).toEqual(out);
        });
    }
});
