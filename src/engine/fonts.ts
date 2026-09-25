import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { EnvError, progress } from '../cli/report.ts';
import codepoints from '../fonts/codepoints.json' with { type: 'json' };
import lxgwLicense from '../fonts/licenses/lxgw-wenkai.OFL.txt';
import notoLicense from '../fonts/licenses/noto-serif-sc.OFL.txt';
import manifest from '../fonts/manifest.json' with { type: 'json' };
import { fontsDir, isWritable } from './cache.ts';
import { type FontFileInfo, readFontFile } from './fontFile.ts';
import { findOnPath, run } from './proc.ts';

export interface FontEntry {
    id: string;
    family: string;
    file: string;
    weight: string;
    style: string;
    size: number;
    sha256: string;
    license: string;
    licenseFile: string;
    reservedNames: string[];
    source: string;
    urls: string[];
}

export const FONTS: FontEntry[] = manifest.fonts;

const LICENSES: Record<string, string> = {
    'noto-serif-sc.OFL.txt': notoLicense,
    'lxgw-wenkai.OFL.txt': lxgwLicense,
};

/** URL path the page loads a font from. */
export const FONT_URL_PREFIX = '/__flipbook/fonts/';

export function fontPath(font: FontEntry, env: NodeJS.ProcessEnv = process.env): string {
    return path.join(fontsDir(env), font.id, font.sha256.slice(0, 12), font.file);
}

export interface FontStatus {
    id: string;
    family: string;
    path: string;
    present: boolean;
}

/** Which fonts are in the cache. Size only; the hash was checked when the file arrived. */
export function fontStatus(env: NodeJS.ProcessEnv = process.env): FontStatus[] {
    return FONTS.map((font) => {
        const file = fontPath(font, env);
        let present = false;
        try {
            present = fs.statSync(file).size === font.size;
        } catch {
            present = false;
        }
        return { id: font.id, family: font.family, path: file, present };
    });
}

function sha256File(file: string): string {
    const hash = createHash('sha256');
    const fd = fs.openSync(file, 'r');
    try {
        const chunk = Buffer.allocUnsafe(1 << 20);
        for (;;) {
            const read = fs.readSync(fd, chunk, 0, chunk.length, null);
            if (read === 0) break;
            hash.update(chunk.subarray(0, read));
        }
    } finally {
        fs.closeSync(fd);
    }
    return hash.digest('hex');
}

async function downloadTo(url: string, target: string): Promise<void> {
    const curl = findOnPath('curl');
    if (curl) {
        const result = await run(
            curl,
            [
                '-fsSL',
                '--retry',
                '2',
                '--connect-timeout',
                '20',
                '--max-time',
                '900',
                '-o',
                target,
                url,
            ],
            { timeoutMs: 960_000 },
        );
        if (result.code !== 0) {
            throw new Error(result.stderr.trim() || `curl exited ${result.code}`);
        }
        return;
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(900_000) });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
}

function candidateUrls(font: FontEntry, env: NodeJS.ProcessEnv): string[] {
    const base = env.FLIPBOOK_FONT_BASE_URL?.replace(/\/+$/, '');
    return base ? [`${base}/${font.file}`, ...font.urls] : [...font.urls];
}

