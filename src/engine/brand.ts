// Brand assets and user fonts for one composition: brand.json (named by
// timeline.json's `brand`) and font files under assets/fonts/. Everything is
// checked here, before a page opens: files are local and exist, every logo and
// font states its license, colors parse, font files are real fonts.
import * as fs from 'fs';
import * as path from 'path';
import { type Finding, finding } from '../cli/report.ts';
import { FontFileError } from './fontFile.ts';
import {
    FONT_URL_PREFIX,
    FONTS,
    GENERIC_FAMILIES,
    readUserFont,
    type UserFontFile,
} from './fonts.ts';
import type { ResolvedBrand, UserFontFace } from './timelineResolve.ts';

export const BRAND_VERSION = 1;
/** Largest logo file inlined into the page. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const LOGO_TYPES: Record<string, string> = {
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
};
const FONT_EXTENSIONS = ['.ttf', '.otf'];
const COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const URL_LIKE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
/** Where fonts dropped into the composition live, and where their licenses are written. */
export const FONT_DIR = path.join('assets', 'fonts');
export const SOURCES_FILE = path.join('assets', 'SOURCES.json');

export interface CompositionAssets {
    brand: ResolvedBrand | null;
    fonts: UserFontFace[];
    findings: Finding[];
}

type Json = unknown;

