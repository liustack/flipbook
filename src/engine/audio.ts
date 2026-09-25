// Sound for a composition: synthesize the stems in a blank browser page,
// write them as WAV under .flipbook/audio/, mix them (or the user's music)
// under the picture with ffmpeg, and measure the result.
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { Page } from 'playwright-core';
import type { EnvError } from '../cli/report.ts';
import { runtimeFile } from '../paths.ts';
import { buildScore, SAMPLE_RATE, type Score } from './audioScore.ts';
import { type FfmpegFeatures, requireFfmpeg, VIDEO_FEATURES } from './ffmpeg.ts';
import { ORIGIN } from './page.ts';
import { run, tail } from './proc.ts';
import { RendererWatch } from './rendererWatch.ts';
import type { Session } from './session.ts';
import type { ResolvedTimeline } from './timelineResolve.ts';
import type { Workspace } from './workspace.ts';

/** Loudness target for any soundtrack with music, in LUFS. */
export const TARGET_LUFS = -14;
/** Allowed distance from the target, in LU. */
export const LUFS_TOLERANCE = 1;
/** Highest true peak allowed in the delivered AAC track, in dBTP. */
export const TRUE_PEAK_MAX_DBTP = -1;
/** Limiter ceiling at 4x oversampling, in dBFS. AAC adds overshoot on top. */
export const LIMIT_DB = -3;
/** Effect peaks sit this far above the music's integrated loudness before normalization. */
export const SFX_OVER_MUSIC_DB = 12;
/** Peak of an effects-only track, in dBFS. */
export const SFX_ONLY_PEAK_DB = -4;
/** ffmpeg features the soundtrack needs on top of the video ones. */
export const AUDIO_FEATURES: (keyof FfmpegFeatures)[] = ['amixNormalize', 'loudnorm', 'ebur128'];

const AUDIO_SCHEMA = 'flipbook.audio/1';
const AUDIO_PAGE = `${ORIGIN}/__flipbook/audio.html`;
const PAGE_HTML =
    '<!doctype html><meta charset="utf-8"><title>flipbook audio</title>' +
    '<script type="module">import * as audio from "/__flipbook/audio.js"; window.__flipbookAudio = audio;</script>';
const SYNTH_TIMEOUT_MS = 300_000;

/** Music is synthesized: a preset or a written score. */
export function synthesizesMusic(tl: ResolvedTimeline): boolean {
    return tl.audio.mode === 'preset' || tl.audio.mode === 'score';
}

export function hasMusic(tl: ResolvedTimeline): boolean {
    return synthesizesMusic(tl) || tl.audio.mode === 'file';
}

export function hasEffects(tl: ResolvedTimeline): boolean {
    return tl.cues.some((cue) => cue.kind === 'sfx');
}

/** Something to synthesize: preset or score music, or built-in effect cues. Effects from files are not synthesized. */
export function needsSynthesis(tl: ResolvedTimeline): boolean {
    return (
        synthesizesMusic(tl) || tl.cues.some((cue) => cue.kind === 'sfx' && cue.sfx !== undefined)
    );
}

/** The video gets an audio track. */
export function needsSoundtrack(tl: ResolvedTimeline): boolean {
    return hasMusic(tl) || hasEffects(tl);
}

export interface StemCue {
    id: string;
    sfx: string;
    frame: number;
    /** The cue frame on the 48 kHz grid. */
    target: number;
    /** The loudest sample of the effects stem near the cue. */
    peakSample: number;
}

export interface StemFile {
    file: string;
    sha256: string;
    peakDb: number;
}

export interface StemSet {
    schema: typeof AUDIO_SCHEMA;
    /** Hash of the score, the audio runtime and the browser build. */
    key: string;
    sampleRate: number;
    length: number;
    durationSec: number;
    preset: string | null;
    keyName: string;
    progression: number;
    music: StemFile | null;
    sfx: (StemFile & { cues: StemCue[] }) | null;
    synthMs: number;
    reused: boolean;
}

