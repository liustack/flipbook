import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../src/cli/check.ts';
import { openPage } from '../src/engine/session.ts';
import { loadTimeline } from '../src/engine/timeline.ts';
import { resolveTimeline } from '../src/engine/timelineResolve.ts';
import { sha256 } from '../src/engine/workspace.ts';
import {
    distanceField,
    markTimes,
    orderSlots,
    paceBeats,
    packSlots,
    type Slot,
    shapeMask,
} from '../src/runtime/templates/assemble.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps, tempDir } from './helpers.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

const ring = shapeMask({ x: 0, y: 0, width: 400, height: 400 }, (x, y) => {
    const d = Math.hypot(x - 200, y - 200);
    return d > 90 && d < 180;
});

function insideRing(slot: Slot, tolerance: number): boolean {
    const d = Math.hypot(slot.x - 200, slot.y - 200);
    return d - slot.r >= 90 - tolerance && d + slot.r <= 180 + tolerance;
}

describe('slots', () => {
    it('measures the distance to the edge of the shape', () => {
        const bar = shapeMask({ x: 0, y: 0, width: 200, height: 100 }, (_x, y) => y > 20 && y < 80);
        const dist = distanceField(bar);
        const mid = dist[12 * bar.cols + 25];
        expect(mid).toBeGreaterThan(26);
        expect(mid).toBeLessThan(34);
        expect(dist[0]).toBe(0);
    });

    it('packs exactly count slots inside the shape without overlaps', () => {
        const slots = packSlots(ring, { count: 30, seed: 5 });
        expect(slots).toHaveLength(30);
        for (const slot of slots) expect(insideRing(slot, ring.cell * 1.5)).toBe(true);
        for (let i = 0; i < slots.length; i++) {
            for (let j = i + 1; j < slots.length; j++) {
                const a = slots[i];
                const b = slots[j];
                expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r - ring.cell);
            }
        }
        const radii = slots.map((s) => s.r);
        expect(Math.max(...radii) / Math.min(...radii)).toBeGreaterThan(1.5);
    });

    it('gives the same slots for the same seed and different ones for another', () => {
        const a = packSlots(ring, { count: 20, seed: 1 });
        const b = packSlots(ring, { count: 20, seed: 1 });
        const c = packSlots(ring, { count: 20, seed: 2 });
        expect(b).toEqual(a);
        expect(c).not.toEqual(a);
    });

    it('fails when the shape cannot hold the count', () => {
        expect(() => packSlots(ring, { count: 30, seed: 5, minRadius: 60 })).toThrow(
            /fit \d+ of 30 slots/,
        );
    });

    it('orders slots reproducibly', () => {
        const slots = packSlots(ring, { count: 12, seed: 3 });
        const random = orderSlots(slots, 'random', 9);
        expect(orderSlots(slots, 'random', 9)).toEqual(random);
        const byPlace = (p: Slot, q: Slot) => p.x - q.x || p.y - q.y;
        expect([...random].sort(byPlace)).toEqual([...slots].sort(byPlace));
        expect(random).not.toEqual(slots);
        const size = orderSlots(slots, 'size');
        for (let i = 1; i < size.length; i++) expect(size[i].r).toBeLessThanOrEqual(size[i - 1].r);
    });
});

describe('landing times', () => {
    it('paces landings from sparse to quick on a beat grid', () => {
        const beats = paceBeats({ count: 20, from: 0, to: 6 });
        expect(beats[0]).toBe(0);
        expect(beats[19]).toBe(6);
        for (let i = 1; i < beats.length; i++)
            expect(beats[i]).toBeGreaterThanOrEqual(beats[i - 1]);
        for (const b of beats) expect((b * 4) % 1).toBe(0);
        expect(beats[3] - beats[0]).toBeGreaterThan(beats[19] - beats[16]);
    });

    it('reads landings from mark cues, snapped to frames and sorted', () => {
        const tl = resolveTimeline({
            version: 1,
            width: 320,
            height: 180,
            fps: 24,
            seed: 1,
            bpm: 90,
            beatsPerBar: 4,
            scenes: [{ id: 'a', bars: 1 }],
            cues: [
                { id: 'drop-2', scene: 'a', beat: 1.3, kind: 'mark' },
                { id: 'drop-1', scene: 'a', beat: 0.5, kind: 'mark' },
                { id: 'title', scene: 'a', beat: 2, kind: 'text', text: 'x' },
            ],
        });
        const times = markTimes(tl, 'drop-');
        expect(times).toEqual([
            Math.round(0.5 * (60 / 90) * 24) / 24,
            Math.round(1.3 * (60 / 90) * 24) / 24,
        ]);
        expect(() => markTimes(tl, 'nope')).toThrow(/No mark cues/);
    });
});

