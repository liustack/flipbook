// Measurement math for the soundtrack: WAV header, ebur128 summary, finding effects in a mix. No browser.
import { describe, expect, it } from 'vitest';
import { locateCues, parseR128, wavHeader } from '../src/engine/audio.ts';

describe('measuring', () => {
    it('writes a float WAV header ffmpeg can read', () => {
        const header = wavHeader(1000, 48000);
        expect(header.toString('ascii', 0, 4)).toBe('RIFF');
        expect(header.readUInt32LE(4)).toBe(50 + 8000);
        expect(header.readUInt16LE(20)).toBe(3);
        expect(header.readUInt32LE(54)).toBe(8000);
    });

    it('parses the ebur128 summary', () => {
        const text = `[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:         -14.2 LUFS
    Threshold: -24.3 LUFS

  True peak:
    Peak:       -1.6 dBFS
`;
        expect(parseR128(text)).toEqual({ integrated: -14.2, truePeak: -1.6 });
        const silent = text.replace('-14.2', '-70.0').replace('-1.6', '-inf');
        expect(parseR128(silent)).toEqual({ integrated: null, truePeak: null });
    });

    it('finds an effect under other sound and measures its offset', () => {
        const rate = 8000;
        const stem = new Float32Array(rate * 3);
        let s = 1;
        const noise = () => {
            s = (s * 16807) % 2147483647;
            return (s / 2147483647) * 2 - 1;
        };
        for (let i = 0; i < 800; i++) stem[rate + i] = noise() * Math.exp(-i / 150);
        const shift = 96;
        const mix = new Float32Array(stem.length);
        for (let i = 0; i < mix.length; i++) {
            mix[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / rate) + (stem[i - shift] ?? 0) * 0.4;
        }
        const cues = [{ id: 'a', sfx: 'drop', frame: 24, peakSample: 48000 }];
        const shifted = locateCues(stem, mix, rate, cues, 24);
        expect(shifted.lagMs).toBeCloseTo(12, 1);
        expect(shifted.cues[0].offsetMs).toBeCloseTo(12, 1);
        const aligned = locateCues(stem, stem, rate, cues, 24);
        expect(aligned.cues[0].offsetMs).toBe(0);
        const silent = new Float32Array(stem.length).fill(0.1);
        expect(locateCues(stem, silent, rate, cues, 24).cues[0].measuredSec).toBeNull();
    });

    it('does not let a pitched effect slip a few cycles under matching music', () => {
        const rate = 8000;
        const stem = new Float32Array(rate * 4);
        const tone = (i: number) => Math.sin((2 * Math.PI * 523.25 * i) / rate);
        let s = 7;
        const noise = () => {
            s = (s * 16807) % 2147483647;
            return (s / 2147483647) * 2 - 1;
        };
        for (let i = 0; i < 4000; i++) stem[rate + i] += tone(i) * Math.exp(-i / 3000);
        for (let i = 0; i < 400; i++) stem[rate * 2.5 + i] += noise() * Math.exp(-i / 80);
        const mix = new Float32Array(stem.length);
        for (let i = 0; i < mix.length; i++) mix[i] = 0.3 * tone(i + 3) + stem[i];
        const cues = [
            { id: 'ding', sfx: 'ding', frame: 24, peakSample: 48000 },
            { id: 'hit', sfx: 'drop', frame: 60, peakSample: 120000 },
        ];
        const found = locateCues(stem, mix, rate, cues, 24);
        expect(found.lagMs).toBe(0);
        expect(found.cues.map((c) => c.offsetMs)).toEqual([0, 0]);
    });
});