function isObject(value: Json): value is Record<string, Json> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: Json): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function inside(root: string, target: string): boolean {
    const rel = path.relative(root, target);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

class Problems {
    readonly findings: Finding[] = [];

    constructor(private readonly file: string) {}

    brand(at: string, message: string): void {
        this.findings.push(
            finding('brand-invalid', `${at} in ${this.file} ${message}`, {
                element: this.file,
                detail: { file: this.file, path: at },
            }),
        );
    }
}

function fontProblem(file: string, message: string, detail: Record<string, unknown> = {}): Finding {
    return finding('font-invalid', `${file}: ${message}`, {
        element: file,
        detail: { file, ...detail },
    });
}

/**
 * A local file named in brand.json: relative to the brand.json directory and,
 * with links resolved, still inside it.
 */
function localFile(
    base: string,
    value: Json,
    at: string,
    problems: Problems,
): { real: string; shown: string } | null {
    if (!nonEmpty(value)) {
        problems.brand(at, 'must be a path to a local file');
        return null;
    }
    if (URL_LIKE.test(value) || path.isAbsolute(value)) {
        problems.brand(at, `must be a path relative to brand.json, not ${JSON.stringify(value)}`);
        return null;
    }
    let real: string;
    try {
        real = fs.realpathSync(path.resolve(base, value));
    } catch {
        problems.brand(at, `names ${value}, which does not exist next to brand.json`);
        return null;
    }
    if (!inside(fs.realpathSync(base), real)) {
        problems.brand(
            at,
            `names ${value}, which resolves outside the directory that holds brand.json`,
        );
        return null;
    }
    if (!fs.statSync(real).isFile()) {
        problems.brand(at, `names ${value}, which is not a regular file`);
        return null;
    }
    return { real, shown: value };
}

/** A face the composition will install, with its registry entry. */
interface Face {
    font: UserFontFile;
    face: UserFontFace;
}

function faceFor(
    font: UserFontFile,
    family: string,
    source: string,
    weight?: string,
    style?: string,
): Face {
    return {
        font,
        face: {
            id: font.id,
            family,
            url: `${FONT_URL_PREFIX}${font.name}`,
            weight: weight ?? font.weight,
            style: style ?? font.style,
            source,
        },
    };
}

function reservedFamily(family: string): string | null {
    const lower = family.trim().toLowerCase();
    if (FONTS.some((f) => f.family.toLowerCase() === lower)) return 'is a flipbook font already';
    if (GENERIC_FAMILIES.includes(lower)) return 'is a CSS generic family';
    return null;
}

/** The license written for `file` (relative to the composition) in assets/SOURCES.json. */
function licenseFor(sources: Record<string, Json> | null, rel: string): string | null {
    if (!sources) return null;
    const underAssets = path.relative('assets', rel).split(path.sep).join('/');
    const full = rel.split(path.sep).join('/');
    const entry = sources[underAssets] ?? sources[full];
    return isObject(entry) && nonEmpty(entry.license) ? entry.license : null;
}

/** A file in assets/fonts/: its face when readable, and what is wrong with it for use on its own. */
interface Dropped {
    real: string;
    face: Face | null;
    problem: Finding | null;
}

/**
 * Fonts dropped into <dir>/assets/fonts/, each needing its license in
 * assets/SOURCES.json. Problems stay attached to their file: a file that
 * brand.json declares is judged by its declaration instead.
 */
function droppedFonts(dir: string, findings: Finding[]): Dropped[] {
    const folder = path.join(dir, FONT_DIR);
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return [];
    const files = fs
        .readdirSync(folder)
        .filter((name) => FONT_EXTENSIONS.includes(path.extname(name).toLowerCase()))
        .sort();
    if (files.length === 0) return [];
    let sources: Record<string, Json> | null = null;
    const sourcesPath = path.join(dir, SOURCES_FILE);
    if (fs.existsSync(sourcesPath)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(sourcesPath, 'utf-8'));
            if (isObject(parsed)) sources = parsed;
            else
                findings.push(
                    fontProblem(SOURCES_FILE, 'must be a JSON object keyed by file path'),
                );
        } catch (error) {
            findings.push(
                fontProblem(SOURCES_FILE, `is not valid JSON: ${(error as Error).message}`),
            );
        }
    }
    const out: Dropped[] = [];
    const root = fs.realpathSync(dir);
    for (const name of files) {
        const rel = path.join(FONT_DIR, name);
        const shown = rel.split(path.sep).join('/');
        const full = path.join(dir, rel);
        // The files are the user's: a link may point nowhere or out of the
        // composition folder, which the page must never be able to read.
        let real: string;
        try {
            real = fs.realpathSync(full);
            if (!fs.statSync(real).isFile()) throw new Error('not a regular file');
        } catch (error) {
            out.push({
                real: full,
                face: null,
                problem: fontProblem(shown, `cannot be read: ${(error as Error).message}`),
            });
            continue;
        }
        if (!inside(root, real)) {
            out.push({
                real,
                face: null,
                problem: fontProblem(
                    shown,
                    'resolves outside the composition folder. Copy the font file into assets/fonts/',
                ),
            });
            continue;
        }
        let font: UserFontFile;
        try {
            font = readUserFont(real);
        } catch (error) {
            if (!(error instanceof FontFileError)) throw error;
            out.push({
                real,
                face: null,
                problem: fontProblem(shown, `cannot be used: ${error.message}`),
            });
            continue;
        }
        if (!font.family) {
            out.push({
                real,
                face: null,
                problem: fontProblem(
                    shown,
                    'names no family. Declare it in brand.json under fonts.files with a family',
                ),
            });
            continue;
        }
        const reserved = reservedFamily(font.family);
        if (reserved) {
            out.push({
                real,
                face: null,
                problem: fontProblem(shown, `its family "${font.family}" ${reserved}`),
            });
            continue;
        }
        const license = licenseFor(sources, rel);
        out.push({
            real,
            face: faceFor(font, font.family, shown),
            problem: license
                ? null
                : fontProblem(
                      shown,
                      `has no license. Add "${shown.replace(/^assets\//, '')}": { "source": "...", "license": "..." } to ${SOURCES_FILE.split(path.sep).join('/')}`,
                  ),
        });
    }
    return out;
}