const LANDINGS = 12;

function assembleComposition(): string {
    const dir = tempDir('assemble');
    const cues = Array.from({ length: LANDINGS }, (_, i) => ({
        id: `drop-${i + 1}`,
        scene: 'build',
        beat: 0.5 * i + 0.25,
        kind: 'mark',
    }));
    fs.writeFileSync(
        path.join(dir, 'timeline.json'),
        JSON.stringify({
            version: 1,
            width: 640,
            height: 360,
            fps: 12,
            seed: 11,
            bpm: 120,
            beatsPerBar: 4,
            scenes: [{ id: 'build', bars: 2 }],
            cues,
        }),
    );
    fs.writeFileSync(
        path.join(dir, 'index.html'),
        `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; width: 640px; height: 360px; overflow: hidden; background: #e9dfca; }
canvas { position: absolute; left: 0; top: 0; }
</style></head><body><canvas id="stage"></canvas><script type="module">
import { composition, timeline, setupCanvas, paperLayer, glyphMask, packSlots, orderSlots, markTimes, assemble, halftone } from '/__flipbook/runtime.js';
const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
let pieces;
composition({
  setup() {
    paperLayer(tl.width, tl.height, { seed: tl.seed });
    const times = markTimes(tl, 'drop-');
    const mask = glyphMask({ text: '8', box: { x: 220, y: 30, width: 200, height: 300 }, grow: 10 });
    const slots = orderSlots(packSlots(mask, { count: times.length, seed: tl.seed }), 'reading');
    pieces = assemble({
      slots, times, stage: tl, seed: tl.seed,
      draw: (c, p) => {
        c.fillStyle = p.index % 2 ? '#c8452d' : '#2a6f97';
        c.beginPath();
        c.ellipse(0, 0, p.width / 2, p.height / 2, 0, 0, Math.PI * 2);
        c.fill();
        halftone(c, { x: -p.width / 2, y: -p.height / 2, width: p.width, height: p.height }, { tone: 0.3, color: '#1d1813' });
      },
    });
  },
  seek(t) {
    ctx.clearRect(0, 0, tl.width, tl.height);
    ctx.fillStyle = '#1d1813';
    ctx.fillRect(20, 330 - t * 20, 16, 16);
    pieces.draw(ctx, t);
  },
});
</script></body></html>`,
    );
    return dir;
}

describe('assemble at its landing frames', () => {
    it('passes check and draws each landing frame the same in any seek order', async () => {
        const dir = assembleComposition();
        const s = await session();
        const report = await runCheck({ dir, session: s, recordAttempts: false, samples: 12 });
        expect(report.failures).toEqual([]);
        expect(report.warnings).toEqual([]);

        const tl = loadTimeline(dir).resolved;
        if (!tl) throw new Error('timeline did not load');
        const frames = [
            ...new Set(tl.cues.flatMap((c) => [c.frame - 1, c.frame, c.frame + 1])),
        ].filter((f) => f >= 0 && f < tl.frameCount);
        const { page } = await openPage(s, { dir, timeline: tl });
        try {
            const forward = new Map<number, string>();
            for (const frame of frames) {
                expect(await page.seek(frame)).toBeNull();
                forward.set(frame, sha256(await page.capture()));
            }
            const mixed = [...frames].sort((a, b) => ((a * 7919) % 31) - ((b * 7919) % 31));
            for (const frame of mixed) {
                await page.seek(frame);
                expect(sha256(await page.capture()), `frame ${frame}`).toBe(forward.get(frame));
            }
        } finally {
            await page.close();
        }
    });
});
