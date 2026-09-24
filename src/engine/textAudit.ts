import { type Finding, finding } from '../cli/report.ts';
import { covered, fontIdForFamily, ignorable, uncoveredChars } from './fonts.ts';
import type { RegisteredText } from './host.ts';
import type { CompositionPage, DomText } from './page.ts';
import type { ResolvedTimeline } from './timelineResolve.ts';

/** Glyph coverage of the text cues in timeline.json; needs no browser. */
export function auditCueText(timeline: ResolvedTimeline): Finding[] {
    const out: Finding[] = [];
    for (const cue of timeline.cues) {
        if (!cue.text) continue;
        const missing = uncoveredChars(cue.text);
        if (missing.length > 0) {
            out.push(
                finding(
                    'missing-glyph',
                    `Cue "${cue.id}" uses characters no flipbook font has: ${missing.join(' ')}`,
                    {
                        time: cue.time,
                        frame: cue.frame,
                        element: `timeline.json cue ${cue.id}`,
                        detail: {
                            chars: missing,
                            codepoints: missing.map(
                                (c) =>
                                    `U+${(c.codePointAt(0) as number).toString(16).toUpperCase()}`,
                            ),
                        },
                    },
                ),
            );
        }
    }
    return out;
}

/** The font-family list of a CSS font shorthand, quotes removed, in order. */
export function fontFamilies(fontShorthand: string): string[] {
    const match = /(?:\d+(?:\.\d+)?(?:px|pt|em|rem|%)(?:\/\S+)?\s+)(.+)$/.exec(
        fontShorthand.trim(),
    );
    const list = match ? match[1] : fontShorthand;
    const families: string[] = [];
    let current = '';
    let quote: string | null = null;
    for (const ch of list) {
        if (quote) {
            if (ch === quote) quote = null;
            else current += ch;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
        } else if (ch === ',') {
            families.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    families.push(current.trim());
    return families.filter(Boolean);
}

/**
 * Canvas text against the fonts it is drawn with. For each character the
 * families are tried in order, as Chromium does: the first flipbook font that
 * has the glyph draws it. A character reaching a family that is not a flipbook
 * font (or the end of the list) is drawn with a system font: font-fallback,
 * or missing-glyph when no flipbook font has it at all.
 */
export function auditCanvasText(entries: RegisteredText[], frame: number, fps: number): Finding[] {
    const out: Finding[] = [];
    const time = frame / fps;
    for (const entry of entries) {
        const label = entry.id
            ? `canvas text "${entry.id}"`
            : `canvas text "${entry.text.slice(0, 24)}"`;
        const families = fontFamilies(entry.font);
        const missing = new Set<string>();
        const fallback = new Set<string>();
        for (const ch of entry.text) {
            const cp = ch.codePointAt(0) as number;
            if (ignorable(cp)) continue;
            let drawn = false;
            for (const family of families) {
                const id = fontIdForFamily(family);
                if (!id) break;
                if (covered(cp, id)) {
                    drawn = true;
                    break;
                }
            }
            if (drawn) continue;
            if (covered(cp)) fallback.add(ch);
            else missing.add(ch);
        }
        if (missing.size > 0) {
            out.push(
                finding(
                    'missing-glyph',
                    `${label} uses characters no flipbook font has: ${[...missing].join(' ')}`,
                    {
                        time,
                        frame,
                        element: label,
                        detail: { chars: [...missing], box: entry.box },
                    },
                ),
            );
        }
        if (fallback.size > 0) {
            out.push(
                finding(
                    'font-fallback',
                    `${label} is drawn with ${families.map((f) => `"${f}"`).join(', ') || 'no font family'}, which does not cover ${[...fallback].join(' ')}: Chromium draws them with a system font.`,
                    {
                        time,
                        frame,
                        element: label,
                        detail: { chars: [...fallback], font: entry.font, box: entry.box },
                    },
                ),
            );
        }
    }
    return out;
}

/**
 * Glyph and font audit of the frame on screen: codepoints of every visible DOM
 * text and registered canvas text against the font tables, and the fonts
 * Chromium actually used for DOM text.
 */
export async function auditFrameText(
    page: CompositionPage,
    frame: number,
    domTexts?: DomText[],
): Promise<Finding[]> {
    const out: Finding[] = [];
    const time = frame / page.timeline.fps;
    const dom = domTexts ?? (await page.domTexts());
    const used = dom.length > 0 ? await page.platformFonts() : new Map();
    for (const entry of dom) {
        const missing = uncoveredChars(entry.text);
        if (missing.length > 0) {
            out.push(
                finding(
                    'missing-glyph',
                    `${entry.selector} shows characters no flipbook font has: ${missing.join(' ')}`,
                    {
                        time,
                        frame,
                        element: entry.selector,
                        detail: { chars: missing, text: entry.text.slice(0, 80) },
                    },
                ),
            );
        }
        const fonts = (used.get(entry.key) ?? []) as {
            familyName: string;
            isCustomFont: boolean;
            glyphCount: number;
        }[];
        const system = fonts.filter((f) => !f.isCustomFont && f.glyphCount > 0);
        if (system.length > 0) {
            out.push(
                finding(
                    'font-fallback',
                    `${entry.selector} rendered with system font ${system.map((f) => f.familyName).join(', ')}`,
                    {
                        time,
                        frame,
                        element: entry.selector,
                        detail: { fonts, cssFamily: entry.family, text: entry.text.slice(0, 80) },
                    },
                ),
            );
        }
    }
    out.push(...auditCanvasText(await page.registeredTexts(), frame, page.timeline.fps));
    return out;
}

/** What makes two findings the same problem: code, element, and the characters or message. */
export function findingKey(item: Finding): string {
    return `${item.code}|${item.element ?? ''}|${JSON.stringify(item.detail?.chars ?? item.message)}`;
}

/** Drop repeats of the same problem on the same element, keeping the earliest. */
export function dedupe(findings: Finding[]): Finding[] {
    const seen = new Set<string>();
    const out: Finding[] = [];
    for (const item of findings) {
        const key = findingKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}
