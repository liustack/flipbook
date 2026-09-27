// flipbook cutout: every specimen on a plate cut out ahead of render into a
// transparent PNG under assets/cut/, with its source recorded and a sheet to
// look at before composing.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCutout } from '../src/cli/cutout.ts';
import { EnvError } from '../src/cli/report.ts';
import { run } from '../src/engine/proc.ts';
import { visionMasks, visionUnsupported } from '../src/engine/vision.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps, codes, runCli, tempDir } from './helpers.ts';

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

// One subject filling the picture, on white: no specimen stands apart.
const WHOLE = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260" viewBox="0 0 400 260">
<rect width="400" height="260" fill="#ffffff"/>
<ellipse cx="200" cy="130" rx="170" ry="110" fill="#d9822b"/>
</svg>`;

// A faint mark on paper: the paper cutout takes it with the ground.
const FAINT = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260" viewBox="0 0 400 260">
<rect width="400" height="260" fill="#efe6d2"/>
<circle cx="200" cy="130" r="90" fill="#e6ddc9"/>
</svg>`;

// An orange ball on a busy green ground, as a photo would have it.
const PHOTO = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260" viewBox="0 0 400 260">
<filter id="n"><feTurbulence baseFrequency="0.08" numOctaves="3" seed="4"/><feColorMatrix values="0 0 0 0 0.25  0 0 0 0 0.55  0 0 0 0 0.2  0 0 0 0 1"/></filter>
<rect width="400" height="260" fill="#3f7d20"/>
<rect width="400" height="260" filter="url(#n)" opacity="0.6"/>
<circle cx="200" cy="130" r="60" fill="#e07a2f"/>
</svg>`;

/** RGBA bytes of a PNG, through ffmpeg. */
async function rgba(file: string): Promise<Buffer> {
    const s = await session();
    const out = await run(s.ffmpeg.ffmpeg, [
        '-v',
        'error',
        '-i',
        file,
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        '-',
    ]);
    return out.stdout as Buffer;
}

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

    it('points at SOURCES.json when it is not an object of entries', async () => {
        const dir = composition(PLATE, false);
        fs.writeFileSync(path.join(dir, 'assets/SOURCES.json'), '[]');
        const report = await runCutout({
            dir,
            image: 'assets/plate.svg',
            session: await session(),
        });
        expect(codes(report)).toEqual(['cutout-invalid']);
        expect(report.failures[0].element).toBe('assets/SOURCES.json');
    });

    it('cuts the picture whole when no specimen stands apart', async () => {
        for (const svg of [WHOLE, JOINED]) {
            const dir = composition(svg);
            const report = await runCutout({
                dir,
                image: 'assets/plate.svg',
                session: await session(),
            });
            expect(report.failures).toEqual([]);
            const out = report.cutout as { whole: boolean; kept: { width: number }[] };
            expect(out.whole).toBe(true);
            expect(out.kept).toHaveLength(1);
            const sidecar = JSON.parse(
                fs.readFileSync(path.join(dir, 'assets/cut/plate/cutout.json'), 'utf-8'),
            );
            expect(sidecar.whole).toBe(true);
        }
    });

    it('cuts a plate on a transparent ground by its transparency, keeping dark specimens', async () => {
        // Dark specimens on a see-through ground whose pixels are black too.
        const dir = tempDir('cutout');
        fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
        fs.writeFileSync(
            path.join(dir, 'assets', 'plate.svg'),
            `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260" viewBox="0 0 400 260">
