// flipbook stock search and stock fetch: find public domain or free images
// for a composition, look at them on one contact sheet, and save the chosen
// one under assets/ with its source and license in assets/SOURCES.json.
// With --audio the same two commands find and save public domain sounds.
import * as fs from 'fs';
import * as path from 'path';
import { SOURCES_FILE } from '../engine/brand.ts';
import { sandboxHost } from '../engine/browser.ts';
import { requireFfmpeg } from '../engine/ffmpeg.ts';
import { sheetLayout } from '../engine/pixels.ts';
import { run, tail } from '../engine/proc.ts';
import { compositionDir, outputLinksFinding } from '../engine/session.ts';
import { Workspace } from '../engine/workspace.ts';
import { type DnsLookup, download, type HttpGet } from '../stock/download.ts';
import { EXTENSION, type ImageInfo, imageInfo } from '../stock/image.ts';
import { type Net, type SleepFn, StockError } from '../stock/net.ts';
import {
    AUDIO_ID_PREFIX,
    type AudioHit,
    type AudioLength,
    KEY_ENV,
    keysFromEnv,
    lookupAudio,
    lookupImage,
    needsKey,
    type Orientation,
    PROVIDERS,
    type Provider,
    parseStockId,
    type StockHit,
    type StockImage,
    type StockKeys,
    type StockRef,
    searchOpenverseAudio,
    searchProvider,
    secretsOf,
} from '../stock/providers.ts';
import { AUDIO_DEMUXER, AUDIO_EXTENSION, type AudioFormat, audioFormat } from '../stock/sound.ts';
import {
    EnvError,
    type Finding,
    finding,
    progress,
    type Report,
    ReportBuilder,
    UsageError,
} from './report.ts';

/** Seams for tests: every network call and timer goes through these. */
export interface StockDeps {
    fetch?: typeof fetch;
    lookup?: DnsLookup;
    get?: HttpGet;
    sleep?: SleepFn;
    env?: NodeJS.ProcessEnv;
}

/** Largest image file downloaded. */
export const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
/** Largest sound file downloaded. */
export const MAX_AUDIO_BYTES = 60 * 1024 * 1024;
const MAX_THUMB_BYTES = 5 * 1024 * 1024;
/** Longer edges are scaled down to this on fetch. */
export const MAX_EDGE = 3200;
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const IMAGE_EXTENSIONS = [
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.gif',
    '.tif',
    '.tiff',
    '.svg',
    '.avif',
];
const AUDIO_EXTENSIONS = ['.mp3', '.ogg', '.oga', '.opus', '.flac', '.wav', '.m4a', '.aac'];

function netFor(deps: StockDeps, keys: StockKeys): Net {
    return {
        fetch: deps.fetch ?? fetch,
        sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
        secrets: secretsOf(keys),
    };
}

function keyMissing(provider: Provider, why?: string): EnvError {
    if (provider === 'openverse') {
        const names = `${KEY_ENV.openverseId} and ${KEY_ENV.openverseSecret}`;
        return new EnvError(
            'stock-key-missing',
            why ?? 'Openverse turned the client credentials down.',
            [`Fix or unset ${names}: Openverse also answers without them`],
            { provider, env: names },
        );
    }
    const name = KEY_ENV[provider];
    return new EnvError(
        'stock-key-missing',
        why ?? `${provider} needs an API key and ${name} is not set.`,
        [
            `Ask the user for a ${provider} API key and set ${name}`,
            'Or leave out --provider: Openverse needs no key',
        ],
        { provider, env: name },
    );
}

function unreachable(error: StockError, env: NodeJS.ProcessEnv): EnvError {
    return new EnvError(
        'stock-unreachable',
        error.message,
        [
            'Check the network or HTTPS_PROXY, then run the command again',
            'Inside a sandbox: run the same flipbook stock command once outside it, after the user approves',
        ],
        { ...error.detail, host: sandboxHost(env) },
    );
}

