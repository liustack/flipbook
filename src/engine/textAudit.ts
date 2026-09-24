import { type Finding, finding } from '../cli/report.ts';
import { fontIdForFamily, uncoveredChars } from './fonts.ts';
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

function firstFamily(fontShorthand: string): string {
    const match = /(?:\d+(?:\.\d+)?(?:px|pt|em|rem|%)(?:\/\S+)?\s+)(.+)$/.exec(
        fontShorthand.trim(),
    );
    const families = (match ? match[1] : fontShorthand).split(',');
    return families[0]?.trim() ?? '';
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
    for (const entry of await page.registeredTexts()) {
        const label = entry.id
            ? `canvas text "${entry.id}"`
            : `canvas text "${entry.text.slice(0, 24)}"`;
        const missing = uncoveredChars(entry.text);
        if (missing.length > 0) {
            out.push(
                finding(
                    'missing-glyph',
                    `${label} uses characters no flipbook font has: ${missing.join(' ')}`,
                    {
                        time,
                        frame,
                        element: label,
                        detail: { chars: missing, box: entry.box },
                    },
                ),
            );
        }
        const family = firstFamily(entry.font);
        if (!fontIdForFamily(family)) {
            out.push(
                finding(
                    'font-fallback',
                    `${label} is drawn with "${family}", not a flipbook font`,
                    {
                        time,
                        frame,
                        element: label,
                        detail: { font: entry.font, box: entry.box },
                    },
                ),
            );
        }
    }
    return out;
}

/** Drop repeats of the same problem on the same element, keeping the earliest. */
export function dedupe(findings: Finding[]): Finding[] {
    const seen = new Set<string>();
    const out: Finding[] = [];
    for (const item of findings) {
        const key = `${item.code}|${item.element ?? ''}|${JSON.stringify(item.detail?.chars ?? item.message)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}
