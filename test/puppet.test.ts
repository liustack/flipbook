// Cut-out puppets: the pose helpers are pure functions of t, and the puppet
// inks one outline per group, so parts meeting inside a group show no seam.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CompositionPage } from '../src/engine/page.ts';
import {
    BIPED,
    biped,
    blendPose,
    blink,
    idle,
    lookAt,
    talk,
    walk,
    walkTime,
    wave,
} from '../src/runtime/puppet.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps } from './helpers.ts';
import { installHelpers, runtimePage } from './runtimePage.ts';

describe('walk', () => {
    it('moves the hips a step every 1 / cadence seconds, and stops half a step on after one more step', () => {
        const legs = { thigh: 60, shin: 60, step: 50, cadence: 2 };
        expect(walk(0, legs).distance).toBe(0);
        expect(walk(1.5, legs).distance).toBeCloseTo(150, 9);
        const stopping = { ...legs, steps: 4 };
        expect(walkTime(stopping)).toBe(2.5);
        expect(walk(2, stopping)).toMatchObject({ distance: 200, standing: false });
        expect(walk(2.25, stopping).standing).toBe(false);
        expect(walk(2.5, stopping)).toMatchObject({ distance: 225, standing: true });
        expect(walk(9, stopping).distance).toBe(225);
    });

    it('slows into the stop without a jolt: no leg turns faster than while walking', () => {
        const opts = { thigh: 60, shin: 70, cadence: 2, steps: 3 };
        const bones = ['thighFront', 'shinFront', 'thighBack', 'shinBack'];
        const most = (from: number, to: number) => {
            let m = 0;
            for (let f = from; f < to; f++) {
                const a = walk(f / 24, opts).pose;
                const b = walk((f + 1) / 24, opts).pose;
                for (const bone of bones) m = Math.max(m, Math.abs(b[bone] - a[bone]));
            }
            return m;
        };
        // 24 frames a second: the walk is frames 0 to 36, the closing step 36 to 48.
        expect(most(36, 60)).toBeLessThanOrEqual(most(0, 36));
    });

    it('refuses a step the legs cannot take, and a stop between steps', () => {
        expect(() => walk(0, { leg: 120, step: 300 })).toThrow(
            'a step of 300 is too long for legs of 120',
        );
        expect(() => walk(0, { leg: 120, steps: 1.5 })).toThrow('steps must be a whole number');
        expect(() => walk(0, { cadence: 0 })).toThrow('cadence must be above 0');
        expect(() => walk(0, { thigh: Infinity, shin: 60 })).toThrow(
            'thigh and shin must be finite',
        );
        expect(() => walk(0, { leg: 120, lift: Infinity })).toThrow('lift must be finite');
        expect(() => walkTime({ leg: 120 })).toThrow('walkTime() needs steps');
    });

    it('stands straight with the feet together once stopped', () => {
        const { pose } = walk(3, { thigh: 60, shin: 70, cadence: 2, steps: 4 });
        expect(walk(3, { thigh: 60, shin: 70, cadence: 2, steps: 4 }).standing).toBe(true);
        for (const bone of ['thighFront', 'shinFront', 'thighBack', 'shinBack', 'torso', 'y']) {
            expect(Math.abs(pose[bone])).toBeLessThan(1e-3);
        }
    });

    it('swings the arms against the legs', () => {
        // At the start of a step the front leg is planted ahead of the hips.
        const { pose } = walk(0, { cadence: 1 });
        expect(pose.thighFront).toBeLessThan(0);
        expect(pose.armFront).toBeGreaterThan(0);
    });
});

