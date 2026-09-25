// stock search and stock fetch: provider order, license filter, key handling,
// the download guard, and what lands in assets/ and assets/SOURCES.json. Every
// network call goes through injected fakes: nothing here reaches the network.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import * as zlib from 'zlib';
import { runStockFetch, runStockSearch, type StockDeps } from '../src/cli/stock.ts';
import { download, type HttpGet } from '../src/stock/download.ts';
import { imageInfo } from '../src/stock/image.ts';
import { redactSecrets } from '../src/stock/net.ts';
import { servedLongEdge } from '../src/stock/providers.ts';
import { audioFormat } from '../src/stock/sound.ts';
import { cleanTemps, codes, runCli, tempDir, warningCodes } from './helpers.ts';

afterAll(() => cleanTemps());

/** A real PNG of one flat color. */
function png(width: number, height: number, rgb: [number, number, number]): Buffer {
    const crcTable = Array.from({ length: 256 }, (_, n) => {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
    });
    const crc = (buf: Buffer) => {
        let c = 0xffffffff;
        for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type: string, data: Buffer) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const sum = Buffer.alloc(4);
        sum.writeUInt32BE(crc(body));
        return Buffer.concat([len, body, sum]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
    const raw = Buffer.concat(Array.from({ length: height }, () => row));
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

const RED = png(40, 30, [200, 60, 40]);
const GREEN = png(30, 40, [40, 160, 80]);

function json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

const OPENVERSE_RESULTS = {
    results: [
        {
            id: 'ov-1',
            title: 'Eggs of British birds',
            url: 'https://live.staticflickr.com/6013/6012000493_ced35d5e50_b.jpg',
            foreign_landing_url: 'https://www.flickr.com/photos/bhl/1',
            creator: 'BioDivLibrary',
            license: 'pdm',
            license_url: 'https://creativecommons.org/publicdomain/mark/1.0/',
            source: 'bio_diversity',
            width: 1200,
            height: 900,
            thumbnail: 'https://api.openverse.org/v1/images/ov-1/thumb/',
            attribution: '"Eggs" by BioDivLibrary is marked with Public Domain Mark 1.0.',
        },
        {
            id: 'ov-2',
            title: 'Attribution required',
            url: 'https://img.example.org/ov-2.png',
            foreign_landing_url: 'https://example.org/2',
            license: 'by',
            width: 800,
            height: 600,
            thumbnail: 'https://api.openverse.org/v1/images/ov-2/thumb/',
        },
        {
            id: 'ov-3',
            title: 'Fern plate',
            url: 'https://img.example.org/ov-3.png',
            foreign_landing_url: 'https://commons.wikimedia.org/wiki/File:Fern.png',
            creator: 'Anna Atkins',
            license: 'cc0',
            source: 'wikimedia',
            width: 600,
            height: 800,
            thumbnail: 'https://api.openverse.org/v1/images/ov-3/thumb/',
        },
    ],
};

interface Fake {
    deps: StockDeps;
    calls: string[];
}

/**
 * Fake APIs and image hosts. `apis` maps a host to a handler; images are
 * served by URL through the pinned download, whose DNS answer is public
 * unless the host starts with "internal.".
 */
function fake(
    apis: Record<string, (url: URL, init?: RequestInit) => Response | Promise<Response>>,
    images: Record<string, Buffer | { status: number; location?: string }> = {},
    env: NodeJS.ProcessEnv = {},
): Fake {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(typeof input === 'string' ? input : (input as URL).toString());
        calls.push(`api ${url.host}${url.pathname}${url.search}`);
        const handler = apis[url.host];
        if (!handler) throw new TypeError(`fetch failed: no route to ${url.host}`);
        return handler(url, init);
    }) as typeof fetch;
    const get: HttpGet = async (url) => {
        calls.push(`get ${url.toString()}`);
        const hit = images[url.toString()];
        if (!hit) return { status: 404, headers: {}, body: Buffer.alloc(0) };
        if (Buffer.isBuffer(hit)) {
            return {
                status: 200,
                headers: { 'content-length': String(hit.length) },
                body: hit,
            };
        }
        return { status: hit.status, headers: { location: hit.location }, body: Buffer.alloc(0) };
    };
    return {
        calls,
        deps: {
            fetch: fetchImpl,
            get,
            lookup: async (host) => [
                { address: host.startsWith('internal.') ? '10.0.0.5' : '93.184.216.34', family: 4 },
            ],
            sleep: async () => undefined,
            // ffmpeg is found on PATH; keys come only from `env`.
            env: { PATH: process.env.PATH, ...env },
        },
    };
}

