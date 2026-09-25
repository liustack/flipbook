// The three image services: Pexels and Pixabay with the user's keys, and
// Openverse, which needs none and is asked for public domain only (cc0, pdm).
import { asNumber, asRecord, asString, fetchJson, type Net, StockError, userAgent } from './net.ts';

export const PROVIDERS = ['pexels', 'pixabay', 'openverse'] as const;
export type Provider = (typeof PROVIDERS)[number];
export type Orientation = 'landscape' | 'portrait' | 'square';

/** Environment variables that hold the keys. */
export const KEY_ENV = {
    pexels: 'PEXELS_API_KEY',
    pixabay: 'PIXABAY_API_KEY',
    openverseId: 'OPENVERSE_CLIENT_ID',
    openverseSecret: 'OPENVERSE_CLIENT_SECRET',
} as const;

export interface StockKeys {
    pexels?: string;
    pixabay?: string;
    openverse?: { clientId: string; clientSecret: string };
}

export function keysFromEnv(env: NodeJS.ProcessEnv): StockKeys {
    const read = (name: string) => env[name]?.trim() || undefined;
    const clientId = read(KEY_ENV.openverseId);
    const clientSecret = read(KEY_ENV.openverseSecret);
    return {
        pexels: read(KEY_ENV.pexels),
        pixabay: read(KEY_ENV.pixabay),
        openverse: clientId && clientSecret ? { clientId, clientSecret } : undefined,
    };
}

export function secretsOf(keys: StockKeys): string[] {
    return [keys.pexels, keys.pixabay, keys.openverse?.clientSecret].filter(
        (s): s is string => typeof s === 'string',
    );
}

/** One search result, the same shape for every service. */
export interface StockHit {
    /** `<provider>:<id>`, what `stock fetch` takes. */
    id: string;
    provider: Provider;
    title: string | null;
    width: number;
    height: number;
    license: string;
    licenseUrl: string | null;
    creator: string | null;
    /** Openverse's collection, such as `wikimedia` or `bio_diversity`. */
    source: string | null;
    /** The page about the image on the service or museum site. */
    pageUrl: string;
    thumbnail: string | null;
}

/** A hit with the address of the full image. */
export interface StockImage extends StockHit {
    url: string;
    /** A smaller rendition to try when `url` fails. */
    fallbackUrl?: string;
}

export const PEXELS_LICENSE = 'Pexels License';
export const PEXELS_LICENSE_URL = 'https://www.pexels.com/license/';
export const PIXABAY_LICENSE = 'Pixabay Content License';
export const PIXABAY_LICENSE_URL = 'https://pixabay.com/service/license-summary/';
const PUBLIC_DOMAIN = new Set(['cc0', 'pdm']);

export function isPublicDomain(license: string | undefined): boolean {
    return PUBLIC_DOMAIN.has((license ?? '').toLowerCase());
}

function matchesOrientation(width: number, height: number, orientation?: Orientation): boolean {
    if (!orientation || width === 0 || height === 0) return true;
    if (orientation === 'landscape') return width > height;
    if (orientation === 'portrait') return height > width;
    return Math.abs(width - height) <= Math.max(width, height) * 0.05;
}

export interface SearchOptions {
    query: string;
    count: number;
    orientation?: Orientation;
    /** Openverse only: one collection. */
    source?: string;
}

// ---------------------------------------------------------------- Pexels

function pexelsHeaders(key: string): Record<string, string> {
    return { Authorization: key, 'User-Agent': userAgent() };
}

function pexelsHit(raw: unknown): StockImage | null {
    const photo = asRecord(raw);
    if (!photo) return null;
    const id = photo.id;
    const photoId = typeof id === 'number' || typeof id === 'string' ? String(id) : '';
    if (!photoId) return null;
    const src = asRecord(photo.src) ?? {};
    const url = asString(src.original) ?? asString(src.large2x);
    if (!url) return null;
    return {
        id: `pexels:${photoId}`,
        provider: 'pexels',
        title: asString(photo.alt) ?? null,
        width: asNumber(photo.width) ?? 0,
        height: asNumber(photo.height) ?? 0,
        license: PEXELS_LICENSE,
        licenseUrl: PEXELS_LICENSE_URL,
        creator: asString(photo.photographer) ?? null,
        source: null,
        pageUrl: asString(photo.url) ?? `https://www.pexels.com/photo/${photoId}/`,
        thumbnail: asString(src.medium) ?? asString(src.small) ?? asString(src.tiny) ?? null,
        url,
        fallbackUrl: asString(src.original) ? asString(src.large2x) : undefined,
    };
}

