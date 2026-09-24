import { PROTOCOL_VERSION } from '../../engine/timelineResolve.ts';
import { isRendering, timeline } from './timeline.ts';

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
 * ready, seek }. ready loads fonts, decodes images, then runs setup. Opened
 * outside the renderer, the page gets a time slider for previewing.
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
    if (!isRendering()) {
        ready.then(() => mountPreview(api)).catch((error: unknown) => console.error(error));
    }
    return api;
}

async function mountPreview(api: FlipbookProtocol): Promise<void> {
    const tl = await timeline();
    const bar = document.createElement('div');
    bar.setAttribute('data-flipbook-preview', '');
    bar.style.cssText =
        'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;display:flex;gap:12px;' +
        'align-items:center;padding:8px 16px;background:rgba(20,20,20,.85);color:#fff;' +
        'font:13px/1.2 ui-monospace,monospace';
    const play = document.createElement('button');
    play.textContent = 'play';
    play.style.cssText = 'font:inherit;padding:2px 10px';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(Math.max(0, tl.frameCount - 1));
    slider.step = '1';
    slider.value = '0';
    slider.style.flex = '1';
    const label = document.createElement('span');
    bar.append(play, slider, label);
    document.body.appendChild(bar);

    let frame = 0;
    let playing = false;
    let startedAt = 0;
    let startFrame = 0;
    const show = async (next: number) => {
        frame = Math.max(0, Math.min(tl.frameCount - 1, next));
        slider.value = String(frame);
        label.textContent = `${(frame / tl.fps).toFixed(2)} s  frame ${frame}/${tl.frameCount - 1}`;
        await api.seek(frame / tl.fps);
    };
    const tick = async (stamp: number) => {
        if (!playing) return;
        const next = startFrame + Math.floor(((stamp - startedAt) / 1000) * tl.fps);
        if (next >= tl.frameCount) {
            playing = false;
            play.textContent = 'play';
            return;
        }
        if (next !== frame) await show(next);
        requestAnimationFrame(tick);
    };
    play.addEventListener('click', () => {
        playing = !playing;
        play.textContent = playing ? 'pause' : 'play';
        if (playing) {
            startFrame = frame >= tl.frameCount - 1 ? 0 : frame;
            startedAt = performance.now();
            requestAnimationFrame(tick);
        }
    });
    slider.addEventListener('input', () => {
        playing = false;
        play.textContent = 'play';
        void show(Number(slider.value));
    });
    window.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowRight') void show(frame + 1);
        if (event.key === 'ArrowLeft') void show(frame - 1);
    });
    await show(0);
}
