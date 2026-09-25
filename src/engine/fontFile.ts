// Read what check needs from a TrueType or OpenType file: the code points it
// maps to glyphs, its family name, weight and style. User files arrive here,
// so every read is bounds-checked and a bad file throws FontFileError.

export class FontFileError extends Error {}

export interface FontFileInfo {
    /** 'truetype' for glyf outlines, 'opentype' for CFF. */
    flavor: 'truetype' | 'opentype';
    /** Typographic family (name ID 16), else the family (name ID 1). Null when the file has neither. */
    family: string | null;
    /** CSS font-weight: one value, or "min max" for a variable weight axis. */
    weight: string;
    style: 'normal' | 'italic';
    /** Mapped code points as sorted, inclusive [start, end] pairs. */
    ranges: Uint32Array;
}

interface Table {
    offset: number;
    length: number;
}

class Reader {
    private readonly view: DataView;

    constructor(readonly bytes: Uint8Array) {
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    private need(at: number, size: number): void {
        if (at < 0 || at + size > this.bytes.byteLength) {
            throw new FontFileError('the file is cut short or a table points past its end');
        }
    }

    u8(at: number): number {
        this.need(at, 1);
        return this.view.getUint8(at);
    }

    u16(at: number): number {
        this.need(at, 2);
        return this.view.getUint16(at);
    }

    i16(at: number): number {
        this.need(at, 2);
        return this.view.getInt16(at);
    }

    u32(at: number): number {
        this.need(at, 4);
        return this.view.getUint32(at);
    }

    fixed(at: number): number {
        this.need(at, 4);
        return this.view.getInt32(at) / 65536;
    }

    tag(at: number): string {
        this.need(at, 4);
        return String.fromCharCode(this.u8(at), this.u8(at + 1), this.u8(at + 2), this.u8(at + 3));
    }
}

function tables(r: Reader): Map<string, Table> {
    const count = r.u16(4);
    const out = new Map<string, Table>();
    for (let i = 0; i < count; i++) {
        const rec = 12 + i * 16;
        const offset = r.u32(rec + 8);
        const length = r.u32(rec + 12);
        if (offset + length > r.bytes.byteLength) {
            throw new FontFileError(`table ${r.tag(rec)} points past the end of the file`);
        }
        out.set(r.tag(rec), { offset, length });
    }
    return out;
}

/** Collapse sorted code points into inclusive ranges. */
function toRanges(points: number[]): Uint32Array {
    points.sort((a, b) => a - b);
    const out: number[] = [];
    for (const cp of points) {
        const last = out.length - 1;
        if (last >= 1 && cp <= out[last] + 1) {
            if (cp > out[last]) out[last] = cp;
        } else {
            out.push(cp, cp);
        }
    }
    return Uint32Array.from(out);
}

function readCmap(r: Reader, cmap: Table): Uint32Array {
    const count = r.u16(cmap.offset + 2);
    const subtables: { platform: number; encoding: number; offset: number; format: number }[] = [];
    for (let i = 0; i < count; i++) {
        const rec = cmap.offset + 4 + i * 8;
        const offset = cmap.offset + r.u32(rec + 4);
        subtables.push({
            platform: r.u16(rec),
            encoding: r.u16(rec + 2),
            offset,
            format: r.u16(offset),
        });
    }
    const unicode = (s: (typeof subtables)[number]) =>
        s.platform === 0 || (s.platform === 3 && (s.encoding === 1 || s.encoding === 10));
    const pick =
        subtables.find((s) => unicode(s) && (s.format === 12 || s.format === 13)) ??
        subtables.find((s) => unicode(s) && s.format === 4);
    if (!pick) throw new FontFileError('it has no Unicode character map (cmap format 4 or 12)');
    const points: number[] = [];
    if (pick.format === 12 || pick.format === 13) {
        const groups = r.u32(pick.offset + 12);
        if (groups > 1_000_000) throw new FontFileError('its character map is implausibly large');
        for (let g = 0; g < groups; g++) {
            const base = pick.offset + 16 + g * 12;
            const start = r.u32(base);
            const end = Math.min(r.u32(base + 4), 0x10ffff);
            const glyph = r.u32(base + 8);
            for (let cp = start; cp <= end; cp++) {
                const id = pick.format === 12 ? glyph + (cp - start) : glyph;
                if (id !== 0) points.push(cp);
            }
        }
    } else {
        const segX2 = r.u16(pick.offset + 6);
        const endAt = pick.offset + 14;
        const startAt = endAt + segX2 + 2;
        const deltaAt = startAt + segX2;
        const rangeAt = deltaAt + segX2;
        for (let s = 0; s < segX2 / 2; s++) {
            const end = r.u16(endAt + s * 2);
            const start = r.u16(startAt + s * 2);
            const delta = r.i16(deltaAt + s * 2);
            const rangeOffset = r.u16(rangeAt + s * 2);
            for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
                let glyph: number;
                if (rangeOffset === 0) {
                    glyph = (cp + delta) & 0xffff;
                } else {
                    glyph = r.u16(rangeAt + s * 2 + rangeOffset + (cp - start) * 2);
                    if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
                }
                if (glyph !== 0) points.push(cp);
            }
        }
    }
    return toRanges(points);
}