function readBrand(
    dir: string,
    brandPath: string,
    droppedFamilies: readonly string[],
): { brand: ResolvedBrand | null; faces: Face[]; findings: Finding[] } {
    const file = path.resolve(dir, brandPath);
    const problems = new Problems(brandPath);
    let raw: string;
    try {
        raw = fs.readFileSync(file, 'utf-8');
    } catch {
        problems.brand('$', `does not exist: timeline.json's brand names ${brandPath}`);
        return { brand: null, faces: [], findings: problems.findings };
    }
    let input: Json;
    try {
        input = JSON.parse(raw);
    } catch (error) {
        problems.brand('$', `is not valid JSON: ${(error as Error).message}`);
        return { brand: null, faces: [], findings: problems.findings };
    }
    if (!isObject(input)) {
        problems.brand('$', 'must be a JSON object');
        return { brand: null, faces: [], findings: problems.findings };
    }
    const base = path.dirname(file);
    const allowed = ['$schema', 'version', 'name', 'tagline', 'logo', 'colors', 'fonts'];
    for (const key of Object.keys(input)) {
        if (!allowed.includes(key)) {
            problems.brand(
                `$.${key}`,
                `is not a brand.json field (allowed: ${allowed.join(', ')})`,
            );
        }
    }
    if (input.version !== undefined && input.version !== BRAND_VERSION) {
        problems.brand('$.version', `must be ${BRAND_VERSION}`);
    }
    if (!nonEmpty(input.name)) problems.brand('$.name', 'must be the brand name');
    if (input.tagline !== undefined && !nonEmpty(input.tagline)) {
        problems.brand('$.tagline', 'must be a line of text when given');
    }

    const colors: ResolvedBrand['colors'] = {
        primary: '',
        secondary: null,
        ink: null,
        paper: null,
    };
    if (!isObject(input.colors)) {
        problems.brand('$.colors', 'must hold at least "primary" as #rgb or #rrggbb');
    } else {
        for (const key of Object.keys(input.colors)) {
            if (!(key in colors)) {
                problems.brand(
                    `$.colors.${key}`,
                    'is not a brand color (allowed: primary, secondary, ink, paper)',
                );
            }
        }
        for (const key of ['primary', 'secondary', 'ink', 'paper'] as const) {
            const value = input.colors[key];
            if (value === undefined && key !== 'primary') continue;
            if (typeof value !== 'string' || !COLOR.test(value)) {
                problems.brand(
                    `$.colors.${key}`,
                    `must be #rgb or #rrggbb (got ${JSON.stringify(value)})`,
                );
            } else {
                colors[key] = value.toLowerCase();
            }
        }
    }

    let logo: ResolvedBrand['logo'] = null;
    if (input.logo !== undefined) {
        if (!isObject(input.logo)) {
            problems.brand('$.logo', 'must be { "file": "...", "license": "..." }');
        } else {
            for (const key of Object.keys(input.logo)) {
                if (!['file', 'license', 'source'].includes(key)) {
                    problems.brand(
                        `$.logo.${key}`,
                        'is not a logo field (allowed: file, license, source)',
                    );
                }
            }
            if (!nonEmpty(input.logo.license)) {
                problems.brand('$.logo.license', 'must say under what terms the logo may be used');
            }
            const found = localFile(base, input.logo.file, '$.logo.file', problems);
            if (found) {
                const type = LOGO_TYPES[path.extname(found.real).toLowerCase()];
                const size = fs.statSync(found.real).size;
                if (!type) {
                    problems.brand('$.logo.file', `must be ${Object.keys(LOGO_TYPES).join(', ')}`);
                } else if (size > MAX_LOGO_BYTES) {
                    problems.brand(
                        '$.logo.file',
                        `is ${(size / 1e6).toFixed(1)} MB, over the 2 MB limit`,
                    );
                } else {
                    const data = fs.readFileSync(found.real);
                    logo = { src: `data:${type};base64,${data.toString('base64')}`, type };
                }
            }
        }
    }

    const faces: Face[] = [];
    const roles = { title: FONTS[0].family, text: '' };
    if (input.fonts !== undefined && !isObject(input.fonts)) {
        problems.brand('$.fonts', 'must be { "title": ..., "text": ..., "files": [...] }');
    } else if (isObject(input.fonts)) {
        const fonts = input.fonts;
        for (const key of Object.keys(fonts)) {
            if (!['title', 'text', 'files'].includes(key)) {
                problems.brand(
                    `$.fonts.${key}`,
                    'is not a fonts field (allowed: title, text, files)',
                );
            }
        }
        if (fonts.files !== undefined && !Array.isArray(fonts.files)) {
            problems.brand('$.fonts.files', 'must be a list of { family, file, license }');
        }
        (Array.isArray(fonts.files) ? fonts.files : []).forEach((entry: Json, i: number) => {
            const at = `$.fonts.files[${i}]`;
            if (!isObject(entry)) {
                problems.brand(at, 'must be { "family": "...", "file": "...", "license": "..." }');
                return;
            }
            for (const key of Object.keys(entry)) {
                if (!['family', 'file', 'license', 'weight', 'style', 'source'].includes(key)) {
                    problems.brand(
                        `${at}.${key}`,
                        'is not a font field (allowed: family, file, license, weight, style, source)',
                    );
                }
            }
            if (!nonEmpty(entry.family))
                problems.brand(
                    `${at}.family`,
                    'must be the family name to use in CSS and ctx.font',
                );
            else {
                const reserved = reservedFamily(entry.family);
                if (reserved)
                    problems.brand(
                        `${at}.family`,
                        `"${entry.family}" ${reserved}: pick another name`,
                    );
            }
            if (!nonEmpty(entry.license))
                problems.brand(`${at}.license`, 'must say under what terms the font may be used');
            const weight =
                entry.weight === undefined
                    ? undefined
                    : typeof entry.weight === 'number' || nonEmpty(entry.weight)
                      ? String(entry.weight)
                      : null;
            if (weight === null || (weight !== undefined && !/^\d{1,4}( \d{1,4})?$/.test(weight))) {
                problems.brand(
                    `${at}.weight`,
                    'must be a weight such as 400, or a range such as "200 900"',
                );
            }
            if (entry.style !== undefined && entry.style !== 'normal' && entry.style !== 'italic') {
                problems.brand(`${at}.style`, 'must be "normal" or "italic"');
            }
            const found = localFile(base, entry.file, `${at}.file`, problems);
            if (!found) return;
            if (!FONT_EXTENSIONS.includes(path.extname(found.real).toLowerCase())) {
                problems.brand(`${at}.file`, 'must be a .ttf or .otf file');
                return;
            }
            let font: UserFontFile;
            try {
                font = readUserFont(found.real);
            } catch (error) {
                if (!(error instanceof FontFileError)) throw error;
                problems.brand(
                    `${at}.file`,
                    `names ${found.shown}, which cannot be used: ${error.message}`,
                );
                return;
            }
            if (nonEmpty(entry.family) && !reservedFamily(entry.family) && weight !== null) {
                faces.push(
                    faceFor(
                        font,
                        entry.family.trim(),
                        found.shown,
                        weight,
                        entry.style as string | undefined,
                    ),
                );
            }
        });
        const known = new Set(
            [
                ...FONTS.map((f) => f.family),
                ...faces.map((f) => f.face.family),
                ...droppedFamilies,
            ].map((f) => f.toLowerCase()),
        );
        for (const role of ['title', 'text'] as const) {
            const value = fonts[role];
            if (value === undefined) continue;
            if (!nonEmpty(value) || !known.has(value.trim().toLowerCase())) {
                problems.brand(
                    `$.fonts.${role}`,
                    `names ${JSON.stringify(value)}: use "Noto Serif SC", "LXGW WenKai", or a family from fonts.files or assets/fonts/`,
                );
            } else {
                roles[role] = value.trim();
            }
        }
    }
    if (problems.findings.length > 0)
        return { brand: null, faces: [], findings: problems.findings };
    return {
        brand: {
            name: (input.name as string).trim(),
            tagline: nonEmpty(input.tagline) ? input.tagline.trim() : null,
            colors,
            logo,
            fonts: { title: roles.title, text: roles.text || roles.title },
        },
        faces,
        findings: [],
    };
}