/** A StockError as the exit-78 error or the finding it stands for. */
function asOutcome(error: unknown, env: NodeJS.ProcessEnv): Finding {
    if (!(error instanceof StockError)) throw error;
    if (error.reason === 'unreachable') throw unreachable(error, env);
    if (error.reason === 'key') {
        const service = String(error.detail.service ?? '').toLowerCase();
        const provider = PROVIDERS.find((p) => p === service) ?? 'openverse';
        throw keyMissing(provider, error.message);
    }
    return finding('stock-rejected', error.message, {
        detail: { reason: error.reason, ...error.detail },
    });
}

// ---------------------------------------------------------------- search

export interface StockSearchOptions {
    dir: string;
    query: string;
    provider?: Provider;
    /** Openverse collection, such as wikimedia, smithsonian or bio_diversity. */
    source?: string;
    orientation?: Orientation;
    count?: number;
    /** Search Openverse for sounds instead of images. */
    audio?: boolean;
    /** Sounds only: Openverse's length bucket. */
    length?: AudioLength;
}

type ProviderStatus =
    | { provider: Provider; status: 'ok'; count: number }
    | { provider: Provider; status: 'no-key' }
    | { provider: Provider; status: 'failed'; message: string };

interface SearchResult extends StockHit {
    /** Position on the contact sheet, from 1, left to right and top to bottom. null: no thumbnail. */
    tile: number | null;
}

