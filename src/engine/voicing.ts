// Chord voicing: where the notes of a chord and of a bass line sit. Pure math,
// shared by the presets and the written score.

/**
 * Place pitch classes as MIDI notes inside [low, high], one note per pitch
 * class, moving as little as possible from `previous` (or sitting near the
 * middle of the range when there is none). Returns the notes sorted low to high.
 */
export function voiceChord(
    pitchClasses: number[],
    low: number,
    high: number,
    previous: number[] | null,
    maxSpan = 16,
): number[] {
    const options = pitchClasses.map((pc) => {
        const notes: number[] = [];
        for (let m = low; m <= high; m++) if (((m % 12) + 12) % 12 === pc) notes.push(m);
        return notes;
    });
    if (options.some((o) => o.length === 0)) {
        throw new Error(`range ${low}..${high} cannot hold every pitch class`);
    }
    const center = (low + high) / 2;
    let best: number[] | null = null;
    let bestCost = Number.POSITIVE_INFINITY;
    const pick: number[] = [];
    const walk = (i: number) => {
        if (i === options.length) {
            const sorted = [...pick].sort((a, b) => a - b);
            for (let k = 1; k < sorted.length; k++) if (sorted[k] === sorted[k - 1]) return;
            const span = sorted[sorted.length - 1] - sorted[0];
            if (span > maxSpan) return;
            let cost: number;
            if (previous && previous.length === sorted.length) {
                cost = sorted.reduce((sum, m, k) => sum + Math.abs(m - previous[k]), 0);
            } else {
                const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
                cost = Math.abs(mean - center) * sorted.length;
            }
            // Ties go to the lower voicing, so the choice never depends on search order.
            cost += span * 0.01 + sorted[0] * 0.0001;
            if (cost < bestCost) {
                bestCost = cost;
                best = sorted;
            }
            return;
        }
        for (const m of options[i]) {
            pick.push(m);
            walk(i + 1);
            pick.pop();
        }
    };
    walk(0);
    if (!best)
        throw new Error(`no voicing of ${pitchClasses.join(',')} within ${maxSpan} semitones`);
    return best;
}

/**
 * One MIDI note of pitch class `pc` in [low, high]: the one nearest to
 * `previous`, or the lowest when there is none. Ties go to the lower note.
 */
export function placeNote(pc: number, low: number, high: number, previous: number | null): number {
    let best: number | null = null;
    for (let m = low; m <= high; m++) {
        if (((m % 12) + 12) % 12 !== pc) continue;
        if (best === null) best = m;
        else if (previous !== null && Math.abs(m - previous) < Math.abs(best - previous)) best = m;
        if (previous === null) break;
    }
    if (best === null) throw new Error(`range ${low}..${high} has no pitch class ${pc}`);
    return best;
}