/**
 * Brand and user fonts of a composition. `brandPath` is timeline.json's
 * `brand`. Any finding is an error: the composition does not load until it
 * is fixed.
 */
export function loadAssets(dir: string, brandPath?: string): CompositionAssets {
    const findings: Finding[] = [];
    const dropped = droppedFonts(dir, findings);
    let brand: ResolvedBrand | null = null;
    let declared: Face[] = [];
    if (brandPath) {
        const families = dropped.flatMap((d) => (d.face ? [d.face.face.family] : []));
        const read = readBrand(dir, brandPath, families);
        findings.push(...read.findings);
        brand = read.brand;
        declared = read.faces;
    }
    // A file brand.json declares is used and judged as declared, not a second time on its own.
    const declaredFiles = new Set(declared.map((d) => d.font.file));
    const own: Face[] = [];
    for (const d of dropped) {
        if (declaredFiles.has(d.real)) continue;
        if (d.problem) findings.push(d.problem);
        else if (d.face) own.push(d.face);
    }
    const faces: UserFontFace[] = [];
    const slots = new Map<string, string>();
    for (const { face } of [...declared, ...own]) {
        const slot = `${face.family.toLowerCase()}|${face.weight}|${face.style}`;
        const taken = slots.get(slot);
        if (taken) {
            findings.push(
                fontProblem(
                    face.source,
                    `and ${taken} are both "${face.family}" at weight ${face.weight}, style ${face.style}: keep one, or give them different weights`,
                ),
            );
            continue;
        }
        slots.set(slot, face.source);
        faces.push(face);
    }
    return { brand, fonts: faces, findings };
}