describe('pose helpers', () => {
    it('blends two poses, a missing angle counting as 0', () => {
        expect(blendPose({ head: 10 }, { head: 20, torso: 4 }, 0.5)).toEqual({
            head: 15,
            torso: 2,
        });
        expect(blendPose({ head: 10 }, {}, 1)).toEqual({ head: 0 });
    });

    it('breathes when idle, a little', () => {
        for (let t = 0; t < 5; t += 0.1) expect(Math.abs(idle(t).y ?? 0)).toBeLessThanOrEqual(2);
    });

    it('waves only between start and end, raising and lowering the arm', () => {
        expect(wave(0.9, 1, 3).raised).toBe(0);
        expect(wave(3.1, 1, 3).raised).toBe(0);
        const up = wave(2, 1, 3, { reach: -85, elbow: -40 });
        expect(up.raised).toBe(1);
        expect(up.pose.armFront).toBe(-85);
        const flaps = new Set(
            [1.6, 1.7, 1.8, 1.9].map((t) => Math.round(wave(t, 1, 3).pose.foreFront)),
        );
        expect(flaps.size).toBeGreaterThan(1);
    });

    it('blinks now and then, the same way for the same seed', () => {
        const shut = [];
        for (let f = 0; f < 24 * 20; f++) if (blink(f / 24, { seed: 5 })) shut.push(f);
        expect(shut.length).toBeGreaterThan(8);
        expect(shut.length).toBeLessThan(40);
        for (const f of shut) expect(blink(f / 24, { seed: 5 })).toBe(true);
    });

    it('opens and shuts the mouth only while speaking', () => {
        expect(talk(0.5, 1, 2)).toBe(false);
        expect(talk(2.1, 1, 2)).toBe(false);
        const moves = new Set();
        for (let t = 1; t < 2; t += 1 / 24) moves.add(talk(t, 1, 2, { seed: 2 }));
        expect(moves).toEqual(new Set([true, false]));
    });

    it('turns a profile head toward a point, within its limit', () => {
        expect(lookAt([0, 0], [100, 0])).toBe(0);
        expect(lookAt([0, 0], [100, 100])).toBeCloseTo(25, 6);
        expect(lookAt([0, 0], [100, -30])).toBeCloseTo((Math.atan2(-30, 100) * 180) / Math.PI, 6);
        expect(lookAt([0, 0], [-100, 30], 45)).toBeCloseTo(
            (Math.atan2(30, 100) * 180) / Math.PI,
            6,
        );
    });

    it('builds a biped where every child tucks under its parent', () => {
        const bones = biped({ armFront: 'arm', armBack: 'arm' });
        expect(bones.map((b) => b.name).sort()).toEqual([...BIPED].sort());
        const z = new Map(bones.map((b) => [b.name, b.z]));
        for (const b of bones) {
            if (b.parent && b.parent !== 'torso')
                expect(b.z).toBeLessThan(z.get(b.parent) as number);
        }
        expect(z.get('head')).toBeLessThan(z.get('torso') as number);
        expect(bones.find((b) => b.name === 'armFront')?.part).toBe('arm');
    });
});

