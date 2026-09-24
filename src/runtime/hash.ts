// Integer hashes for per-pixel and per-cell decisions. Unlike hash32 in
// core/random.ts they take no strings, so a 1080p texture stays fast.

/** A number in [0, 1) from two integer coordinates and a seed. */
export function ihash(x: number, y: number, seed: number): number {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
    h ^= Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca77);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

/** ihash with a third coordinate. */
export function ihash3(x: number, y: number, z: number, seed: number): number {
    return ihash(x, y, (Math.imul(z | 0, 0x2c1b3c6d) ^ seed) | 0);
}

function smooth(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Smooth value noise in [0, 1) on the integer lattice of ihash. */
export function vnoise(x: number, y: number, seed: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const a = ihash(x0, y0, seed);
    const b = ihash(x0 + 1, y0, seed);
    const c = ihash(x0, y0 + 1, seed);
    const d = ihash(x0 + 1, y0 + 1, seed);
    const top = a + (b - a) * fx;
    return top + (c + (d - c) * fx - top) * fy;
}

/** Octaves of vnoise, normalized to [0, 1). */
export function vfbm(x: number, y: number, seed: number, octaves = 3): number {
    let sum = 0;
    let amp = 1;
    let total = 0;
    let f = 1;
    for (let i = 0; i < octaves; i++) {
        sum += amp * vnoise(x * f, y * f, seed + i * 1013);
        total += amp;
        amp *= 0.5;
        f *= 2;
    }
    return sum / total;
}
