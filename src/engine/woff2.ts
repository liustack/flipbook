// The tables of a WOFF2 font that need no rebuilding (everything but glyf,
// loca and a transformed hmtx), laid out again as a plain sfnt, enough for
// reading its character map, names and weight. flipbook serves one font as
// WOFF2, the only form it is published in, and checks it like the others.
import { brotliDecompressSync } from 'zlib';

// The table tags WOFF2 knows by number (WOFF2 spec, 5.1).
const TAGS = [
    'cmap',
    'head',
    'hhea',
    'hmtx',
    'maxp',
    'name',
    'OS/2',
    'post',
    'cvt ',
    'fpgm',
    'glyf',
    'loca',
    'prep',
    'CFF ',
    'VORG',
    'EBDT',
    'EBLC',
    'gasp',
    'hdmx',
    'kern',
    'LTSH',
    'PCLT',
    'VDMX',
    'vhea',
    'vmtx',
    'BASE',
    'GDEF',
    'GPOS',
    'GSUB',
    'EBSC',
    'JSTF',
    'MATH',
    'CBDT',
    'CBLC',
    'COLR',
    'CPAL',
    'SVG ',
    'sbix',
    'acnt',
    'avar',
    'bdat',
    'bloc',
    'bsln',
    'cvar',
    'fdsc',
    'feat',
    'fmtx',
    'fvar',
    'gvar',
    'hsty',
    'just',
    'lcar',
    'mort',
    'morx',
    'opbd',
    'prop',
    'trak',
    'Zapf',
    'Silf',
    'Glat',
    'Gloc',
    'Feat',
    'Sill',
];

export function isWoff2(bytes: Uint8Array): boolean {
    return (
        bytes.length >= 4 &&
        bytes[0] === 0x77 &&
        bytes[1] === 0x4f &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x32
    );
}

/**
 * Whether a table is stored transformed, and its length in the font data. Only
 * the versions the WOFF2 spec defines are read (5.1): glyf and loca 0 (their
 * transform) or 3 (none), hmtx 0 (none) or 1 (its transform), any other 0.
 */
function woff2Transform(
    tag: string,
    version: number,
    length: number,
    next: () => number,
): { length: number; transformed: boolean } {
    const glyph = tag === 'glyf' || tag === 'loca';
    const known = glyph
        ? version === 0 || version === 3
        : version === 0 || (tag === 'hmtx' && version === 1);
    if (!known)
        throw new Error(
            `WOFF2 table ${tag} has transform version ${version}, which the spec reserves`,
        );
    const transformed = glyph ? version === 0 : version === 1;
    return transformed ? { length: next(), transformed } : { length, transformed };
}

/** An sfnt holding the untransformed tables of a WOFF2 font. */
export function woff2ToSfnt(bytes: Uint8Array): Buffer {
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (!isWoff2(buf)) throw new Error('not a WOFF2 font');
    if (buf.length < 48) throw new Error('WOFF2 header cut short');
    const flavor = buf.readUInt32BE(4);
    if (flavor === 0x74746366) throw new Error('WOFF2 font collections are not read');
    const numTables = buf.readUInt16BE(12);
    const compressed = buf.readUInt32BE(20);
    let at = 48;
    const byte = () => {
        if (at >= buf.length) throw new Error('WOFF2 table directory cut short');
        return buf[at++];
    };
    const base128 = () => {
        let value = 0;
        for (let i = 0; i < 5; i++) {
            const b = byte();
            // No leading zeros, and the value fits 32 bits (WOFF2 spec, 4.1).
            if (i === 0 && b === 0x80)
                throw new Error('bad UIntBase128 in the WOFF2 table directory');
            value = value * 128 + (b & 0x7f);
            if (value > 0xffffffff) throw new Error('bad UIntBase128 in the WOFF2 table directory');
            if ((b & 0x80) === 0) return value;
        }
        throw new Error('bad UIntBase128 in the WOFF2 table directory');
    };
    const tables: { tag: string; length: number; transformed: boolean }[] = [];
    for (let i = 0; i < numTables; i++) {
        const flags = byte();
        let tag: string;
        if ((flags & 0x3f) === 63) {
            if (at + 4 > buf.length) throw new Error('WOFF2 table directory cut short');
            tag = buf.toString('latin1', at, at + 4);
            at += 4;
        } else {
            tag = TAGS[flags & 0x3f];
        }
        const version = flags >> 6;
        const length = base128();
        tables.push({ tag, ...woff2Transform(tag, version, length, base128) });
    }
    if (at + compressed > buf.length) throw new Error('WOFF2 font data cut short');
    const data = brotliDecompressSync(buf.subarray(at, at + compressed));
    const declared = tables.reduce((n, t) => n + t.length, 0);
    if (declared !== data.length) {
        throw new Error(
            `WOFF2 tables declare ${declared} bytes, the font data unpacks to ${data.length}`,
        );
    }
    const kept: { tag: string; bytes: Buffer }[] = [];
    let offset = 0;
    for (const t of tables) {
        if (!t.transformed)
            kept.push({ tag: t.tag, bytes: data.subarray(offset, offset + t.length) });
        offset += t.length;
    }
    kept.sort((a, b) => (a.tag < b.tag ? -1 : 1));
    const head = 12 + 16 * kept.length;
    const size = kept.reduce((n, t) => n + ((t.bytes.length + 3) & ~3), head);
    const out = Buffer.alloc(size);
    out.writeUInt32BE(flavor, 0);
    out.writeUInt16BE(kept.length, 4);
    let pos = head;
    kept.forEach((t, i) => {
        const rec = 12 + 16 * i;
        out.write(t.tag, rec, 'latin1');
        out.writeUInt32BE(pos, rec + 8);
        out.writeUInt32BE(t.bytes.length, rec + 12);
        t.bytes.copy(out, pos);
        pos += (t.bytes.length + 3) & ~3;
    });
    return out;
}
