// flipbook sprite: cut frame-by-frame sprite sheets into clips ahead of
// render. Reads assets/sprites/<name>/sprite.json (which sheet holds which
// clip, how many drawings), cuts every drawing, puts them in reading order,
// measures each one's head and soles, scales every clip to one height, takes
// a walk's stride from how far apart its feet get, and writes the frames,
// a clips.json for loadSprite() and a sheet: every clip's drawings laid over
// one another on their anchor (drift shows as a blur) and side by side.
import * as fs from 'fs';
import * as path from 'path';
import { cutEntry, parseSources, sourceProblem } from '../engine/assetSources.ts';
import { Checker, describe, ID_PATTERN, isObject, type Json } from '../engine/schema.ts';
import { compositionDir, openSession, type Session } from '../engine/session.ts';
import { openToolPage } from '../engine/toolPage.ts';
import { Workspace } from '../engine/workspace.ts';
import { type SpriteFile, walkStride } from '../runtime/sprite.ts';
import { finding, progress, type Report, ReportBuilder } from './report.ts';

export interface SpriteOptions {
    dir: string;
    /** The sprite's folder under assets/sprites/. */
    name: string;
    env?: NodeJS.ProcessEnv;
    session?: Session;
}

const SOURCES = path.join('assets', 'SOURCES.json');
const IMAGE = /\.(png|jpe?g|webp)$/i;
/** A drawing taller or shorter than its clip's median by more than this share has drifted. */
export const DRIFT_HEIGHT = 0.06;
/** In a clip that stands still, feet that wander from the head by more than this share of the height have drifted. */
export const DRIFT_FEET = 0.05;
/** In a walk, a drawing shifted by more than this share of the height to keep the planted foot put is said so. */
export const DRIFT_NUDGE = 0.04;

interface ClipSpec {
    image: string;
    frames: number;
    fps?: number;
    loop?: boolean;
    walk?: boolean;
    paper?: string;
    threshold?: number;
    gap?: number;
    /** A sheet laid out in equal cells: [columns, rows]. Each cell is a drawing. */
    grid?: [number, number];
    /** With grid: the cells to use, [first, last], numbered from 1 in reading order. */
    cells?: [number, number];
}
interface SpriteSpec {
    version: 1;
    height?: number;
    /** Pixel art: every drawing keeps its own size and hard edges, nothing is rescaled. */
    pixel?: boolean;
    clips: Record<string, ClipSpec>;
}

interface PageClip {
    found: number;
    /** The grid does not fit the sheet. */
    gridProblem?: string;
    clipped: number[];
    frames: {
        png: string;
        width: number;
        height: number;
        anchor: [number, number];
        tall: number;
        feet: [number, number];
    }[];
    measured: number;
    /** A walk's even advance per drawing, or null when the planted foot could not be followed. */
    advance?: number | null;
}
interface Drift {
    clip: string;
    frame: number;
    kind: 'height' | 'feet' | 'nudge';
    share: number;
}
interface PageResult {
    clips: Record<string, PageClip>;
    height: number;
    drift: Drift[];
    sheet: string | null;
}

