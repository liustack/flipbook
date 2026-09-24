// Pixel analysis without an image library: ffmpeg decodes and scales to raw
// gray or RGB bytes, the math happens here.
import { spawn } from 'child_process';
import * as path from 'path';
import { killedBySystem, run, tail, terminate } from './proc.ts';
import type { Workspace } from './workspace.ts';

/** Analysis size for blank, paper-only and freeze checks. */
export const GRAY_W = 320;
export const GRAY_H = 180;
/** Analysis size for PSNR against captured frames. */
export const RGB_W = 480;
export const RGB_H = 270;

/** A pixel differs when its gray level moves by more than this. */
export const DIFF_LEVEL = 16;
/** A frame is "unchanged" when fewer than this share of pixels differ. */
export const CHANGED_SHARE = 0.0005;

/** Empty `dir`, write PNG buffers as f_00000.png ... into it, return the ffmpeg input pattern. */
export function writeSequence(ws: Workspace, dir: string, frames: Buffer[]): string {
    ws.fresh(dir);
    frames.forEach((png, i) => {
        ws.writeFile(path.join(dir, `f_${String(i).padStart(5, '0')}.png`), png);
    });
    return path.join(dir, 'f_%05d.png');
}

function grayFilter(width: number, height: number): string {
    return `scale=${width}:${height}:flags=area,format=gray`;
}

/** Decode an image sequence or a video into gray frames of width x height. */
export async function decodeGray(
    ffmpeg: string,
    input: string[],
    width = GRAY_W,
    height = GRAY_H,
    filterPrefix = '',
): Promise<Uint8Array[]> {
    const vf = `${filterPrefix}${grayFilter(width, height)}`;
    const result = await run(
        ffmpeg,
        [
            '-v',
            'error',
            ...input,
            '-vf',
            vf,
            '-fps_mode',
            'passthrough',
            '-f',
            'rawvideo',
            '-pix_fmt',
            'gray',
            '-',
        ],
        { timeoutMs: 600_000 },
    );
    if (result.code !== 0) throw new Error(`ffmpeg gray decode failed: ${tail(result.stderr)}`);
    return split(result.stdout, width * height);
}

/** Decode to RGB frames of width x height. */
export async function decodeRgb(
    ffmpeg: string,
    input: string[],
    width = RGB_W,
    height = RGB_H,
    filterPrefix = '',
): Promise<Uint8Array[]> {
    const vf = `${filterPrefix}scale=${width}:${height}:flags=area,format=rgb24`;
    const result = await run(
        ffmpeg,
        [
            '-v',
            'error',
            ...input,
            '-vf',
            vf,
            '-fps_mode',
            'passthrough',
            '-f',
            'rawvideo',
            '-pix_fmt',
            'rgb24',
            '-',
        ],
        { timeoutMs: 600_000 },
    );
    if (result.code !== 0) throw new Error(`ffmpeg rgb decode failed: ${tail(result.stderr)}`);
    return split(result.stdout, width * height * 3);
}

function split(bytes: Buffer, size: number): Uint8Array[] {
    const frames: Uint8Array[] = [];
    for (let offset = 0; offset + size <= bytes.length; offset += size) {
        frames.push(new Uint8Array(bytes.buffer, bytes.byteOffset + offset, size));
    }
    return frames;
}

/**
 * Stream every frame of a video as gray bytes without holding the whole
 * decode in memory. Calls `onFrame(index, pixels)` in order.
 */
export function streamGray(
    ffmpeg: string,
    video: string,
    onFrame: (index: number, pixels: Uint8Array) => void,
    width = GRAY_W,
    height = GRAY_H,
): Promise<number> {
    return new Promise((resolve, reject) => {
        const size = width * height;
        const child = spawn(
            ffmpeg,
            [
                '-v',
                'error',
                '-i',
                video,
                '-vf',
                grayFilter(width, height),
                '-fps_mode',
                'passthrough',
                '-f',
                'rawvideo',
                '-pix_fmt',
                'gray',
                '-',
            ],
            { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
        );
        let pending: Buffer = Buffer.alloc(0);
        let index = 0;
        const errors: Buffer[] = [];
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            terminate(child);
        }, 600_000);
        child.stdout.on('data', (chunk: Buffer) => {
            pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
            while (pending.length >= size) {
                onFrame(index++, new Uint8Array(pending.subarray(0, size)));
                pending = pending.subarray(size);
            }
        });
        child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', (code, signal) => {
            clearTimeout(timer);
            const killed = timedOut ? null : killedBySystem(ffmpeg, signal);
            if (killed) {
                reject(killed);
            } else if (code !== 0) {
                reject(
                    new Error(
                        `ffmpeg gray stream failed: ${tail(Buffer.concat(errors).toString('utf-8'))}`,
                    ),
                );
            } else {
                resolve(index);
            }
        });
    });
}