export async function searchPexels(
    options: SearchOptions,
    key: string,
    net: Net,
): Promise<StockHit[]> {
    const url = new URL('https://api.pexels.com/v1/search');
    url.searchParams.set('query', options.query);
    url.searchParams.set('per_page', String(options.count));
    if (options.orientation) url.searchParams.set('orientation', options.orientation);
    const json = await fetchJson('Pexels', url.toString(), { headers: pexelsHeaders(key) }, net);
    const photos = asRecord(json)?.photos;
    return (Array.isArray(photos) ? photos : [])
        .map(pexelsHit)
        .filter((hit): hit is StockImage => hit !== null)
        .slice(0, options.count);
}

async function pexelsImage(photoId: string, key: string, net: Net): Promise<StockImage> {
    const url = `https://api.pexels.com/v1/photos/${encodeURIComponent(photoId)}`;
    const hit = pexelsHit(await fetchJson('Pexels', url, { headers: pexelsHeaders(key) }, net));
    if (!hit) throw new StockError('not-found', `Pexels has no photo ${photoId}`);
    return hit;
}

// ---------------------------------------------------------------- Pixabay

function pixabayHit(raw: unknown): StockImage | null {
    const photo = asRecord(raw);
    if (!photo) return null;
    const photoId = photo.id !== undefined ? String(photo.id) : '';
    const url = asString(photo.largeImageURL);
    if (!photoId || !url) return null;
    return {
        id: `pixabay:${photoId}`,
        provider: 'pixabay',
        title: asString(photo.tags) ?? null,
        width: asNumber(photo.imageWidth) ?? 0,
        height: asNumber(photo.imageHeight) ?? 0,
        license: PIXABAY_LICENSE,
        licenseUrl: PIXABAY_LICENSE_URL,
        creator: asString(photo.user) ?? null,
        source: null,
        pageUrl: asString(photo.pageURL) ?? `https://pixabay.com/photos/${photoId}/`,
        thumbnail: asString(photo.webformatURL) ?? asString(photo.previewURL) ?? null,
        url,
    };
}

function pixabayOrientation(orientation?: Orientation): string | undefined {
    if (orientation === 'landscape') return 'horizontal';
    if (orientation === 'portrait') return 'vertical';
    return undefined;
}

export async function searchPixabay(
    options: SearchOptions,
    key: string,
    net: Net,
): Promise<StockHit[]> {
    const url = new URL('https://pixabay.com/api/');
    url.searchParams.set('key', key);
    url.searchParams.set('q', options.query.slice(0, 100));
    url.searchParams.set('per_page', String(Math.max(3, options.count)));
    url.searchParams.set('safesearch', 'true');
    const orientation = pixabayOrientation(options.orientation);
    if (orientation) url.searchParams.set('orientation', orientation);
    const json = await fetchJson(
        'Pixabay',
        url.toString(),
        { headers: { 'User-Agent': userAgent() } },
        net,
    );
    const hits = asRecord(json)?.hits;
    return (Array.isArray(hits) ? hits : [])
        .map(pixabayHit)
        .filter((hit): hit is StockImage => hit !== null)
        .filter((hit) => matchesOrientation(hit.width, hit.height, options.orientation))
        .slice(0, options.count);
}

async function pixabayImage(photoId: string, key: string, net: Net): Promise<StockImage> {
    const url = new URL('https://pixabay.com/api/');
    url.searchParams.set('key', key);
    url.searchParams.set('id', photoId);
    const json = await fetchJson(
        'Pixabay',
        url.toString(),
        { headers: { 'User-Agent': userAgent() } },
        net,
    );
    const hits = asRecord(json)?.hits;
    const hit = pixabayHit(Array.isArray(hits) ? hits[0] : undefined);
    if (!hit) throw new StockError('not-found', `Pixabay has no image ${photoId}`);
    return hit;
}

// ---------------------------------------------------------------- Openverse

export const OPENVERSE_API = 'https://api.openverse.org/v1/images/';
const OPENVERSE_TOKEN = 'https://api.openverse.org/v1/auth_tokens/token/';

const tokens = new Map<string, { token: string; expiresAt: number }>();