/** Download one font into the cache, verify size and SHA-256, then move it into place. */
export async function downloadFont(
    font: FontEntry,
    env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
    const target = fontPath(font, env);
    const dir = path.dirname(target);
    if (!isWritable(dir)) {
        throw new EnvError(
            'cache-unwritable',
            `Cannot write ${dir} to store ${font.family}.`,
            ['Run the same flipbook command once outside the sandbox'],
            { dir },
        );
    }
    fs.mkdirSync(dir, { recursive: true });
    const errors: string[] = [];
    for (const url of candidateUrls(font, env)) {
        const part = `${target}.${process.pid}.part`;
        progress(`downloading ${font.family} (${(font.size / 1e6).toFixed(1)} MB) from ${url}`);
        try {
            await downloadTo(url, part);
            const size = fs.statSync(part).size;
            if (size !== font.size) throw new Error(`size ${size}, expected ${font.size}`);
            const digest = sha256File(part);
            if (digest !== font.sha256)
                throw new Error(`sha256 ${digest}, expected ${font.sha256}`);
            fs.renameSync(part, target);
            fs.writeFileSync(path.join(dir, 'OFL.txt'), LICENSES[font.licenseFile]);
            return target;
        } catch (error) {
            errors.push(`${url}: ${(error as Error).message}`);
            fs.rmSync(part, { force: true });
        }
    }
    throw new EnvError(
        'font-download-failed',
        `Could not download ${font.family}.`,
        [
            'Check the network or HTTPS_PROXY, then run the command again',
            `Or set FLIPBOOK_FONT_BASE_URL to a mirror serving ${font.file} (sha256 ${font.sha256})`,
        ],
        { errors },
    );
}

/** Every manifest font in the cache, downloading the missing ones. */
export async function ensureFonts(env: NodeJS.ProcessEnv = process.env): Promise<void> {
    for (const status of fontStatus(env)) {
        if (status.present) continue;
        const font = FONTS.find((f) => f.id === status.id) as FontEntry;
        await downloadFont(font, env);
    }
}

/**
 * A font file the user supplied (named in brand.json or dropped in
 * assets/fonts/), registered under its content hash. The registry only grows:
 * the same bytes always get the same id, so compositions never clash.
 */
export interface UserFontFile extends FontFileInfo {
    /** `user-<first 16 hex of the SHA-256>`. */
    id: string;
    /** The file with links resolved. */
    file: string;
    /** Path under /__flipbook/fonts/ that serves it. */
    name: string;
}

const userFonts = new Map<string, UserFontFile>();
const userFontsByPath = new Map<string, { size: number; mtimeMs: number; font: UserFontFile }>();

/** Read a user font file and register it for serving and for the glyph checks. Throws FontFileError. */
export function readUserFont(file: string): UserFontFile {
    const real = fs.realpathSync(file);
    const stat = fs.statSync(real);
    const known = userFontsByPath.get(real);
    if (known && known.size === stat.size && known.mtimeMs === stat.mtimeMs) return known.font;
    const bytes = fs.readFileSync(real);
    const info = readFontFile(bytes);
    const sha = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    const font: UserFontFile = {
        ...info,
        id: `user-${sha}`,
        file: real,
        name: `user/${sha}${path.extname(real).toLowerCase()}`,
    };
    userFonts.set(font.id, font);
    userFontsByPath.set(real, { size: stat.size, mtimeMs: stat.mtimeMs, font });
    return font;
}

/** The file behind /__flipbook/fonts/<name>: a cached flipbook font or a registered user font. */
export function fontFileFor(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
    const font = FONTS.find((f) => f.file === name);
    if (font) return fontPath(font, env);
    for (const user of userFonts.values()) if (user.name === name) return user.file;
    return null;
}

export interface FontFaceSpec {
    family: string;
    url: string;
    weight: string;
    style: string;
}

export function fontFaces(): FontFaceSpec[] {
    return FONTS.map((font) => ({
        family: font.family,
        url: `${FONT_URL_PREFIX}${font.file}`,
        weight: font.weight,
        style: font.style,
    }));
}

type Ranges = Uint32Array;

function parseRanges(encoded: string): Ranges {
    const parts = encoded.split(',');
    const out = new Uint32Array(parts.length * 2);
    parts.forEach((part, i) => {
        const [a, b] = part.split('-');
        const start = Number.parseInt(a, 16);
        out[i * 2] = start;
        out[i * 2 + 1] = b === undefined ? start : Number.parseInt(b, 16);
    });
    return out;
}

const coverage: Map<string, Ranges> = new Map(
    Object.entries(codepoints as Record<string, string>).map(([id, encoded]) => [
        id,
        parseRanges(encoded),
    ]),
);

