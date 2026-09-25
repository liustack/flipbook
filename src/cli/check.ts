import * as path from 'path';
import { recordCheck } from '../engine/attempts.ts';
import { auditContrast, auditSafeArea } from '../engine/layoutAudit.ts';
import { type ClockConfig, defaultClock } from '../engine/page.ts';
import { decodeGray, isFlat, matchesBaseline, writeSequence } from '../engine/pixels.ts';
import { scanComposition } from '../engine/scan.ts';
import {
    compositionDir,
    indexFinding,
    openPage,
    openSession,
    outputLinksFinding,
    type Session,
} from '../engine/session.ts';
import { auditCueText, auditFrameText, dedupe, findingKey } from '../engine/textAudit.ts';
import { loadTimeline } from '../engine/timeline.ts';
import type { ResolvedTimeline } from '../engine/timelineResolve.ts';
import { compositionHash, sha256, Workspace } from '../engine/workspace.ts';
import {
    type Determinism,
    type Finding,
    finding,
    progress,
    type Report,
    ReportBuilder,
} from './report.ts';

export interface CheckOptions {
    dir: string;
    /** Seed for picking and ordering sample frames. */
    seed?: number;
    /** How many frames to sample. */
    samples?: number;
    seekTimeoutMs?: number;
    readyTimeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    /** Reuse an open session instead of launching one. */
    session?: Session;
    recordAttempts?: boolean;
}

/** Clock origin and random seed shifts for the perturbation pages. */
export const CLOCK_SHIFT = { epochMs: 123_456_789.125, perfOriginMs: 7_777.5 };
export const RANDOM_SHIFT = 0x5bd1e995;