export async function runStockSearch(
    options: StockSearchOptions,
    deps: StockDeps = {},
): Promise<Report> {
    const dir = compositionDir(options.dir);
    const query = options.query.trim().replace(/\s+/g, ' ');
    if (query === '')
        throw new UsageError('stock search needs a query: two to four English words.');
    if (options.length && !options.audio) {
        throw new UsageError('--length sorts sounds by length: add --audio, or drop --length.');
    }
    if (options.audio && options.provider && options.provider !== 'openverse') {
        throw new UsageError('--audio searches Openverse alone: drop --provider.');
    }
    if (options.audio && options.orientation) {
        throw new UsageError('--orientation is for images: drop it with --audio.');
    }
    if (options.source && options.provider && options.provider !== 'openverse') {
        throw new UsageError(
            '--source picks an Openverse collection: drop --provider or use openverse.',
        );
    }
    const env = deps.env ?? process.env;
    const keys = keysFromEnv(env);
    const net = netFor(deps, keys);
    const count = options.count ?? 8;
    const rb = new ReportBuilder('stock-search', dir);
    const ws = Workspace.open(dir);
    const unsafe = outputLinksFinding(ws);
    if (unsafe) {
        rb.add(unsafe);
        return rb.finish();
    }
    if (options.audio) {
        await searchAudio(rb, { ...options, query, count }, keys, net, env);
        return rb.finish();
    }

    const order: Provider[] = options.source
        ? ['openverse']
        : options.provider
          ? [options.provider]
          : [...PROVIDERS];
    const providers: ProviderStatus[] = [];
    let hits: StockHit[] = [];
    let lastFailure: StockError | null = null;
    for (const provider of order) {
        if (needsKey(provider) && !keys[provider]) {
            if (options.provider === provider) throw keyMissing(provider);
            providers.push({ provider, status: 'no-key' });
            continue;
        }
        progress(`searching ${provider} for "${query}"`);
        try {
            hits = await searchProvider(
                provider,
                { query, count, orientation: options.orientation, source: options.source },
                keys,
                net,
            );
        } catch (error) {
            if (!(error instanceof StockError)) throw error;
            // A rejected key is the user's to fix, unless another service can still answer.
            if (error.reason === 'key' && (options.provider === provider || !needsKey(provider))) {
                throw keyMissing(provider, error.message);
            }
            lastFailure = error;
            providers.push({ provider, status: 'failed', message: error.message });
            continue;
        }
        providers.push({ provider, status: 'ok', count: hits.length });
        if (hits.length > 0) break;
    }
    if (lastFailure && !providers.some((p) => p.status === 'ok')) {
        throw unreachable(lastFailure, env);
    }

    const results: SearchResult[] = hits.map((hit) => {
        const { url: _url, fallbackUrl: _fallback, ...shown } = hit as StockImage;
        return { ...shown, tile: null };
    });
    rb.report.stock = {
        kind: 'image',
        query,
        provider: options.provider ?? null,
        source: options.source ?? null,
        providers,
        results,
    };
    if (results.length === 0) {
        rb.add(
            finding('stock-no-results', `No image found for "${query}".`, {
                severity: 'warning',
                detail: { query },
            }),
        );
        return rb.finish();
    }

    // Thumbnails, then one contact sheet in result order.
    const thumbDir = ws.fresh(ws.path('.flipbook', 'stock', 'thumbs'));
    const thumbFailures: { id: string; message: string }[] = [];
    const thumbs = await Promise.all(
        results.map(async (result, i) => {
            if (!result.thumbnail) return null;
            try {
                const { bytes } = await download(result.thumbnail, {
                    lookup: deps.lookup,
                    get: deps.get,
                    maxBytes: MAX_THUMB_BYTES,
                });
                const info = imageInfo(bytes);
                if (!info || info.format === 'tiff') {
                    thumbFailures.push({ id: result.id, message: 'not a PNG, JPEG, WebP or GIF' });
                    return null;
                }
                const file = path.join(
                    thumbDir,
                    `${String(i + 1).padStart(2, '0')}${EXTENSION[info.format]}`,
                );
                ws.writeFile(file, bytes);
                return file;
            } catch (error) {
                if (!(error instanceof StockError)) throw error;
                thumbFailures.push({ id: result.id, message: error.message });
                return null;
            }
        }),
    );
    if (thumbFailures.length > 0) {
        (rb.report.stock as Record<string, unknown>).thumbnailFailures = thumbFailures;
    }
    const tiles: string[] = [];
    thumbs.forEach((file, i) => {
        if (!file) return;
        tiles.push(file);
        results[i].tile = tiles.length;
    });
    if (tiles.length > 0) {
        const { ffmpeg } = await requireFfmpeg(['tile'], env);
        const outDir = ws.fresh(ws.path('out', 'stock'));
        const sheet = path.join(outDir, 'contact-sheet.png');
        await tileSheet(ffmpeg, tiles, sheet);
        rb.report.artifacts.contactSheet = sheet;
    }
    return rb.finish();
}

/** Sounds from Openverse, public domain only. No contact sheet: the results carry length, title and tags. */
async function searchAudio(
    rb: ReportBuilder,
    options: StockSearchOptions & { count: number },
    keys: StockKeys,
    net: Net,
    env: NodeJS.ProcessEnv,
): Promise<void> {
    progress(`searching Openverse audio for "${options.query}"`);
    let results: AudioHit[];
    try {
        results = await searchOpenverseAudio(
            {
                query: options.query,
                count: options.count,
                source: options.source,
                length: options.length,
            },
            keys.openverse,
            net,
        );
    } catch (error) {
        if (!(error instanceof StockError)) throw error;
        if (error.reason === 'key') throw keyMissing('openverse', error.message);
        throw unreachable(error, env);
    }
    rb.report.stock = {
        kind: 'audio',
        query: options.query,
        provider: 'openverse',
        source: options.source ?? null,
        length: options.length ?? null,
        providers: [{ provider: 'openverse', status: 'ok', count: results.length }],
        results,
    };
    if (results.length === 0) {
        rb.add(
            finding('stock-no-results', `No sound found for "${options.query}".`, {
                severity: 'warning',
                detail: { query: options.query },
            }),
        );
    }
}

