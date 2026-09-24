// A page that loads the runtime under flipbook's host, for testing runtime
// functions in the real browser. The runtime is on window.rt.
import * as fs from 'fs';
import * as path from 'path';
import type { CompositionPage } from '../src/engine/page.ts';
import { openPage, type Session } from '../src/engine/session.ts';
import { resolveTimeline } from '../src/engine/timelineResolve.ts';
import { tempDir } from './helpers.ts';

export async function runtimePage(
    session: Session,
    width = 1920,
    height = 1080,
): Promise<CompositionPage> {
    const dir = tempDir('runtime');
    const timeline = {
        version: 1 as const,
        width,
        height,
        fps: 24,
        seed: 1,
        bpm: 120,
        beatsPerBar: 4,
        scenes: [{ id: 'main', bars: 1 }],
    };
    fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(timeline));
    fs.writeFileSync(
        path.join(dir, 'index.html'),
        `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: #fff; }
canvas { position: absolute; left: 0; top: 0; }
</style></head><body><script type="module">
import * as rt from '/__flipbook/runtime.js';
window.rt = rt;
rt.composition({ seek() {} });
</script></body></html>`,
    );
    const { page, findings } = await openPage(session, {
        dir,
        timeline: resolveTimeline(timeline),
    });
    if (findings.length > 0) {
        await page.close();
        throw new Error(`runtime page failed: ${findings.map((f) => f.message).join('; ')}`);
    }
    return page;
}

/** Page-side helper source: a fresh canvas and a 64-bit hash of its pixels (no crypto.subtle off https). */
export const PAGE_HELPERS = `
window.freshCanvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c.getContext('2d', { willReadFrequently: true });
};
window.pixelHash = async (ctx) => {
    const data = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data;
    let a = 0x811c9dc5;
    let b = 0x01000193;
    for (let i = 0; i < data.length; i++) {
        a = Math.imul(a ^ data[i], 0x01000193);
        b = Math.imul(b ^ data[i], 0x5bd1e995) ^ (b >>> 13);
    }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
};
window.realNow = () => Performance.prototype.now.call(performance);
`;

export async function installHelpers(page: CompositionPage): Promise<void> {
    await page.page.addScriptTag({ content: PAGE_HELPERS });
}
