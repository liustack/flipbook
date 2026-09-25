// Play a written score: every note and drum hit of the expanded plan, in the
// plan's order, onto the main and air buses. Timing drift and velocity spread
// are seeded per event, so the same timeline always plays the same way.

import type { Score } from '../../engine/audioScore.ts';
import type { Room, SheetPlan } from '../../engine/audioSheet.ts';
import { hash32, rand } from '../core/random.ts';
import { samples } from './dsp.ts';
import {
    AIR_INSTRUMENTS,
    DRUM_GAIN,
    INSTRUMENT_GAIN,
    type PitchedInstrument,
    playHit,
    playNote,
} from './instruments.ts';
import type { Arrangement, MasterSettings } from './presets.ts';

export const ROOM_MASTER: Record<Room, MasterSettings> = {
    dry: { reverbSec: 0.9, sendMain: 0.15, sendAir: 0.35, wet: 0.18, lowpass: 12000 },
    room: { reverbSec: 1.8, sendMain: 0.3, sendAir: 0.65, wet: 0.35, lowpass: 11000 },
    hall: { reverbSec: 3, sendMain: 0.42, sendAir: 0.8, wet: 0.48, lowpass: 11000 },
};

/** Most a note starts early or late, in seconds. */
const DRIFT_SEC = 0.003;
/** Spread of the velocity, as a fraction either way. */
const SPREAD = 0.06;

export function perform(score: Score, plan: SheetPlan, out: Arrangement, sr: number): void {
    const seed = hash32(score.seed, 'sheet');
    const spb = score.secondsPerBeat;
    const place = (beat: number, key: string, i: number) => {
        const exact = samples(beat * spb, sr);
        const drift = Math.round((rand(seed, key, 'time', i) - 0.5) * 2 * DRIFT_SEC * sr);
        return Math.max(0, exact + (exact > 0 ? drift : 0));
    };
    const spread = (key: string, i: number) => 1 + (rand(seed, key, 'vel', i) - 0.5) * 2 * SPREAD;
    plan.notes.forEach((note, i) => {
        const part = plan.parts[note.part];
        const instrument = part.instrument as PitchedInstrument;
        playNote(
            AIR_INSTRUMENTS.has(instrument) ? out.air : out.main,
            instrument,
            place(note.beat, 'note', i),
            note.midi,
            {
                velocity: Math.min(1, note.velocity * spread('note', i)),
                gain: INSTRUMENT_GAIN[instrument] * part.volume,
                pan: part.pan,
                gate: Math.max(1, samples(note.beats * spb, sr)),
                seed: hash32(seed, 'note', i),
            },
            sr,
        );
    });
    plan.hits.forEach((hit, i) => {
        const part = plan.parts[hit.part];
        playHit(
            out.main,
            hit.piece,
            place(hit.beat, 'hit', i),
            {
                velocity:
                    Math.min(1, hit.velocity * spread('hit', i)) *
                    DRUM_GAIN[hit.piece] *
                    part.volume,
                pan: part.pan,
                seed: hash32(seed, 'hit', i),
            },
            sr,
        );
    });
}