const openverseOnly = () =>
    fake(
        { 'api.openverse.org': () => json(OPENVERSE_RESULTS) },
        {
            'https://api.openverse.org/v1/images/ov-1/thumb/': RED,
            'https://api.openverse.org/v1/images/ov-3/thumb/': GREEN,
        },
    );

describe('servedLongEdge', () => {
    it('knows the previews some collections hand out in place of the original', () => {
        expect(
            servedLongEdge('https://live.staticflickr.com/6013/6012000493_ced35d5e50_b.jpg'),
        ).toBe(1024);
        expect(servedLongEdge('https://live.staticflickr.com/1/2_abc_z.jpg')).toBe(640);
        expect(servedLongEdge('https://live.staticflickr.com/1/2_abc_c.jpg')).toBe(800);
        expect(
            servedLongEdge('https://images.rawpixel.com/editor_1024/cHJpdmF0ZS9sci9pbWFnZXM.jpg'),
        ).toBe(1024);
        expect(
            servedLongEdge('https://upload.wikimedia.org/wikipedia/commons/6/60/Horse.jpg'),
        ).toBeNull();
        expect(
            servedLongEdge('https://images.metmuseum.org/CRDImages/eg/original/x.jpg'),
        ).toBeNull();
    });
});

describe('stock search', () => {
    it('asks Openverse for cc0 and pdm only when no key is set, and drops other licenses', async () => {
        const { deps, calls } = openverseOnly();
        const dir = tempDir('stock');
        const report = await runStockSearch({ dir, query: 'bird eggs plate' }, deps);
        expect(report.exitCode).toBe(0);
        expect(report.command).toBe('stock-search');
        const search = calls.find((c) => c.startsWith('api api.openverse.org'));
        expect(search).toContain('license=cc0%2Cpdm');
        expect(search).toContain('q=bird+eggs+plate');
        expect(calls.some((c) => c.includes('pexels') || c.includes('pixabay'))).toBe(false);
        const stock = report.stock as {
            providers: { provider: string; status: string }[];
            results: { id: string; license: string; tile: number | null }[];
        };
        expect(stock.results.map((r) => [r.id, r.license, r.tile])).toEqual([
            ['openverse:ov-1', 'pdm', 1],
            ['openverse:ov-3', 'cc0', 2],
        ]);
        // The listed size is the original; a Flickr hit only downloads as its preview.
        expect(
            (stock.results as unknown as { width: number; servedEdge: number | null }[]).map(
                (r) => [r.width, r.servedEdge],
            ),
        ).toEqual([
            [1200, 1024],
            [600, null],
        ]);
        expect(stock.providers).toEqual([
            { provider: 'pexels', status: 'no-key' },
            { provider: 'pixabay', status: 'no-key' },
            { provider: 'openverse', status: 'ok', count: 2 },
        ]);
    });

    it('tiles the thumbnails into one contact sheet in result order', async () => {
        const { deps } = openverseOnly();
        const dir = tempDir('stock');
        const report = await runStockSearch({ dir, query: 'fern' }, deps);
        const sheet = report.artifacts.contactSheet;
        expect(sheet).toBe(path.join(dir, 'out', 'stock', 'contact-sheet.png'));
        const info = imageInfo(fs.readFileSync(sheet));
        expect(info?.format).toBe('png');
        expect(info && info.width > info.height).toBe(true);
    });

    it('keeps a result whose thumbnail fails, without a tile', async () => {
        const { deps } = fake(
            { 'api.openverse.org': () => json(OPENVERSE_RESULTS) },
            { 'https://api.openverse.org/v1/images/ov-3/thumb/': GREEN },
        );
        const report = await runStockSearch({ dir: tempDir('stock'), query: 'fern' }, deps);
        const results = (report.stock as { results: { id: string; tile: number | null }[] })
            .results;
        expect(results.map((r) => [r.id, r.tile])).toEqual([
            ['openverse:ov-1', null],
            ['openverse:ov-3', 1],
        ]);
        expect(
            (report.stock as { thumbnailFailures: { id: string }[] }).thumbnailFailures.map(
                (f) => f.id,
            ),
        ).toEqual(['openverse:ov-1']);
    });

    it('tries Pexels first, then Pixabay, then Openverse, stopping at the first with results', async () => {
        const pexelsEmpty = fake(
            {
                'api.pexels.com': (_url, init) => {
                    expect((init as RequestInit).headers).toMatchObject({
                        Authorization: 'pexels-secret-key',
                    });
                    return json({ photos: [] });
                },
                'pixabay.com': () =>
                    json({
                        hits: [
                            {
                                id: 22,
                                pageURL: 'https://pixabay.com/photos/fern-22/',
                                user: 'someone',
                                previewURL: 'https://cdn.pixabay.com/22_150.png',
                                largeImageURL: 'https://pixabay.com/get/22_1280.png',
                                imageWidth: 1280,
                                imageHeight: 960,
                                tags: 'fern, leaf',
                            },
                        ],
                    }),
                'api.openverse.org': () => json(OPENVERSE_RESULTS),
            },
            { 'https://cdn.pixabay.com/22_150.png': RED },
            { PEXELS_API_KEY: 'pexels-secret-key', PIXABAY_API_KEY: 'pixabay-secret-key' },
        );
        const report = await runStockSearch(
            { dir: tempDir('stock'), query: 'fern' },
            pexelsEmpty.deps,
        );
        const stock = report.stock as {
            providers: unknown[];
            results: { id: string; license: string }[];
        };
        expect(stock.providers).toEqual([
            { provider: 'pexels', status: 'ok', count: 0 },
            { provider: 'pixabay', status: 'ok', count: 1 },
        ]);
        expect(stock.results.map((r) => [r.id, r.license])).toEqual([
            ['pixabay:22', 'Pixabay Content License'],
        ]);
        expect(pexelsEmpty.calls.some((c) => c.includes('openverse'))).toBe(false);
    });

    it('moves on when one service fails, and exits 78 when every service tried failed', async () => {
        const partly = fake(
            {
                'api.pexels.com': () => json({ error: 'down' }, 503),
                'api.openverse.org': () => json(OPENVERSE_RESULTS),
            },
            {},
            { PEXELS_API_KEY: 'pexels-secret-key' },
        );
        const ok = await runStockSearch({ dir: tempDir('stock'), query: 'fern' }, partly.deps);
        const providers = (ok.stock as { providers: { provider: string; status: string }[] })
            .providers;
        expect(providers.map((p) => [p.provider, p.status])).toEqual([
            ['pexels', 'failed'],
            ['pixabay', 'no-key'],
            ['openverse', 'ok'],
        ]);

        const down = fake({});
        await expect(
            runStockSearch({ dir: tempDir('stock'), query: 'fern' }, down.deps),
        ).rejects.toMatchObject({ name: 'EnvError', code: 'stock-unreachable' });
    });

    it('reports no results as a warning with an empty list', async () => {
        const { deps } = fake({ 'api.openverse.org': () => json({ results: [] }) });
        const report = await runStockSearch({ dir: tempDir('stock'), query: 'zzqx' }, deps);
        expect(report.exitCode).toBe(0);
        expect(warningCodes(report)).toEqual(['stock-no-results']);
        expect((report.stock as { results: unknown[] }).results).toEqual([]);
        expect(report.artifacts.contactSheet).toBeUndefined();
    });

    it('limits Openverse to one collection with --source', async () => {
        const { deps, calls } = openverseOnly();
        const report = await runStockSearch(
            { dir: tempDir('stock'), query: 'fern', source: 'wikimedia' },
            deps,
        );
        expect(report.exitCode).toBe(0);
        expect(calls.find((c) => c.startsWith('api api.openverse.org'))).toContain(
            'source=wikimedia',
        );
        expect(calls.some((c) => c.includes('pexels'))).toBe(false);
    });

    it('exits 78 with stock-key-missing when a keyed service is asked for without a key', async () => {
        const { deps } = openverseOnly();
        await expect(
            runStockSearch({ dir: tempDir('stock'), query: 'fern', provider: 'pexels' }, deps),
        ).rejects.toMatchObject({ name: 'EnvError', code: 'stock-key-missing' });
    });

    it('reports rejected Openverse credentials as stock-key-missing', async () => {
        const { deps } = fake(
            { 'api.openverse.org': () => json({ error: 'invalid_client' }, 401) },
            {},
            { OPENVERSE_CLIENT_ID: 'client-id', OPENVERSE_CLIENT_SECRET: 'client-secret-value' },
        );
        await expect(
            runStockSearch({ dir: tempDir('stock'), query: 'fern' }, deps),
        ).rejects.toMatchObject({
            code: 'stock-key-missing',
            detail: { provider: 'openverse' },
        });
    });

    it('never lets a key reach the report', async () => {
        const { deps } = fake(
            {
                'pixabay.com': (url) => json({ error: `bad request for ${url.toString()}` }, 400),
                'api.openverse.org': () => json({ results: [] }),
            },
            {},
            { PIXABAY_API_KEY: 'pixabay-secret-key' },
        );
        const report = await runStockSearch({ dir: tempDir('stock'), query: 'fern' }, deps);
        expect(JSON.stringify(report)).not.toContain('pixabay-secret-key');
        expect(redactSecrets('https://pixabay.com/api/?key=abcdef123&q=x', [])).not.toContain(
            'abcdef123',
        );
    });
});

