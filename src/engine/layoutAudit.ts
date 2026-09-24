import * as fs from 'fs';
import * as path from 'path';
import { type Finding, finding } from '../cli/report.ts';
import type { RegisteredText } from './host.ts';
import type { CompositionPage, DomText, Rect } from './page.ts';
import { decodeRgb, writeSequence } from './pixels.ts';
import type { ResolvedTimeline } from './timelineResolve.ts';
import { sha256 } from './workspace.ts';

/** Safe area inset on each side, as a share of width and height. */
export const SAFE_MARGIN = 0.05;
/** Contrast ratio below which text gets a warning (WCAG large text). */
export const MIN_CONTRAST = 3;
/** A pixel belongs to a glyph when hiding the text changes a channel by more than this. */
const GLYPH_DIFF = 6;
/** Fewest glyph pixels for a contrast reading. */
const MIN_GLYPH_PIXELS = 12;

interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

function outside(line: Box, left: number, top: number, right: number, bottom: number): boolean {
    const eps = 1;
    return (
        line.x < left - eps ||
        line.y < top - eps ||
        line.x + line.width > right + eps ||
        line.y + line.height > bottom + eps
    );
}

/**
 * Text lines against the frame and the safe area. Lines cut by the frame edge
 * are errors (`text-offstage`); lines inside the frame but in the outer margin
 * are warnings (`text-safe-area`). Elements under data-flipbook-allow-overflow
 * and texts registered with allowOverflow are skipped.
 */
export function auditSafeArea(
    timeline: ResolvedTimeline,
    frame: number,
    dom: DomText[],
    registered: RegisteredText[],
): Finding[] {
    const W = timeline.width;
    const H = timeline.height;
    const mx = W * SAFE_MARGIN;
    const my = H * SAFE_MARGIN;
    const time = frame / timeline.fps;
    const items: { element: string; text: string; lines: Box[] }[] = [
        ...dom
            .filter((d) => !d.allowOverflow)
            .map((d) => ({ element: d.selector, text: d.text, lines: d.lines })),
        ...registered
            .filter((r) => !r.allowOverflow)
            .map((r) => ({
                element: r.id ? `canvas text "${r.id}"` : `canvas text "${r.text.slice(0, 24)}"`,
                text: r.text,
                lines: [r.box],
            })),
    ];
    const out: Finding[] = [];
    for (const item of items) {
        const cut = item.lines.filter((line) => outside(line, 0, 0, W, H));
        if (cut.length > 0) {
            out.push(
                finding('text-offstage', `${item.element} runs past the frame edge.`, {
                    time,
                    frame,
                    element: item.element,
                    detail: {
                        lines: cut,
                        text: item.text.slice(0, 80),
                        frame: { width: W, height: H },
                    },
                }),
            );
            continue;
        }
        const unsafe = item.lines.filter((line) => outside(line, mx, my, W - mx, H - my));
        if (unsafe.length > 0) {
            out.push(
                finding(
                    'text-safe-area',
                    `${item.element} reaches into the outer ${SAFE_MARGIN * 100}% margin.`,
                    {
                        severity: 'warning',
                        time,
                        frame,
                        element: item.element,
                        detail: {
                            lines: unsafe,
                            text: item.text.slice(0, 80),
                            safeArea: { x: mx, y: my, width: W - 2 * mx, height: H - 2 * my },
                        },
                    },
                ),
            );
        }
    }
    return out;
}

function luminance(r: number, g: number, b: number): number {
    const lin = (c: number) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
    const la = luminance(...a);
    const lb = luminance(...b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const hex = (c: [number, number, number]) =>
    `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/**
 * Contrast of each DOM text against what is drawn behind it, measured in
 * pixels: the frame is captured as is and again with DOM text transparent.
 * Pixels that change are glyph pixels; the text color is the mean of the most
 * changed ones in the first capture, the background is the mean of the same
 * pixels in the second.
 */
export async function auditContrast(
    page: CompositionPage,
    frame: number,
    dom: DomText[],
    shown: Buffer,
    ffmpeg: string,
    workDir: string,
    evidenceDir: string,
): Promise<Finding[]> {
    if (dom.length === 0) return [];
    await page.setTextVisible(false);
    const hidden = await page.capture();
    await page.setTextVisible(true);
    if (sha256(hidden) === sha256(shown)) return [];
    const { width: W, height: H } = page.timeline;
    const pattern = writeSequence(path.join(workDir, `contrast-f${frame}`), [shown, hidden]);
    const [a, b] = await decodeRgb(ffmpeg, ['-i', pattern], W, H);
    const out: Finding[] = [];
    const time = frame / page.timeline.fps;
    const seen = new Set<string>();
    for (const entry of dom) {
        if (seen.has(entry.key)) continue;
        seen.add(entry.key);
        const glyph: { i: number; diff: number }[] = [];
        for (const line of entry.lines) {
            const x0 = Math.max(0, Math.floor(line.x));
            const y0 = Math.max(0, Math.floor(line.y));
            const x1 = Math.min(W, Math.ceil(line.x + line.width));
            const y1 = Math.min(H, Math.ceil(line.y + line.height));
            for (let y = y0; y < y1; y++) {
                for (let x = x0; x < x1; x++) {
                    const i = (y * W + x) * 3;
                    const diff = Math.max(
                        Math.abs(a[i] - b[i]),
                        Math.abs(a[i + 1] - b[i + 1]),
                        Math.abs(a[i + 2] - b[i + 2]),
                    );
                    if (diff > GLYPH_DIFF) glyph.push({ i, diff });
                }
            }
        }
        if (glyph.length < MIN_GLYPH_PIXELS) continue;
        const core = [...glyph]
            .sort((p, q) => q.diff - p.diff)
            .slice(0, Math.max(MIN_GLYPH_PIXELS, Math.floor(glyph.length * 0.3)));
        const mean = (source: Uint8Array, pixels: { i: number }[]): [number, number, number] => {
            let r = 0;
            let g = 0;
            let bl = 0;
            for (const { i } of pixels) {
                r += source[i];
                g += source[i + 1];
                bl += source[i + 2];
            }
            return [r / pixels.length, g / pixels.length, bl / pixels.length];
        };
        const text = mean(a, core);
        const background = mean(b, glyph);
        const ratio = contrastRatio(text, background);
        if (ratio < MIN_CONTRAST) {
            const evidence = path.join(evidenceDir, `low-contrast-f${frame}.png`);
            fs.writeFileSync(evidence, shown);
            out.push(
                finding(
                    'low-contrast',
                    `${entry.selector} has contrast ${ratio.toFixed(2)}:1 against its background (text ${hex(text)}, background ${hex(background)}). The minimum is ${MIN_CONTRAST}:1.`,
                    {
                        severity: 'warning',
                        time,
                        frame,
                        element: entry.selector,
                        evidence: [evidence],
                        detail: {
                            ratio: Number(ratio.toFixed(2)),
                            text: hex(text),
                            background: hex(background),
                            glyphPixels: glyph.length,
                            box: entry.box as Rect,
                        },
                    },
                ),
            );
        }
    }
    return out;
}
