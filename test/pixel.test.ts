// The pixel skin: a grid of cells snapped to the palette and blown up by a
// whole number, so every cell lands as one solid block of a palette color.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CompositionPage } from '../src/engine/page.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps } from './helpers.ts';
import { installHelpers, runtimePage } from './runtimePage.ts';

const PALETTE = ['#1b1b2e', '#f2e8cf', '#e0584f', '#4f8fba'];

describe('pixel in the page', () => {
    let page: CompositionPage;

    beforeAll(async () => {
        page = await runtimePage(await session(), 660, 360);
        await installHelpers(page);
    });

    afterAll(async () => {
        await page?.close();
        await closeSession();
        cleanTemps();
    });

    it('blows every cell up to one solid block of a palette color, however it was drawn', async () => {
        const result = (await page.page.evaluate(`(() => {
            const palette = ${JSON.stringify(PALETTE)};
            const g = rt.pixel(660, 360, { palette, cols: 64, rows: 36 });
            g.clear();
            g.rect(4, 4, 20, 10, 2);
            g.line(0, 35, 63, 20, '#4f8fba');
            g.disc(40, 18, 9, 1);
            g.circle(40, 18, 12, 3);
            // A smooth path and a blur leave colors between the palette's: present snaps them.
            g.ctx.fillStyle = '#e0584f';
            g.ctx.beginPath();
            g.ctx.arc(12, 26, 6.3, 0, Math.PI * 2);
            g.ctx.fill();
            g.ctx.globalAlpha = 0.5;
            g.ctx.fillStyle = '#ffffff';
            g.ctx.fillRect(50, 2, 10, 6);
            g.ctx.globalAlpha = 1;
            const ctx = freshCanvas(660, 360);
            g.present(ctx);
            const W = ctx.canvas.width, H = ctx.canvas.height;
            const d = ctx.getImageData(0, 0, W, H).data;
            const k = Math.floor(Math.min(W / 64, H / 36));
            const ox = Math.floor((W - 64 * k) / 2), oy = Math.floor((H - 36 * k) / 2);
            const colors = new Set();
            let mixed = 0;
            for (let cy = 0; cy < 36; cy++) for (let cx = 0; cx < 64; cx++) {
                const at = (x, y) => { const i = (y * W + x) * 4; return (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; };
                const first = at(ox + cx * k, oy + cy * k);
                colors.add(first);
                for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) if (at(ox + cx * k + x, oy + cy * k + y) !== first) mixed++;
            }
            const hex = (n) => '#' + n.toString(16).padStart(6, '0');
            return { k, ox, oy, mixed, colors: [...colors].map(hex).sort(), margin: hex(((d[0] << 16) | (d[1] << 8) | d[2])), scale: g.scale };
        })()`)) as {
            k: number;
            ox: number;
            oy: number;
            mixed: number;
            colors: string[];
            margin: string;
            scale: number;
        };
        expect(result.k).toBe(result.scale);
        expect(result.mixed).toBe(0);
        expect(result.colors.every((c) => PALETTE.includes(c))).toBe(true);
        expect(result.colors.length).toBe(4);
        // 660 / 64 leaves a margin, filled with the ground.
        expect(result.ox).toBeGreaterThan(0);
        expect(result.margin).toBe(PALETTE[0]);
    });

    it('draws lines end to end and discs even on both sides', async () => {
        const r = (await page.page.evaluate(`(() => {
            const g = rt.pixel(640, 360, { palette: ${JSON.stringify(PALETTE)}, cols: 64, rows: 36 });
            g.clear();
            g.line(2, 3, 20, 9, 2);
            g.disc(40, 18, 5, 3);
            const d = g.ctx.getImageData(0, 0, 64, 36).data;
            const is = (x, y, hex) => { const i = (y * 64 + x) * 4; return '#' + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('') === hex; };
            const row = []; for (let x = 30; x <= 50; x++) row.push(is(x, 18, '#4f8fba'));
            return { ends: is(2, 3, '#e0584f') && is(20, 9, '#e0584f'), row };
        })()`)) as { ends: boolean; row: boolean[] };
        expect(r.ends).toBe(true);
        const first = r.row.indexOf(true);
        const last = r.row.lastIndexOf(true);
        expect(first + 30).toBe(40 - 5);
        expect(last + 30).toBe(40 + 5);
    });

    it('writes words on whole cells in one color and registers them where they land', async () => {
        const r = (await page.page.evaluate(`(() => {
            const palette = ${JSON.stringify(PALETTE)};
            const g = rt.pixel(660, 360, { palette, cols: 64, rows: 36 });
            g.clear();
            const box = g.text('Hi 你好', 4, 3, 1, { id: 'hi' });
            const empty = g.text(' ', 4, 20, 1);
            const d = g.ctx.getImageData(0, 0, 64, 36).data;
            const hex = (i) => '#' + ((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]).toString(16).padStart(6, '0') + d[i + 3];
            const seen = new Set();
            for (let i = 0; i < d.length; i += 4) seen.add(hex(i));
            window.__flipbookHost.texts.length = 0;
            // On the page, as a stage is, so the words' place can be measured.
            const stage = document.createElement('canvas');
            stage.width = 660;
            stage.height = 360;
            stage.style.cssText = 'position: absolute; left: 0; top: 0; width: 660px; height: 360px';
            document.body.appendChild(stage);
            const ctx = stage.getContext('2d');
            g.present(ctx);
            const texts = window.__flipbookHost.texts.slice();
            // A second present has nothing new to register.
            g.present(ctx);
            const again = window.__flipbookHost.texts.length;
            stage.remove();
            const k = Math.floor(Math.min(660 / 64, 360 / 36));
            return { box, empty, seen: [...seen].sort(), texts, again, k, ox: Math.floor((660 - 64 * k) / 2), oy: Math.floor((360 - 36 * k) / 2) };
        })()`)) as {
            box: { x: number; y: number; width: number; height: number };
            empty: unknown;
            seen: string[];
            texts: {
                id?: string;
                text: string;
                font: string;
                box: { x: number; y: number; width: number; height: number };
            }[];
            again: number;
            k: number;
            ox: number;
            oy: number;
        };
        expect(r.seen).toEqual([`${PALETTE[0]}255`, `${PALETTE[1]}255`]);
        expect(r.box.x).toBeGreaterThanOrEqual(4);
        expect(r.box.height).toBeGreaterThan(8);
        expect(r.empty).toBeNull();
        expect(r.texts).toHaveLength(1);
        expect(r.texts[0]).toMatchObject({
            id: 'hi',
            text: 'Hi 你好',
            font: '12px "Fusion Pixel 12px Prop zh-Hans"',
        });
        expect(r.texts[0].box).toEqual({
            x: r.ox + r.box.x * r.k,
            y: r.oy + r.box.y * r.k,
            width: r.box.width * r.k,
            height: r.box.height * r.k,
        });
        expect(r.again).toBe(1);
    });

    it('refuses words the grid would cut, and registers the whole line when they slide off on purpose', async () => {
        const r = (await page.page.evaluate(`(() => {
            const palette = ${JSON.stringify(PALETTE)};
            const g = rt.pixel(660, 360, { palette, cols: 64, rows: 36 });
            g.clear();
            let refused = '';
            try { g.text('WIDE', 56, 4, 1); } catch (e) { refused = e.message; }
            const box = g.text('WIDE', 56, 4, 1, { id: 'slide', allowOverflow: true });
            window.__flipbookHost.texts.length = 0;
            const stage = document.createElement('canvas');
            stage.width = 660;
            stage.height = 360;
            stage.style.cssText = 'position: absolute; left: 0; top: 0; width: 660px; height: 360px';
            document.body.appendChild(stage);
            g.present(stage.getContext('2d'));
            const texts = window.__flipbookHost.texts.slice();
            stage.remove();
            return { refused, box, texts };
        })()`)) as {
            refused: string;
            box: { x: number; width: number };
            texts: { id?: string; allowOverflow?: boolean; box: { x: number; width: number } }[];
        };
        expect(r.refused).toContain('runs off the 64 by 36 grid');
        expect(r.box.x + r.box.width).toBeGreaterThan(64);
        expect(r.texts).toHaveLength(1);
        expect(r.texts[0]).toMatchObject({ id: 'slide', allowOverflow: true });
        // The whole line, past the grid's right edge: 10 px a cell, 10 px of margin.
        expect(r.texts[0].box.x).toBe(10 + r.box.x * 10);
        expect(r.texts[0].box.width).toBe(r.box.width * 10);
    });

    it('blows words up by a whole number: the same pixels, each a block of cells', async () => {
        const r = (await page.page.evaluate(`(() => {
            const palette = ${JSON.stringify(PALETTE)};
            const inked = (g) => {
                const d = g.ctx.getImageData(0, 0, g.cols, g.rows).data;
                return (x, y) => d[(y * g.cols + x) * 4] === ${Number.parseInt(PALETTE[1].slice(1, 3), 16)};
            };
            const small = rt.pixel(660, 360, { palette, cols: 64, rows: 36 });
            small.clear();
            const one = small.text('发', 2, 2, 1);
            const big = rt.pixel(660, 360, { palette, cols: 64, rows: 36 });
            big.clear();
            const three = big.text('发', 2, 2, 1, { scale: 3 });
            const a = inked(small);
            const b = inked(big);
            let differ = 0;
            let cells = 0;
            for (let y = 0; y < 36; y++) for (let x = 0; x < 64; x++) {
                const want = a(2 + Math.floor((x - 2) / 3), 2 + Math.floor((y - 2) / 3)) && x >= 2 && y >= 2;
                if (b(x, y)) cells++;
                if (b(x, y) !== want) differ++;
            }
            let bad = '';
            try { big.text('发', 2, 2, 1, { scale: 1.5 }); } catch (e) { bad = e.message; }
            return { one, three, differ, cells, bad };
        })()`)) as {
            one: { x: number; y: number; width: number; height: number };
            three: { x: number; y: number; width: number; height: number };
            differ: number;
            cells: number;
            bad: string;
        };
        expect(r.cells).toBeGreaterThan(0);
        expect(r.differ).toBe(0);
        expect(r.three).toEqual({
            x: 2 + (r.one.x - 2) * 3,
            y: 2 + (r.one.y - 2) * 3,
            width: r.one.width * 3,
            height: r.one.height * 3,
        });
        expect(r.bad).toContain('scale must be a whole number');
    });

    it('builds a drawing from rows of characters, and a sprite frame anchored at its feet', async () => {
        const r = (await page.page.evaluate(`(() => {
            const art = rt.pixelArt(['.a.', 'aba', 'a.a'], { a: '#e0584f', b: '#1b1b2e' });
            const d = art.canvas.getContext('2d').getImageData(0, 0, 3, 3).data;
            const f = art.frame();
            let bad = '';
            try { rt.pixelArt(['ax'], { a: '#e0584f' }); } catch (e) { bad = e.message; }
            const emoji = rt.pixelArt(['🟩🟥'], { '🟩': '#6aa84f', '🟥': '#e0584f' });
            return { size: [art.width, art.height], corner: d[3], middle: [d[16], d[17], d[18], d[19]], anchor: f.anchor, bad, emoji: [emoji.width, ...emoji.frame().anchor] };
        })()`)) as {
            size: number[];
            corner: number;
            middle: number[];
            anchor: number[];
            bad: string;
            emoji: number[];
        };
        expect(r.size).toEqual([3, 3]);
        expect(r.corner).toBe(0);
        expect(r.middle).toEqual([0x1b, 0x1b, 0x2e, 255]);
        expect(r.anchor).toEqual([1, 3]);
        expect(r.bad).toContain('row 1 uses "x", which keys does not name');
        expect(r.emoji).toEqual([2, 1, 1]);
    });

    it('names what is wrong', async () => {
        const errors = (await page.page.evaluate(`(() => {
            const tries = [
                () => rt.pixel(640, 360, { palette: ['#000000'] }),
                () => rt.pixel(640, 360, { palette: ['#000000', 'red'] }),
                () => rt.pixel(640, 360, { palette: ['#000000', '#ffffff'], cols: 10.5 }),
                () => rt.pixel(640, 360, { palette: ['#000000', '#ffffff'] }).dot(1, 1, 5),
                () => rt.pixel(16, 16, { palette: ['#000000', '#ffffff'] }),
            ];
            return tries.map((f) => { try { f(); return 'ok'; } catch (e) { return e.message; } });
        })()`)) as string[];
        expect(errors[0]).toContain('2 to 64 colors');
        expect(errors[1]).toContain('palette[1]: a color must be #rrggbb');
        expect(errors[2]).toContain('whole numbers of at least 8');
        expect(errors[3]).toContain('no color 5 in the palette');
        expect(errors[4]).toContain('does not fit a 16 by 16 px stage');
    });
});
