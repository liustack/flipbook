// Image downloads from addresses an API handed back. Only HTTPS, no
// credentials in the URL, no private or reserved addresses: the host is
// resolved first, every address it resolves to is checked, and the connection
// is pinned to the address that passed, so a second DNS answer cannot swap in
// an internal one. Redirects are followed by hand and each hop is checked the
// same way.
import { lookup as dnsLookup } from 'dns/promises';
import * as https from 'https';
import { isIP } from 'net';
import { StockError, userAgent } from './net.ts';

export interface PinnedTarget {
    hostname: string;
    address: string;
    family: number;
}

export type DnsLookup = (hostname: string) => Promise<{ address: string; family: number }[]>;

export interface HttpResponse {
    status: number;
    headers: Record<string, string | undefined>;
    body: Buffer;
}

/** One GET with no redirect following, connected to `pin.address`. */
export type HttpGet = (
    url: URL,
    pin: PinnedTarget,
    options: { maxBytes: number; headers: Record<string, string> },
) => Promise<HttpResponse>;

export const defaultLookup: DnsLookup = (hostname) =>
    dnsLookup(hostname, { all: true, verbatim: true });

const BLOCKED_HOSTNAMES = new Set([
    'localhost',
    'localhost.localdomain',
    'metadata.google.internal',
    'metadata.amazonaws.com',
    'metadata.azure.internal',
]);

