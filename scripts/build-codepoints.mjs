#!/usr/bin/env node
// Build src/fonts/codepoints.json from the font files in src/fonts/manifest.json.
//
//   pnpm fonts:codepoints                     read fonts from the flipbook cache
//   pnpm fonts:codepoints <dir>               read fonts from <dir>/<file>
//
// Each file is checked against the manifest SHA-256 before its cmap is read.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'src/fonts/manifest.json'), 'utf-8'));

function cacheFontsDir() {
    if (process.env.FLIPBOOK_CACHE_DIR) return join(process.env.FLIPBOOK_CACHE_DIR, 'fonts');
    const home = process.env.HOME || homedir();
    if (process.platform === 'darwin') return join(home, 'Library/Caches/liustack/flipbook/fonts');
    return join(process.env.XDG_CACHE_HOME || join(home, '.cache'), 'liustack/flipbook/fonts');
}

function locate(font, dirArg) {
    if (dirArg) return join(dirArg, font.file);
    return join(cacheFontsDir(), font.id, font.sha256.slice(0, 12), font.file);
}

/** Every code point the font's best Unicode cmap subtable maps to a real glyph. */
export function readCodepoints(buffer) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const numTables = view.getUint16(4);
    let cmapOffset = -1;
    for (let i = 0; i < numTables; i++) {
        const rec = 12 + i * 16;
        const tag = String.fromCharCode(
            view.getUint8(rec),
            view.getUint8(rec + 1),
            view.getUint8(rec + 2),
            view.getUint8(rec + 3),
        );
        if (tag === 'cmap') cmapOffset = view.getUint32(rec + 8);
    }
    if (cmapOffset < 0) throw new Error('font has no cmap table');
    const count = view.getUint16(cmapOffset + 2);
    const subtables = [];
    for (let i = 0; i < count; i++) {
        const rec = cmapOffset + 4 + i * 8;
        const platform = view.getUint16(rec);
        const encoding = view.getUint16(rec + 2);
        const offset = cmapOffset + view.getUint32(rec + 4);
        subtables.push({ platform, encoding, offset, format: view.getUint16(offset) });
    }
    const pick =
        subtables.find((s) => s.format === 12 && s.platform === 3 && s.encoding === 10) ??
        subtables.find((s) => s.format === 12 && s.platform === 0) ??
        subtables.find((s) => s.format === 4 && s.platform === 3 && s.encoding === 1) ??
        subtables.find((s) => s.format === 4 && s.platform === 0);
    if (!pick) throw new Error('font has no Unicode cmap subtable of format 4 or 12');
    const points = [];
    if (pick.format === 12) {
        const groups = view.getUint32(pick.offset + 12);
        for (let g = 0; g < groups; g++) {
            const base = pick.offset + 16 + g * 12;
            const start = view.getUint32(base);
            const end = view.getUint32(base + 4);
            const glyph = view.getUint32(base + 8);
            for (let cp = start; cp <= end; cp++) {
                if (glyph + (cp - start) !== 0) points.push(cp);
            }
        }
    } else {
        const segX2 = view.getUint16(pick.offset + 6);
        const seg = segX2 / 2;
        const endAt = pick.offset + 14;
        const startAt = endAt + segX2 + 2;
        const deltaAt = startAt + segX2;
        const rangeAt = deltaAt + segX2;
        for (let s = 0; s < seg; s++) {
            const end = view.getUint16(endAt + s * 2);
            const start = view.getUint16(startAt + s * 2);
            const delta = view.getInt16(deltaAt + s * 2);
            const rangeOffset = view.getUint16(rangeAt + s * 2);
            for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
                let glyph;
                if (rangeOffset === 0) {
                    glyph = (cp + delta) & 0xffff;
                } else {
                    const at = rangeAt + s * 2 + rangeOffset + (cp - start) * 2;
                    glyph = view.getUint16(at);
                    if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
                }
                if (glyph !== 0) points.push(cp);
            }
        }
    }
    return [...new Set(points)].sort((a, b) => a - b);
}

/** "4e00-9fa5,3000,..." in hex: consecutive runs collapse into ranges. */
export function encodeRanges(points) {
    const parts = [];
    let i = 0;
    while (i < points.length) {
        let j = i;
        while (j + 1 < points.length && points[j + 1] === points[j] + 1) j++;
        parts.push(
            i === j
                ? points[i].toString(16)
                : `${points[i].toString(16)}-${points[j].toString(16)}`,
        );
        i = j + 1;
    }
    return parts.join(',');
}

function main() {
    const dirArg = process.argv[2];
    const out = {};
    for (const font of manifest.fonts) {
        const file = locate(font, dirArg);
        if (!existsSync(file)) {
            console.error(
                `Missing ${file}. Run flipbook check once, or pass a directory holding ${font.file}.`,
            );
            process.exit(1);
        }
        const bytes = readFileSync(file);
        const digest = createHash('sha256').update(bytes).digest('hex');
        if (digest !== font.sha256) {
            console.error(
                `${file}: sha256 ${digest} does not match the manifest (${font.sha256}).`,
            );
            process.exit(1);
        }
        const points = readCodepoints(bytes);
        out[font.id] = encodeRanges(points);
        console.error(`${font.id}: ${points.length} code points`);
    }
    writeFileSync(join(root, 'src/fonts/codepoints.json'), `${JSON.stringify(out, null, 4)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main();
}