function validate(
    input: Json,
    sources: Record<string, unknown>,
    dir: string,
): { errors: { path: string; message: string }[]; spec?: SpriteSpec } {
    const c = new Checker('sprite v1');
    if (!isObject(input)) {
        c.fail('$', 'must be a JSON object');
        return { errors: c.errors };
    }
    c.keys(input, '$', ['$schema', 'version', 'height', 'pixel', 'clips']);
    if (input.version !== 1) c.fail('$.version', `must be 1 (got ${describe(input.version)})`);
    if (input.pixel !== undefined && typeof input.pixel !== 'boolean') {
        c.fail('$.pixel', `must be true or false (got ${describe(input.pixel)})`);
    }
    if (input.height !== undefined) {
        if (input.pixel === true) {
            c.fail('$.height', 'pixel sprites keep their own size: scale them when you draw them');
        } else c.num(input.height, '$.height', 16, 4000);
    }
    if (!isObject(input.clips) || Object.keys(input.clips).length === 0) {
        c.fail('$.clips', `must be an object of clips (got ${describe(input.clips)})`);
        return { errors: c.errors };
    }
    for (const [name, clip] of Object.entries(input.clips)) {
        const at = `$.clips.${name}`;
        if (!ID_PATTERN.test(name)) c.fail(at, 'must be named with letters, digits, - or _');
        if (!isObject(clip)) {
            c.fail(at, 'must be an object with image and frames');
            continue;
        }
        c.keys(clip, at, [
            'image',
            'frames',
            'fps',
            'loop',
            'walk',
            'paper',
            'threshold',
            'gap',
            'grid',
            'cells',
        ]);
        if (c.localFile(clip.image, `${at}.image`)) {
            const rel = (clip.image as string).split(/[\\/]/).join('/');
            const full = path.join(dir, rel);
            if (!rel.startsWith('assets/')) c.fail(`${at}.image`, 'must be a file under assets/');
            else if (!fs.existsSync(full) || !fs.statSync(full).isFile())
                c.fail(`${at}.image`, 'names no file');
            else if (!IMAGE.test(rel)) c.fail(`${at}.image`, 'must be a .png, .jpg or .webp image');
            else {
                const problem = sourceProblem(sources, rel.slice('assets/'.length));
                if (problem) c.fail(`${at}.image`, `${rel} ${problem} in assets/SOURCES.json`);
            }
        }
        c.int(clip.frames, `${at}.frames`, 1, 64);
        if (clip.fps !== undefined) c.num(clip.fps, `${at}.fps`, 1, 60);
        for (const key of ['loop', 'walk'] as const) {
            if (clip[key] !== undefined && typeof clip[key] !== 'boolean')
                c.fail(`${at}.${key}`, `must be true or false (got ${describe(clip[key])})`);
        }
        if (clip.paper !== undefined)
            c.str(clip.paper, `${at}.paper`, /^#[0-9a-fA-F]{6}$/, 'a color as #rrggbb');
        if (clip.threshold !== undefined) c.int(clip.threshold, `${at}.threshold`, 1, 255);
        if (clip.gap !== undefined) c.num(clip.gap, `${at}.gap`, 0, 0.2);
        const pair = (v: unknown) =>
            Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n >= 1);
        if (clip.grid !== undefined) {
            if (!pair(clip.grid) || (clip.grid as number[]).some((n) => n > 64)) {
                c.fail(
                    `${at}.grid`,
                    `must be [columns, rows], whole numbers from 1 to 64 (got ${describe(clip.grid)})`,
                );
            } else if (clip.gap !== undefined) {
                c.fail(
                    `${at}.gap`,
                    'parts drawings a sheet shows apart, and a grid cuts by cells: leave it out',
                );
            }
        }
        if (clip.cells !== undefined) {
            if (clip.grid === undefined) {
                c.fail(`${at}.cells`, 'numbers the cells of a grid: give grid too');
            } else if (pair(clip.grid)) {
                const [cols, rows] = clip.grid as number[];
                const n = cols * rows;
                const cells = clip.cells as number[];
                if (!pair(clip.cells) || cells[0] > cells[1] || cells[1] > n) {
                    c.fail(
                        `${at}.cells`,
                        `must be [first, last], cells numbered 1 to ${n} in reading order, first no later than last (got ${describe(clip.cells)})`,
                    );
                }
            }
        }
    }
    return c.errors.length > 0
        ? { errors: c.errors }
        : { errors: [], spec: input as unknown as SpriteSpec };
}