function ipv4Value(address: string): number | null {
    const parts = address.split('.').map((p) => Number.parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
        return null;
    }
    return ((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3];
}

// 198.18.0.0/15 (benchmarking) is left open on purpose: proxy tools in
// fake-IP mode answer every DNS lookup from it, and the proxy then connects
// to the real host.
const V4_BLOCKED: [string, string][] = [
    ['0.0.0.0', '0.255.255.255'],
    ['10.0.0.0', '10.255.255.255'],
    ['100.64.0.0', '100.127.255.255'],
    ['127.0.0.0', '127.255.255.255'],
    ['169.254.0.0', '169.254.255.255'],
    ['172.16.0.0', '172.31.255.255'],
    ['192.0.0.0', '192.0.0.255'],
    ['192.0.2.0', '192.0.2.255'],
    ['192.168.0.0', '192.168.255.255'],
    ['198.51.100.0', '198.51.100.255'],
    ['203.0.113.0', '203.0.113.255'],
    ['224.0.0.0', '255.255.255.255'],
];

function privateV4(address: string): boolean {
    const value = ipv4Value(address);
    if (value === null) return true;
    return V4_BLOCKED.some(([from, to]) => {
        const lo = ipv4Value(from) as number;
        const hi = ipv4Value(to) as number;
        return value >= lo && value <= hi;
    });
}

/** The eight 16-bit groups of an IPv6 address, or null. */
function ipv6Groups(address: string): number[] | null {
    let text = address.toLowerCase().split('%')[0];
    // A dotted IPv4 tail (::ffff:10.0.0.1) becomes two groups.
    const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text);
    if (dotted) {
        const v4 = ipv4Value(dotted[2]);
        if (v4 === null) return null;
        text = `${dotted[1]}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
    }
    const halves = text.split('::');
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
    if (fill < 0) return null;
    const groups = [...left, ...Array(fill).fill('0'), ...right].map((g) =>
        /^[0-9a-f]{1,4}$/.test(g) ? Number.parseInt(g, 16) : Number.NaN,
    );
    return groups.length === 8 && groups.every((g) => !Number.isNaN(g)) ? groups : null;
}

function privateV6(address: string): boolean {
    const g = ipv6Groups(address);
    if (!g) return true;
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) addresses.
    if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
        if (g[5] === 0 && g[6] === 0 && g[7] <= 1) return true;
        return privateV4(`${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`);
    }
    if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
    if ((g[0] & 0xffc0) === 0xfe80) return true; // link local fe80::/10
    if ((g[0] & 0xff00) === 0xff00) return true; // multicast ff00::/8
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
    if (g[0] === 0x0064 && g[1] === 0xff9b) {
        // NAT64 carries an IPv4 address in its last 32 bits.
        return privateV4(`${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`);
    }
    return false;
}

export function isPrivateAddress(address: string): boolean {
    const family = isIP(address.split('%')[0]);
    if (family === 4) return privateV4(address);
    if (family === 6) return privateV6(address);
    return true;
}

function refuse(url: string, why: string): StockError {
    return new StockError('unsafe-url', `Refusing to download ${url}: ${why}`, { url });
}

/** Parse and vet one download address, resolving its host. */
export async function vetTarget(
    raw: string,
    lookup: DnsLookup,
): Promise<{ url: URL; pin: PinnedTarget }> {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw refuse(raw, 'not a valid URL');
    }
    if (url.protocol !== 'https:') throw refuse(raw, 'only HTTPS is downloaded');
    if (url.username !== '' || url.password !== '') {
        throw refuse(raw, 'the URL carries credentials');
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
        throw refuse(raw, `${hostname} is a local name`);
    }
    const literal = isIP(hostname);
    if (literal > 0) {
        if (isPrivateAddress(hostname)) throw refuse(raw, `${hostname} is a private address`);
        return { url, pin: { hostname, address: hostname, family: literal } };
    }
    let answers: { address: string; family: number }[];
    try {
        answers = await lookup(hostname);
    } catch (error) {
        throw new StockError(
            'unreachable',
            `The name ${hostname} did not resolve: ${(error as Error).message}`,
            { url: raw },
        );
    }
    if (answers.length === 0) {
        throw new StockError('unreachable', `The name ${hostname} did not resolve`, { url: raw });
    }
    const bad = answers.find((a) => isPrivateAddress(a.address));
    if (bad) throw refuse(raw, `${hostname} resolves to the private address ${bad.address}`);
    return { url, pin: { hostname, ...answers[0] } };
}

/** node:https GET pinned to the vetted address, the body capped at maxBytes. */
export const pinnedGet: HttpGet = (url, pin, options) =>
    new Promise((resolve, reject) => {
        const req = https.get(
            url,
            {
                headers: options.headers,
                timeout: 60_000,
                servername: isIP(pin.hostname) ? undefined : pin.hostname,
                lookup: (_host, opts, callback) => {
                    const all = (opts as { all?: boolean }).all;
                    if (all) {
                        (callback as (e: null, a: { address: string; family: number }[]) => void)(
                            null,
                            [{ address: pin.address, family: pin.family }],
                        );
                    } else {
                        callback(null, pin.address, pin.family);
                    }
                },
            },
            (res) => {
                const headers: Record<string, string | undefined> = {};
                for (const [key, value] of Object.entries(res.headers)) {
                    headers[key] = Array.isArray(value) ? value.join(', ') : value;
                }
                const status = res.statusCode ?? 0;
                if (status >= 300 && status < 400) {
                    res.resume();
                    resolve({ status, headers, body: Buffer.alloc(0) });
                    return;
                }
                const chunks: Buffer[] = [];
                let size = 0;
                res.on('data', (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > options.maxBytes) {
                        req.destroy();
                        reject(
                            new StockError(
                                'too-large',
                                `${url} is larger than ${options.maxBytes} bytes`,
                                { url: url.toString(), maxBytes: options.maxBytes },
                            ),
                        );
                        return;
                    }
                    chunks.push(chunk);
                });
                res.on('end', () => resolve({ status, headers, body: Buffer.concat(chunks) }));
                res.on('error', reject);
            },
        );
        req.on('timeout', () => req.destroy(new Error('timed out after 60 s')));
        req.on('error', (error) => {
            if (error instanceof StockError) reject(error);
            else
                reject(
                    new StockError('unreachable', `Downloading ${url} failed: ${error.message}`, {
                        url: url.toString(),
                    }),
                );
        });
    });

export interface DownloadOptions {
    lookup?: DnsLookup;
    get?: HttpGet;
    maxBytes: number;
    maxRedirects?: number;
}

/** The bytes at `raw`, following at most `maxRedirects` redirects, each vetted. */
export async function download(
    raw: string,
    options: DownloadOptions,
): Promise<{ bytes: Buffer; url: string }> {
    const lookup = options.lookup ?? defaultLookup;
    const get = options.get ?? pinnedGet;
    const maxRedirects = options.maxRedirects ?? 3;
    let current = raw;
    for (let hop = 0; ; hop++) {
        const { url, pin } = await vetTarget(current, lookup);
        const res = await get(url, pin, {
            maxBytes: options.maxBytes,
            // Openverse answers 406 to `Accept: image/*` for some thumbnails.
            headers: { 'User-Agent': userAgent(), Accept: '*/*' },
        });
        if (res.status >= 300 && res.status < 400 && res.headers.location) {
            if (hop >= maxRedirects) {
                throw new StockError(
                    'unreachable',
                    `${raw} redirected more than ${maxRedirects} times`,
                    {
                        url: raw,
                    },
                );
            }
            current = new URL(res.headers.location, url).toString();
            continue;
        }
        if (res.status === 404 || res.status === 410) {
            throw new StockError('not-found', `${current} answered HTTP ${res.status}`, {
                url: current,
            });
        }
        if (res.status < 200 || res.status >= 300) {
            throw new StockError('unreachable', `${current} answered HTTP ${res.status}`, {
                url: current,
                status: res.status,
            });
        }
        const declared = Number(res.headers['content-length'] ?? '0');
        if (declared > options.maxBytes || res.body.length > options.maxBytes) {
            throw new StockError(
                'too-large',
                `${current} is larger than ${options.maxBytes} bytes`,
                {
                    url: current,
                    maxBytes: options.maxBytes,
                },
            );
        }
        return { bytes: res.body, url: current };
    }
}
