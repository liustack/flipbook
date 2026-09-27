// The codepoint builder's WOFF2 reader: only what the WOFF2 spec defines, and
// a clear error for a directory that does not add up.
import { brotliCompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { woff2Cmap } from './build-codepoints.mjs';

const CMAP = Buffer.from('a cmap table, as far as this test cares');

/** A one-table WOFF2: `flags` and the length bytes as given, the data brotli packed. */
function woff2(flags, length, data = CMAP) {
    const packed = brotliCompressSync(data);
    const directory = Buffer.from([flags, ...length]);
    const header = Buffer.alloc(48);
    header.write('wOF2', 0, 'latin1');
    header.writeUInt32BE(0x00010000, 4);
    header.writeUInt32BE(48 + directory.length + packed.length, 8);
    header.writeUInt16BE(1, 12);
    header.writeUInt32BE(packed.length, 20);
    return new Uint8Array(Buffer.concat([header, directory, packed]));
}

describe('woff2Cmap', () => {
    it('reads a plain cmap table', () => {
        expect(Buffer.from(woff2Cmap(woff2(0, [CMAP.length]))).includes(CMAP)).toBe(true);
    });

    it('refuses a cut header or directory, a length with a leading zero, a reserved transform and lengths that do not add up', () => {
        expect(() => woff2Cmap(woff2(0, [0x80, CMAP.length]))).toThrow('bad UIntBase128');
        expect(() => woff2Cmap(woff2(2 << 6, [CMAP.length]))).toThrow(
            'transform version 2, which the spec reserves',
        );
        const font = woff2(0, [CMAP.length]);
        expect(() => woff2Cmap(font.subarray(0, 4))).toThrow('WOFF2 header cut short');
        expect(() => woff2Cmap(font.subarray(0, 48))).toThrow('table directory cut short');
        const custom = woff2(63, []).subarray(0, 51);
        expect(() => woff2Cmap(custom)).toThrow('table directory cut short');
        expect(() => woff2Cmap(woff2(0, [CMAP.length + 5]))).toThrow(
            `declare ${CMAP.length + 5} bytes`,
        );
    });
});