function decode(r: Reader, at: number, length: number, platform: number): string {
    let out = '';
    if (platform === 1) {
        for (let i = 0; i < length; i++) out += String.fromCharCode(r.u8(at + i));
        return out;
    }
    for (let i = 0; i + 1 < length; i += 2) out += String.fromCharCode(r.u16(at + i));
    return out;
}

function readFamily(r: Reader, name: Table | undefined): string | null {
    if (!name) return null;
    const count = r.u16(name.offset + 2);
    const strings = name.offset + r.u16(name.offset + 4);
    const found: { id: number; platform: number; language: number; value: string }[] = [];
    for (let i = 0; i < count; i++) {
        const rec = name.offset + 6 + i * 12;
        const platform = r.u16(rec);
        const encoding = r.u16(rec + 2);
        const language = r.u16(rec + 4);
        const id = r.u16(rec + 6);
        if (id !== 1 && id !== 16) continue;
        const readable =
            platform === 0 ||
            (platform === 3 && encoding <= 10) ||
            (platform === 1 && encoding === 0);
        if (!readable) continue;
        const value = decode(r, strings + r.u16(rec + 10), r.u16(rec + 8), platform).trim();
        if (value) found.push({ id, platform, language, value });
    }
    const rank = (n: (typeof found)[number]) =>
        (n.id === 16 ? 0 : 10) +
        (n.platform === 3 ? (n.language === 0x409 ? 0 : 1) : n.platform === 0 ? 2 : 3);
    found.sort((a, b) => rank(a) - rank(b));
    return found[0]?.value ?? null;
}

/** Parse a .ttf or .otf file. Throws FontFileError with a reason a person can act on. */
export function readFontFile(bytes: Uint8Array): FontFileInfo {
    const r = new Reader(bytes);
    const magic = r.tag(0);
    if (magic === 'ttcf') throw new FontFileError('it is a font collection (.ttc), not one font');
    if (magic === 'wOFF' || magic === 'wOF2') {
        throw new FontFileError('it is a WOFF web font: supply the .ttf or .otf');
    }
    const version = r.u32(0);
    if (version !== 0x00010000 && magic !== 'OTTO' && magic !== 'true') {
        throw new FontFileError('it is not a TrueType or OpenType font');
    }
    const all = tables(r);
    const cmap = all.get('cmap');
    if (!cmap) throw new FontFileError('it has no character map (cmap table)');
    const ranges = readCmap(r, cmap);
    if (ranges.length === 0) throw new FontFileError('its character map is empty');
    const os2 = all.get('OS/2');
    let weight = '400';
    let style: 'normal' | 'italic' = 'normal';
    if (os2 && os2.length >= 64) {
        const w = r.u16(os2.offset + 4);
        if (w >= 1 && w <= 1000) weight = String(w);
        if (r.u16(os2.offset + 62) & 1) style = 'italic';
    }
    const fvar = all.get('fvar');
    if (fvar) {
        const axesAt = fvar.offset + r.u16(fvar.offset + 4);
        const axisCount = r.u16(fvar.offset + 8);
        const axisSize = r.u16(fvar.offset + 10);
        for (let i = 0; i < axisCount; i++) {
            const at = axesAt + i * axisSize;
            if (r.tag(at) !== 'wght') continue;
            const min = Math.round(r.fixed(at + 4));
            const max = Math.round(r.fixed(at + 12));
            if (min >= 1 && max <= 1000 && min < max) weight = `${min} ${max}`;
        }
    }
    return {
        flavor: magic === 'OTTO' ? 'opentype' : 'truetype',
        family: readFamily(r, all.get('name')),
        weight,
        style,
        ranges,
    };
}
