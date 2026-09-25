// brand(): the palette, logo and fonts of the brand.json that timeline.json names.
import type { ResolvedBrand } from '../engine/timelineResolve.ts';
import { timeline } from './core/timeline.ts';

const SERIF = 'Noto Serif SC';
const HAND = 'LXGW WenKai';

export type BrandRole = 'title' | 'text';

export interface Brand {
    name: string;
    /** The one-line description, or null. */
    tagline: string | null;
    colors: ResolvedBrand['colors'];
    /** The logo, decoded and ready for drawImage or an <img>, or null. */
    logo: HTMLImageElement | null;
    /** CSS font-family lists: the brand face first, then flipbook's fonts for missing characters. */
    fonts: { title: string; text: string };
    /** A CSS font shorthand for ctx.font or style.font: `font('title', 96, 700)`. */
    font(role: BrandRole, size: number, weight?: number | string): string;
    /** Set --brand-primary, --brand-secondary, --brand-ink, --brand-paper, --brand-title-font and --brand-text-font on an element. */
    applyCss(element?: HTMLElement): void;
}

function stack(family: string): string {
    const families = [family, SERIF, HAND].filter(
        (f, i, all) => all.findIndex((g) => g.toLowerCase() === f.toLowerCase()) === i,
    );
    return families.map((f) => `"${f}"`).join(', ');
}

let cached: Promise<Brand> | null = null;

async function load(): Promise<Brand> {
    const tl = await timeline();
    const resolved = tl.brand;
    if (!resolved) {
        throw new Error(
            'brand() found no brand: add "brand": "<path to brand.json>" to timeline.json',
        );
    }
    let logo: HTMLImageElement | null = null;
    if (resolved.logo) {
        logo = new Image();
        logo.src = resolved.logo.src;
        await logo.decode();
    }
    const fonts = { title: stack(resolved.fonts.title), text: stack(resolved.fonts.text) };
    return {
        name: resolved.name,
        tagline: resolved.tagline,
        colors: { ...resolved.colors },
        logo,
        fonts,
        font(role, size, weight = role === 'title' ? 600 : 400) {
            return `${weight} ${size}px ${fonts[role]}`;
        },
        applyCss(element = document.documentElement) {
            for (const [key, value] of Object.entries(resolved.colors)) {
                if (value) element.style.setProperty(`--brand-${key}`, value);
            }
            element.style.setProperty('--brand-title-font', fonts.title);
            element.style.setProperty('--brand-text-font', fonts.text);
        },
    };
}

/**
 * The brand of this composition, from the brand.json that timeline.json's
 * `brand` names. flipbook has checked the file before the page opened. Await
 * it at module level or in setup.
 */
export function brand(): Promise<Brand> {
    cached ??= load();
    return cached;
}