/** Thumbnails of any shape, each fitted into a square tile, row by row. */
async function tileSheet(ffmpeg: string, files: string[], out: string): Promise<void> {
    const layout = sheetLayout(files.length, 1, 1, 1568);
    const side = Math.min(layout.tileWidth, 480) - (Math.min(layout.tileWidth, 480) % 2);
    const fit =
        `trim=end_frame=1,scale=${side}:${side}:force_original_aspect_ratio=decrease:flags=lanczos,` +
        `pad=${side}:${side}:(ow-iw)/2:(oh-ih)/2:color=0x303030,setsar=1,format=rgb24`;
    const chains = files.map((_, i) => `[${i}:v]${fit}[t${i}]`);
    const joined = files.map((_, i) => `[t${i}]`).join('');
    const graph =
        `${chains.join(';')};${joined}concat=n=${files.length}:v=1:a=0,` +
        `tile=${layout.cols}x${layout.rows}:margin=8:padding=8:color=0x303030[sheet]`;
    const result = await run(
        ffmpeg,
        [
            '-v',
            'error',
            '-y',
            ...files.flatMap((file) => ['-i', file]),
            '-filter_complex',
            graph,
            '-map',
            '[sheet]',
            '-frames:v',
            '1',
            '-update',
            '1',
            out,
        ],
        { timeoutMs: 120_000 },
    );
    if (result.code !== 0) throw new Error(`ffmpeg contact sheet failed: ${tail(result.stderr)}`);
}

// ---------------------------------------------------------------- fetch

export interface StockFetchOptions {
    dir: string;
    /** `<provider>:<id>` from stock search. */
    id: string;
    /** File name under assets/, without the extension. */
    as: string;
}

type SourcesFile = Record<string, unknown>;

function readSources(ws: Workspace): { sources: SourcesFile } | { problem: string } {
    const text = ws.readText(ws.path(SOURCES_FILE));
    if (text === null) return { sources: {} };
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        return { problem: `is not valid JSON: ${(error as Error).message}` };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { problem: 'must be a JSON object keyed by file path under assets/' };
    }
    return { sources: parsed as SourcesFile };
}

/** Files of one kind already under assets/ named `<name>.<extension>`. */
function taken(dir: string, name: string, extensions: string[]): string[] {
    const folder = path.join(dir, 'assets');
    let entries: string[];
    try {
        entries = fs.readdirSync(folder);
    } catch {
        return [];
    }
    return entries
        .filter((file) => {
            const ext = path.extname(file);
            return (
                extensions.includes(ext.toLowerCase()) &&
                file.slice(0, -ext.length).toLowerCase() === name.toLowerCase()
            );
        })
        .sort();
}

/** Scale an image whose long edge passes MAX_EDGE, and turn TIFF into JPEG, with ffmpeg. */
async function normalize(
    ws: Workspace,
    bytes: Buffer,
    info: ImageInfo,
    env: NodeJS.ProcessEnv,
): Promise<{ bytes: Buffer; info: ImageInfo; resized: boolean }> {
    const long = Math.max(info.width, info.height);
    if (info.format !== 'tiff' && long <= MAX_EDGE) return { bytes, info, resized: false };
    const { ffmpeg } = await requireFfmpeg([], env);
    const work = ws.fresh(ws.path('.flipbook', 'tmp', 'stock'));
    try {
        const input = path.join(work, `in${EXTENSION[info.format]}`);
        ws.writeFile(input, bytes);
        const keepAlpha = info.format === 'png' || info.format === 'webp' || info.format === 'gif';
        const output = path.join(work, keepAlpha ? 'out.png' : 'out.jpg');
        const scale =
            long > MAX_EDGE
                ? info.width >= info.height
                    ? `scale=${MAX_EDGE}:-2:flags=lanczos`
                    : `scale=-2:${MAX_EDGE}:flags=lanczos`
                : 'null';
        const result = await run(
            ffmpeg,
            [
                '-v',
                'error',
                '-y',
                '-i',
                input,
                '-vf',
                scale,
                '-frames:v',
                '1',
                ...(keepAlpha ? [] : ['-q:v', '2']),
                '-update',
                '1',
                output,
            ],
            { timeoutMs: 120_000 },
        );
        if (result.code !== 0) {
            throw new StockError(
                'not-image',
                `ffmpeg could not read the image: ${tail(result.stderr, 3)}`,
            );
        }
        const out = fs.readFileSync(output);
        const outInfo = imageInfo(out);
        if (!outInfo) throw new StockError('not-image', 'ffmpeg wrote no readable image');
        return { bytes: out, info: outInfo, resized: true };
    } finally {
        ws.remove(work);
    }
}