<circle cx="110" cy="130" r="50" fill="#111111"/>
<rect x="240" y="80" width="90" height="100" fill="#000000"/>
</svg>`,
        );
        fs.writeFileSync(
            path.join(dir, 'assets', 'SOURCES.json'),
            JSON.stringify({
                'plate.svg': { source: 'https://example.org/plate', license: 'pdm' },
            }),
        );
        const report = await runCutout({
            dir,
            image: 'assets/plate.svg',
            session: await session(),
        });
        expect(report.failures).toEqual([]);
        const out = report.cutout as { kept: { width: number; height: number }[] };
        expect(out.kept.map((k) => [k.width, k.height])).toEqual([
            [90, 100],
            [100, 100],
        ]);
    });

    it('says so when the ground takes everything, instead of failing', async () => {
        const dir = composition(FAINT);
        const report = await runCutout({
            dir,
            image: 'assets/plate.svg',
            session: await session(),
        });
        expect(codes(report)).toEqual(['cutout-none']);
        expect(report.failures[0].message).toContain('loses everything with the ground');
        expect(fs.existsSync(path.join(dir, 'assets/cut'))).toBe(false);
    });
});

describe('flipbook cutout --subject', () => {
    it("cuts each subject Vision finds, its rim in the subject's colors, not the ground's", async () => {
        const dir = composition(PHOTO);
        const s = await session();
        const report = await runCutout({
            dir,
            image: 'assets/plate.svg',
            mode: 'subject',
            session: s,
            // Vision's answer: a soft disc a little wider than the ball, and a speck.
            vision: async (_image, outDir) => {
                const masks = [
                    ['mask-01.png', 'clip((62-hypot(X-200\\,Y-130))*64\\,0\\,255)'],
                    ['mask-02.png', 'if(lt(hypot(X-20\\,Y-20)\\,3)\\,255\\,0)'],
                ].map(([name, lum]) => {
                    const file = path.join(outDir, name);
                    return { file, lum };
                });
                for (const m of masks) {
                    const made = await run(s.ffmpeg.ffmpeg, [
                        '-v',
                        'error',
                        '-f',
                        'lavfi',
                        '-i',
                        `color=black:s=400x260,format=gray,geq=lum='${m.lum}'`,
                        '-frames:v',
                        '1',
                        m.file,
                    ]);
                    expect(made.code).toBe(0);
                }
                return {
                    os: 'Version 15.3 (Build test)',
                    revision: 1,
                    masks: masks.map((m) => m.file),
                };
            },
        });
        expect(report.failures).toEqual([]);
        const out = report.cutout as {
            mode: string;
            kept: { file: string; width: number; height: number; edges: string[] }[];
        };
        expect(out.mode).toBe('subject');
        // The speck is left out.
        expect(out.kept).toHaveLength(1);
        const [ball] = out.kept;
        expect(ball.edges).toEqual([]);
        expect(ball.width).toBeGreaterThanOrEqual(120);
        expect(ball.width).toBeLessThanOrEqual(126);
        const px = await rgba(path.join(dir, ball.file));
        let rim = 0;
        let green = 0;
        for (let i = 0; i < px.length; i += 4) {
            const a = px[i + 3];
            if (a === 0 || a === 255) continue;
            rim++;
            if (px[i + 1] > px[i]) green++;
        }
        expect(rim).toBeGreaterThan(100);
        expect(green).toBe(0);
        const sources = JSON.parse(fs.readFileSync(path.join(dir, 'assets/SOURCES.json'), 'utf-8'));
        expect(sources['cut/plate/plate-01.png']).toEqual({
            source: 'https://example.org/plate',
            license: 'pdm',
            cutFrom: 'plate.svg',
            cutWith:
                'macOS Vision foreground instance mask, revision 1, macOS Version 15.3 (Build test)',
        });
        const sidecar = JSON.parse(
            fs.readFileSync(path.join(dir, 'assets/cut/plate/cutout.json'), 'utf-8'),
        );
        expect(sidecar.vision).toEqual({ os: 'Version 15.3 (Build test)', revision: 1 });
    });

    it('gives a wide soft rim the colors of the subject all the way out', async () => {
        const dir = composition(PHOTO);
        const s = await session();
        const report = await runCutout({
            dir,
            image: 'assets/plate.svg',
            mode: 'subject',
            session: s,
            // Solid to 40 px from the middle, then fading over 60 px, well past
            // the ball's edge at 60 into the green: far more than a dozen rings.
            vision: async (_image, outDir) => {
                const mask = path.join(outDir, 'mask-01.png');
                await run(s.ffmpeg.ffmpeg, [
                    '-v',
                    'error',
                    '-f',
                    'lavfi',
                    '-i',
                    "color=black:s=400x260,format=gray,geq=lum='clip((100-hypot(X-200\\,Y-130))*255/60\\,0\\,255)'",
                    '-frames:v',
                    '1',
                    mask,
                ]);
                return { os: 'test', revision: 1, masks: [mask] };
            },
        });
        expect(report.failures).toEqual([]);
        const [ball] = (report.cutout as { kept: { file: string }[] }).kept;
        const px = await rgba(path.join(dir, ball.file));
        let rim = 0;
        let green = 0;
        for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] === 0 || px[i + 3] === 255) continue;
            rim++;
            if (px[i + 1] > px[i]) green++;
        }
        expect(rim).toBeGreaterThan(1000);
        expect(green).toBe(0);
    });

    it('blows a subject up or down to the size asked for, past the 1200 default', async () => {
        const dir = composition(PHOTO);
        const s = await session();
        const report = await runCutout({
            dir,
            image: 'assets/plate.svg',
            mode: 'subject',
            size: 1800,
            session: s,
            vision: async (_image, outDir) => {
                const mask = path.join(outDir, 'mask-01.png');
                await run(s.ffmpeg.ffmpeg, [
                    '-v',
                    'error',
                    '-f',
                    'lavfi',
                    '-i',
                    "color=black:s=400x260,format=gray,geq=lum='clip((62-hypot(X-200\\,Y-130))*64\\,0\\,255)'",
                    '-frames:v',
                    '1',
                    mask,
                ]);
                return { os: 'test', revision: 1, masks: [mask] };
            },
        });
        expect(report.failures).toEqual([]);
        const [ball] = (report.cutout as { kept: { width: number; height: number }[] }).kept;
        expect(Math.max(ball.width, ball.height)).toBe(1800);
    });

    it('refuses --subject with --ink or --paper as a usage error, exit 2 with a report', () => {
        const dir = composition(PHOTO);
        for (const flag of [['--ink'], ['--paper', '#ffffff']]) {
            const out = runCli(['cutout', dir, 'assets/plate.svg', '--subject', ...flag]);
            expect(out.status).toBe(2);
            expect(out.json).toMatchObject({ command: 'usage', exitCode: 2 });
        }
        expect(fs.existsSync(path.join(dir, 'assets/cut'))).toBe(false);
    });

    it('leaves the composition as it was when Vision cannot be asked', async () => {
        const dir = composition(PHOTO);
        const cache = path.join(dir, '.flipbook', 'vision', 'plate');
        fs.mkdirSync(cache, { recursive: true });
        fs.writeFileSync(path.join(cache, 'keep.png'), 'an earlier mask');
        await expect(
            runCutout({
                dir,
                image: 'assets/plate.svg',
                mode: 'subject',
                session: await session(),
                vision: (image, outDir) => visionMasks(image, outDir, 'linux', '6.8.0'),
            }),
        ).rejects.toMatchObject({ code: 'vision-unavailable' });
        expect(fs.readFileSync(path.join(cache, 'keep.png'), 'utf-8')).toBe('an earlier mask');
        expect(fs.existsSync(path.join(dir, 'assets/cut'))).toBe(false);
        // osascript that cannot start is the same missing piece, not a crash.
        const path0 = process.env.PATH;
        process.env.PATH = '';
        try {
            await expect(
                visionMasks(
                    path.join(dir, 'assets/plate.svg'),
                    tempDir('vision'),
                    'darwin',
                    '24.0.0',
                ),
            ).rejects.toMatchObject({ code: 'vision-unavailable' });
        } finally {
            process.env.PATH = path0;
        }
    });

    it('names what is missing on a machine without Vision, before anything is cut', async () => {
        expect(visionUnsupported('linux', '6.8.0')).toContain('this is linux');
        expect(visionUnsupported('darwin', '22.6.0')).toContain('older macOS');
        expect(visionUnsupported('darwin', '23.0.0')).toBeNull();
        const dir = composition(PHOTO);
        await expect(
            visionMasks(path.join(dir, 'assets/plate.svg'), dir, 'linux', '6.8.0'),
        ).rejects.toMatchObject({ code: 'vision-unavailable' });
        await expect(visionMasks('x', dir, 'linux', '6.8.0')).rejects.toBeInstanceOf(EnvError);
    });

    // The real framework, only where it is: not on CI, whose Macs may lack the GPU it needs.
    it.skipIf(visionUnsupported() !== null || process.env.CI !== undefined)(
        'finds a ball on a busy ground with the real Vision',
        async () => {
            const dir = tempDir('cutout-vision');
            fs.mkdirSync(path.join(dir, 'assets'));
            const s = await session();
            const photo = path.join(dir, 'assets', 'ball.png');
            const made = await run(s.ffmpeg.ffmpeg, [
                '-v',
                'error',
                '-f',
                'lavfi',
                '-i',
                "nullsrc=s=400x260,geq=r='60+40*sin(X/7)*cos(Y/5)+random(1)*40':g='120+30*sin(X/11)+random(1)*50':b='50+random(1)*30'",
                '-f',
                'lavfi',
                '-i',
                'color=c=0xE07A2F:s=400x260',
                '-filter_complex',
                "[1:v]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(hypot(X-200,Y-130),70),255,0)'[d];[0:v][d]overlay",
                '-frames:v',
                '1',
                photo,
            ]);
            expect(made.code).toBe(0);
            const found = await visionMasks(photo, path.join(dir, 'masks'));
            expect(found.masks).toHaveLength(1);
            expect(found.revision).toBeGreaterThanOrEqual(1);
            const px = await rgba(found.masks[0]);
            const at = (x: number, y: number) => px[(y * 400 + x) * 4];
            expect(at(200, 130)).toBe(255);
            expect(at(10, 10)).toBe(0);
        },
    );
});