interface PageResult {
    sampleRate: number;
    length: number;
    chunkFrames: number;
    stems: Partial<Record<'music' | 'sfx', { chunks: number; peak: number }>>;
    sfx: { id: string; name: string; target: number; peakSample: number }[];
}

function audioDir(ws: Workspace): string {
    return ws.path('.flipbook', 'audio');
}

function sha256File(file: string): string {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function cacheKey(score: Score, session: Session): string {
    return createHash('sha256')
        .update(JSON.stringify(score))
        .update('\0')
        .update(fs.readFileSync(runtimeFile('audio.js')))
        .update('\0')
        .update(`${session.chromium.version}/${session.chromium.revision}`)
        .digest('hex');
}

/** 44-byte-plus header of a stereo IEEE float WAV with `frames` frames. */
export function wavHeader(frames: number, sampleRate: number): Buffer {
    const dataBytes = frames * 2 * 4;
    const header = Buffer.alloc(58);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(50 + dataBytes, 4);
    header.write('WAVE', 8, 'ascii');
    header.write('fmt ', 12, 'ascii');
    header.writeUInt32LE(18, 16);
    header.writeUInt16LE(3, 20);
    header.writeUInt16LE(2, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 8, 28);
    header.writeUInt16LE(8, 32);
    header.writeUInt16LE(32, 34);
    header.writeUInt16LE(0, 36);
    header.write('fact', 38, 'ascii');
    header.writeUInt32LE(4, 42);
    header.writeUInt32LE(frames, 46);
    header.write('data', 50, 'ascii');
    header.writeUInt32LE(dataBytes, 54);
    return header;
}

function readMeta(ws: Workspace): StemSet | null {
    try {
        const text = ws.readText(path.join(audioDir(ws), 'audio.json'));
        if (text === null) return null;
        const meta = JSON.parse(text) as StemSet;
        if (meta.schema !== AUDIO_SCHEMA) return null;
        for (const stem of [meta.music, meta.sfx]) {
            if (!stem) continue;
            stem.file = path.join(audioDir(ws), path.basename(stem.file));
            if (!fs.existsSync(stem.file) || sha256File(stem.file) !== stem.sha256) return null;
        }
        return meta;
    } catch {
        return null;
    }
}

async function openAudioPage(session: Session): Promise<{
    page: Page;
    /** resource-exhausted when the system took the page's renderer or browser away. */
    systemExit(): Promise<EnvError | null>;
    close(): Promise<void>;
}> {
    const { browser, dispose } = await session.browserForPage();
    const watch = await RendererWatch.start(browser);
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    await context.route('**/*', async (route) => {
        const url = route.request().url();
        if (url === AUDIO_PAGE) {
            await route.fulfill({
                status: 200,
                contentType: 'text/html; charset=utf-8',
                body: PAGE_HTML,
            });
        } else if (url === `${ORIGIN}/__flipbook/audio.js`) {
            await route.fulfill({
                path: runtimeFile('audio.js'),
                contentType: 'text/javascript; charset=utf-8',
            });
        } else {
            await route.abort('blockedbyclient');
        }
    });
    const page = await context.newPage();
    let crashed = false;
    page.on('crash', () => {
        crashed = true;
    });
    await watch.follow(await context.newCDPSession(page));
    return {
        page,
        systemExit: () => watch.systemExit(crashed),
        async close() {
            await watch.stop();
            await context.close().catch(() => undefined);
            await dispose();
        },
    };
}

/** Render the score in the page and stream each stem into a float WAV in `dir`. */
async function renderInPage(
    page: Page,
    score: Score,
    ws: Workspace,
    dir: string,
): Promise<{
    result: PageResult;
    files: Partial<Record<'music' | 'sfx', { file: string; sha256: string }>>;
}> {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(AUDIO_PAGE, { waitUntil: 'load' });
    await page.waitForFunction(
        () => (window as unknown as { __flipbookAudio?: unknown }).__flipbookAudio !== undefined,
        undefined,
        { timeout: 30_000 },
    );
    let timer: NodeJS.Timeout | undefined;
    const result = await Promise.race([
        page.evaluate(
            (s) =>
                (
                    window as unknown as {
                        __flipbookAudio: { render(score: unknown): Promise<unknown> };
                    }
                ).__flipbookAudio.render(s),
            score as unknown as Record<string, unknown>,
        ),
        new Promise<never>((_, reject) => {
            timer = setTimeout(
                () => reject(new Error(`audio synthesis took longer than ${SYNTH_TIMEOUT_MS} ms`)),
                SYNTH_TIMEOUT_MS,
            );
        }),
    ])
        .catch((error: Error) => {
            throw new Error(
                `audio synthesis failed: ${error.message.split('\n')[0]}${errors.length ? ` (${errors.join('; ')})` : ''}`,
            );
        })
        .finally(() => clearTimeout(timer));
    const rendered = result as PageResult;
    const files: Partial<Record<'music' | 'sfx', { file: string; sha256: string }>> = {};
    for (const stem of ['music', 'sfx'] as const) {
        const info = rendered.stems[stem];
        if (!info) continue;
        const hash = createHash('sha256');
        const chunks = info.chunks;
        async function* pieces(): AsyncGenerator<Buffer> {
            const header = wavHeader(rendered.length, rendered.sampleRate);
            hash.update(header);
            yield header;
            for (let i = 0; i < chunks; i++) {
                const b64 = await page.evaluate(
                    ({ stem, i }) =>
                        (
                            window as unknown as {
                                __flipbookAudio: { chunk(stem: string, index: number): string };
                            }
                        ).__flipbookAudio.chunk(stem, i),
                    { stem, i },
                );
                const bytes = Buffer.from(b64, 'base64');
                hash.update(bytes);
                yield bytes;
            }
        }
        const target = await ws.writeFileFrom(path.join(dir, `${stem}.wav`), pieces());
        files[stem] = { file: target, sha256: hash.digest('hex') };
    }
    await page.evaluate(() =>
        (window as unknown as { __flipbookAudio: { release(): void } }).__flipbookAudio.release(),
    );
    return { result: rendered, files };
}

function toDb(value: number): number {
    return value > 0 ? Number((20 * Math.log10(value)).toFixed(2)) : Number.NEGATIVE_INFINITY;
}

export interface SynthesizeOptions {
    /** Render again even when the cached stems match. */
    force?: boolean;
}

/**
 * Synthesize the preset or score music and the effect cues into .flipbook/audio/.
 * Stems whose score, runtime and browser build did not change are reused.
 */
export async function synthesize(
    session: Session,
    tl: ResolvedTimeline,
    ws: Workspace,
    options: SynthesizeOptions = {},
): Promise<StemSet> {
    const score = buildScore(tl);
    const key = cacheKey(score, session);
    const out = ws.ensureDir(audioDir(ws));
    if (!options.force) {
        const cached = readMeta(ws);
        if (cached && cached.key === key) return { ...cached, reused: true };
    }
    for (const name of ['music.wav', 'sfx.wav', 'audio.json', 'score.json']) {
        ws.remove(path.join(out, name));
    }
    const started = Date.now();
    const { page, systemExit, close } = await openAudioPage(session);
    let rendered: Awaited<ReturnType<typeof renderInPage>>;
    try {
        rendered = await renderInPage(page, score, ws, out);
    } catch (error) {
        throw (await systemExit()) ?? error;
    } finally {
        await close();
    }
    const { result, files } = rendered;
    const stems: StemSet = {
        schema: AUDIO_SCHEMA,
        key,
        sampleRate: result.sampleRate,
        length: result.length,
        durationSec: result.length / result.sampleRate,
        preset: score.preset,
        keyName: score.key.name,
        progression: score.progression,
        music:
            files.music && result.stems.music
                ? { ...files.music, peakDb: toDb(result.stems.music.peak) }
                : null,
        sfx:
            files.sfx && result.stems.sfx
                ? {
                      ...files.sfx,
                      peakDb: toDb(result.stems.sfx.peak),
                      cues: result.sfx.map((placed) => ({
                          id: placed.id,
                          sfx: placed.name,
                          frame: score.sfx.find((s) => s.id === placed.id)?.frame ?? 0,
                          target: placed.target,
                          peakSample: placed.peakSample,
                      })),
                  }
                : null,
        synthMs: Date.now() - started,
        reused: false,
    };
    ws.writeFile(path.join(out, 'score.json'), `${JSON.stringify(score, null, 2)}\n`);
    ws.writeFile(path.join(out, 'audio.json'), `${JSON.stringify(stems, null, 2)}\n`);
    return stems;
}

// --- mixing ---------------------------------------------------------------

export interface MixOptions {
    ffmpeg: string;
    /** The silent picture. */
    video: string;
    output: string;
    durationSec: number;
    /**
     * The music bed: the preset stem, or a file from the composition cut at
     * `offsetSec`, faded in over `fadeInSec` (default none) and out over
     * `fadeOutSec` (default one second, a quarter of a shorter video).
     */
    music?: {
        file: string;
        offsetSec: number;
        user: boolean;
        fadeInSec?: number;
        fadeOutSec?: number;
    };
    /** The effects stem and its sample peak. */
    sfx?: { file: string; peakDb: number };
    /** Test hook: move the effects this many seconds later. */
    shiftSfxSec?: number;
    /**
     * Reserved for narration: the bed would duck under it through
     * sidechaincompress. Not implemented; passing it throws.
     */
    voice?: { file: string };
}

export interface MixResult {
    /** Integrated loudness of the music alone, before any gain. */
    musicLufs: number | null;
    /** Integrated loudness of the mix before normalization. */
    mixLufs: number | null;
    /** Gain applied to the effects stem. */
    sfxGainDb: number | null;
    /** Gain applied to the whole mix before the limiter. */
    gainDb: number;
    limitDb: number;
}

const FMT = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';

function num(value: number): string {
    return Number(value.toFixed(6)).toString();
}

/** Filter lines that bring the inputs to [mix], with audio inputs starting at `first`. */
function mixGraph(
    o: MixOptions,
    first: number,
    gains: { music: number; sfx: number },
    include: { music: boolean; sfx: boolean },
): string[] {
    const d = num(o.durationSec);
    const lines: string[] = [];
    const labels: string[] = [];
    let index = first;
    if (o.music && include.music) {
        const parts = [`[${index}:a]`];
        if (o.music.user) {
            const fadeIn = Math.min(o.music.fadeInSec ?? 0, o.durationSec);
            const fadeOut = Math.min(
                o.music.fadeOutSec ?? Math.min(1, o.durationSec / 4),
                o.durationSec,
            );
            parts.push(
                `atrim=start=${num(o.music.offsetSec)},asetpts=PTS-STARTPTS,aresample=48000,${FMT},apad,atrim=0:${d},` +
                    (fadeIn > 0 ? `afade=t=in:st=0:d=${num(fadeIn)},` : '') +
                    (fadeOut > 0
                        ? `afade=t=out:st=${num(Math.max(0, o.durationSec - fadeOut))}:d=${num(fadeOut)},`
                        : ''),
            );
        } else {
            parts.push(`${FMT},apad,atrim=0:${d},`);
        }
        parts.push(`volume=${num(gains.music)}dB[m]`);
        lines.push(parts.join(''));
        labels.push('[m]');
        index++;
    } else if (o.music) {
        index++;
    }
    if (o.sfx && include.sfx) {
        const shift = o.shiftSfxSec ? `adelay=${Math.round(o.shiftSfxSec * 1000)}:all=1,` : '';
        lines.push(`[${index}:a]${FMT},${shift}apad,atrim=0:${d},volume=${num(gains.sfx)}dB[s]`);
        labels.push('[s]');
    }
    if (labels.length === 2)
        lines.push(`${labels.join('')}amix=inputs=2:duration=first:normalize=0[mix]`);
    else lines.push(`${labels[0]}anull[mix]`);
    return lines;
}

/**
 * Demuxers accepted for the user's music. Playlist and concat formats, which
 * name other files, are left out, and the file may only be read as a local file.
 */
export const SOUNDTRACK_FORMATS = [
    'wav',
    'w64',
    'mp3',
    'flac',
    'ogg',
    'aac',
    'mov',
    'aiff',
    'matroska',
];

function audioInputs(o: MixOptions): string[] {
    const args: string[] = [];
    if (o.music?.user) {
        args.push('-protocol_whitelist', 'file', '-format_whitelist', SOUNDTRACK_FORMATS.join(','));
    }
    if (o.music) args.push('-i', o.music.file);
    if (o.sfx) args.push('-i', o.sfx.file);
    return args;
}

/** Gain, then a true-peak limiter at 4x oversampling, back at 48 kHz and cut to length. */
function limiterChain(gainDb: number, durationSec: number): string {
    const limit = 10 ** (LIMIT_DB / 20);
    return (
        `volume=${num(gainDb)}dB,aresample=192000,` +
        `alimiter=limit=${num(limit)}:attack=1:release=60:level=false:latency=1,` +
        `aresample=48000,atrim=0:${num(durationSec)}`
    );
}

/**
 * A measuring pass over part of the mix, optionally after `post`: integrated
 * loudness in LUFS from the ebur128 meter (the same meter the acceptance
 * check reads), or null for silence.
 */
async function measureMix(
    o: MixOptions,
    gains: { music: number; sfx: number },
    include: { music: boolean; sfx: boolean },
    post?: string,
): Promise<number | null> {
    const graph = [
        ...mixGraph(o, 0, gains, include),
        `[mix]${post ? `${post},` : ''}ebur128=framelog=quiet[out]`,
    ].join(';');
    const result = await run(
        o.ffmpeg,
        [
            '-hide_banner',
            '-nostats',
            ...audioInputs(o),
            '-filter_complex',
            graph,
            '-map',
            '[out]',
            '-f',
            'null',
            '-',
        ],
        { timeoutMs: 600_000 },
    );
    if (result.code !== 0)
        throw new Error(`ffmpeg could not measure the mix: ${tail(result.stderr)}`);
    return parseR128(result.stderr).integrated;
}

/**
 * The music branch of the mix on its own (before the gain and the limiter),
 * as mono float samples at `rate`, or null without music.
 */
export async function musicReference(o: MixOptions, rate: number): Promise<Float32Array | null> {
    if (!o.music) return null;
    const graph = mixGraph(o, 0, { music: 0, sfx: 0 }, { music: true, sfx: false }).join(';');
    const result = await run(
        o.ffmpeg,
        [
            '-v',
            'error',
            ...audioInputs(o),
            '-filter_complex',
            graph,
            '-map',
            '[mix]',
            '-ac',
            '1',
            '-ar',
            String(rate),
            '-f',
            'f32le',
            '-',
        ],
        { timeoutMs: 600_000 },
    );
    if (result.code !== 0)
        throw new Error(`ffmpeg could not render the music reference: ${tail(result.stderr)}`);
    const bytes = result.stdout;
    const copy = new Uint8Array(bytes.length - (bytes.length % 4));
    copy.set(bytes.subarray(0, copy.length));
    return new Float32Array(copy.buffer);
}

/**
 * Mix the music bed and the effects under the picture: amix without
 * normalization, a gain to TARGET_LUFS measured in two passes (the second
 * one through the limiter, to take back what the limiter shaves off), a
 * true-peak limiter at 4x oversampling, AAC 48 kHz. Effects alone are set by
 * their peak instead of their loudness.
 */
export async function mixSoundtrack(o: MixOptions): Promise<MixResult> {
    if (o.voice) throw new Error('narration ducking is reserved and not implemented');
    if (!o.music && !o.sfx) throw new Error('nothing to mix');
    let musicLufs: number | null = null;
    let sfxGain = 0;
    if (o.music && o.sfx) {
        musicLufs = await measureMix(o, { music: 0, sfx: 0 }, { music: true, sfx: false });
        sfxGain = (musicLufs ?? TARGET_LUFS) + SFX_OVER_MUSIC_DB - o.sfx.peakDb;
    } else if (o.sfx) {
        sfxGain = SFX_ONLY_PEAK_DB - o.sfx.peakDb;
    }
    const gains = { music: 0, sfx: sfxGain };
    let mixLufs: number | null = null;
    let gainDb = 0;
    const all = { music: true, sfx: true };
    if (o.music) {
        mixLufs = await measureMix(o, gains, all);
        if (mixLufs !== null) {
            gainDb = TARGET_LUFS - mixLufs;
            const limited = await measureMix(o, gains, all, limiterChain(gainDb, o.durationSec));
            if (limited !== null) gainDb += TARGET_LUFS - limited;
        }
    }
    const graph = [
        ...mixGraph(o, 1, gains, all),
        `[mix]${limiterChain(gainDb, o.durationSec)}[a]`,
    ].join(';');
    const result = await run(
        o.ffmpeg,
        [
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-i',
            o.video,
            ...audioInputs(o),
            '-filter_complex',
            graph,
            '-map',
            '0:v',
            '-map',
            '[a]',
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-ar',
            '48000',
            '-ac',
            '2',
            '-map_metadata',
            '0',
            '-movflags',
            '+faststart',
            o.output,
        ],
        { timeoutMs: 600_000 },
    );
    if (result.code !== 0)
        throw new Error(`ffmpeg could not add the soundtrack: ${tail(result.stderr)}`);
    return {
        musicLufs,
        mixLufs,
        sfxGainDb: o.sfx ? Number(sfxGain.toFixed(2)) : null,
        gainDb: Number(gainDb.toFixed(2)),
        limitDb: LIMIT_DB,
    };
}

/** ffmpeg with the video and audio features, or an EnvError (exit 78). */
export function requireAudioFfmpeg(env: NodeJS.ProcessEnv = process.env) {
    return requireFfmpeg([...VIDEO_FEATURES, ...AUDIO_FEATURES], env);
}

// --- measuring ------------------------------------------------------------

export interface Loudness {
    /** Integrated loudness in LUFS, null when the track is too short or silent. */
    integrated: number | null;
    /** True peak in dBTP, null for silence. */
    truePeak: number | null;
}

/** EBU R128 integrated loudness and true peak of the first audio stream. */
export async function measureLoudness(ffmpeg: string, file: string): Promise<Loudness> {
    const result = await run(
        ffmpeg,
        [
            '-hide_banner',
            '-nostats',
            '-i',
            file,
            '-map',
            '0:a:0',
            '-af',
            'ebur128=peak=true:framelog=quiet',
            '-f',
            'null',
            '-',
        ],
        { timeoutMs: 600_000 },
    );
    if (result.code !== 0) throw new Error(`ffmpeg ebur128 failed: ${tail(result.stderr)}`);
    return parseR128(result.stderr);
}

/** The Summary block ebur128 prints at the end of stderr. */
export function parseR128(stderr: string): Loudness {
    const at = stderr.lastIndexOf('Summary:');
    if (at < 0) throw new Error(`ebur128 printed no summary: ${tail(stderr)}`);
    const summary = stderr.slice(at);
    const integrated = Number(/I:\s+(-?[\d.]+|-inf)\s+LUFS/.exec(summary)?.[1]);
    const truePeak = Number(/True peak:\s+Peak:\s+(-?[\d.]+|-inf)\s+dBFS/.exec(summary)?.[1]);
    return {
        integrated: Number.isFinite(integrated) && integrated > -70 ? integrated : null,
        truePeak: Number.isFinite(truePeak) ? truePeak : null,
    };
}

/** The first audio stream as mono float samples at `rate`. */
export async function decodeMono(
    ffmpeg: string,
    file: string,
    rate: number,
): Promise<Float32Array> {
    const result = await run(
        ffmpeg,
        [
            '-v',
            'error',
            '-i',
            file,
            '-map',
            '0:a:0',
            '-ac',
            '1',
            '-ar',
            String(rate),
            '-f',
            'f32le',
            '-',
        ],
        { timeoutMs: 600_000 },
    );
    if (result.code !== 0) throw new Error(`ffmpeg audio decode failed: ${tail(result.stderr)}`);
    const bytes = result.stdout;
    const copy = new Uint8Array(bytes.length - (bytes.length % 4));
    copy.set(bytes.subarray(0, copy.length));
    return new Float32Array(copy.buffer);
}

/** Analysis rate for finding effects in the mix. */
export const ANALYSIS_RATE = 8000;
/**
 * Correlation below which an effect counts as not found. Unrelated audio of
 * this window length correlates around 0.01.
 */
export const MIN_MATCH = 0.12;

export interface CueMeasure {
    id: string;
    sfx: string;
    frame: number;
    /** When the cue frame is shown, in seconds. */
    expectedSec: number;
    /** Where the effect peaks in the delivered track, or null when it was not found. */
    measuredSec: number | null;
    offsetMs: number | null;
    /** Normalized cross-correlation of the effect against the delivered track. */
    match: number;
}

/**
 * Take the music out of the delivered track: find where the music reference
 * sits in it (lag within ±0.25 s, matched over eight half-second stretches)
 * and how loud (least squares), and subtract it. What is left is the
 * effects, plus what the limiter and the encoder changed. Music of its own
 * can hold the same bell or pluck as an effect, which would otherwise match
 * the effect at the wrong time.
 */
export function removeMusic(
    mix: Float32Array,
    reference: Float32Array,
    rate: number,
): Float32Array {
    const length = Math.min(mix.length, reference.length);
    const maxLag = Math.round(0.25 * rate);
    const span = Math.round(0.5 * rate);
    const room = length - 2 * maxLag - span;
    if (room <= 0) return mix;
    const lags = 2 * maxLag + 1;
    const dot = new Float64Array(lags);
    const energy = new Float64Array(lags);
    let refEnergy = 0;
    for (let w = 0; w < 8; w++) {
        const a = maxLag + Math.round((room * w) / 7);
        for (let k = a; k < a + span; k++) refEnergy += reference[k] * reference[k];
        for (let i = 0; i < lags; i++) {
            const lag = i - maxLag;
            let d = 0;
            let e = 0;
            for (let k = a; k < a + span; k++) {
                const m = mix[k + lag];
                d += reference[k] * m;
                e += m * m;
            }
            dot[i] += d;
            energy[i] += e;
        }
    }
    if (refEnergy <= 1e-12) return mix;
    let best = -1;
    let lag = 0;
    for (let i = 0; i < lags; i++) {
        if (energy[i] <= 1e-12) continue;
        const score = dot[i] / Math.sqrt(refEnergy * energy[i]);
        if (score > best) {
            best = score;
            lag = i - maxLag;
        }
    }
    let num = 0;
    let den = 0;
    for (let k = Math.max(0, -lag); k < Math.min(length, length - lag); k++) {
        num += reference[k] * mix[k + lag];
        den += reference[k] * reference[k];
    }
    const gain = den > 0 ? num / den : 0;
    const out = Float32Array.from(mix);
    for (let k = Math.max(0, -lag); k < Math.min(length, length - lag); k++) {
        out[k + lag] -= gain * reference[k];
    }
    return out;
}

/** First difference, which tilts the spectrum up so bass and held chords weigh less. */
function emphasize(signal: Float32Array): Float32Array {
    const out = new Float32Array(signal.length);
    let prev = 0;
    for (let i = 0; i < signal.length; i++) {
        out[i] = signal[i] - 0.95 * prev;
        prev = signal[i];
    }
    return out;
}

export interface CueLocation {
    /** How far the effects track sits late (positive) or early in the delivered track, or null when not found. */
    lagMs: number | null;
    /** Normalized cross-correlation of all effect windows at that lag. */
    match: number;
    cues: CueMeasure[];
}

/**
 * Find the effects of the stem in the delivered track. `peakSample` is where
 * each effect peaks in the stem (measured on the 48 kHz stem next to its
 * cue). The mix can only move the effects track as a whole, so one lag is
 * found for all effects together: the stem from 0.35 s before to 30 ms after every peak (cut to where
 * 90% of its energy is) is matched against the delivered track (both at
 * `rate`, first-differenced) and the correlations are summed per lag. Each
 * effect then peaks at `peakSample` plus that lag.
 */
export function locateCues(
    stemRaw: Float32Array,
    mixRaw: Float32Array,
    rate: number,
    cues: { id: string; sfx: string; frame: number; peakSample: number }[],
    fps: number,
    sampleRate = SAMPLE_RATE,
): CueLocation {
    const stem = emphasize(stemRaw);
    const mix = emphasize(mixRaw);
    const maxLag = Math.round(0.25 * rate);
    const before = Math.round(0.35 * rate);
    // Only 30 ms past the peak: a ringing tail looks the same shifted by a
    // whole number of cycles, the onset does not.
    const after = Math.round(0.03 * rate);
    const lags = 2 * maxLag + 1;
    const dot = new Float64Array(lags);
    const energy = new Float64Array(lags);
    const usable = new Uint8Array(lags).fill(1);
    let templateEnergy = 0;
    for (const cue of cues) {
        const peak = Math.round((cue.peakSample * rate) / sampleRate);
        let a = Math.max(0, peak - before);
        let b = Math.min(stem.length, peak + after);
        let total = 0;
        for (let k = a; k < b; k++) total += stem[k] * stem[k];
        if (total <= 1e-12) continue;
        let cut = 0;
        while (a < peak && cut + stem[a] * stem[a] <= total * 0.05) cut += stem[a] * stem[a++];
        cut = 0;
        while (b > peak + 1 && cut + stem[b - 1] * stem[b - 1] <= total * 0.05) {
            cut += stem[b - 1] * stem[b - 1];
            b--;
        }
        for (let k = a; k < b; k++) templateEnergy += stem[k] * stem[k];
        for (let i = 0; i < lags; i++) {
            const lag = i - maxLag;
            if (a + lag < 0 || b + lag > mix.length) {
                usable[i] = 0;
                continue;
            }
            let d = 0;
            let e = 0;
            for (let k = a; k < b; k++) {
                const m = mix[k + lag];
                d += stem[k] * m;
                e += m * m;
            }
            dot[i] += d;
            energy[i] += e;
        }
    }
    let best = -1;
    let bestLag = 0;
    if (templateEnergy > 1e-12) {
        for (let i = 0; i < lags; i++) {
            if (!usable[i] || energy[i] <= 1e-12) continue;
            const score = dot[i] / Math.sqrt(templateEnergy * energy[i]);
            if (score > best) {
                best = score;
                bestLag = i - maxLag;
            }
        }
    }
    const found = best >= MIN_MATCH;
    const match = Number(Math.max(0, best).toFixed(3));
    return {
        lagMs: found ? Number(((bestLag / rate) * 1000).toFixed(2)) : null,
        match,
        cues: cues.map((cue) => {
            const expectedSec = cue.frame / fps;
            const measuredSec = found ? cue.peakSample / sampleRate + bestLag / rate : null;
            return {
                id: cue.id,
                sfx: cue.sfx,
                frame: cue.frame,
                expectedSec,
                measuredSec,
                offsetMs:
                    measuredSec === null
                        ? null
                        : Number(((measuredSec - expectedSec) * 1000).toFixed(2)),
                match,
            };
        }),
    };
}