function mulberry(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let x = a;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffle<T>(items: T[], seed: number): T[] {
    const next = mulberry(seed);
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/** `count` distinct frames chosen with a fixed seed, always including the first and last. */
export function sampleFrames(frameCount: number, count: number, seed: number): number[] {
    if (frameCount <= count) return Array.from({ length: frameCount }, (_, i) => i);
    const picked = new Set<number>([0, frameCount - 1]);
    const next = mulberry(seed ^ 0x51ed270b);
    while (picked.size < count) picked.add(Math.floor(next() * frameCount));
    return [...picked].sort((a, b) => a - b);
}

function different<T>(a: T[], b: T[]): boolean {
    return a.some((value, i) => value !== b[i]);
}

/** Frames from a page under a changed clock or seed, and everything that went wrong there. */
interface PerturbedRun {
    shots: Map<number, Buffer>;
    findings: Finding[];
}

async function perturbed(
    session: Session,
    dir: string,
    timeline: ResolvedTimeline,
    clock: ClockConfig,
    frames: number[],
    readyTimeoutMs: number | undefined,
    seekTimeoutMs: number | undefined,
    env: NodeJS.ProcessEnv | undefined,
): Promise<PerturbedRun> {
    const { page, findings } = await openPage(session, {
        dir,
        timeline,
        clock,
        readyTimeoutMs,
        env,
    });
    const run: PerturbedRun = { shots: new Map(), findings: [...findings] };
    try {
        if (findings.length > 0 || page.broken) return run;
        for (const frame of frames) {
            const failed = await page.seek(frame, seekTimeoutMs);
            if (failed) {
                run.findings.push(failed);
                break;
            }
            run.shots.set(frame, await page.capture());
        }
        return run;
    } finally {
        run.findings.push(...page.issues);
        await page.close();
    }
}

/** Validate the timeline, scan the source, and exercise the page for determinism and text problems. */
export async function runCheck(options: CheckOptions): Promise<Report> {
    const dir = compositionDir(options.dir);
    const rb = new ReportBuilder('check', dir);
    const seed = options.seed ?? 1;
    const ws = Workspace.open(dir);
    const unsafe = outputLinksFinding(ws);
    if (unsafe) {
        rb.add(unsafe);
        return rb.finish();
    }
    const evidenceDir = ws.fresh(ws.path('.flipbook', 'evidence', 'check'));
    const scratch = (name: string) => ws.path('.flipbook', 'check', name);
    const finish = () => {
        if (options.recordAttempts !== false) {
            const verdict = recordCheck(dir, [...new Set(rb.report.failures.map((f) => f.code))]);
            rb.report.attempts = verdict.summary;
            rb.report.stop = verdict.stop;
            if (verdict.reason) rb.report.stopReason = verdict.reason;
        }
        return rb.finish();
    };

    const missingIndex = indexFinding(dir);
    if (missingIndex) rb.add(missingIndex);
    const loaded = loadTimeline(dir);
    rb.addAll(loaded.findings);
    rb.addAll(scanComposition(dir));
    const timeline = loaded.resolved;
    if (!timeline || missingIndex) return finish();
    rb.report.composition = {
        dir,
        hash: compositionHash(dir),
        width: timeline.width,
        height: timeline.height,
        fps: timeline.fps,
        frames: timeline.frameCount,
        durationSec: timeline.durationSec,
    };
    rb.addAll(auditCueText(timeline));

    const session = options.session ?? (await openSession(options.env));
    rb.report.environment.chromium = session.chromium;
    rb.report.environment.ffmpeg = session.ffmpeg.version ?? undefined;
    try {
        const dynamic: Finding[] = [];
        progress(`check: loading ${path.join(dir, 'index.html')}`);
        const { page, findings: loadFindings } = await openPage(session, {
            dir,
            timeline,
            readyTimeoutMs: options.readyTimeoutMs,
            env: options.env,
        });
        dynamic.push(...loadFindings);
        const frames = sampleFrames(timeline.frameCount, options.samples ?? 8, seed);
        const first = shuffle(frames, seed);
        let second = shuffle(frames, seed + 1);
        if (!different(first, second)) second = [...first].reverse();
        const shots = new Map<number, Buffer>();
        const baselines = new Map<number, Buffer>();
        const contrastSkipped: { frame: number; element: string; reason: string }[] = [];
        // Each stays skipped unless its pass runs to the end.
        const determinism: Determinism = {
            seekOrder: 'skipped',
            perturbation: 'skipped',
            latePaint: 'skipped',
        };
        let latePaintFailed = false;
        let usable = !page.broken && loadFindings.length === 0;
        try {
            if (usable) {
                const size = await page.stageSize();
                if (size.width > timeline.width + 1 || size.height > timeline.height + 1) {
                    rb.add(
                        finding(
                            'stage-size',
                            `The page is laid out at ${size.width}x${size.height}, the stage is ${timeline.width}x${timeline.height}.`,
                            {
                                severity: 'warning',
                                detail: {
                                    page: size,
                                    stage: { width: timeline.width, height: timeline.height },
                                },
                            },
                        ),
                    );
                }
            }
            // Pass 1: shuffled order; a second capture of the same state catches late painting.
            const passOneRan = usable;
            for (const frame of usable ? first : []) {
                const failed = await page.seek(frame, options.seekTimeoutMs);
                if (failed) {
                    dynamic.push(failed);
                    usable = false;
                    break;
                }
                const a = await page.capture();
                const b = await page.capture();
                shots.set(frame, a);
                if (sha256(a) !== sha256(b)) {
                    const files = [
                        path.join(evidenceDir, `late-paint-f${frame}-a.png`),
                        path.join(evidenceDir, `late-paint-f${frame}-b.png`),
                    ];
                    ws.writeFile(files[0], a);
                    ws.writeFile(files[1], b);
                    latePaintFailed = true;
                    dynamic.push(
                        finding(
                            'late-paint',
                            `Frame ${frame} changed between two captures with no seek in between.`,
                            {
                                time: frame / timeline.fps,
                                frame,
                                evidence: files,
                            },
                        ),
                    );
                }
                await page.setContent(false);
                baselines.set(frame, await page.capture());
                await page.setContent(true);
            }
            if (passOneRan && usable) determinism.latePaint = latePaintFailed ? 'fail' : 'pass';
            // Pass 2: another order must give the same pixels.
            const passTwoRan = usable;
            const orderMismatch: number[] = [];
            for (const frame of usable ? second : []) {
                const failed = await page.seek(frame, options.seekTimeoutMs);
                if (failed) {
                    dynamic.push(failed);
                    usable = false;
                    break;
                }
                const shot = await page.capture();
                const before = shots.get(frame) as Buffer;
                if (sha256(shot) !== sha256(before)) {
                    orderMismatch.push(frame);
                    if (orderMismatch.length === 1) {
                        ws.writeFile(
                            path.join(evidenceDir, `seek-order-f${frame}-first.png`),
                            before,
                        );
                        ws.writeFile(
                            path.join(evidenceDir, `seek-order-f${frame}-second.png`),
                            shot,
                        );
                    }
                }
            }
            if (passTwoRan && usable)
                determinism.seekOrder = orderMismatch.length > 0 ? 'fail' : 'pass';
            if (orderMismatch.length > 0) {
                const frame = orderMismatch[0];
                dynamic.push(
                    finding(
                        'seek-order-dependent',
                        `${orderMismatch.length} of ${frames.length} sampled frames changed when seeked in a different order.`,
                        {
                            time: frame / timeline.fps,
                            frame,
                            evidence: [
                                path.join(evidenceDir, `seek-order-f${frame}-first.png`),
                                path.join(evidenceDir, `seek-order-f${frame}-second.png`),
                            ],
                            detail: {
                                frames: orderMismatch,
                                firstOrder: first,
                                secondOrder: second,
                            },
                        },
                    ),
                );
            }
            // Text at the moments text cues settle (or at sampled frames): glyphs, fonts, safe area, contrast.
            const textFrames = [
                ...new Set(
                    timeline.cues.filter((c) => c.kind === 'text').map((c) => c.settleFrame),
                ),
            ];
            for (const frame of usable
                ? textFrames.length > 0
                    ? textFrames
                    : frames.slice(0, 3)
                : []) {
                const failed = await page.seek(frame, options.seekTimeoutMs);
                if (failed) {
                    dynamic.push(failed);
                    usable = false;
                    break;
                }
                const shown = await page.capture();
                const texts = await page.domTexts();
                const registered = await page.registeredTexts();
                dynamic.push(...(await auditFrameText(page, frame, texts)));
                dynamic.push(...auditSafeArea(timeline, frame, texts, registered));
                for (const entry of registered) {
                    const element = entry.id
                        ? `canvas text "${entry.id}"`
                        : `canvas text "${entry.text.slice(0, 24)}"`;
                    if (!contrastSkipped.some((skip) => skip.element === element)) {
                        contrastSkipped.push({
                            frame,
                            element,
                            reason: 'canvas text is not measured',
                        });
                    }
                }
                dynamic.push(
                    ...(await auditContrast(
                        page,
                        frame,
                        texts,
                        shown,
                        session.ffmpeg.ffmpeg,
                        ws,
                        scratch('contrast'),
                        evidenceDir,
                    )),
                );
            }
            // Calls to forbidden clock and random functions over the whole run so far.
            if (!page.broken) {
                for (const [api, call] of Object.entries(await page.forbiddenCalls())) {
                    dynamic.push(
                        finding(
                            'forbidden-api-call',
                            `The page called ${api} ${call.count} time${call.count === 1 ? '' : 's'}${call.at ? `, first at ${call.at}` : ''}.`,
                            { element: call.at, detail: { api, count: call.count } },
                        ),
                    );
                }
            }
        } finally {
            dynamic.push(...page.issues);
            await page.close();
        }

        // Perturbation: same frames from a fresh page with a shifted clock, then a shifted random seed.
        const probe = first.slice(0, Math.min(3, first.length));
        if (usable && probe.length > 0) {
            const before = dynamic.length;
            const base = defaultClock(timeline);
            const variants: {
                code: 'clock-dependent' | 'random-dependent';
                clock: ClockConfig;
                condition: Record<string, unknown>;
                label: string;
            }[] = [
                {
                    code: 'clock-dependent',
                    clock: {
                        ...base,
                        epochMs: base.epochMs + CLOCK_SHIFT.epochMs,
                        perfOriginMs: base.perfOriginMs + CLOCK_SHIFT.perfOriginMs,
                    },
                    condition: {
                        change: 'clock',
                        epochShiftMs: CLOCK_SHIFT.epochMs,
                        perfShiftMs: CLOCK_SHIFT.perfOriginMs,
                    },
                    label: `the clock moved ${(CLOCK_SHIFT.epochMs / 3_600_000).toFixed(1)} hours later`,
                },
                {
                    code: 'random-dependent',
                    clock: { ...base, randomSeed: (base.randomSeed ^ RANDOM_SHIFT) >>> 0 },
                    condition: {
                        change: 'random seed',
                        randomSeed: (base.randomSeed ^ RANDOM_SHIFT) >>> 0,
                    },
                    label: 'a different random seed underneath',
                },
            ];
            for (const variant of variants) {
                progress(
                    `check: ${variant.code === 'clock-dependent' ? 'shifted clock' : 'shifted random seed'}`,
                );
                const result = await perturbed(
                    session,
                    dir,
                    timeline,
                    variant.clock,
                    probe,
                    options.readyTimeoutMs,
                    options.seekTimeoutMs,
                    options.env,
                );
                // A failure the base page did not have is a failure of this check too.
                const known = new Set(dynamic.map(findingKey));
                for (const item of result.findings) {
                    if (known.has(findingKey(item))) continue;
                    dynamic.push({
                        ...item,
                        message: `${item.message} This happens only with ${variant.label}.`,
                        detail: { ...item.detail, perturbation: variant.condition },
                    });
                }
                const changed = probe.filter(
                    (frame) =>
                        result.shots.has(frame) &&
                        sha256(result.shots.get(frame) as Buffer) !==
                            sha256(shots.get(frame) as Buffer),
                );
                if (changed.length > 0) {
                    const frame = changed[0];
                    const files = [
                        path.join(evidenceDir, `${variant.code}-f${frame}-base.png`),
                        path.join(evidenceDir, `${variant.code}-f${frame}-shifted.png`),
                    ];
                    ws.writeFile(files[0], shots.get(frame) as Buffer);
                    ws.writeFile(files[1], result.shots.get(frame) as Buffer);
                    dynamic.push(
                        finding(
                            variant.code,
                            variant.code === 'clock-dependent'
                                ? `Frame ${frame} changed when the clock origin moved: the page reads Date or performance.now.`
                                : `Frame ${frame} changed when the random seed changed: the page uses Math.random or crypto.`,
                            {
                                time: frame / timeline.fps,
                                frame,
                                evidence: files,
                                detail: { frames: changed, perturbation: variant.condition },
                            },
                        ),
                    );
                }
            }
            determinism.perturbation = dynamic.length > before ? 'fail' : 'pass';
        }

        // Blank and paper-only samples.
        if (shots.size > 0) {
            const order = [...shots.keys()].sort((a, b) => a - b);
            const content = await decodeGray(session.ffmpeg.ffmpeg, [
                '-i',
                writeSequence(
                    ws,
                    scratch('frames'),
                    order.map((f) => shots.get(f) as Buffer),
                ),
            ]);
            const paper = await decodeGray(session.ffmpeg.ffmpeg, [
                '-i',
                writeSequence(
                    ws,
                    scratch('baseline'),
                    order.map((f) => baselines.get(f) as Buffer),
                ),
            ]);
            const blank: number[] = [];
            const paperOnly: number[] = [];
            order.forEach((frame, i) => {
                if (isFlat(content[i])) blank.push(frame);
                else if (matchesBaseline(content[i], paper[i])) paperOnly.push(frame);
            });
            const empty = blank.length + paperOnly.length;
            if (empty > 0) {
                const all = empty === order.length;
                const code = blank.length >= paperOnly.length ? 'blank-frame' : 'paper-only';
                const frame = (code === 'blank-frame' ? blank : paperOnly)[0];
                const evidence = path.join(evidenceDir, `${code}-f${frame}.png`);
                ws.writeFile(evidence, shots.get(frame) as Buffer);
                dynamic.push(
                    finding(
                        code,
                        all
                            ? `All ${order.length} sampled frames are ${code === 'blank-frame' ? 'flat and empty' : 'paper only'}.`
                            : `${empty} of ${order.length} sampled frames show no content (at ${[
                                  ...blank,
                                  ...paperOnly,
                              ]
                                  .sort((a, b) => a - b)
                                  .map((f) => (f / timeline.fps).toFixed(2))
                                  .join(', ')} s).`,
                        {
                            severity: all ? 'error' : 'warning',
                            time: frame / timeline.fps,
                            frame,
                            evidence: [evidence],
                            detail: { blank, paperOnly },
                        },
                    ),
                );
            }
        }
        rb.addAll(dedupe(dynamic));
        rb.report.check = {
            seed,
            frames,
            firstOrder: first,
            secondOrder: second,
            evidenceDir,
            contrastSkipped,
            determinism,
        };
    } finally {
        if (!options.session) await session.close();
    }
    return finish();
}