export async function runStockFetch(
    options: StockFetchOptions,
    deps: StockDeps = {},
): Promise<Report> {
    const dir = compositionDir(options.dir);
    const ref = parseStockId(options.id);
    if (!ref) {
        throw new UsageError(
            `"${options.id}" is not a stock id. Pass one from stock search: openverse:<id>, openverse-audio:<id>, pexels:<id> or pixabay:<id>.`,
        );
    }
    if (!NAME.test(options.as)) {
        throw new UsageError(
            `--as "${options.as}" is not a file name: use letters, digits, - and _, without an extension.`,
        );
    }
    const env = deps.env ?? process.env;
    const keys = keysFromEnv(env);
    if (needsKey(ref.provider) && !keys[ref.provider]) throw keyMissing(ref.provider);
    const id = ref.kind === 'audio' ? `${AUDIO_ID_PREFIX}:${ref.id}` : `${ref.provider}:${ref.id}`;
    const rb = new ReportBuilder('stock-fetch', dir);
    const ws = Workspace.open(dir);
    const sourcesShown = SOURCES_FILE.split(path.sep).join('/');

    const read = readSources(ws);
    if ('problem' in read) {
        rb.add(
            finding('asset-conflict', `${sourcesShown} ${read.problem}`, {
                element: sourcesShown,
                detail: { reason: 'sources-invalid', file: sourcesShown },
            }),
        );
        return rb.finish();
    }
    const sources = read.sources;
    const existing = taken(
        dir,
        options.as,
        ref.kind === 'audio' ? AUDIO_EXTENSIONS : IMAGE_EXTENSIONS,
    );
    if (existing.length > 0) {
        const same = existing.find((file) => {
            const entry = sources[file];
            return (
                typeof entry === 'object' &&
                entry !== null &&
                (entry as Record<string, unknown>).id === id
            );
        });
        if (same && ref.kind === 'audio') {
            const file = path.join(dir, 'assets', same);
            const entry = sources[same] as Record<string, unknown>;
            const bytes = fs.readFileSync(file);
            const format = audioFormat(bytes);
            const probe = format ? await probeSound(ws, bytes, format, env) : null;
            rb.report.stock = {
                id,
                provider: ref.provider,
                kind: 'audio',
                file: `assets/${same}`,
                format,
                durationSec: probe?.durationSec ?? null,
                sampleRate: probe?.sampleRate ?? null,
                channels: probe?.channels ?? null,
                license: entry.license ?? null,
                source: entry.source ?? null,
                skipped: true,
            };
            rb.report.artifacts.audio = file;
            rb.report.artifacts.sources = ws.path(SOURCES_FILE);
            return rb.finish();
        }
        if (same) {
            const file = path.join(dir, 'assets', same);
            const info = imageInfo(fs.readFileSync(file));
            const entry = sources[same] as Record<string, unknown>;
            rb.report.stock = {
                id,
                provider: ref.provider,
                kind: 'image',
                file: `assets/${same}`,
                width: info?.width ?? null,
                height: info?.height ?? null,
                license: entry.license ?? null,
                source: entry.source ?? null,
                skipped: true,
            };
            rb.report.artifacts.image = file;
            rb.report.artifacts.sources = ws.path(SOURCES_FILE);
            return rb.finish();
        }
        rb.add(
            finding(
                'asset-conflict',
                `assets/${existing[0]} already exists and is not ${id}. Pass another --as name.`,
                {
                    element: `assets/${existing[0]}`,
                    detail: { reason: 'name-taken', file: `assets/${existing[0]}` },
                },
            ),
        );
        return rb.finish();
    }

    const net = netFor(deps, keys);
    if (ref.kind === 'audio') {
        await fetchAudio(rb, ws, { ref, id, as: options.as, sources }, deps, net, env);
        return rb.finish();
    }
    let image: StockImage;
    try {
        progress(`looking up ${id}`);
        image = await lookupImage(ref.provider, ref.id, keys, net);
    } catch (error) {
        rb.add(asOutcome(error, env));
        return rb.finish();
    }

    let bytes: Buffer;
    try {
        progress(`downloading ${image.url}`);
        const got = await download(image.url, {
            lookup: deps.lookup,
            get: deps.get,
            maxBytes: MAX_IMAGE_BYTES,
        }).catch(async (error) => {
            if (!image.fallbackUrl || !(error instanceof StockError)) throw error;
            if (error.reason === 'unsafe-url') throw error;
            return download(image.fallbackUrl, {
                lookup: deps.lookup,
                get: deps.get,
                maxBytes: MAX_IMAGE_BYTES,
            });
        });
        bytes = got.bytes;
    } catch (error) {
        rb.add(asOutcome(error, env));
        return rb.finish();
    }

    const sniffed = imageInfo(bytes);
    if (!sniffed) {
        rb.add(
            asOutcome(
                new StockError(
                    'not-image',
                    `${image.url} is not a PNG, JPEG, WebP, GIF or TIFF image`,
                    {
                        url: image.url,
                    },
                ),
                env,
            ),
        );
        return rb.finish();
    }
    let normalized: Awaited<ReturnType<typeof normalize>>;
    try {
        normalized = await normalize(ws, bytes, sniffed, env);
    } catch (error) {
        rb.add(asOutcome(error, env));
        return rb.finish();
    }

    const fileName = `${options.as}${EXTENSION[normalized.info.format]}`;
    const target = ws.writeFile(ws.path('assets', fileName), normalized.bytes);
    const entry: Record<string, string> = {
        source: image.pageUrl,
        license: image.license,
    };
    if (image.licenseUrl) entry.licenseUrl = image.licenseUrl;
    entry.id = id;
    if (image.title) entry.title = image.title;
    if (image.creator) entry.creator = image.creator;
    entry.url = image.url;
    sources[fileName] = entry;
    const sourcesPath = ws.writeFile(
        ws.path(SOURCES_FILE),
        `${JSON.stringify(sources, null, 4)}\n`,
    );

    rb.report.stock = {
        id,
        provider: ref.provider,
        kind: 'image',
        file: `assets/${fileName}`,
        format: normalized.info.format,
        width: normalized.info.width,
        height: normalized.info.height,
        bytes: normalized.bytes.length,
        resized: normalized.resized,
        license: image.license,
        licenseUrl: image.licenseUrl,
        source: image.pageUrl,
        title: image.title,
        creator: image.creator,
        skipped: false,
    };
    rb.report.artifacts.image = target;
    rb.report.artifacts.sources = sourcesPath;
    return rb.finish();
}