const DETAIL = {
    ...OPENVERSE_RESULTS.results[0],
};

function openverseDetail(detail: Record<string, unknown>, image: Buffer | null = RED): Fake {
    return fake(
        { 'api.openverse.org': () => json(detail) },
        image ? { [String(detail.url)]: image } : {},
    );
}

describe('stock fetch', () => {
    it('saves the image under assets/ and records its source and license', async () => {
        const dir = tempDir('stock');
        fs.mkdirSync(path.join(dir, 'assets'));
        fs.writeFileSync(
            path.join(dir, 'assets', 'SOURCES.json'),
            `${JSON.stringify({ 'logo.svg': { source: 'hand-drawn', license: 'MIT' } }, null, 4)}\n`,
        );
        const { deps } = openverseDetail(DETAIL);
        const report = await runStockFetch({ dir, id: 'openverse:ov-1', as: 'eggs' }, deps);
        expect(report.failures).toEqual([]);
        expect(report.exitCode).toBe(0);
        const file = path.join(dir, 'assets', 'eggs.png');
        expect(fs.readFileSync(file).equals(RED)).toBe(true);
        expect(report.artifacts.image).toBe(file);
        expect(report.stock).toMatchObject({
            id: 'openverse:ov-1',
            file: 'assets/eggs.png',
            width: 40,
            height: 30,
            license: 'pdm',
            skipped: false,
        });
        const sources = JSON.parse(
            fs.readFileSync(path.join(dir, 'assets', 'SOURCES.json'), 'utf-8'),
        );
        expect(Object.keys(sources)).toEqual(['logo.svg', 'eggs.png']);
        expect(sources['eggs.png']).toEqual({
            source: 'https://www.flickr.com/photos/bhl/1',
            license: 'pdm',
            licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
            id: 'openverse:ov-1',
            title: 'Eggs of British birds',
            creator: 'BioDivLibrary',
            url: 'https://live.staticflickr.com/6013/6012000493_ced35d5e50_b.jpg',
        });
    });

    it('scales an image longer than 3200 pixels down with ffmpeg', async () => {
        const dir = tempDir('stock');
        const wide = png(3300, 12, [90, 120, 60]);
        const { deps } = openverseDetail(DETAIL, wide);
        const report = await runStockFetch({ dir, id: 'openverse:ov-1', as: 'wide' }, deps);
        expect(report.failures).toEqual([]);
        expect(report.stock).toMatchObject({ width: 3200, resized: true, format: 'png' });
        const saved = imageInfo(fs.readFileSync(path.join(dir, 'assets', 'wide.png')));
        expect(saved?.width).toBe(3200);
        expect(fs.existsSync(path.join(dir, '.flipbook', 'tmp', 'stock'))).toBe(false);
    });

    it('skips a second fetch of the same image under the same name', async () => {
        const dir = tempDir('stock');
        const first = openverseDetail(DETAIL);
        await runStockFetch({ dir, id: 'openverse:ov-1', as: 'eggs' }, first.deps);
        const again = openverseDetail(DETAIL);
        const report = await runStockFetch({ dir, id: 'openverse:ov-1', as: 'eggs' }, again.deps);
        expect(report.exitCode).toBe(0);
        expect((report.stock as { skipped: boolean }).skipped).toBe(true);
        expect(again.calls).toEqual([]);
    });

    it('refuses a name another file already holds', async () => {
        const dir = tempDir('stock');
        fs.mkdirSync(path.join(dir, 'assets'));
        fs.writeFileSync(path.join(dir, 'assets', 'eggs.jpg'), 'not ours');
        const { deps } = openverseDetail(DETAIL);
        const report = await runStockFetch({ dir, id: 'openverse:ov-1', as: 'eggs' }, deps);
        expect(codes(report)).toEqual(['asset-conflict']);
        expect(fs.readFileSync(path.join(dir, 'assets', 'eggs.jpg'), 'utf-8')).toBe('not ours');
    });

    it('refuses to overwrite a SOURCES.json it cannot read', async () => {
        const dir = tempDir('stock');
        fs.mkdirSync(path.join(dir, 'assets'));
        fs.writeFileSync(path.join(dir, 'assets', 'SOURCES.json'), '{ broken');
        const { deps } = openverseDetail(DETAIL);
        const report = await runStockFetch({ dir, id: 'openverse:ov-1', as: 'eggs' }, deps);
        expect(codes(report)).toEqual(['asset-conflict']);
        expect(fs.existsSync(path.join(dir, 'assets', 'eggs.png'))).toBe(false);
    });

    it('refuses an Openverse image whose license is not cc0 or pdm', async () => {
        const { deps } = openverseDetail({ ...DETAIL, license: 'by-nc' });
        const dir = tempDir('stock');
        const report = await runStockFetch({ dir, id: 'openverse:ov-1', as: 'eggs' }, deps);
        expect(codes(report)).toEqual(['stock-rejected']);
        expect(report.failures[0].detail?.reason).toBe('license');
        expect(fs.existsSync(path.join(dir, 'assets'))).toBe(false);
    });

    it('refuses bytes that are not an image', async () => {
        const { deps } = openverseDetail(DETAIL, Buffer.from('<html>login</html>'));
        const report = await runStockFetch(
            { dir: tempDir('stock'), id: 'openverse:ov-1', as: 'eggs' },
            deps,
        );
        expect(codes(report)).toEqual(['stock-rejected']);
        expect(report.failures[0].detail?.reason).toBe('not-image');
    });

    it('reports an unknown id as stock-rejected', async () => {
        const { deps } = fake({ 'api.openverse.org': () => json({ detail: 'Not found.' }, 404) });
        const report = await runStockFetch(
            { dir: tempDir('stock'), id: 'openverse:nope', as: 'eggs' },
            deps,
        );
        expect(codes(report)).toEqual(['stock-rejected']);
        expect(report.failures[0].detail?.reason).toBe('not-found');
    });

    it('fetches from Pexels with the key and records the Pexels license', async () => {
        const dir = tempDir('stock');
        const { deps } = fake(
            {
                'api.pexels.com': () =>
                    json({
                        id: 11,
                        width: 1600,
                        height: 1200,
                        url: 'https://www.pexels.com/photo/11/',
                        photographer: 'Ada',
                        alt: 'A fern',
                        src: {
                            original: 'https://images.pexels.com/11/original.png',
                            large2x: 'https://images.pexels.com/11/large2x.png',
                        },
                    }),
            },
            { 'https://images.pexels.com/11/original.png': GREEN },
            { PEXELS_API_KEY: 'pexels-secret-key' },
        );
        const report = await runStockFetch({ dir, id: 'pexels:11', as: 'fern' }, deps);
        expect(report.failures).toEqual([]);
        const sources = JSON.parse(
            fs.readFileSync(path.join(dir, 'assets', 'SOURCES.json'), 'utf-8'),
        );
        expect(sources['fern.png']).toMatchObject({
            source: 'https://www.pexels.com/photo/11/',
            license: 'Pexels License',
            creator: 'Ada',
            id: 'pexels:11',
        });
        expect(JSON.stringify(sources)).not.toContain('pexels-secret-key');
    });
});

