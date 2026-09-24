import * as fs from 'fs';
import * as path from 'path';
import { type Finding, progress } from '../cli/report.ts';
import type { Encoder } from './encode.ts';
import type { CompositionPage } from './page.ts';
import { auditFrameText } from './textAudit.ts';
import { sha256 } from './workspace.ts';

export interface CaptureOptions {
    page: CompositionPage;
    encoder: Encoder;
    frameCount: number;
    /** Frames kept as PNG for the PSNR check. */
    sampleFrames: number[];
    /** Frames also captured with the content layer hidden. */
    baselineFrames: number[];
    /** Frames that get the glyph and font audit. */
    textFrames: number[];
    workDir: string;
    seekTimeoutMs?: number;
    /** Test hook: frames never written to the encoder. */
    dropFrames?: number[];
}

export interface CaptureOutput {
    hashes: string[];
    /** sha256 over the per-frame sha256 list. */
    digest: string;
    samples: Map<number, string>;
    baselines: Map<number, string>;
    findings: Finding[];
    completed: boolean;
    captureMs: number;
}

/** Sequence file for the n-th kept frame; ffmpeg reads these back as f_%05d.png. */
export function sequenceFile(dir: string, ordinal: number): string {
    return path.join(dir, `f_${String(ordinal).padStart(5, '0')}.png`);
}

/** The ffmpeg input pattern for a directory written with sequenceFile. */
export function sequencePattern(dir: string): string {
    return path.join(dir, 'f_%05d.png');
}

function ordinals(frames: number[]): Map<number, number> {
    return new Map([...new Set(frames)].sort((a, b) => a - b).map((frame, i) => [frame, i]));
}

/** Seek every frame in order, capture it, hash it and feed it to the encoder. */
export async function captureFrames(options: CaptureOptions): Promise<CaptureOutput> {
    const { page, encoder, frameCount } = options;
    const samplesDir = path.join(options.workDir, 'samples');
    const baselineDir = path.join(options.workDir, 'baseline');
    fs.mkdirSync(samplesDir, { recursive: true });
    fs.mkdirSync(baselineDir, { recursive: true });
    const sampleSet = ordinals(options.sampleFrames);
    const baselineSet = ordinals(options.baselineFrames);
    const textSet = new Set(options.textFrames);
    const dropSet = new Set(options.dropFrames ?? []);
    const hashes: string[] = [];
    const samples = new Map<number, string>();
    const baselines = new Map<number, string>();
    const findings: Finding[] = [];
    const started = Date.now();
    let lastReport = started;
    for (let frame = 0; frame < frameCount; frame++) {
        const failed = await page.seek(frame, options.seekTimeoutMs);
        if (failed) {
            findings.push(failed);
            return {
                hashes,
                digest: '',
                samples,
                baselines,
                findings,
                completed: false,
                captureMs: Date.now() - started,
            };
        }
        const png = await page.capture();
        hashes.push(sha256(png));
        const sampleOrdinal = sampleSet.get(frame);
        if (sampleOrdinal !== undefined) {
            const file = sequenceFile(samplesDir, sampleOrdinal);
            fs.writeFileSync(file, png);
            samples.set(frame, file);
        }
        if (textSet.has(frame)) findings.push(...(await auditFrameText(page, frame)));
        const baselineOrdinal = baselineSet.get(frame);
        if (baselineOrdinal !== undefined) {
            await page.setContent(false);
            const base = await page.capture();
            await page.setContent(true);
            const file = sequenceFile(baselineDir, baselineOrdinal);
            fs.writeFileSync(file, base);
            baselines.set(frame, file);
        }
        if (!dropSet.has(frame)) await encoder.write(png);
        const now = Date.now();
        if (now - lastReport > 2000) {
            lastReport = now;
            const rate = (frame + 1) / ((now - started) / 1000);
            progress(`frame ${frame + 1}/${frameCount} (${rate.toFixed(1)} fps)`);
        }
    }
    return {
        hashes,
        digest: sha256(hashes.join('\n')),
        samples,
        baselines,
        findings,
        completed: true,
        captureMs: Date.now() - started,
    };
}

/** Frames spread evenly over [0, frameCount), `count` of them, distinct and sorted. */
export function evenFrames(frameCount: number, count: number): number[] {
    if (frameCount <= 0) return [];
    if (count >= frameCount) return Array.from({ length: frameCount }, (_, i) => i);
    const out = new Set<number>();
    for (let i = 0; i < count; i++) {
        out.add(Math.round((i * (frameCount - 1)) / Math.max(1, count - 1)));
    }
    return [...out].sort((a, b) => a - b);
}
