// flipbook puppet on a small drawn sheet: two outlined bars with round ends
// and a square block. It finds the round tabs, shaves the 5 px outline,
// writes the rig and its sources, and refuses what it cannot rig.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCutout } from '../src/cli/cutout.ts';
import { runPuppet } from '../src/cli/puppet.ts';
import { updateSources } from '../src/engine/assetSources.ts';
import { requireFfmpeg } from '../src/engine/ffmpeg.ts';
import { run } from '../src/engine/proc.ts';
import { Workspace } from '../src/engine/workspace.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps, codes, copyFixture } from './helpers.ts';

/** How many pixels of a PNG are more than half opaque, decoded by ffmpeg. */
async function opaquePixels(file: string): Promise<number> {
    const { ffmpeg } = await requireFfmpeg([]);
    const out = await run(
        ffmpeg,
        ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
        {
            timeoutMs: 30_000,
        },
    );
    let n = 0;
    for (let i = 3; i < out.stdout.length; i += 4) if (out.stdout[i] > 128) n++;
    return n;
}

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

// cutout numbers the pieces biggest first: the block, the long bar, the short bar.
const BLOCK = 'assets/cut/limbs/limbs-01.png';
const UPPER = 'assets/cut/limbs/limbs-02.png';
const LOWER = 'assets/cut/limbs/limbs-03.png';

function writeSpec(dir: string, spec: unknown): void {
    const folder = path.join(dir, 'assets', 'puppets', 'arm');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'puppet.json'), JSON.stringify(spec));
}

const ARM = {
    version: 1,
    parts: {
        upper: { image: UPPER, pivot: 'top', sockets: { tip: 'bottom' } },
        lower: { image: LOWER, pivot: 'top' },
    },
    bones: [
        { name: 'upper', part: 'upper', z: 2, group: 'arm' },
        { name: 'lower', parent: 'upper', socket: 'tip', part: 'lower', z: 1, group: 'arm' },
    ],
};