/** A real 16-bit PCM WAV: a quiet sine with one loud click at `clickSec`. */
function wav(seconds: number, rate = 8000, clickSec = seconds / 2): Buffer {
    const frames = Math.round(seconds * rate);
    const data = Buffer.alloc(frames * 2);
    for (let i = 0; i < frames; i++) {
        const click = Math.abs(i - Math.round(clickSec * rate)) < 4 ? 0.9 : 0;
        const v = 0.05 * Math.sin((2 * Math.PI * 440 * i) / rate) + click;
        data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2);
    }
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVE', 8, 'ascii');
    header.write('fmt ', 12, 'ascii');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
}

const TAP = wav(1.2);

const AUDIO_RESULTS = {
    results: [
        {
            id: 'au-1',
            title: 'Page Turn',
            url: 'https://cdn.example.org/previews/au-1-hq.mp3',
            foreign_landing_url: 'https://freesound.org/people/someone/sounds/1',
            creator: 'someone',
            license: 'cc0',
            license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
            provider: 'freesound',
            source: 'freesound',
            filetype: 'mp3',
            duration: 1975,
            tags: [{ name: 'page' }, { name: 'paper' }, { name: 'turn' }],
            waveform: 'https://api.openverse.org/v1/audio/au-1/waveform/',
        },
        {
            id: 'au-2',
            title: 'Attribution required',
            url: 'https://cdn.example.org/au-2.mp3',
            foreign_landing_url: 'https://freesound.org/people/other/sounds/2',
            license: 'by',
            source: 'freesound',
            duration: 3000,
        },
        {
            id: 'au-3',
            title: 'Gymnopedie No. 1',
            url: 'https://upload.example.org/Gymnopedie.ogg',
            foreign_landing_url: 'https://commons.wikimedia.org/w/index.php?curid=1',
            creator: 'Pianist',
            license: 'pdm',
            source: 'wikimedia_audio',
            filetype: 'ogg',
            duration: 204799,
            tags: [],
        },
    ],
};