function inRanges(ranges: Ranges, cp: number): boolean {
    let lo = 0;
    let hi = ranges.length / 2 - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (cp < ranges[mid * 2]) hi = mid - 1;
        else if (cp > ranges[mid * 2 + 1]) lo = mid + 1;
        else return true;
    }
    return false;
}

/** True when some flipbook font (or the named one, flipbook or user font) has a glyph for `cp`. */
export function covered(cp: number, fontId?: string): boolean {
    if (fontId) {
        const ranges = coverage.get(fontId) ?? userFonts.get(fontId)?.ranges;
        return ranges ? inRanges(ranges, cp) : false;
    }
    for (const ranges of coverage.values()) {
        if (inRanges(ranges, cp)) return true;
    }
    return false;
}

/** Characters that need no glyph: whitespace, controls, joiners and variation selectors. */
export function ignorable(cp: number): boolean {
    return (
        cp <= 0x20 ||
        (cp >= 0x7f && cp <= 0x9f) ||
        cp === 0xa0 ||
        cp === 0xad ||
        (cp >= 0x200b && cp <= 0x200f) ||
        (cp >= 0x2028 && cp <= 0x202f) ||
        cp === 0x2060 ||
        cp === 0xfeff ||
        (cp >= 0xfe00 && cp <= 0xfe0f) ||
        /\s/u.test(String.fromCodePoint(cp))
    );
}

function cleanFamily(family: string): string {
    return family
        .trim()
        .replace(/^["']|["']$/g, '')
        .toLowerCase();
}

/** A user font face as a composition declares it: which registered file, under which family. */
export interface FaceRef {
    id: string;
    family: string;
}

/**
 * The fonts one composition can draw with: flipbook's own plus the user
 * fonts its timeline carries. The glyph and fallback checks ask it.
 */
export class FontSet {
    private readonly families = new Map<string, string[]>();

    constructor(user: readonly FaceRef[] = []) {
        for (const font of FONTS) this.families.set(font.family.toLowerCase(), [font.id]);
        for (const face of user) {
            if (!userFonts.has(face.id)) {
                throw new Error(`User font ${face.id} (${face.family}) was never read`);
            }
            const key = face.family.toLowerCase();
            this.families.set(key, [...(this.families.get(key) ?? []), face.id]);
        }
    }

    /** Font ids behind a CSS family name, or null when it is not one of this set's families. */
    ids(family: string): string[] | null {
        return this.families.get(cleanFamily(family)) ?? null;
    }

    /** True, false, or null when `family` is not one of this set's families. */
    familyCovers(family: string, cp: number): boolean | null {
        const ids = this.ids(family);
        return ids ? ids.some((id) => covered(cp, id)) : null;
    }

    /** True when any font of the set has a glyph for `cp`. */
    covers(cp: number): boolean {
        for (const ids of this.families.values()) {
            if (ids.some((id) => covered(cp, id))) return true;
        }
        return false;
    }

    /** Distinct characters in `text` that no font of the set covers. */
    uncovered(text: string): string[] {
        const missing = new Set<string>();
        for (const ch of text) {
            const cp = ch.codePointAt(0) as number;
            if (!ignorable(cp) && !this.covers(cp)) missing.add(ch);
        }
        return [...missing];
    }
}

/** Distinct characters in `text` that no flipbook font covers. */
export function uncoveredChars(text: string): string[] {
    return new FontSet().uncovered(text);
}

/** Font id for a CSS family name, if it is a flipbook font. */
export function fontIdForFamily(family: string): string | null {
    const clean = cleanFamily(family);
    return FONTS.find((f) => f.family.toLowerCase() === clean)?.id ?? null;
}

/** CSS generic family keywords: never a name for a user font. */
export const GENERIC_FAMILIES = [
    'serif',
    'sans-serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
    'ui-serif',
    'ui-sans-serif',
    'ui-monospace',
    'ui-rounded',
    'math',
    'emoji',
    'fangsong',
    'inherit',
    'initial',
    'unset',
];
