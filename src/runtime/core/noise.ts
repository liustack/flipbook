import { hash32 } from './random.ts';

function lattice(seed: number, x: number, y: number): number {
    return hash32(seed, x, y) / 4294967296;
}

function fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Smooth value noise in [0, 1], seeded, continuous in x. */
export function noise1(seed: number, x: number): number {
    return noise2(seed, x, 0);
}

/** Smooth 2D value noise in [0, 1], seeded, continuous in x and y. */
export function noise2(seed: number, x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = fade(x - x0);
    const fy = fade(y - y0);
    const a = lattice(seed, x0, y0);
    const b = lattice(seed, x0 + 1, y0);
    const c = lattice(seed, x0, y0 + 1);
    const d = lattice(seed, x0 + 1, y0 + 1);
    const top = a + (b - a) * fx;
    const bottom = c + (d - c) * fx;
    return top + (bottom - top) * fy;
}

/** Fractal sum of noise2 octaves, normalized to [0, 1]. */
export function fbm2(seed: number, x: number, y: number, octaves = 4, gain = 0.5): number {
    let sum = 0;
    let amplitude = 1;
    let total = 0;
    let frequency = 1;
    for (let i = 0; i < octaves; i++) {
        sum += amplitude * noise2(seed + i * 101, x * frequency, y * frequency);
        total += amplitude;
        amplitude *= gain;
        frequency *= 2;
    }
    return sum / total;
}
