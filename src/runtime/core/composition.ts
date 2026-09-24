import { PROTOCOL_VERSION } from '../../engine/timelineResolve.ts';

export interface CompositionOptions {
    /** One-time work before the first frame: static layers, lookup tables, layout. */
    setup?: () => void | Promise<void>;
    /** Put the picture at time t (seconds). Draw from t alone. */
    seek: (t: number) => void | Promise<void>;
}

export interface FlipbookProtocol {
    protocol: typeof PROTOCOL_VERSION;
    ready: Promise<void>;
    seek(t: number): Promise<void>;
}

/** Load every declared font face so no frame draws with a fallback font. */
export async function loadFonts(): Promise<void> {
    await Promise.all(Array.from(document.fonts).map((face) => face.load()));
    await document.fonts.ready;
}

/** Decode every <img> in the document before the first frame. */
export async function decodeImages(): Promise<void> {
    await Promise.all(
        Array.from(document.images).map((img) =>
            img.decode().catch(() => {
                throw new Error(`image failed to decode: ${img.currentSrc || img.src}`);
            }),
        ),
    );
}

/**
 * Register the page with flipbook: defines window.__flipbook = { protocol,
 * ready, seek }. ready loads fonts, decodes images, then runs setup.
 */
export function composition(options: CompositionOptions): FlipbookProtocol {
    const ready = (async () => {
        await loadFonts();
        await decodeImages();
        await options.setup?.();
    })();
    const api: FlipbookProtocol = {
        protocol: PROTOCOL_VERSION,
        ready,
        async seek(t: number) {
            await options.seek(t);
        },
    };
    (window as unknown as { __flipbook: FlipbookProtocol }).__flipbook = api;
    return api;
}