describe('flipbook puppet', () => {
    let dir: string;

    beforeAll(async () => {
        dir = copyFixture('puppet');
        const cut = await runCutout({ dir, image: 'assets/limbs.png', session: await session() });
        expect(codes(cut)).toEqual([]);
    });

    it('keeps an entry another command writes to SOURCES.json while it rigs', async () => {
        // puppet reads SOURCES.json first and writes it at the end: a fetch
        // that finishes in between must keep its entry.
        writeSpec(dir, ARM);
        const other = (async () => {
            await new Promise((resolve) => setTimeout(resolve, 30));
            await updateSources(Workspace.open(dir), (sources) => {
                sources['fetched.png'] = { source: 'https://example.org/p', license: 'cc0' };
            });
        })();
        const [rigged] = await Promise.all([
            runPuppet({ dir, name: 'arm', session: await session() }),
            other,
        ]);
        expect(codes(rigged)).toEqual([]);
        const sources = JSON.parse(
            fs.readFileSync(path.join(dir, 'assets', 'SOURCES.json'), 'utf-8'),
        );
        expect(sources['fetched.png']).toEqual({ source: 'https://example.org/p', license: 'cc0' });
        expect(sources['puppets/arm/parts/upper.png']).toBeTruthy();
    });

    it('finds the round tabs, shaves the outline and writes the rig', async () => {
        writeSpec(dir, ARM);
        const report = await runPuppet({ dir, name: 'arm', session: await session() });
        expect(codes(report)).toEqual([]);
        const done = report.puppet as {
            outline: number;
            parts: Record<
                string,
                { pivot: [number, number]; sockets: Record<string, [number, number]> }
            >;
        };
        expect(done.outline).toBe(5);
        // The long bar is 60 px wide with round ends: tab centers 30 px in from each end.
        const upper = done.parts.upper;
        const size = JSON.parse(
            fs.readFileSync(path.join(dir, 'assets/cut/limbs/cutout.json'), 'utf-8'),
        ).items[1] as { width: number; height: number };
        expect(Math.abs(upper.pivot[0] - size.width / 2)).toBeLessThan(2);
        expect(Math.abs(upper.pivot[1] - 31)).toBeLessThan(3);
        expect(Math.abs(upper.sockets.tip[1] - (size.height - 32))).toBeLessThan(3);
        const rig = JSON.parse(
            fs.readFileSync(path.join(dir, 'assets/puppets/arm/rig.json'), 'utf-8'),
        );
        expect(Object.keys(rig.parts).sort()).toEqual(['lower', 'upper']);
        expect(rig.bones).toHaveLength(2);
        expect(fs.existsSync(path.join(dir, rig.parts.upper.file))).toBe(true);
        const sources = JSON.parse(fs.readFileSync(path.join(dir, 'assets/SOURCES.json'), 'utf-8'));
        // A rigged part names the piece it came from, which names the plate with the prompt.
        expect(sources['puppets/arm/parts/upper.png']).toEqual({
            source: 'drawn by the flipbook tests',
            license: 'generated',
            cutFrom: UPPER.slice('assets/'.length),
        });
        expect(fs.existsSync(report.artifacts.sheet)).toBe(true);
    });

    it('asks for the point by hand where an end is square', async () => {
        writeSpec(dir, {
            ...ARM,
            parts: {
                ...ARM.parts,
                upper: { image: BLOCK, pivot: 'top', sockets: { tip: 'bottom' } },
            },
        });
        const report = await runPuppet({ dir, name: 'arm', session: await session() });
        expect(codes(report)).toEqual(['puppet-joint-missing', 'puppet-joint-missing']);
        expect(report.failures[0].detail).toMatchObject({
            part: 'upper',
            joint: 'pivot',
            side: 'top',
        });
    });

    it('shaves each part by its own outline, and keeps a part that is dark all through', async () => {
        const spec = {
            version: 1,
            parts: {
                upper: { image: UPPER, pivot: 'top', sockets: { tip: 'bottom' } },
                thin: { image: 'assets/thin.png', pivot: [10, 12], sockets: { tip: [10, 85] } },
                block: { image: 'assets/dark.png', pivot: [40, 10] },
            },
            bones: [
                { name: 'upper', part: 'upper', z: 2 },
                { name: 'thin', parent: 'upper', socket: 'tip', part: 'thin', z: 1 },
                { name: 'block', parent: 'thin', socket: 'tip', part: 'block', z: 0 },
            ],
        };
        writeSpec(dir, spec);
        const report = await runPuppet({ dir, name: 'arm', session: await session() });
        expect(codes(report)).toEqual([]);
        const done = report.puppet as {
            outline: number;
            parts: Record<string, { shaved: number }>;
        };
        expect(done.outline).toBe(5);
        expect([done.parts.upper.shaved, done.parts.thin.shaved, done.parts.block.shaved]).toEqual([
            5, 1, 0,
        ]);
        // The thin part keeps its 6 by 78 fill.
        const thin = await opaquePixels(path.join(dir, 'assets/puppets/arm/parts/thin.png'));
        expect(thin).toBe(6 * 78);
        // One outline for all, too wide for the thin part: refused, not a blank part.
        writeSpec(dir, { ...spec, outline: 5 });
        const wide = await runPuppet({ dir, name: 'arm', session: await session() });
        expect(codes(wide)).toEqual(['puppet-invalid']);
        expect(wide.failures[0].detail).toMatchObject({ path: '$.outline', part: 'thin' });
    });

    it('refuses an outline between whole pixels, and bones with wrong fields, naming the field', async () => {
        writeSpec(dir, { ...ARM, outline: 2.5 });
        const half = await runPuppet({ dir, name: 'arm', session: await session() });
        expect(half.failures.map((f) => f.detail?.path)).toEqual(['$.outline']);
        writeSpec(dir, {
            ...ARM,
            bones: [
                { name: 'upper', part: 'upper', z: 2, group: 'arm' },
                { name: 'lower', parent: 'elbow', socket: 'tip', part: 'lower', z: 'oops' },
            ],
        });
        const bones = await runPuppet({ dir, name: 'arm', session: await session() });
        expect(bones.failures.map((f) => f.detail?.path).sort()).toEqual([
            '$.bones[1].parent',
            '$.bones[1].z',
        ]);
        writeSpec(dir, {
            ...ARM,
            bones: [
                { name: 'upper', part: 'upper', z: 2 },
                { name: 'lower', parent: 'upper', socket: 'wrist', part: 'lower', z: 1 },
            ],
        });
        const socket = await runPuppet({ dir, name: 'arm', session: await session() });
        expect(socket.failures[0].detail?.path).toBe('$.bones[1].socket');
        expect(socket.failures[0].message).toContain(
            'names no socket of part "upper" (sockets: tip)',
        );
    });

    it('says what is wrong when assets/SOURCES.json is not an object of entries', async () => {
        const sourcesFile = path.join(dir, 'assets/SOURCES.json');
        const kept = fs.readFileSync(sourcesFile, 'utf-8');
        fs.writeFileSync(sourcesFile, 'null');
        writeSpec(dir, ARM);
        const report = await runPuppet({ dir, name: 'arm', session: await session() });
        fs.writeFileSync(sourcesFile, kept);
        expect(codes(report)).toEqual(['puppet-invalid']);
        expect(report.failures[0].element).toBe('assets/SOURCES.json');
        expect(report.failures[0].message).toContain('must be a JSON object');
    });

    it('refuses a generated picture without its prompt, and a picture outside assets/', async () => {
        const sourcesFile = path.join(dir, 'assets/SOURCES.json');
        const sources = JSON.parse(fs.readFileSync(sourcesFile, 'utf-8'));
        const kept = sources['limbs.png'];
        sources['limbs.png'] = { ...kept, prompt: undefined };
        fs.writeFileSync(sourcesFile, JSON.stringify(sources));
        writeSpec(dir, ARM);
        const report = await runPuppet({ dir, name: 'arm', session: await session() });
        expect(codes(report)).toEqual(['puppet-invalid', 'puppet-invalid']);
        expect(report.failures[0].message).toContain('is generated but gives no prompt');
        sources['limbs.png'] = kept;
        fs.writeFileSync(sourcesFile, JSON.stringify(sources));
        writeSpec(dir, {
            ...ARM,
            parts: { ...ARM.parts, lower: { image: 'index.html', pivot: 'top' } },
        });
        const outside = await runPuppet({ dir, name: 'arm', session: await session() });
        expect(outside.failures.map((f) => f.detail?.path)).toEqual(['$.parts.lower.image']);
    });
});