async function openverseHeaders(
    credentials: StockKeys['openverse'],
    net: Net,
): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'User-Agent': userAgent() };
    if (!credentials) return headers;
    const cached = tokens.get(credentials.clientId);
    if (cached && cached.expiresAt > Date.now() + 30_000) {
        headers.Authorization = `Bearer ${cached.token}`;
        return headers;
    }
    const json = await fetchJson(
        'Openverse',
        OPENVERSE_TOKEN,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': userAgent(),
            },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: credentials.clientId,
                client_secret: credentials.clientSecret,
            }).toString(),
        },
        net,
    );
    const token = asString(asRecord(json)?.access_token);
    if (!token) throw new StockError('key', 'Openverse returned no access token');
    const expiresIn = asNumber(asRecord(json)?.expires_in) ?? 3600;
    tokens.set(credentials.clientId, { token, expiresAt: Date.now() + expiresIn * 1000 });
    headers.Authorization = `Bearer ${token}`;
    return headers;
}

function openverseHit(raw: unknown): StockImage | null {
    const image = asRecord(raw);
    if (!image) return null;
    const id = asString(image.id);
    const url = asString(image.url);
    const license = (asString(image.license) ?? '').toLowerCase();
    if (!id || !url || !isPublicDomain(license)) return null;
    return {
        id: `openverse:${id}`,
        provider: 'openverse',
        title: asString(image.title) ?? null,
        width: asNumber(image.width) ?? 0,
        height: asNumber(image.height) ?? 0,
        license,
        licenseUrl: asString(image.license_url) ?? null,
        creator: asString(image.creator) ?? null,
        source: asString(image.source) ?? asString(image.provider) ?? null,
        pageUrl: asString(image.foreign_landing_url) ?? url,
        thumbnail: asString(image.thumbnail) ?? null,
        url,
    };
}

export async function searchOpenverse(
    options: SearchOptions,
    credentials: StockKeys['openverse'],
    net: Net,
): Promise<StockHit[]> {
    const url = new URL(OPENVERSE_API);
    url.searchParams.set('q', options.query);
    url.searchParams.set('license', 'cc0,pdm');
    url.searchParams.set('page_size', String(Math.min(20, options.count * 2)));
    url.searchParams.set('mature', 'false');
    if (options.source) url.searchParams.set('source', options.source);
    if (options.orientation === 'landscape') url.searchParams.set('aspect_ratio', 'wide');
    if (options.orientation === 'portrait') url.searchParams.set('aspect_ratio', 'tall');
    if (options.orientation === 'square') url.searchParams.set('aspect_ratio', 'square');
    const headers = await openverseHeaders(credentials, net);
    const json = await fetchJson('Openverse', url.toString(), { headers }, net);
    const results = asRecord(json)?.results;
    return (Array.isArray(results) ? results : [])
        .map(openverseHit)
        .filter((hit): hit is StockImage => hit !== null)
        .filter((hit) => matchesOrientation(hit.width, hit.height, options.orientation))
        .slice(0, options.count);
}

async function openverseImage(
    imageId: string,
    credentials: StockKeys['openverse'],
    net: Net,
): Promise<StockImage> {
    const headers = await openverseHeaders(credentials, net);
    const json = await fetchJson(
        'Openverse',
        `${OPENVERSE_API}${encodeURIComponent(imageId)}/`,
        { headers },
        net,
    );
    const license = asString(asRecord(json)?.license);
    if (!isPublicDomain(license)) {
        throw new StockError(
            'license',
            `Openverse image ${imageId} is licensed "${license ?? 'unknown'}", not cc0 or pdm`,
            { license: license ?? null },
        );
    }
    const hit = openverseHit(json);
    if (!hit) throw new StockError('not-found', `Openverse has no image ${imageId}`);
    return hit;
}

// ---------------------------------------------------------------- dispatch

/** `pexels:123` into its parts, or null when malformed. */
export function parseStockId(ref: string): { provider: Provider; id: string } | null {
    const m = /^(pexels|pixabay|openverse):([A-Za-z0-9_-]{1,80})$/.exec(ref.trim());
    return m ? { provider: m[1] as Provider, id: m[2] } : null;
}

export function needsKey(provider: Provider): provider is 'pexels' | 'pixabay' {
    return provider !== 'openverse';
}

export async function searchProvider(
    provider: Provider,
    options: SearchOptions,
    keys: StockKeys,
    net: Net,
): Promise<StockHit[]> {
    if (provider === 'pexels') return searchPexels(options, keys.pexels as string, net);
    if (provider === 'pixabay') return searchPixabay(options, keys.pixabay as string, net);
    return searchOpenverse(options, keys.openverse, net);
}

export async function lookupImage(
    provider: Provider,
    id: string,
    keys: StockKeys,
    net: Net,
): Promise<StockImage> {
    if (provider === 'pexels') return pexelsImage(id, keys.pexels as string, net);
    if (provider === 'pixabay') return pixabayImage(id, keys.pixabay as string, net);
    return openverseImage(id, keys.openverse, net);
}