describe('stock audio', () => {
    it('searches Openverse audio for cc0 and pdm only, even with image keys set', async () => {
        const { deps, calls } = fake(
            { 'api.openverse.org': () => json(AUDIO_RESULTS) },
            {},
            { PEXELS_API_KEY: 'pexels-secret-key', PIXABAY_API_KEY: 'pixabay-secret-key' },
        );
        const dir = tempDir('stock');
        const report = await runStockSearch(
            { dir, query: 'page turn', audio: true, length: 'shortest' },
            deps,
        );
        expect(report.exitCode).toBe(0);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('api api.openverse.org/v1/audio/?');
        expect(calls[0]).toContain('license=cc0%2Cpdm');
        expect(calls[0]).toContain('q=page+turn');
        expect(calls[0]).toContain('length=shortest');
        const stock = report.stock as {
            kind: string;
            providers: unknown[];
            results: Record<string, unknown>[];
        };
        expect(stock.kind).toBe('audio');
        expect(stock.providers).toEqual([{ provider: 'openverse', status: 'ok', count: 2 }]);
        expect(stock.results.map((r) => r.id)).toEqual([
            'openverse-audio:au-1',
            'openverse-audio:au-3',
        ]);
        expect(stock.results[0]).toEqual({
            id: 'openverse-audio:au-1',
            provider: 'openverse',
            title: 'Page Turn',
            durationSec: 1.975,
            license: 'cc0',
            licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
            creator: 'someone',
            source: 'freesound',
            pageUrl: 'https://freesound.org/people/someone/sounds/1',
            filetype: 'mp3',
            tags: ['page', 'paper', 'turn'],
            preview: 'https://cdn.example.org/previews/au-1-hq.mp3',
            waveform: 'https://api.openverse.org/v1/audio/au-1/waveform/',
        });
        expect(stock.results[1]).toMatchObject({ durationSec: 204.799, waveform: null });
        expect(report.artifacts.contactSheet).toBeUndefined();
    });

    it('reports no sound found as a warning', async () => {
        const { deps } = fake({ 'api.openverse.org': () => json({ results: [] }) });
        const report = await runStockSearch(
            { dir: tempDir('stock'), query: 'zzqx', audio: true },
            deps,
        );
        expect(warningCodes(report)).toEqual(['stock-no-results']);
        expect(report.warnings[0].message).toContain('No sound');
    });

    it('refuses image-only options with --audio and --length without it', async () => {
        const { deps, calls } = fake({});
        const dir = tempDir('stock');
        for (const options of [
            { audio: true, provider: 'pexels' as const },
            { audio: true, orientation: 'square' as const },
            { length: 'short' as const },
        ]) {
            await expect(
                runStockSearch({ dir, query: 'harpsichord', ...options }, deps),
            ).rejects.toMatchObject({ name: 'UsageError' });
        }
        expect(calls).toEqual([]);
    });

    const audioDetail = (detail: Record<string, unknown>, bytes: Buffer | null) =>
        fake(
            { 'api.openverse.org': () => json(detail) },
            bytes ? { [String(detail.url)]: bytes } : {},
        );

    it('saves a sound under the extension its bytes show and records it in SOURCES.json', async () => {
        const dir = tempDir('stock');
        fs.mkdirSync(path.join(dir, 'assets'));
        fs.writeFileSync(
            path.join(dir, 'assets', 'SOURCES.json'),
            `${JSON.stringify({ 'eggs.png': { source: 'x', license: 'pdm' } }, null, 4)}\n`,
        );
        const { deps, calls } = audioDetail(AUDIO_RESULTS.results[0], TAP);
        const report = await runStockFetch(
            { dir, id: 'openverse-audio:au-1', as: 'page-turn' },
            deps,
        );
        expect(report.failures).toEqual([]);
        expect(calls[0]).toBe('api api.openverse.org/v1/audio/au-1/');
        // The URL says mp3, the bytes are a WAV: the bytes win.
        const file = path.join(dir, 'assets', 'page-turn.wav');
        expect(fs.readFileSync(file).equals(TAP)).toBe(true);
        expect(report.artifacts.audio).toBe(file);
        expect(report.stock).toMatchObject({
            id: 'openverse-audio:au-1',
            kind: 'audio',
            file: 'assets/page-turn.wav',
            format: 'wav',
            sampleRate: 8000,
            channels: 1,
            license: 'cc0',
            skipped: false,
        });
        expect(Math.abs((report.stock as { durationSec: number }).durationSec - 1.2)).toBeLessThan(
            0.01,
        );
        const sources = JSON.parse(
            fs.readFileSync(path.join(dir, 'assets', 'SOURCES.json'), 'utf-8'),
        );
        expect(Object.keys(sources)).toEqual(['eggs.png', 'page-turn.wav']);
        expect(sources['page-turn.wav']).toEqual({
            source: 'https://freesound.org/people/someone/sounds/1',
            license: 'cc0',
            licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
            id: 'openverse-audio:au-1',
            title: 'Page Turn',
            creator: 'someone',
            url: 'https://cdn.example.org/previews/au-1-hq.mp3',
        });

        const again = audioDetail(AUDIO_RESULTS.results[0], TAP);
        const second = await runStockFetch(
            { dir, id: 'openverse-audio:au-1', as: 'page-turn' },
            again.deps,
        );
        expect((second.stock as { skipped: boolean }).skipped).toBe(true);
        expect(again.calls).toEqual([]);
    });

    it('keeps a compressed file as it came', async () => {
        const dir = tempDir('stock');
        const source = path.join(dir, 'made.flac');
        const { run } = await import('../src/engine/proc.ts');
        const made = await run('ffmpeg', [
            '-v',
            'error',
            '-f',
            'lavfi',
            '-i',
            'sine=frequency=220:sample_rate=44100:duration=2',
            source,
        ]);
        expect(made.code).toBe(0);
        const bytes = fs.readFileSync(source);
        const { deps } = audioDetail(AUDIO_RESULTS.results[2], bytes);
        const report = await runStockFetch(
            { dir, id: 'openverse-audio:au-3', as: 'gymnopedie' },
            deps,
        );
        expect(report.failures).toEqual([]);
        const saved = fs.readFileSync(path.join(dir, 'assets', 'gymnopedie.flac'));
        expect(saved.equals(bytes)).toBe(true);
        expect(report.stock).toMatchObject({ format: 'flac', sampleRate: 44100, license: 'pdm' });
    });

    it('refuses bytes that are not a sound, and a license that is not cc0 or pdm', async () => {
        const html = audioDetail(AUDIO_RESULTS.results[0], Buffer.from('<html>login</html>'));
        const notAudio = await runStockFetch(
            { dir: tempDir('stock'), id: 'openverse-audio:au-1', as: 'tap' },
            html.deps,
        );
        expect(codes(notAudio)).toEqual(['stock-rejected']);
        expect(notAudio.failures[0].detail?.reason).toBe('not-audio');

        const byLicense = audioDetail(AUDIO_RESULTS.results[1], TAP);
        const dir = tempDir('stock');
        const refused = await runStockFetch(
            { dir, id: 'openverse-audio:au-2', as: 'tap' },
            byLicense.deps,
        );
        expect(codes(refused)).toEqual(['stock-rejected']);
        expect(refused.failures[0].detail?.reason).toBe('license');
        expect(fs.existsSync(path.join(dir, 'assets'))).toBe(false);
    });

    it('refuses a sound whose download address is private', async () => {
        const { deps } = audioDetail(
            { ...AUDIO_RESULTS.results[0], url: 'https://internal.example.org/a.wav' },
            TAP,
        );
        const report = await runStockFetch(
            { dir: tempDir('stock'), id: 'openverse-audio:au-1', as: 'tap' },
            deps,
        );
        expect(report.failures[0].detail?.reason).toBe('unsafe-url');
    });
});

