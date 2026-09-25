// flipbook cutout: find every specimen on a plate under assets/ and cut each
// into a transparent PNG under assets/cut/<name>/, ahead of render. Each file
// carries the plate's source and license in assets/SOURCES.json, and a sheet
// shows every cutout on light, dark and checkered ground for a look first.
import * as fs from 'fs';
import * as path from 'path';
import { compositionDir, openSession, type Session } from '../engine/session.ts';
import { openToolPage } from '../engine/toolPage.ts';
import { Workspace } from '../engine/workspace.ts';
import { finding, progress, type Report, ReportBuilder } from './report.ts';

export interface CutoutOptions {
    dir: string;
    /** The plate, relative to dir, under assets/. */
    image: string;
    mode?: 'paper' | 'ink';
    /** Ground color, as #rrggbb. Default: measured along the plate's edge. */
    paper?: string;
    threshold?: number;
    /** Share of the long edge within which pieces count as one specimen. */
    gap?: number;
    /** Clear ground enclosed by a specimen covering at least this share of it. */
    holes?: number;
    /** Most specimens to cut, biggest first. Default 12. */
    max?: number;
    /** Long edge of each cutout in pixels. Default: its size on the plate, at most 1200. */
    size?: number;
    env?: NodeJS.ProcessEnv;
    session?: Session;
}

interface PageResult {
    found: number;
    kept: {
        index: number;
        png: string;
        width: number;
        height: number;
        crop: unknown;
        area: number;
    }[];
    clipped: { index: number; sides: string[] }[];
    sheet: string | null;
}

const SOURCES = path.join('assets', 'SOURCES.json');

