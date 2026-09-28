// The evaluator's recheck through its real copy: a brand.json beside the
// composition or in the workspace root, with its logo and font, must check
// the same on the copy as where the agent left it.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildTestFont } from '../test/fontBuilder.ts';
import { writeStory } from '../test/story.ts';
import { recheck, renderShape } from './recheck.mjs';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'main.js');
const temps = [];
afterAll(() => {
    for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function write(root, rel, content) {
    const file = join(root, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
}

const LOGO =
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><rect width="200" height="100" fill="#1f6f78"/></svg>';

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; width: 100vw; height: 100vh; overflow: hidden; background: #f1ece2; }
canvas { position: absolute; left: 0; top: 0; }
#name { position: absolute; left: 40px; top: 40px; margin: 0; font: 40px/1.2 "Tide Display"; color: #1c2326; }
</style></head><body><canvas id="stage"></canvas><p id="name">TIDE</p>
<script type="module">
import { brand, composition, setupCanvas, timeline } from '/__flipbook/runtime.js';
const tl = await timeline();
const b = await brand();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
composition({
  seek(t) {
    ctx.clearRect(0, 0, tl.width, tl.height);
    ctx.fillStyle = b.colors.primary;
    ctx.fillRect(0, tl.height - 40, tl.width * (0.2 + t / 4), 40);
    ctx.drawImage(b.logo, 40 + t * 30, 110, 80, 40);
  },
});
</script></body></html>`;

/**
 * A workspace with one composition in film/ and its brand.json, logo and
 * font either in film/ (`inside`) or in the workspace root (`root`), plus
 * agent leftovers in .flipbook/ and out/ that the copy must leave behind.
 */
function workspace(layout) {
    const ws = mkdtempSync(join(tmpdir(), `flipbook-recheck-${layout}-`));
    temps.push(ws);
    const film = join(ws, 'film');
    const brandDir = layout === 'root' ? ws : film;
    write(
        film,
        'timeline.json',
        JSON.stringify({
            version: 1,
            width: 320,
            height: 180,
            fps: 12,
            seed: 1,
            bpm: 120,
            beatsPerBar: 4,
            brand: layout === 'root' ? '../brand.json' : 'brand.json',
            scenes: [{ id: 'main', bars: 1 }],
        }),
    );
    writeStory(film);
    write(film, 'index.html', PAGE);
    write(
        brandDir,
        'brand.json',
        JSON.stringify({
            version: 1,
            name: '潮汐茶室',
            logo: { file: 'brand/logo.svg', license: 'owned by the tea house' },
            colors: { primary: '#1f6f78', ink: '#1c2326', paper: '#f1ece2' },
            fonts: {
                title: 'Tide Display',
                files: [{ family: 'Tide Display', file: 'brand/tide.ttf', license: 'OFL-1.1' }],
            },
        }),
    );
    write(brandDir, 'brand/logo.svg', LOGO);
    write(brandDir, 'brand/tide.ttf', buildTestFont({ family: 'Tide Display', chars: 'TIDE' }));
    write(film, '.flipbook/reports/check.json', '{"ok": true}');
    write(film, 'out/video.mp4', 'not a video');
    return { ws, film };
}

describe('eval recheck', () => {
    it('checks a composition whose brand.json, logo and font sit beside it', () => {
        const { ws, film } = workspace('inside');
        const result = recheck(film, { wsRoot: ws, cli });
        expect(result.report?.failures, JSON.stringify(result.report?.failures)).toEqual([]);
        expect(result.exitCode).toBe(0);
    });

    it('keeps a brand.json, logo and font in the workspace root where the composition finds them', () => {
        const { ws, film } = workspace('root');
        const result = recheck(film, { wsRoot: ws, cli });
        expect(result.report?.failures, JSON.stringify(result.report?.failures)).toEqual([]);
        expect(result.exitCode).toBe(0);
        expect(result.report?.composition?.dir).not.toBe(film);
    });
});

describe('eval recheck in the rendered shape', () => {
    it('reads --size and --scale from the last render report', () => {
        expect(renderShape(null)).toEqual([]);
        expect(renderShape({ composition: { width: 1080, height: 1920, scale: 1 } })).toEqual([
            '--size',
            '1080x1920',
        ]);
        expect(renderShape({ composition: { width: 1920, height: 1080, scale: 2 } })).toEqual([
            '--size',
            '1920x1080',
            '--scale',
            '2',
        ]);
    });

    it('checks text at the size the video was rendered, not only the timeline size', () => {
        const { ws, film } = workspace('inside');
        write(
            film,
            'index.html',
            PAGE.replace('<p id="name">TIDE</p>', '<p id="name">TIDETIDE</p>'),
        );
        const landscape = recheck(film, { wsRoot: ws, cli });
        expect(landscape.report?.failures, JSON.stringify(landscape.report?.failures)).toEqual([]);
        const portrait = recheck(film, { wsRoot: ws, cli, flags: ['--size', '180x320'] });
        expect(portrait.exitCode).toBe(1);
        expect(portrait.report?.failures.map((f) => f.code)).toContain('text-offstage');
        expect(portrait.report?.composition).toMatchObject({ width: 180, height: 320 });
    });
});
