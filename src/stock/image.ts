// Format and pixel size of an image from its first bytes, without decoding it.

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'tiff';

export interface ImageInfo {
    format: ImageFormat;
    width: number;
    height: number;
}

/** File extension flipbook saves each format under. */
export const EXTENSION: Record<ImageFormat, string> = {
    png: '.png',
    jpeg: '.jpg',
    webp: '.webp',
    gif: '.gif',
    tiff: '.tif',
};

function jpegSize(b: Buffer): { width: number; height: number } | null {
    let i = 2;
    while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null;
        const marker = b[i + 1];
        if (marker === 0xff) {
            i += 1;
            continue;
        }
        // SOF0 to SOF15, except DHT (c4), JPG (c8) and DAC (cc).
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
            return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
        }
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
            i += 2;
            continue;
        }
        i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
}

function webpSize(b: Buffer): { width: number; height: number } | null {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8 ' && b.length >= 30) {
        return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    }
    if (kind === 'VP8L' && b.length >= 25) {
        const bits = b.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8X' && b.length >= 30) {
        return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
    }
    return null;
}

function tiffSize(b: Buffer): { width: number; height: number } | null {
    const le = b[0] === 0x49;
    const u16 = (o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
    const u32 = (o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
    const ifd = u32(4);
    if (ifd + 2 > b.length) return null;
    let width = 0;
    let height = 0;
    const count = u16(ifd);
    for (let k = 0; k < count; k++) {
        const e = ifd + 2 + k * 12;
        if (e + 12 > b.length) break;
        const tag = u16(e);
        const type = u16(e + 2);
        const value = type === 3 ? u16(e + 8) : u32(e + 8);
        if (tag === 256) width = value;
        if (tag === 257) height = value;
    }
    return width > 0 && height > 0 ? { width, height } : null;
}

/** The image's format and size, or null when the bytes are not a supported raster image. */
export function imageInfo(b: Buffer): ImageInfo | null {
    if (b.length < 16) return null;
    if (b.readUInt32BE(0) === 0x89504e47 && b.toString('ascii', 12, 16) === 'IHDR') {
        return { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
        const size = jpegSize(b);
        return size ? { format: 'jpeg', ...size } : null;
    }
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
        const size = webpSize(b);
        return size ? { format: 'webp', ...size } : null;
    }
    if (b.toString('ascii', 0, 4) === 'GIF8') {
        return { format: 'gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    }
    const tiff = b.toString('ascii', 0, 4);
    if (tiff === 'II*\u0000' || tiff === 'MM\u0000*') {
        const size = tiffSize(b);
        return size ? { format: 'tiff', ...size } : null;
    }
    return null;
}