export async function runCutout(options: CutoutOptions): Promise<Report> {
    const dir = compositionDir(options.dir);
    const rb = new ReportBuilder('cutout', dir);
    const ws = Workspace.open(dir);
    const image = options.image.split(path.sep).join('/');
    const refuse = (message: string) => {
        rb.add(finding('cutout-invalid', message, { element: image, detail: { image } }));
        return rb.finish();
    };
    const full = path.resolve(dir, image);
    const underAssets = path.relative(path.join(dir, 'assets'), full);
    if (underAssets.startsWith('..') || path.isAbsolute(underAssets)) {
        return refuse(`${image} is not under assets/ in the composition.`);
    }
    if (!fs.existsSync(full) || !fs.statSync(full).isFile())
        return refuse(`${image} does not exist.`);
    const key = underAssets.split(path.sep).join('/');
    let sources: Record<string, unknown>;
    try {
        sources = JSON.parse(ws.readText(ws.path(SOURCES)) ?? '{}');
    } catch (error) {
        return refuse(`assets/SOURCES.json is not valid JSON: ${(error as Error).message}`);
    }
    const entry = sources[key] as { source?: unknown; license?: unknown } | undefined;
    if (
        !entry ||
        typeof entry.license !== 'string' ||
        !entry.license ||
        typeof entry.source !== 'string'
    ) {
        return refuse(`${image} has no source and license in assets/SOURCES.json.`);
    }

    const session = options.session ?? (await openSession(options.env));
    const tool = await openToolPage(session, dir);
    let result: PageResult;
    try {
        rb.report.environment.chromium = session.chromium;
        progress(`cutout: finding specimens on ${image}`);
        result = await tool.page.evaluate(
            async (o) => {
                const rt = (window as unknown as { rt: typeof import('../runtime/index.ts') }).rt;
                const find = { paper: o.paper, threshold: o.threshold, gap: o.gap };
                const found = await rt.specimens(o.src, find);
                const kept: PageResult['kept'] = [];
                const clipped: PageResult['clipped'] = [];
                for (const [index, f] of found.slice(0, o.max).entries()) {
                    const p = await rt.photo(o.src, {
                        crop: f.crop,
                        cutout: o.mode,
                        paper: o.paper,
                        threshold: o.threshold,
                        holes: o.holes,
                        keep: 'largest',
                        size: o.size,
                        sticker: false,
                    });
                    if (p.clipped.length > 0) {
                        clipped.push({ index, sides: [...p.clipped] });
                        continue;
                    }
                    kept.push({
                        index,
                        png: p.canvas.toDataURL('image/png'),
                        width: p.canvas.width,
                        height: p.canvas.height,
                        crop: f.crop,
                        area: f.area,
                    });
                }
                if (kept.length === 0) return { found: found.length, kept, clipped, sheet: null };
                // Each cutout on light paper, on dark ground and on a checkerboard, side
                // by side, so a pale rim, a dark fringe and leftover ground all show.
                const cellW = 540;
                const cellH = 240;
                const cols = 2;
                const rows = Math.ceil(kept.length / cols);
                const sheet = document.createElement('canvas');
                sheet.width = cols * cellW;
                sheet.height = rows * cellH;
                const ctx = sheet.getContext('2d') as CanvasRenderingContext2D;
                const images = await Promise.all(
                    kept.map(async (k) => {
                        const img = new Image();
                        img.src = k.png;
                        await img.decode();
                        return img;
                    }),
                );
                images.forEach((img, i) => {
                    const x0 = (i % cols) * cellW;
                    const y0 = Math.floor(i / cols) * cellH;
                    const third = cellW / 3;
                    ctx.fillStyle = '#efe5d0';
                    ctx.fillRect(x0, y0, third, cellH);
                    ctx.fillStyle = '#1e2a28';
                    ctx.fillRect(x0 + third, y0, third, cellH);
                    for (let y = 0; y < cellH; y += 12) {
                        for (let x = 0; x < third; x += 12) {
                            ctx.fillStyle = (x + y) % 24 === 0 ? '#ffffff' : '#c8c8c8';
                            ctx.fillRect(x0 + 2 * third + x, y0 + y, 12, 12);
                        }
                    }
                    // One copy on each ground.
                    const k = Math.min((third * 0.88) / img.width, (cellH * 0.8) / img.height);
                    const w = img.width * k;
                    const h = img.height * k;
                    for (let n = 0; n < 3; n++) {
                        ctx.drawImage(
                            img,
                            x0 + n * third + (third - w) / 2,
                            y0 + (cellH - h) / 2,
                            w,
                            h,
                        );
                    }
                    ctx.fillStyle = '#c8452d';
                    ctx.font = 'bold 22px sans-serif';
                    ctx.fillText(String(i + 1).padStart(2, '0'), x0 + 8, y0 + 26);
                });
                return { found: found.length, kept, clipped, sheet: sheet.toDataURL('image/png') };
            },
            {
                src: `/${image}`,
                mode: options.mode ?? 'paper',
                paper: options.paper,
                threshold: options.threshold,
                gap: options.gap,
                holes: options.holes,
                max: options.max ?? 12,
                size: options.size,
            },
        );
    } finally {
        await tool.close();
        if (!options.session) await session.close();
    }

    for (const c of result.clipped) {
        rb.add(
            finding(
                'cutout-clipped',
                `Specimen ${c.index + 1} reaches past its crop on the ${c.sides.join(', ')}.`,
                {
                    severity: 'warning',
                    element: image,
                    detail: { index: c.index, sides: c.sides },
                },
            ),
        );
    }
    if (result.kept.length === 0) {
        rb.add(
            finding(
                'cutout-none',
                `No specimen on ${image} stands apart from the others (${result.found} found, ${result.clipped.length} cut by their crop).`,
                { element: image, detail: { found: result.found } },
            ),
        );
        return rb.finish();
    }

    const stem = path.basename(key, path.extname(key));
    const outDir = path.join('assets', 'cut', stem);
    ws.fresh(ws.path(outDir));
    // A rerun replaces the whole set: forget the entries of the old files.
    for (const name of Object.keys(sources)) {
        if (name.startsWith(`cut/${stem}/`)) delete sources[name];
    }
    const items = result.kept.map((k, i) => {
        const name = `${stem}-${String(i + 1).padStart(2, '0')}.png`;
        const file = path.join(outDir, name);
        ws.writeFile(ws.path(file), Buffer.from(k.png.split(',')[1], 'base64'));
        sources[`cut/${stem}/${name}`] = {
            source: entry.source,
            license: entry.license,
            cutFrom: key,
        };
        return {
            file: file.split(path.sep).join('/'),
            width: k.width,
            height: k.height,
            crop: k.crop,
            area: k.area,
        };
    });
    ws.writeFile(
        ws.path(outDir, 'cutout.json'),
        `${JSON.stringify({ image, mode: options.mode ?? 'paper', paper: options.paper ?? null, items }, null, 2)}\n`,
    );
    ws.writeFile(ws.path(SOURCES), `${JSON.stringify(sources, null, 4)}\n`);
    const sheet = path.join('out', 'cutout', `${stem}.png`).split(path.sep).join('/');
    ws.writeFile(ws.path(sheet), Buffer.from((result.sheet as string).split(',')[1], 'base64'));
    rb.report.cutout = { image, found: result.found, kept: items, skipped: result.clipped, sheet };
    rb.report.artifacts.sheet = path.join(dir, sheet);
    return rb.finish();
}