// ---------------------------------------------------------------- sounds

interface SoundProbe {
    codec: string;
    sampleRate: number;
    channels: number;
    durationSec: number | null;
}

/**
 * Read a downloaded sound with ffprobe, through the one demuxer its first
 * bytes name and as a local file only. Null when ffprobe cannot read it.
 */
async function probeSound(
    ws: Workspace,
    bytes: Buffer,
    format: AudioFormat,
    env: NodeJS.ProcessEnv,
): Promise<SoundProbe | null> {
    const { ffprobe } = await requireFfmpeg([], env);
    const work = ws.fresh(ws.path('.flipbook', 'tmp', 'stock'));
    try {
        const input = path.join(work, `in${AUDIO_EXTENSION[format]}`);
        ws.writeFile(input, bytes);
        const result = await run(
            ffprobe,
            [
                '-v',
                'error',
                '-protocol_whitelist',
                'file',
                '-f',
                AUDIO_DEMUXER[format],
                '-select_streams',
                'a:0',
                '-show_entries',
                'stream=codec_name,sample_rate,channels,duration:format=duration',
                '-of',
                'json',
                input,
            ],
            { timeoutMs: 120_000 },
        );
        if (result.code !== 0) return null;
        const parsed = JSON.parse(result.stdout.toString('utf-8')) as {
            streams?: Record<string, string | number>[];
            format?: Record<string, string | number>;
        };
        const stream = parsed.streams?.[0];
        if (!stream) return null;
        const duration = Number(stream.duration ?? parsed.format?.duration);
        return {
            codec: String(stream.codec_name ?? ''),
            sampleRate: Number(stream.sample_rate ?? 0),
            channels: Number(stream.channels ?? 0),
            durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
        };
    } finally {
        ws.remove(work);
    }
}

