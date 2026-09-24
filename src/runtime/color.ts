/** An sRGB color as [r, g, b], each 0 to 255. */
export type Rgb = [number, number, number];

/** Parse `#rgb` or `#rrggbb` (or pass an Rgb through). */
export function rgb(color: string | Rgb): Rgb {
    if (typeof color !== 'string') return color;
    const hex = color.trim().replace(/^#/, '');
    const full =
        hex.length === 3
            ? hex
                  .split('')
                  .map((c) => c + c)
                  .join('')
            : hex;
    if (!/^[0-9a-fA-F]{6}$/.test(full)) {
        throw new Error(`Colors here are #rgb or #rrggbb, got "${color}"`);
    }
    const n = Number.parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** CSS rgba() for a color and an alpha. */
export function rgba(color: string | Rgb, alpha = 1): string {
    const [r, g, b] = rgb(color);
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

/** `#rrggbb` for a color. */
export function hex(color: string | Rgb): string {
    return `#${rgb(color)
        .map((v) =>
            Math.round(Math.min(255, Math.max(0, v)))
                .toString(16)
                .padStart(2, '0'),
        )
        .join('')}`;
}

/** Linear mix of two colors, t = 0 gives a, t = 1 gives b. */
export function mix(a: string | Rgb, b: string | Rgb, t: number): string {
    const ca = rgb(a);
    const cb = rgb(b);
    return hex([0, 1, 2].map((i) => ca[i] + (cb[i] - ca[i]) * t) as Rgb);
}

/** Toward white for amount > 0, toward black for amount < 0 (-1 to 1). */
export function shade(color: string | Rgb, amount: number): string {
    return amount >= 0 ? mix(color, '#ffffff', amount) : mix(color, '#000000', -amount);
}