describe('audio sniffing', () => {
    it('tells mp3, ogg, flac and wav apart by their first bytes', () => {
        const pad = (head: number[] | string) =>
            Buffer.concat([
                typeof head === 'string' ? Buffer.from(head, 'latin1') : Buffer.from(head),
                Buffer.alloc(32),
            ]);
        expect(audioFormat(TAP)).toBe('wav');
        expect(audioFormat(pad('ID3\u0004\u0000'))).toBe('mp3');
        expect(audioFormat(pad([0xff, 0xfb, 0x90, 0x64]))).toBe('mp3');
        expect(audioFormat(pad('OggS\u0000\u0002'))).toBe('ogg');
        expect(audioFormat(pad('fLaC\u0000\u0000\u0000"'))).toBe('flac');
        // ADTS AAC shares the sync word with mp3 but has layer bits 00.
        expect(audioFormat(pad([0xff, 0xf1, 0x50, 0x80]))).toBeNull();
        expect(audioFormat(RED)).toBeNull();
        expect(audioFormat(Buffer.from('<html>'))).toBeNull();
    });
});

describe('download guard', () => {
    const get: HttpGet = async (url) => {
        if (url.hostname === 'hop.example.org') {
            return {
                status: 302,
                headers: { location: 'https://internal.example.org/x.png' },
                body: Buffer.alloc(0),
            };
        }
        return { status: 200, headers: {}, body: RED };
    };
    const lookup = async (host: string) => [
        { address: host.startsWith('internal.') ? '10.0.0.5' : '93.184.216.34', family: 4 },
    ];
    const reason = async (url: string, maxBytes = 1_000_000) => {
        try {
            await download(url, { get, lookup, maxBytes });
            return 'ok';
        } catch (error) {
            return (error as { reason?: string }).reason ?? String(error);
        }
    };

    it('downloads over HTTPS from a public address', async () => {
        expect(await reason('https://img.example.org/a.png')).toBe('ok');
    });

    it('lets through the fake-IP range proxies answer DNS with', async () => {
        const fakeIp = async () => [{ address: '198.18.97.237', family: 4 }];
        await expect(
            download('https://img.example.org/a.png', { get, lookup: fakeIp, maxBytes: 1_000_000 }),
        ).resolves.toMatchObject({ url: 'https://img.example.org/a.png' });
    });

    it('refuses plain HTTP, embedded credentials and private addresses', async () => {
        expect(await reason('http://img.example.org/a.png')).toBe('unsafe-url');
        expect(await reason('https://user:pw@img.example.org/a.png')).toBe('unsafe-url');
        expect(await reason('https://internal.example.org/a.png')).toBe('unsafe-url');
        expect(await reason('https://127.0.0.1/a.png')).toBe('unsafe-url');
        expect(await reason('https://[::1]/a.png')).toBe('unsafe-url');
        expect(await reason('https://localhost/a.png')).toBe('unsafe-url');
    });

    it('checks every redirect hop again', async () => {
        expect(await reason('https://hop.example.org/a.png')).toBe('unsafe-url');
    });

    it('refuses a file over the byte limit', async () => {
        expect(await reason('https://img.example.org/a.png', 10)).toBe('too-large');
    });
});

