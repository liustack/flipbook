import { UsageError } from '../cli/report.ts';
import type { ResolvedTimeline } from './timelineResolve.ts';

/** What --size asked for: an aspect ratio or exact CSS pixels. */
export type SizeSpec =
    | { kind: 'ratio'; w: number; h: number; raw: string }
    | { kind: 'pixels'; width: number; height: number; raw: string };

/** Largest stage and output edges, the same limits as timeline.json. */
export const MAX_WIDTH = 7680;
export const MAX_HEIGHT = 4320;
export const MIN_EDGE = 16;
/** Largest output in pixels (8K UHD). */
export const MAX_OUTPUT_PIXELS = 7680 * 4320;

const RATIO = /^(\d{1,2}):(\d{1,2})$/;
const PIXELS = /^(\d{2,5})x(\d{2,5})$/i;

/** Parse --size: "9:16", "1:1", "4:5" or "1080x1920". */
export function parseSize(raw: string): SizeSpec {
    const text = raw.trim();
    const ratio = RATIO.exec(text);
    if (ratio) {
        const w = Number(ratio[1]);
        const h = Number(ratio[2]);
        if (w > 0 && h > 0) return { kind: 'ratio', w, h, raw: text };
    }
    const pixels = PIXELS.exec(text);
    if (pixels) {
        return {
            kind: 'pixels',
            width: Number(pixels[1]),
            height: Number(pixels[2]),
            raw: text,
        };
    }
    throw new UsageError(
        `Invalid --size "${raw}". Use a ratio like 9:16, 1:1 or 4:5, or pixels like 1080x1920.`,
    );
}

function even(n: number): number {
    return Math.round(n / 2) * 2;
}

/**
 * The stage size --size gives for a timeline of base width x height. A ratio
 * keeps the short edge: 1920x1080 at 9:16 is 1080x1920, at 1:1 1080x1080.
 */
export function stageSize(
    spec: SizeSpec,
    base: { width: number; height: number },
): { width: number; height: number } {
    let width: number;
    let height: number;
    if (spec.kind === 'pixels') {
        width = spec.width;
        height = spec.height;
    } else {
        const short = Math.min(base.width, base.height);
        if (spec.w >= spec.h) {
            height = short;
            width = even((short * spec.w) / spec.h);
        } else {
            width = short;
            height = even((short * spec.h) / spec.w);
        }
    }
    if (width % 2 !== 0 || height % 2 !== 0) {
        throw new UsageError(
            `--size ${spec.raw} gives ${width}x${height}. Both edges must be even (yuv420p).`,
        );
    }
    if (width < MIN_EDGE || height < MIN_EDGE || width > MAX_WIDTH || height > MAX_HEIGHT) {
        throw new UsageError(
            `--size ${spec.raw} gives ${width}x${height}. Width must be ${MIN_EDGE} to ${MAX_WIDTH}, height ${MIN_EDGE} to ${MAX_HEIGHT}.`,
        );
    }
    return { width, height };
}

/** The timeline with its stage replaced by --size; unchanged without it. */
export function applySize(
    timeline: ResolvedTimeline,
    spec: SizeSpec | undefined,
): ResolvedTimeline {
    if (!spec) return timeline;
    const { width, height } = stageSize(spec, timeline);
    return { ...timeline, width, height };
}

/** Output pixels for a stage at --scale; refuses sizes yuv420p or the encoder cannot take. */
export function outputSize(
    stage: { width: number; height: number },
    scale: number,
): { width: number; height: number } {
    const width = stage.width * scale;
    const height = stage.height * scale;
    if (!Number.isInteger(width) || !Number.isInteger(height)) {
        throw new UsageError(
            `--scale ${scale} gives ${width}x${height} for a ${stage.width}x${stage.height} stage. Pick a scale that gives whole pixels.`,
        );
    }
    if (width % 2 !== 0 || height % 2 !== 0) {
        throw new UsageError(
            `--scale ${scale} gives ${width}x${height}. Both edges must be even (yuv420p).`,
        );
    }
    if (width * height > MAX_OUTPUT_PIXELS || Math.max(width, height) > MAX_WIDTH) {
        throw new UsageError(
            `--scale ${scale} gives ${width}x${height}, larger than ${MAX_WIDTH}x${MAX_HEIGHT}.`,
        );
    }
    return { width, height };
}