/**
 * Save one Openverse sound as it came: mp3, Ogg and FLAC stay compressed
 * (a WAV of a whole piece runs ten times larger), and render decodes and
 * resamples every file to 48 kHz stereo anyway.
 */
async function fetchAudio(
    rb: ReportBuilder,
    ws: Workspace,
    target: { ref: StockRef; id: string; as: string; sources: SourcesFile },
    deps: StockDeps,
    net: Net,
    env: NodeJS.ProcessEnv,
): Promise<void> {
    const { ref, id, sources } = target;
    const keys = keysFromEnv(env);
    let sound: AudioHit;
    let bytes: Buffer;
    try {
        progress(`looking up ${id}`);
        sound = await lookupAudio(ref.id, keys.openverse, net);
        progress(`downloading ${sound.preview}`);
        bytes = (
            await download(sound.preview, {
                lookup: deps.lookup,
                get: deps.get,
                maxBytes: MAX_AUDIO_BYTES,
            })
        ).bytes;
    } catch (error) {
        rb.add(asOutcome(error, env));
        return;
    }
    const format = audioFormat(bytes);
    const probe = format ? await probeSound(ws, bytes, format, env) : null;
    if (!format || !probe) {
        const why = format
            ? `ffmpeg could not read ${sound.preview} as ${format}`
            : `${sound.preview} is not an mp3, Ogg, FLAC or WAV file`;
        rb.add(asOutcome(new StockError('not-audio', why, { url: sound.preview }), env));
        return;
    }
    const fileName = `${target.as}${AUDIO_EXTENSION[format]}`;
    const file = ws.writeFile(ws.path('assets', fileName), bytes);
    const entry: Record<string, string> = { source: sound.pageUrl, license: sound.license };
    if (sound.licenseUrl) entry.licenseUrl = sound.licenseUrl;
    entry.id = id;
    if (sound.title) entry.title = sound.title;
    if (sound.creator) entry.creator = sound.creator;
    entry.url = sound.preview;
    sources[fileName] = entry;
    const sourcesPath = ws.writeFile(
        ws.path(SOURCES_FILE),
        `${JSON.stringify(sources, null, 4)}\n`,
    );
    rb.report.stock = {
        id,
        provider: ref.provider,
        kind: 'audio',
        file: `assets/${fileName}`,
        format,
        codec: probe.codec,
        durationSec: probe.durationSec,
        sampleRate: probe.sampleRate,
        channels: probe.channels,
        bytes: bytes.length,
        license: sound.license,
        licenseUrl: sound.licenseUrl,
        source: sound.pageUrl,
        title: sound.title,
        creator: sound.creator,
        skipped: false,
    };
    rb.report.artifacts.audio = file;
    rb.report.artifacts.sources = sourcesPath;
}