/** Share of pixels whose gray levels differ by more than DIFF_LEVEL. */
export function changedShare(a: Uint8Array, b: Uint8Array): number {
    let changed = 0;
    for (let i = 0; i < a.length; i++) {
        if (Math.abs(a[i] - b[i]) > DIFF_LEVEL) changed++;
    }
    return changed / a.length;
}

/** Share of pixels that stray from the frame's median gray by more than DIFF_LEVEL. */
export function nonFlatShare(frame: Uint8Array): number {
    const histogram = new Uint32Array(256);
    for (const value of frame) histogram[value]++;
    let seen = 0;
    let median = 0;
    for (let level = 0; level < 256; level++) {
        seen += histogram[level];
        if (seen * 2 >= frame.length) {
            median = level;
            break;
        }
    }
    let off = 0;
    for (const value of frame) {
        if (Math.abs(value - median) > DIFF_LEVEL) off++;
    }
    return off / frame.length;
}

export function isFlat(frame: Uint8Array): boolean {
    return nonFlatShare(frame) < CHANGED_SHARE;
}

export function matchesBaseline(frame: Uint8Array, baseline: Uint8Array): boolean {
    return changedShare(frame, baseline) < CHANGED_SHARE;
}

/** PSNR in dB between two byte arrays of equal length; Infinity when identical. */
export function psnr(a: Uint8Array, b: Uint8Array): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const d = a[i] - b[i];
        sum += d * d;
    }
    if (sum === 0) return Number.POSITIVE_INFINITY;
    const mse = sum / a.length;
    return 10 * Math.log10((255 * 255) / mse);
}

/** ffmpeg select expression for a list of frame indices. */
export function selectExpr(frames: number[]): string {
    return `select='${frames.map((n) => `eq(n\\,${n})`).join('+')}',`;
}

/** Extract one frame of a video as PNG. */
export async function extractFrame(
    ffmpeg: string,
    video: string,
    frame: number,
    out: string,
): Promise<void> {
    const result = await run(
        ffmpeg,
        [
            '-v',
            'error',
            '-y',
            '-i',
            video,
            '-vf',
            `select='eq(n\\,${frame})'`,
            '-fps_mode',
            'passthrough',
            '-frames:v',
            '1',
            out,
        ],
        { timeoutMs: 120_000 },
    );
    if (result.code !== 0) throw new Error(`ffmpeg frame extract failed: ${tail(result.stderr)}`);
}

export interface SheetLayout {
    cols: number;
    rows: number;
    tileWidth: number;
    tileHeight: number;
}

/** Grid for `count` tiles of aspect width:height with the long edge near `longEdge`. */
export function sheetLayout(
    count: number,
    width: number,
    height: number,
    longEdge = 1568,
): SheetLayout {
    const aspect = width / height;
    let best: SheetLayout | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let cols = 1; cols <= count; cols++) {
        const rows = Math.ceil(count / cols);
        const sheetAspect = (cols * aspect) / rows;
        const score = Math.abs(Math.log(sheetAspect / (16 / 9))) + (cols * rows - count) * 0.05;
        if (score < bestScore) {
            bestScore = score;
            const wide = cols * aspect >= rows;
            let tileWidth: number;
            let tileHeight: number;
            if (wide) {
                tileWidth = Math.floor((longEdge - 8 * (cols + 1)) / cols);
                tileHeight = Math.round(tileWidth / aspect);
            } else {
                tileHeight = Math.floor((longEdge - 8 * (rows + 1)) / rows);
                tileWidth = Math.round(tileHeight * aspect);
            }
            best = {
                cols,
                rows,
                tileWidth: tileWidth - (tileWidth % 2),
                tileHeight: tileHeight - (tileHeight % 2),
            };
        }
    }
    return best as SheetLayout;
}

/** Tile frames (an image sequence, or selected frames of a video) into one PNG. */
export async function contactSheet(
    ffmpeg: string,
    input: string[],
    layout: SheetLayout,
    out: string,
    filterPrefix = '',
): Promise<void> {
    const vf =
        `${filterPrefix}scale=${layout.tileWidth}:${layout.tileHeight}:flags=lanczos,` +
        `tile=${layout.cols}x${layout.rows}:margin=8:padding=8:color=0x303030`;
    const result = await run(
        ffmpeg,
        [
            '-v',
            'error',
            '-y',
            ...input,
            '-vf',
            vf,
            '-fps_mode',
            'passthrough',
            '-frames:v',
            '1',
            '-update',
            '1',
            out,
        ],
        { timeoutMs: 300_000 },
    );
    if (result.code !== 0) throw new Error(`ffmpeg contact sheet failed: ${tail(result.stderr)}`);
}