export async function runSprite(options: SpriteOptions): Promise<Report> {
    const dir = compositionDir(options.dir);
    const rb = new ReportBuilder('sprite', dir);
    const ws = Workspace.open(dir);
    const name = options.name;
    const folder = path.join('assets', 'sprites', name);
    const specFile = path.join(folder, 'sprite.json').split(path.sep).join('/');
    const invalid = (message: string, at = '$', detail: Record<string, unknown> = {}) => {
        rb.add(
            finding('sprite-invalid', message, {
                element: specFile,
                detail: { path: at, ...detail },
            }),
        );
    };
    if (!ID_PATTERN.test(name)) {
        invalid(`"${name}" is not a sprite name: use letters, digits, - or _.`);
        return rb.finish();
    }
    const text = ws.readText(ws.path(specFile));
    if (text === null) {
        invalid(`No ${specFile}. Write it first, as references/characters.md describes.`);
        return rb.finish();
    }
    let parsed: unknown;
    let sources: Record<string, unknown>;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        invalid(`${specFile} is not valid JSON: ${(error as Error).message}`);
        return rb.finish();
    }
    const read = parseSources(ws.readText(ws.path(SOURCES)));
    if ('problem' in read) {
        rb.add(
            finding('sprite-invalid', read.problem, {
                element: 'assets/SOURCES.json',
                detail: { path: '$' },
            }),
        );
        return rb.finish();
    }
    sources = read.sources;
    const { errors, spec } = validate(parsed as Json, sources, dir);
    if (!spec) {
        for (const e of errors) invalid(`${e.path} ${e.message}`, e.path);
        return rb.finish();
    }

    const session = options.session ?? (await openSession(options.env));
    const tool = await openToolPage(session, dir);
    let result: PageResult;
    try {
        rb.report.environment.chromium = session.chromium;
        progress(`sprite: cutting ${name}`);
        result = await tool.page.evaluate(
            async (o) => {
                const rt = (window as unknown as { rt: typeof import('../runtime/index.ts') }).rt;
                const clips: PageResult['clips'] = {};
                const cut: Record<
                    string,
                    { canvas: HTMLCanvasElement; m: import('../runtime/sprite.ts').FrameMeasure }[]
                > = {};
                for (const [clipName, c] of Object.entries(o.clips)) {
                    // Drawings on a sheet sit closer than specimens on a plate, and a small
                    // drawing on a big sheet is still a drawing: only pieces much smaller
                    // than a typical drawing (below) are dust. Pixel sheets are packed,
                    // drawings reaching the sheet's edge.
                    type Target = {
                        crop: { x: number; y: number; width: number; height: number };
                        box?: { x: number; y: number; width: number; height: number };
                    };
                    let ordered: Target[];
                    let drawings = 0;
                    if (c.grid) {
                        // A sheet in equal cells: each cell is a drawing, in reading order,
                        // however close the drawings sit. Empty cells are found when cut.
                        const [cols, rows] = c.grid;
                        const img = new Image();
                        img.src = `/${c.image}`;
                        await img.decode();
                        const sw = img.naturalWidth;
                        const sh = img.naturalHeight;
                        if (o.pixel && (sw % cols !== 0 || sh % rows !== 0)) {
                            clips[clipName] = {
                                found: 0,
                                clipped: [],
                                frames: [],
                                measured: 0,
                                gridProblem: `${c.image} is ${sw} by ${sh} px, which does not split into ${cols} by ${rows} cells of whole pixels`,
                            };
                            cut[clipName] = [];
                            continue;
                        }
                        const [first, last] = c.cells ?? [1, cols * rows];
                        ordered = [];
                        for (let n = first; n <= last; n++) {
                            const col = (n - 1) % cols;
                            const row = Math.floor((n - 1) / cols);
                            ordered.push({
                                crop: {
                                    x: col / cols,
                                    y: row / rows,
                                    width: 1 / cols,
                                    height: 1 / rows,
                                },
                            });
                        }
                    } else {
                        const find = {
                            paper: c.paper,
                            threshold: c.threshold,
                            gap: c.gap ?? 0.004,
                            minArea: 0,
                            sheet: o.pixel,
                            pixelated: o.pixel,
                        };
                        const found = await rt.specimens(`/${c.image}`, find);
                        // The drawings are the biggest pieces: a piece counts as one when it
                        // is at least a third the size of a typical drawing. Smaller is dust.
                        const top = found
                            .slice(0, c.frames)
                            .map((f) => f.area)
                            .sort((a, b) => a - b);
                        const typical = top.length > 0 ? top[Math.floor(top.length / 2)] : 0;
                        drawings = found.filter((f) => f.area >= typical / 3).length;
                        // Read in order by where each drawing itself lies: the crop's room
                        // is wide on a big sheet and would blur rows and columns together.
                        const kept = found
                            .slice(0, c.frames)
                            .map((f) => ({ ...f.box, crop: f.crop, box: f.box }));
                        ordered = rt.readingOrder(kept);
                    }
                    const frames: {
                        canvas: HTMLCanvasElement;
                        m: (typeof cut)[string][number]['m'];
                    }[] = [];
                    const clipped: number[] = [];
                    for (const [i, f] of ordered.entries()) {
                        let p: Awaited<ReturnType<typeof rt.photo>>;
                        try {
                            p = await rt.photo(`/${c.image}`, {
                                crop: f.crop,
                                // Paper, or the sheet's own transparency when it has
                                // some: a see-through ground read as paper is black, and
                                // dark ink reaching the crop's edge would go with it.
                                cutout: 'auto',
                                paper: c.paper,
                                threshold: c.threshold,
                                // The drawing specimens() found, not a bigger neighbour. A
                                // grid cell holds one drawing, every piece of it.
                                keep: f.box ?? 'all',
                                sticker: false,
                                // Pixel art: whole pixels, nothing smoothed, a cell in or out.
                                ...(o.pixel ? { pixelated: true } : {}),
                            });
                        } catch (error) {
                            // An empty cell of a grid: nothing is left once the ground goes.
                            if (c.grid && /nothing is left/.test(String((error as Error).message)))
                                continue;
                            throw error;
                        }
                        if (c.grid) drawings++;
                        // In a grid the cell is the frame: a drawing may touch its edge.
                        else if (p.clipped.length > 0) clipped.push(i);
                        const w = p.canvas.width;
                        const h = p.canvas.height;
                        const data = (
                            p.canvas.getContext('2d', {
                                willReadFrequently: true,
                            }) as CanvasRenderingContext2D
                        ).getImageData(0, 0, w, h).data;
                        const alpha = new Uint8ClampedArray(w * h);
                        for (let j = 0; j < w * h; j++) alpha[j] = data[j * 4 + 3];
                        const m = rt.measureFrame(alpha, w, h);
                        if (!m) {
                            clipped.push(i);
                            continue;
                        }
                        frames.push({ canvas: p.canvas, m });
                    }
                    const talls = frames.map((f) => f.m.base - f.m.top + 1).sort((a, b) => a - b);
                    clips[clipName] = {
                        found: drawings,
                        clipped,
                        frames: [],
                        measured: talls.length > 0 ? talls[Math.floor(talls.length / 2)] : 0,
                    };
                    cut[clipName] = frames;
                }
                const names = Object.keys(o.clips);
                const bad = names.some(
                    (n) =>
                        clips[n].found !== o.clips[n].frames ||
                        clips[n].clipped.length > 0 ||
                        clips[n].measured === 0,
                );
                if (bad) return { clips, height: 0, drift: [], sheet: null };

                // One height for every clip: the given one, or the first clip's.
                // Pixel art is never rescaled: its cells would blur or double.
                const height = o.height ?? clips[names[0]].measured;
                const drift: Drift[] = [];
                const ground: [number, number][][] = [];
                for (const n of names) {
                    const k = o.pixel ? 1 : height / clips[n].measured;
                    for (const f of cut[n]) {
                        const w = Math.max(1, Math.round(f.canvas.width * k));
                        const h = Math.max(1, Math.round(f.canvas.height * k));
                        const out = document.createElement('canvas');
                        out.width = w;
                        out.height = h;
                        const g = out.getContext('2d') as CanvasRenderingContext2D;
                        if (o.pixel) {
                            g.imageSmoothingEnabled = false;
                            g.drawImage(f.canvas, 0, 0, w, h);
                            // Every cell fully in or out.
                            const img = g.getImageData(0, 0, w, h);
                            for (let j = 3; j < img.data.length; j += 4) {
                                img.data[j] = img.data[j] >= 128 ? 255 : 0;
                            }
                            g.putImageData(img, 0, 0);
                        } else {
                            g.imageSmoothingQuality = 'high';
                            g.drawImage(f.canvas, 0, 0, w, h);
                        }
                        clips[n].frames.push({
                            png: out.toDataURL('image/png'),
                            width: w,
                            height: h,
                            anchor: o.pixel
                                ? [Math.round(f.m.headX), f.m.base + 1]
                                : [
                                      Math.round(f.m.headX * k * 2) / 2,
                                      Math.round((f.m.base + 1) * k * 2) / 2,
                                  ],
                            tall: (f.m.base - f.m.top + 1) * k,
                            feet: [(f.m.feet[0] - f.m.headX) * k, (f.m.feet[1] - f.m.headX) * k],
                        });
                        if (o.clips[n].walk) {
                            const d = g.getImageData(0, 0, w, h).data;
                            const alpha = new Uint8ClampedArray(w * h);
                            for (let j = 0; j < w * h; j++) alpha[j] = d[j * 4 + 3];
                            const ax = f.m.headX * k;
                            const band = Math.max(3, Math.round(0.04 * height));
                            ground.push(
                                rt
                                    .groundRuns(alpha, w, h, band)
                                    .map(([l, r]) => [l - ax, r - ax] as [number, number]),
                            );
                        }
                    }
                    // A walk: shift each drawing so the planted foot stays where it landed.
                    if (o.clips[n].walk) {
                        const planted = rt.plantedWalk(ground, height, o.clips[n].loop ?? false);
                        clips[n].advance = planted ? planted.advance : null;
                        planted?.nudges.forEach((e, i) => {
                            const f = clips[n].frames[i];
                            // Pixel anchors stay on whole pixels.
                            const x = f.anchor[0] + e;
                            f.anchor = [
                                o.pixel ? Math.round(x) : Math.round(x * 2) / 2,
                                f.anchor[1],
                            ];
                            f.feet = [f.feet[0] - e, f.feet[1] - e];
                            if (Math.abs(e) > o.driftNudge * height) {
                                drift.push({
                                    clip: n,
                                    frame: i + 1,
                                    kind: 'nudge',
                                    share: e / height,
                                });
                            }
                        });
                    }
                    ground.length = 0;
                }

                // Drift: a drawing much taller or shorter than the rest of its clip, and
                // in a clip that stands still, feet that wander away from under the head.
                for (const n of names) {
                    const frames = clips[n].frames;
                    const talls = frames.map((f) => f.tall).sort((a, b) => a - b);
                    const median = talls[Math.floor(talls.length / 2)];
                    frames.forEach((f, i) => {
                        const share = f.tall / median - 1;
                        if (Math.abs(share) > o.driftHeight)
                            drift.push({ clip: n, frame: i + 1, kind: 'height', share });
                    });
                    if (o.clips[n].walk) continue;
                    const mids = frames.map((f) => (f.feet[0] + f.feet[1]) / 2);
                    const mid = [...mids].sort((a, b) => a - b)[Math.floor(mids.length / 2)];
                    mids.forEach((m, i) => {
                        const share = (m - mid) / height;
                        if (Math.abs(share) > o.driftFeet)
                            drift.push({ clip: n, frame: i + 1, kind: 'feet', share });
                    });
                }

                // The sheet: one row per clip. The drawings laid over one another on
                // their anchor, then side by side, each on the baseline (red) with its
                // anchor (blue), a drawing whose height is off drawn on pink.
                const rowH = 380;
                const pad = 30;
                // Room for the tallest drawing of each clip, so none is cut off at the top.
                const tallest = (n: string) =>
                    Math.max(height, ...clips[n].frames.map((f) => Math.max(f.tall, f.anchor[1])));
                const cellW = (n: string) =>
                    (Math.max(...clips[n].frames.map((f) => f.width)) * (rowH - 2 * pad - 20)) /
                    tallest(n);
                const widths = names.map((n) => cellW(n) * (clips[n].frames.length + 1.5) + 40);
                const sheet = document.createElement('canvas');
                sheet.width = Math.ceil(Math.min(4000, Math.max(800, ...widths)));
                sheet.height = names.length * rowH;
                const g = sheet.getContext('2d') as CanvasRenderingContext2D;
                g.fillStyle = '#efe9dc';
                g.fillRect(0, 0, sheet.width, sheet.height);
                const images = new Map<string, HTMLImageElement[]>();
                for (const n of names) {
                    images.set(
                        n,
                        await Promise.all(
                            clips[n].frames.map(async (f) => {
                                const img = new Image();
                                img.src = f.png;
                                await img.decode();
                                return img;
                            }),
                        ),
                    );
                }
                names.forEach((n, row) => {
                    const frames = clips[n].frames;
                    const imgs = images.get(n) as HTMLImageElement[];
                    const cw = cellW(n);
                    const fit = Math.min(1, (sheet.width - 40) / (cw * (frames.length + 1.5)));
                    const fitted = ((rowH - 2 * pad - 20) / tallest(n)) * fit;
                    // Pixel art on the sheet: whole-number zoom, no smoothing.
                    const k = o.pixel ? Math.max(1, Math.floor(fitted)) : fitted;
                    g.imageSmoothingEnabled = !o.pixel;
                    const base = row * rowH + rowH - pad;
                    const drifting = new Set(
                        drift.filter((d) => d.clip === n).map((d) => d.frame - 1),
                    );
                    const onion = 20 + (cw * fit) / 2 + 10;
                    g.globalAlpha = Math.max(0.12, 1 / frames.length);
                    frames.forEach((f, i) => {
                        g.drawImage(
                            imgs[i],
                            onion - f.anchor[0] * k,
                            base - f.anchor[1] * k,
                            f.width * k,
                            f.height * k,
                        );
                    });
                    g.globalAlpha = 1;
                    frames.forEach((f, i) => {
                        const cx = 20 + cw * fit * (i + 1.5) + 20;
                        if (drifting.has(i)) {
                            g.fillStyle = '#f4c9c4';
                            g.fillRect(cx - (cw * fit) / 2, row * rowH + 30, cw * fit, rowH - 40);
                        }
                        g.drawImage(
                            imgs[i],
                            cx - f.anchor[0] * k,
                            base - f.anchor[1] * k,
                            f.width * k,
                            f.height * k,
                        );
                        g.fillStyle = '#1f5fbf';
                        g.fillRect(cx - 0.5, base - height * k - 6, 1, height * k + 6);
                        g.fillStyle = '#222222';
                        g.font = 'bold 14px sans-serif';
                        g.fillText(String(i + 1), cx - 4, row * rowH + 46);
                    });
                    g.fillStyle = '#d62d20';
                    g.fillRect(10, base, sheet.width - 20, 1.5);
                    g.fillStyle = '#222222';
                    g.font = 'bold 16px sans-serif';
                    g.fillText(n, 12, row * rowH + 22);
                });
                return { clips, height, drift, sheet: sheet.toDataURL('image/png') };
            },
            {
                clips: spec.clips,
                height: spec.height,
                pixel: spec.pixel === true,
                driftHeight: DRIFT_HEIGHT,
                driftFeet: DRIFT_FEET,
                driftNudge: DRIFT_NUDGE,
            },
        );
    } finally {
        await tool.close();
        if (!options.session) await session.close();
    }

    let failed = false;
    for (const [clip, c] of Object.entries(result.clips)) {
        const want = spec.clips[clip].frames;
        const image = spec.clips[clip].image;
        const grid = spec.clips[clip].grid;
        if (c.gridProblem) {
            failed = true;
            invalid(`Clip "${clip}": ${c.gridProblem}. Check grid.`, `$.clips.${clip}.grid`, {
                clip,
            });
        } else if (grid && c.found !== want) {
            failed = true;
            const [first, last] = spec.clips[clip].cells ?? [1, grid[0] * grid[1]];
            invalid(
                `Clip "${clip}": cells ${first} to ${last} of ${image} on a ${grid[0]} by ${grid[1]} grid hold ${c.found} drawings (empty cells do not count), sprite.json asks for ${want}. Check grid, cells and frames.`,
                `$.clips.${clip}.frames`,
                { clip, found: c.found, frames: want },
            );
        } else if (c.found !== want) {
            failed = true;
            invalid(
                `Clip "${clip}": ${image} shows ${c.found} separate drawings, sprite.json asks for ${want}. ${c.found < want ? 'Drawings that touch or nearly touch count as one: lower gap (0 keeps close drawings apart), or leave more room between them on the sheet.' : 'Pieces of one drawing count apart: raise gap so they join, or fix frames.'}`,
                `$.clips.${clip}.frames`,
                { clip, found: c.found, frames: want },
            );
        } else if (c.clipped.length > 0) {
            failed = true;
            invalid(
                `Clip "${clip}": drawings ${c.clipped.map((i) => i + 1).join(', ')} of ${image} reach past their crop (a neighbour too close, or a piece left over).`,
                `$.clips.${clip}.image`,
                { clip, frames: c.clipped.map((i) => i + 1) },
            );
        }
    }
    if (failed || !result.sheet) return rb.finish();

    // Pixel clips are not brought to one height: say when one is off from the first.
    if (spec.pixel) {
        const [first, ...rest] = Object.entries(result.clips);
        for (const [clip, c] of rest) {
            const share = c.measured / first[1].measured - 1;
            if (Math.abs(c.measured - first[1].measured) <= 1) continue;
            rb.add(
                finding(
                    'sprite-drift',
                    `Clip "${clip}" is ${Math.abs(c.measured - first[1].measured)} px ${share > 0 ? 'taller' : 'shorter'} than "${first[0]}": pixel sprites are not rescaled, so the character changes size between the clips.`,
                    {
                        severity: 'warning',
                        element: specFile,
                        detail: { clip, kind: 'clip-height', share },
                    },
                ),
            );
        }
    }

    const messages: Record<Drift['kind'], (d: Drift) => string> = {
        height: (d) =>
            `Clip "${d.clip}": drawing ${d.frame} is ${Math.round(Math.abs(d.share) * 100)}% ${d.share > 0 ? 'taller' : 'shorter'} than the others, so the character grows and shrinks as it plays.`,
        feet: (d) =>
            `Clip "${d.clip}": in drawing ${d.frame} the feet stand ${Math.round(Math.abs(d.share) * 100)}% of the height ${d.share > 0 ? 'ahead of' : 'behind'} where they stand in the others, so the character slides while standing still.`,
        nudge: (d) =>
            `Clip "${d.clip}": drawing ${d.frame} puts the planted foot ${Math.round(Math.abs(d.share) * result.height)} px off from where the walk carries it, so it was shifted to keep that foot where it landed: the head moves ${Math.round(Math.abs(d.share) * 100)}% of the height there.`,
    };
    for (const d of result.drift) {
        rb.add(
            finding('sprite-drift', messages[d.kind](d), {
                severity: 'warning',
                element: specFile,
                detail: { clip: d.clip, frame: d.frame, kind: d.kind, share: d.share },
            }),
        );
    }
    for (const [clip, c] of Object.entries(result.clips)) {
        if (spec.clips[clip].walk && c.advance === null) {
            rb.add(
                finding(
                    'sprite-drift',
                    `Clip "${clip}": the planted foot could not be followed from one drawing to the next, so the stride is a guess from how far apart the feet get and the walk may slide.`,
                    {
                        severity: 'warning',
                        element: specFile,
                        detail: { clip, kind: 'stride', share: 0 },
                    },
                ),
            );
        }
    }

    ws.fresh(ws.path(folder, 'frames'));
    for (const key of Object.keys(sources)) {
        if (key.startsWith(`sprites/${name}/frames/`)) delete sources[key];
    }
    const file: SpriteFile = {
        version: 1,
        height: result.height,
        clips: {},
    };
    const report: Record<string, unknown> = {};
    for (const [clip, c] of Object.entries(result.clips)) {
        const s = spec.clips[clip];
        const from = s.image.split(/[\\/]/).join('/').slice('assets/'.length);
        const frames = c.frames.map((f, i) => {
            const out = path
                .join(folder, 'frames', `${clip}-${String(i + 1).padStart(2, '0')}.png`)
                .split(path.sep)
                .join('/');
            ws.writeFile(ws.path(out), Buffer.from(f.png.split(',')[1], 'base64'));
            sources[out.slice('assets/'.length)] = cutEntry(sources, from);
            return { file: out, width: f.width, height: f.height, anchor: f.anchor };
        });
        // A walk moves its even advance once per drawing: the frames were shifted so the
        // planted foot stays put. Without a planted foot to follow, a guess: two steps,
        // each the widest distance between the feet less the closest.
        const stride = s.walk
            ? Math.round(
                  (typeof c.advance === 'number'
                      ? c.advance * c.frames.length
                      : walkStride(c.frames.map((f) => f.feet))) * 10,
              ) / 10
            : undefined;
        file.clips[clip] = {
            fps: s.fps ?? 8,
            loop: s.loop ?? false,
            ...(stride !== undefined ? { stride } : {}),
            frames,
        };
        report[clip] = {
            frames: frames.length,
            fps: s.fps ?? 8,
            loop: s.loop ?? false,
            scale: spec.pixel ? 1 : result.height / c.measured,
            ...(stride !== undefined ? { stride } : {}),
        };
    }
    const clipsFile = path.join(folder, 'clips.json').split(path.sep).join('/');
    ws.writeFile(ws.path(clipsFile), `${JSON.stringify(file, null, 2)}\n`);
    ws.writeFile(ws.path(SOURCES), `${JSON.stringify(sources, null, 4)}\n`);
    const sheet = path.join('out', 'sprite', `${name}.png`).split(path.sep).join('/');
    ws.writeFile(ws.path(sheet), Buffer.from(result.sheet.split(',')[1], 'base64'));
    rb.report.sprite = { name, height: result.height, clips: report, file: clipsFile, sheet };
    rb.report.artifacts.sheet = path.join(dir, sheet);
    return rb.finish();
}
