// flipbook cutout: every specimen on a plate cut out ahead of render into a
// transparent PNG under assets/cut/, with its source recorded and a sheet to
// look at before composing.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCutout } from '../src/cli/cutout.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps, codes, tempDir } from './helpers.ts';

process.env.FLIPBOOK_QUIET = '1';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

const PLATE = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260" viewBox="0 0 400 260">
<rect width="400" height="260" fill="#efe6d2"/>
<ellipse cx="90" cy="120" rx="60" ry="40" fill="#6b4a2e"/>
<circle cx="250" cy="90" r="36" fill="#2a6f97"/>
<rect x="300" y="170" width="50" height="40" fill="#c8452d"/>
</svg>`;

const JOINED = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260" viewBox="0 0 400 260">
<rect width="400" height="260" fill="#efe6d2"/>
<g stroke="#3a2a1a" stroke-width="4">
<line x1="200" y1="130" x2="40" y2="30"/><line x1="200" y1="130" x2="360" y2="30"/>
<line x1="200" y1="130" x2="40" y2="230"/><line x1="200" y1="130" x2="360" y2="230"/>
</g>
<g fill="#3a2a1a"><circle cx="40" cy="30" r="14"/><circle cx="360" cy="30" r="14"/>
<circle cx="40" cy="230" r="14"/><circle cx="360" cy="230" r="14"/><circle cx="200" cy="130" r="20"/></g>
</svg>`;

function composition(svg: string, sources = true): string {
    const dir = tempDir('cutout');
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'assets', 'plate.svg'), svg);
    if (sources) {
        fs.writeFileSync(
            path.join(dir, 'assets', 'SOURCES.json'),
            JSON.stringify({
                'plate.svg': { source: 'https://example.org/plate', license: 'pdm' },
            }),
        );
    }
    return dir;
}

describe('flipbook cutout', () => {
    it('cuts every specimen into assets/cut/, records its source and draws a sheet', async () => {
        const dir = composition(PLATE);
        const report = await runCutout({
            dir,
            image: 'assets/plate.svg',
            session: await session(),
        });
        expect(report.failures).toEqual([]);
        expect(report.exitCode).toBe(0);
        const out = report.cutout as {
            kept: { file: string; width: number; height: number }[];
            sheet: string;
        };
        expect(out.kept.map((k) => k.file)).toEqual([
            'assets/cut/plate/plate-01.png',
            'assets/cut/plate/plate-02.png',
            'assets/cut/plate/plate-03.png',
        ]);
        for (const k of out.kept) {
            const bytes = fs.readFileSync(path.join(dir, k.file));
            expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
        }
        // The biggest first: the 120 x 80 egg.
        expect(out.kept[0].width).toBeGreaterThanOrEqual(118);
        expect(out.kept[0].width).toBeLessThanOrEqual(124);
        const sidecar = JSON.parse(
            fs.readFileSync(path.join(dir, 'assets/cut/plate/cutout.json'), 'utf-8'),
        );
        expect(sidecar.image).toBe('assets/plate.svg');
        expect(sidecar.items).toHaveLength(3);
        const sources = JSON.parse(fs.readFileSync(path.join(dir, 'assets/SOURCES.json'), 'utf-8'));
        expect(sources['cut/plate/plate-02.png']).toEqual({
            source: 'https://example.org/plate',
            license: 'pdm',
            cutFrom: 'plate.svg',
        });
        expect(fs.existsSync(path.join(dir, out.sheet))).toBe(true);
    });

    it('refuses an image without its source and license in SOURCES.json', async () => {
        const dir = composition(PLATE, false);
        const report = await runCutout({
            dir,
            image: 'assets/plate.svg',
            session: await session(),
        });
        expect(codes(report)).toEqual(['cutout-invalid']);
        expect(fs.existsSync(path.join(dir, 'assets/cut'))).toBe(false);
    });

    it('says so when the specimens are joined and none can be cut out alone', async () => {
        const dir = composition(JOINED);
        const report = await runCutout({
            dir,
            image: 'assets/plate.svg',
            session: await session(),
        });
        expect(codes(report)).toEqual(['cutout-none']);
    });
});