describe('image sniffing', () => {
    it('reads the format and size of PNG and JPEG', () => {
        expect(imageInfo(RED)).toEqual({ format: 'png', width: 40, height: 30 });
        // Smallest baseline JPEG header with an SOF0 marker for 7x5.
        const jpeg = Buffer.from([
            0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00,
            0x05, 0x00, 0x07, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
        ]);
        expect(imageInfo(jpeg)).toEqual({ format: 'jpeg', width: 7, height: 5 });
        expect(imageInfo(Buffer.from('<svg/>'))).toBeNull();
    });
});

describe('stock command line', () => {
    it('exits 2 on a malformed id or name, without touching the network', () => {
        const dir = tempDir('stock');
        const badId = runCli(['stock', 'fetch', dir, 'flickr:1', '--as', 'x']);
        expect(badId.status).toBe(2);
        const badName = runCli(['stock', 'fetch', dir, 'openverse:abc', '--as', '../x']);
        expect(badName.status).toBe(2);
        const noQuery = runCli(['stock', 'search', dir, '  ']);
        expect(noQuery.status).toBe(2);
        const badAudio = runCli(['stock', 'fetch', dir, 'openverse-audio:a/b', '--as', 'x']);
        expect(badAudio.status).toBe(2);
        const lengthAlone = runCli(['stock', 'search', dir, 'harp', '--length', 'short']);
        expect(lengthAlone.status).toBe(2);
    });

    it('exits 78 for a Pexels id without PEXELS_API_KEY', () => {
        const dir = tempDir('stock');
        const env = { ...process.env };
        delete env.PEXELS_API_KEY;
        const run = runCli(['stock', 'fetch', dir, 'pexels:1', '--as', 'x'], env);
        expect(run.status).toBe(78);
        const report = run.json as { command: string; environmentError: { error: string } };
        expect(report.command).toBe('stock-fetch');
        expect(report.environmentError.error).toBe('stock-key-missing');
    });
});
