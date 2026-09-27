// Reading a WOFF2 font's plain tables: only what the WOFF2 spec defines, and
// a clear error for a directory that does not add up.
import { describe, expect, it } from 'vitest';
import { brotliCompressSync } from 'zlib';
import { woff2ToSfnt } from '../src/engine/woff2.ts';

const CMAP = Buffer.from('a cmap table, as far as this test cares');

/** A one-table WOFF2: `flags` and the length bytes as given, the data brotli packed. */
function woff2(flags: number, length: number[], data = CMAP): Buffer {
    const packed = brotliCompressSync(data);
    const directory = Buffer.from([flags, ...length]);
    const header = Buffer.alloc(48);
    header.write('wOF2', 0, 'latin1');
    header.writeUInt32BE(0x00010000, 4);
    header.writeUInt32BE(48 + directory.length + packed.length, 8);
    header.writeUInt16BE(1, 12);
    header.writeUInt32BE(packed.length, 20);
    return Buffer.concat([header, directory, packed]);
}

describe('WOFF2 tables', () => {
    it('reads a plain cmap table', () => {
        const font = woff2(0, [CMAP.length]);
        expect(woff2ToSfnt(font).includes(CMAP)).toBe(true);
    });

    it('refuses a length with a leading zero, a reserved transform and lengths that do not add up', () => {
        expect(() => woff2ToSfnt(woff2(0, [0x80, CMAP.length]))).toThrow('bad UIntBase128');
        expect(() => woff2ToSfnt(woff2(2 << 6, [CMAP.length]))).toThrow(
            'transform version 2, which the spec reserves',
        );
        expect(() => woff2ToSfnt(woff2(0, [CMAP.length + 5]))).toThrow(
            `declare ${CMAP.length + 5} bytes`,
        );
    });
});