describe('puppet in the page', () => {
    let page: CompositionPage;

    beforeAll(async () => {
        page = await runtimePage(await session(), 400, 300);
        await installHelpers(page);
    });

    afterAll(async () => {
        await page?.close();
        await closeSession();
        cleanTemps();
    });

    // Two bars, one hanging from the other, drawn on a white canvas.
    const SETUP = `
        const bar = (color) => rt.part(20, 80, [10, 10], (c) => { c.fillStyle = color; c.fillRect(0, 0, 20, 80); }, { sockets: { tip: [10, 70] } });
        const parts = { upper: bar('#35507a'), lower: bar('#35507a'), other: bar('#c8423b') };
        const draw = (bones, pose) => {
            const ctx = freshCanvas(400, 300);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, 400, 300);
            const p = rt.puppet({ parts, bones, outline: { width: 3, color: '#000000' } });
            p.draw(ctx, 200, 60, { pose });
            return { ctx, p };
        };
        const dark = (ctx, x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return d[0] < 60 && d[1] < 60 && d[2] < 60; };
    `;

    it('inks no seam where two parts of one group meet, and an edge between groups', async () => {
        const result = await page.page.evaluate(`(() => {
            ${SETUP}
            const one = draw([
                { name: 'a', part: 'upper', z: 2, group: 'arm' },
                { name: 'b', parent: 'a', socket: 'tip', part: 'lower', z: 1, group: 'arm' },
            ]).ctx;
            const two = draw([
                { name: 'a', part: 'upper', z: 2 },
                { name: 'b', parent: 'a', socket: 'tip', part: 'lower', z: 1 },
            ]).ctx;
            // The joint: the upper bar ends at y 60 + 70 = 130 on the canvas.
            return {
                seamInGroup: dark(one, 200, 130) || dark(one, 200, 131),
                seamBetweenGroups: dark(two, 200, 131) || dark(two, 200, 130) || dark(two, 200, 132),
                sideInk: dark(one, 188, 100),
            };
        })()`);
        expect(result).toEqual({ seamInGroup: false, seamBetweenGroups: true, sideInk: true });
    });

    it('puts joint() where draw() puts the bone', async () => {
        const result = await page.page.evaluate(`(() => {
            ${SETUP}
            const bones = [
                { name: 'a', part: 'upper', z: 2 },
                { name: 'b', parent: 'a', socket: 'tip', part: 'other', z: 3 },
            ];
            const pose = { a: -90 };
            const { ctx, p } = draw(bones, pose);
            // Swung forward a quarter turn, the upper bar points right and the lower bar carries on along it.
            const j = p.joint('b', 200, 60, { pose });
            const tip = p.joint('b', 200, 60, { pose }, [10, 70]);
            const d = ctx.getImageData(Math.round((j.x + tip.x) / 2), Math.round((j.y + tip.y) / 2), 1, 1).data;
            return { j: [Math.round(j.x), Math.round(j.y)], tip: [Math.round(tip.x), Math.round(tip.y)], red: d[0] > 150 && d[1] < 110 };
        })()`);
        expect(result).toEqual({ j: [260, 60], tip: [320, 60], red: true });
    });

    it('draws the same pixels whatever it drew before', async () => {
        const result = await page.page.evaluate(`(async () => {
            ${SETUP}
            const bones = [
                { name: 'a', part: 'upper', z: 2, group: 'g' },
                { name: 'b', parent: 'a', socket: 'tip', part: 'lower', z: 1, group: 'g' },
            ];
            const ctx = freshCanvas(400, 300);
            const p = rt.puppet({ parts, bones });
            const shot = async (a) => {
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.clearRect(0, 0, 400, 300);
                p.draw(ctx, 200, 60, { pose: { a, b: 30 } });
                return pixelHash(ctx);
            };
            const first = await shot(10);
            await shot(-70);
            await shot(55);
            return first === (await shot(10));
        })()`);
        expect(result).toBe(true);
    });

    it('refuses a bone that hangs from a missing socket or shows a missing part', async () => {
        const errors = (await page.page.evaluate(`(() => {
            ${SETUP}
            const tries = [
                [{ name: 'a', part: 'upper', z: 1 }, { name: 'b', parent: 'a', socket: 'knee', part: 'lower', z: 0 }],
                [{ name: 'a', part: 'nothing', z: 1 }],
                [{ name: 'a', part: 'upper', z: 1 }, { name: 'b', part: 'lower', z: 0 }],
            ];
            return tries.map((bones) => { try { rt.puppet({ parts, bones }); return 'ok'; } catch (e) { return e.message; } });
        })()`)) as string[];
        expect(errors[0]).toContain('socket "knee"');
        expect(errors[1]).toContain('unknown part "nothing"');
        expect(errors[2]).toContain('exactly one bone may have no parent');
    });

    it('refuses two bones with one name, a part with no size, and a swap to a missing part', async () => {
        const errors = (await page.page.evaluate(`(() => {
            ${SETUP}
            const tries = [
                () => rt.puppet({ parts, bones: [{ name: 'a', part: 'upper', z: 1 }, { name: 'a', parent: 'a', socket: 'tip', part: 'lower', z: 0 }] }),
                () => rt.puppet({ parts: { ...parts, flat: { ...parts.upper, height: 0 } }, bones: [{ name: 'a', part: 'flat', z: 1 }] }),
                () => rt.puppet({ parts, bones: [{ name: 'a', part: 'upper', z: 1 }] }).draw(freshCanvas(40, 40), 20, 20, { swap: { a: 'nothing' } }),
            ];
            return tries.map((f) => { try { f(); return 'ok'; } catch (e) { return e.message; } });
        })()`)) as string[];
        expect(errors[0]).toContain('two bones are named "a"');
        expect(errors[1]).toContain('part "flat" needs a width and height above 0');
        expect(errors[2]).toContain('swap shows unknown part "nothing" on bone "a"');
    });

    it('hangs a child from the socket of the part its parent shows, turned and stretched as drawn', async () => {
        const result = (await page.page.evaluate(`(() => {
            ${SETUP}
            const turned = { ...parts.upper, angle: 90 };
            const short = rt.part(20, 60, [10, 10], (c) => { c.fillStyle = '#35507a'; c.fillRect(0, 0, 20, 60); }, { sockets: { tip: [10, 50] }, fit: [1, 2] });
            const bones = [
                { name: 'a', part: 'turned', z: 2 },
                { name: 'b', parent: 'a', socket: 'tip', part: 'lower', z: 1 },
            ];
            const p = rt.puppet({ parts: { ...parts, turned, short }, bones, scale: 1.2 });
            const gap = (frame, part) => {
                const socket = p.joint('a', 200, 100, frame, part.sockets.tip);
                const child = p.joint('b', 200, 100, frame);
                return Math.hypot(socket.x - child.x, socket.y - child.y);
            };
            return [
                gap({}, turned),
                gap({ pose: { a: 30 }, flip: true }, turned),
                gap({ swap: { a: 'short' } }, short),
            ];
        })()`)) as number[];
        for (const g of result) expect(g).toBeLessThan(1e-3);
    });

    it('inks a solid outline around a hairline part, however wide the outline', async () => {
        const gaps = (await page.page.evaluate(`(() => {
            const line = rt.part(1, 80, [0.5, 0], (c) => { c.fillStyle = '#35507a'; c.fillRect(0, 0, 1, 80); });
            const p = rt.puppet({ parts: { line }, bones: [{ name: 'a', part: 'line', z: 0 }], outline: { width: 10, color: '#000000' } });
            const ctx = freshCanvas(400, 300);
            p.draw(ctx, 200, 100);
            // Across the middle of the line: the inked run must have no holes.
            const row = ctx.getImageData(180, 140, 40, 1).data;
            const on = [];
            for (let i = 0; i < 40; i++) on.push(row[i * 4 + 3] > 20);
            const first = on.indexOf(true);
            const last = on.lastIndexOf(true);
            return { width: last - first + 1, holes: on.slice(first, last + 1).filter((v) => !v).length };
        })()`)) as { width: number; holes: number };
        expect(gaps.holes).toBe(0);
        expect(gaps.width).toBeGreaterThanOrEqual(20);
    });

    it('keeps the planted foot where it landed and on the floor, and brings the feet together at the stop', async () => {
        const result = (await page.page.evaluate(`(() => {
            // Upright bars: a 60 px thigh, a 70 px shin, the sole at the shin's bottom.
            const bar = (h, sockets) => rt.part(16, h, [8, 0], (c) => { c.fillStyle = '#35507a'; c.fillRect(0, 0, 16, h); }, { sockets });
            const parts = {
                torso: rt.part(40, 80, [20, 80], (c) => { c.fillStyle = '#35507a'; c.fillRect(0, 0, 40, 80); }, { sockets: { neck: [20, 0], shoulder: [20, 10], hip: [20, 80] } }),
                head: bar(30, {}), arm: bar(40, { elbow: [8, 40] }), fore: bar(30, { wrist: [8, 30] }), hand: bar(10, {}),
                thigh: bar(60, { knee: [8, 60] }), shin: bar(70, {}),
            };
            const map = { armFront: 'arm', armBack: 'arm', foreFront: 'fore', foreBack: 'fore', handFront: 'hand', handBack: 'hand', thighFront: 'thigh', thighBack: 'thigh', shinFront: 'shin', shinBack: 'shin' };
            const man = rt.puppet({ parts, bones: rt.biped(map), scale: 1 });
            const legs = man.legs();
            const FLOOR = 250;
            const opts = { ...legs, cadence: 2, steps: 3 };
            const sole = (t, bone) => {
                const w = rt.walk(t, opts);
                return man.joint(bone, 40 + w.distance, FLOOR - (legs.thigh + legs.shin), { pose: w.pose }, [8, 70]);
            };
            // Step 0 plants the front foot, step 1 the back one, step 2 the front again.
            const drift = [];
            const lowest = [];
            for (const [k, bone, other] of [[0, 'shinFront', 'shinBack'], [1, 'shinBack', 'shinFront'], [2, 'shinFront', 'shinBack']]) {
                const at = sole(k / 2 + 0.001, bone);
                for (let u = 0.05; u < 1; u += 0.1) {
                    const p = sole((k + u) / 2, bone);
                    drift.push(Math.hypot(p.x - at.x, p.y - FLOOR));
                    lowest.push(sole((k + u) / 2, other).y - FLOOR);
                }
            }
            const a = sole(5, 'shinFront');
            const b = sole(5, 'shinBack');
            return { legs, drift: Math.max(...drift), below: Math.max(...lowest), apart: Math.hypot(a.x - b.x, a.y - b.y), floor: Math.max(Math.abs(a.y - FLOOR), Math.abs(b.y - FLOOR)) };
        })()`)) as {
            legs: { thigh: number; shin: number };
            drift: number;
            below: number;
            apart: number;
            floor: number;
        };
        expect(result.legs).toEqual({ thigh: 60, shin: 70 });
        // The planted sole stays put and on the floor, the swinging one never dips under it.
        expect(result.drift).toBeLessThan(0.5);
        expect(result.below).toBeLessThan(0.5);
        expect(result.apart).toBeLessThan(0.5);
        expect(result.floor).toBeLessThan(0.5);
    });
});
