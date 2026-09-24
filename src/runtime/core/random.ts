/** 32-bit hash of any mix of numbers and strings (FNV-1a with a murmur finalizer). */
export function hash32(...parts: (number | string)[]): number {
    let h = 0x811c9dc5;
    for (const part of parts) {
        const text = typeof part === 'number' ? part.toString() : part;
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        h ^= 0xff;
        h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
}

/** A number in [0, 1) that depends only on its arguments. */
export function rand(seed: number, ...keys: (number | string)[]): number {
    return hash32(seed, ...keys) / 4294967296;
}

export interface Rng {
    /** Next number in [0, 1). */
    next(): number;
    /** Number in [min, max). */
    range(min: number, max: number): number;
    /** Integer in [min, max]. */
    int(min: number, max: number): number;
    pick<T>(items: readonly T[]): T;
    /** Standard normal sample. */
    gauss(): number;
    /** An independent generator derived from this seed and `key`. */
    fork(key: number | string): Rng;
}

/**
 * Seeded generator (mulberry32). The sequence depends only on the seed, so
 * create it in setup or per frame from rand(seed, frame), never once and
 * advance it across frames.
 */
export function rng(seed: number): Rng {
    let a = seed >>> 0;
    const next = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let x = a;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    const self: Rng = {
        next,
        range: (min, max) => min + (max - min) * next(),
        int: (min, max) => Math.floor(min + (max - min + 1) * next()),
        pick: (items) => items[Math.floor(next() * items.length)],
        gauss: () => {
            const u = Math.max(next(), 1e-12);
            const v = next();
            return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        },
        fork: (key) => rng(hash32(seed, key)),
    };
    return self;
}
