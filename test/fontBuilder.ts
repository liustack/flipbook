// A minimal TrueType font built in memory for tests: one box glyph per
// character, a real cmap, name, OS/2 and the tables Chromium's font
// sanitizer requires. Small enough to write into a temp directory per test.

export interface TestFontOptions {
    family: string;
    chars: string;
    weight?: number;
    italic?: boolean;
}

function table(size: number): { buf: Buffer; at: number } {
    return { buf: Buffer.alloc(size), at: 0 };
}

function pad4(buf: Buffer): Buffer {
    const rest = buf.length % 4;
    return rest === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rest)]);
}

function checksum(buf: Buffer): number {
    const padded = pad4(buf);
    let sum = 0;
    for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
    return sum;
}

function utf16be(text: string): Buffer {
    const out = Buffer.alloc(text.length * 2);
    for (let i = 0; i < text.length; i++) out.writeUInt16BE(text.charCodeAt(i), i * 2);
    return out;
}

/** Bytes of a .ttf whose `chars` (BMP only) each map to a filled box. */
export function buildTestFont(options: TestFontOptions): Buffer {
    const chars = [...new Set([...options.chars].map((c) => c.codePointAt(0) as number))].sort(
        (a, b) => a - b,
    );
    if (chars.some((cp) => cp > 0xfffe)) throw new Error('test fonts cover the BMP only');
    const numGlyphs = chars.length + 1;
    const weight = options.weight ?? 400;

    // glyf and loca: glyph 0 is empty, every other glyph a box.
    // 34 bytes of glyph, padded to 36.
    const box = Buffer.alloc(36);
    box.writeInt16BE(1, 0);
    box.writeInt16BE(100, 2);
    box.writeInt16BE(0, 4);
    box.writeInt16BE(500, 6);
    box.writeInt16BE(700, 8);
    box.writeUInt16BE(3, 10);
    box.writeUInt16BE(0, 12);
    box.writeUInt8(1, 14);
    box.writeUInt8(1, 15);
    box.writeUInt8(1, 16);
    box.writeUInt8(1, 17);
    [100, 0, 400, 0].forEach((dx, i) => {
        box.writeInt16BE(dx, 18 + i * 2);
    });
    [0, 700, 0, -700].forEach((dy, i) => {
        box.writeInt16BE(dy, 26 + i * 2);
    });
    const glyf = Buffer.concat(Array.from({ length: chars.length }, () => box));
    const loca = Buffer.alloc((numGlyphs + 1) * 4);
    for (let g = 0; g <= numGlyphs; g++) loca.writeUInt32BE(g === 0 ? 0 : (g - 1) * 36, g * 4);

    const head = table(54).buf;
    head.writeUInt32BE(0x00010000, 0);
    head.writeUInt32BE(0x00010000, 4);
    head.writeUInt32BE(0x5f0f3cf5, 12);
    head.writeUInt16BE(0x000b, 16);
    head.writeUInt16BE(1000, 18);
    head.writeInt16BE(0, 36);
    head.writeInt16BE(0, 38);
    head.writeInt16BE(500, 40);
    head.writeInt16BE(700, 42);
    head.writeUInt16BE((weight >= 700 ? 1 : 0) | (options.italic ? 2 : 0), 44);
    head.writeUInt16BE(8, 46);
    head.writeInt16BE(2, 48);
    head.writeInt16BE(1, 50);
    head.writeInt16BE(0, 52);

    const hhea = table(36).buf;
    hhea.writeUInt32BE(0x00010000, 0);
    hhea.writeInt16BE(800, 4);
    hhea.writeInt16BE(-200, 6);
    hhea.writeInt16BE(0, 8);
    hhea.writeUInt16BE(600, 10);
    hhea.writeInt16BE(0, 12);
    hhea.writeInt16BE(100, 14);
    hhea.writeInt16BE(500, 16);
    hhea.writeInt16BE(1, 18);
    hhea.writeUInt16BE(numGlyphs, 34);

    const hmtx = Buffer.alloc(numGlyphs * 4);
    for (let g = 0; g < numGlyphs; g++) {
        hmtx.writeUInt16BE(600, g * 4);
        hmtx.writeInt16BE(g === 0 ? 0 : 100, g * 4 + 2);
    }

    const maxp = table(32).buf;
    maxp.writeUInt32BE(0x00010000, 0);
    maxp.writeUInt16BE(numGlyphs, 4);
    maxp.writeUInt16BE(4, 6);
    maxp.writeUInt16BE(1, 8);
    maxp.writeUInt16BE(2, 14);

    const os2 = table(96).buf;
    os2.writeUInt16BE(4, 0);
    os2.writeInt16BE(600, 2);
    os2.writeUInt16BE(weight, 4);
    os2.writeUInt16BE(5, 6);
    os2.writeInt16BE(650, 10);
    os2.writeInt16BE(600, 12);
    os2.writeInt16BE(75, 16);
    os2.writeInt16BE(650, 18);
    os2.writeInt16BE(600, 20);
    os2.writeInt16BE(350, 24);
    os2.writeInt16BE(50, 26);
    os2.writeInt16BE(300, 28);
    os2.writeUInt32BE(1, 42);
    os2.write('NONE', 58, 'latin1');
    os2.writeUInt16BE(options.italic ? 0x01 : 0x40, 62);
    os2.writeUInt16BE(chars[0], 64);
    os2.writeUInt16BE(chars[chars.length - 1], 66);
    os2.writeInt16BE(800, 68);
    os2.writeInt16BE(-200, 70);
    os2.writeUInt16BE(800, 74);
    os2.writeUInt16BE(200, 76);
    os2.writeUInt32BE(1, 78);
    os2.writeInt16BE(500, 86);
    os2.writeInt16BE(700, 88);
    os2.writeUInt16BE(32, 92);

    // cmap format 4, one segment per character plus the closing 0xFFFF segment.
    const segCount = chars.length + 1;
    const sub = Buffer.alloc(16 + segCount * 8);
    const searchRange = 2 * 2 ** Math.floor(Math.log2(segCount));
    sub.writeUInt16BE(4, 0);
    sub.writeUInt16BE(sub.length, 2);
    sub.writeUInt16BE(segCount * 2, 6);
    sub.writeUInt16BE(searchRange, 8);
    sub.writeUInt16BE(Math.log2(searchRange / 2), 10);
    sub.writeUInt16BE(segCount * 2 - searchRange, 12);
    const endAt = 14;
    const startAt = endAt + segCount * 2 + 2;
    const deltaAt = startAt + segCount * 2;
    const rangeAt = deltaAt + segCount * 2;
    chars.forEach((cp, i) => {
        sub.writeUInt16BE(cp, endAt + i * 2);
        sub.writeUInt16BE(cp, startAt + i * 2);
        sub.writeUInt16BE((i + 1 - cp + 0x10000) & 0xffff, deltaAt + i * 2);
    });
    const last = chars.length;
    sub.writeUInt16BE(0xffff, endAt + last * 2);
    sub.writeUInt16BE(0xffff, startAt + last * 2);
    sub.writeUInt16BE(1, deltaAt + last * 2);
    sub.writeUInt16BE(0, rangeAt + last * 2);
    const cmapHead = Buffer.alloc(12);
    cmapHead.writeUInt16BE(0, 0);
    cmapHead.writeUInt16BE(1, 2);
    cmapHead.writeUInt16BE(3, 4);
    cmapHead.writeUInt16BE(1, 6);
    cmapHead.writeUInt32BE(12, 8);
    const cmap = Buffer.concat([cmapHead, sub]);

    const style = options.italic ? 'Italic' : 'Regular';
    const postscript = `${options.family.replace(/[^A-Za-z0-9]/g, '')}-${style}`;
    const names: [number, string][] = [
        [1, options.family],
        [2, style],
        [3, `${postscript};test`],
        [4, `${options.family} ${style}`],
        [6, postscript],
    ];
    const strings = names.map(([, value]) => utf16be(value));
    const nameHead = Buffer.alloc(6 + names.length * 12);
    nameHead.writeUInt16BE(0, 0);
    nameHead.writeUInt16BE(names.length, 2);
    nameHead.writeUInt16BE(nameHead.length, 4);
    let offset = 0;
    names.forEach(([id], i) => {
        const rec = 6 + i * 12;
        nameHead.writeUInt16BE(3, rec);
        nameHead.writeUInt16BE(1, rec + 2);
        nameHead.writeUInt16BE(0x409, rec + 4);
        nameHead.writeUInt16BE(id, rec + 6);
        nameHead.writeUInt16BE(strings[i].length, rec + 8);
        nameHead.writeUInt16BE(offset, rec + 10);
        offset += strings[i].length;
    });
    const name = Buffer.concat([nameHead, ...strings]);

    const post = table(32).buf;
    post.writeUInt32BE(0x00030000, 0);
    post.writeInt16BE(-100, 8);
    post.writeInt16BE(50, 10);

    const tables: [string, Buffer][] = [
        ['OS/2', os2],
        ['cmap', cmap],
        ['glyf', glyf],
        ['head', head],
        ['hhea', hhea],
        ['hmtx', hmtx],
        ['loca', loca],
        ['maxp', maxp],
        ['name', name],
        ['post', post],
    ];
    const dir = Buffer.alloc(12 + tables.length * 16);
    const dirRange = 16 * 2 ** Math.floor(Math.log2(tables.length));
    dir.writeUInt32BE(0x00010000, 0);
    dir.writeUInt16BE(tables.length, 4);
    dir.writeUInt16BE(dirRange, 6);
    dir.writeUInt16BE(Math.log2(dirRange / 16), 8);
    dir.writeUInt16BE(tables.length * 16 - dirRange, 10);
    let at = dir.length;
    const bodies: Buffer[] = [];
    tables.forEach(([tag, body], i) => {
        const rec = 12 + i * 16;
        dir.write(tag, rec, 'latin1');
        dir.writeUInt32BE(checksum(body), rec + 4);
        dir.writeUInt32BE(at, rec + 8);
        dir.writeUInt32BE(body.length, rec + 12);
        const padded = pad4(body);
        bodies.push(padded);
        at += padded.length;
    });
    const font = Buffer.concat([dir, ...bodies]);
    const headAt = dir.readUInt32BE(12 + 3 * 16 + 8);
    font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, headAt + 8);
    return font;
}
