// flipbook cutout: find every specimen on a plate under assets/ and cut each
// into a transparent PNG under assets/cut/<name>/, ahead of render. Each file
// carries the plate's source and license in assets/SOURCES.json, and a sheet
// shows every cutout on light, dark and checkered ground for a look first.
import * as fs from 'fs';
import * as path from 'path';
import { cutEntry, parseSources, sourceProblem } from '../engine/assetSources.ts';
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

interface Kept {
    index: number;
    png: string;
    width: number;
    height: number;
    crop: { x: number; y: number; width: number; height: number };
    area: number;
}

interface Cut {
    found: number;
    /** No specimen stood apart, so the plate was cut whole as one. */
    whole: boolean;
    kept: Kept[];
    clipped: { index: number; sides: string[] }[];
    /** Specimens the paper cutout left nothing of. */
    empty: number[];
}

const SOURCES = path.join('assets', 'SOURCES.json');

export async function runCutout(options: CutoutOptions): Promise<Report> {
    const dir = compositionDir(options.dir);
    const rb = new ReportBuilder('cutout', dir);
    const ws = Workspace.open(dir);
    const image = options.image.split(path.sep).join('/');
    const mode = options.mode ?? 'paper';
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
    const read = parseSources(ws.readText(ws.path(SOURCES)));
    if ('problem' in read) {
        rb.add(
            finding('cutout-invalid', read.problem, {
                element: 'assets/SOURCES.json',
                detail: { image },
            }),
        );
        return rb.finish();
    }
    const sources = read.sources;
    const problem = sourceProblem(sources, key);
    if (problem) return refuse(`${image} ${problem} in assets/SOURCES.json.`);
    const stem = path.basename(key, path.extname(key));

    const session = options.session ?? (await openSession(options.env));
    const tool = await openToolPage(session, dir);
    let cut: Cut;
    let sheet: string | null = null;
    try {
        rb.report.environment.chromium = session.chromium;
        progress(`cutout: finding specimens on ${image}`);
        cut = await tool.page.evaluate(cutSpecimens, {
            src: `/${image}`,
            mode,
            paper: options.paper,
            threshold: options.threshold,
            gap: options.gap,
            holes: options.holes,
            max: options.max ?? 12,
            size: options.size,
        });
        if (cut.kept.length > 0) {
            sheet = await tool.page.evaluate(
                drawSheet,
                cut.kept.map((k) => k.png),
            );
        }
    } finally {
        await tool.close();
        if (!options.session) await session.close();
    }

    for (const c of cut.clipped) {
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
    if (cut.kept.length === 0) {
        const why = cut.whole
            ? `No specimen on ${image} stands apart from the others, and cut whole it ${
                  cut.empty.length > 0
                      ? 'loses everything with the ground: the ground is not one flat color'
                      : 'runs off the picture'
              }.`
            : `No specimen on ${image} stands apart from the others (${cut.found} found, ${cut.clipped.length} cut by their crop, ${cut.empty.length} lost with the ground).`;
        rb.add(
            finding('cutout-none', why, {
                element: image,
                detail: { found: cut.found, whole: cut.whole, empty: cut.empty.length },
            }),
        );
        return rb.finish();
    }

    const outDir = path.join('assets', 'cut', stem);
    ws.fresh(ws.path(outDir));
    // A rerun replaces the whole set: forget the entries of the old files.
    for (const name of Object.keys(sources)) {
        if (name.startsWith(`cut/${stem}/`)) delete sources[name];
    }
    const items = cut.kept.map((k, i) => {
        const name = `${stem}-${String(i + 1).padStart(2, '0')}.png`;
        const file = path.join(outDir, name);
        ws.writeFile(ws.path(file), Buffer.from(k.png.split(',')[1], 'base64'));
        sources[`cut/${stem}/${name}`] = cutEntry(sources, key);
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
        `${JSON.stringify(
            {
                image,
                mode,
                paper: options.paper ?? null,
                ...(cut.whole ? { whole: true } : {}),
                items,
            },
            null,
            2,
        )}\n`,
    );
    ws.writeFile(ws.path(SOURCES), `${JSON.stringify(sources, null, 4)}\n`);
    const sheetFile = path.join('out', 'cutout', `${stem}.png`).split(path.sep).join('/');
    ws.writeFile(ws.path(sheetFile), Buffer.from((sheet as string).split(',')[1], 'base64'));
    rb.report.cutout = {
        image,
        mode,
        found: cut.found,
        whole: cut.whole,
        kept: items,
        skipped: cut.clipped,
        sheet: sheetFile,
    };
    rb.report.artifacts.sheet = path.join(dir, sheetFile);
    return rb.finish();
}

// ---------------------------------------------------------------------------
// In the tool page. These run in the browser, so they reach nothing outside.

/** Paper or ink: the specimens on a plate, or the plate whole when none stands apart. */
async function cutSpecimens(o: {
    src: string;
    mode: 'paper' | 'ink';
    paper?: string;
    threshold?: number;
    gap?: number;
    holes?: number;
    max: number;
    size?: number;
}): Promise<Cut> {
    const rt = (window as unknown as { rt: typeof import('../runtime/index.ts') }).rt;
    const found = await rt.specimens(o.src, {
        paper: o.paper,
        threshold: o.threshold,
        gap: o.gap,
    });
    // One subject filling the picture is never a specimen (it could be the
    // plate's frame): with none found, the picture is tried whole.
    const whole = found.length === 0;
    const all = { x: 0, y: 0, width: 1, height: 1 };
    const tries: { crop: typeof all; box?: typeof all; area: number }[] = whole
        ? [{ crop: all, area: 1 }]
        : found.slice(0, o.max);
    const kept: Kept[] = [];
    const clipped: Cut['clipped'] = [];
    const empty: number[] = [];
    for (const [index, f] of tries.entries()) {
        let p: Awaited<ReturnType<typeof rt.photo>>;
        try {
            p = await rt.photo(o.src, {
                crop: whole ? undefined : f.crop,
                cutout: o.mode,
                paper: o.paper,
                threshold: o.threshold,
                holes: o.holes,
                // The specimen specimens() found, never a neighbour in its crop.
                keep: f.box ?? 'largest',
                size: o.size,
                sticker: false,
            });
        } catch (error) {
            // The ground took everything: the picture is not a plate on flat paper.
            if (/nothing is left/.test(String((error as Error).message))) {
                empty.push(index);
                continue;
            }
            throw error;
        }
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
    return { found: found.length, whole, kept, clipped, empty };
}

/**
 * Each cutout on light paper, on dark ground and on a checkerboard, side by
 * side, so a pale rim, a dark fringe and leftover ground all show.
 */
async function drawSheet(pngs: string[]): Promise<string> {
    const cellW = 540;
    const cellH = 240;
    const cols = 2;
    const rows = Math.ceil(pngs.length / cols);
    const sheet = document.createElement('canvas');
    sheet.width = cols * cellW;
    sheet.height = rows * cellH;
    const ctx = sheet.getContext('2d') as CanvasRenderingContext2D;
    const images = await Promise.all(
        pngs.map(async (png) => {
            const img = new Image();
            img.src = png;
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
        const k = Math.min((third * 0.88) / img.width, (cellH * 0.8) / img.height);
        const w = img.width * k;
        const h = img.height * k;
        for (let n = 0; n < 3; n++) {
            ctx.drawImage(img, x0 + n * third + (third - w) / 2, y0 + (cellH - h) / 2, w, h);
        }
        ctx.fillStyle = '#c8452d';
        ctx.font = 'bold 22px sans-serif';
        ctx.fillText(String(i + 1).padStart(2, '0'), x0 + 8, y0 + 26);
    });
    return sheet.toDataURL('image/png');
}
