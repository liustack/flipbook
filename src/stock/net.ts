// JSON requests to the image services, with retries on HTTP 429 and every
// known key scrubbed from anything that can reach a report.
import { appVersion } from '../paths.ts';

/** Why a stock request went wrong. The command maps each to an exit code. */
export type StockErrorReason =
    | 'unreachable'
    | 'key'
    | 'not-found'
    | 'license'
    | 'unsafe-url'
    | 'not-image'
    | 'too-large';

export class StockError extends Error {
    readonly reason: StockErrorReason;
    readonly detail: Record<string, unknown>;

    constructor(reason: StockErrorReason, message: string, detail: Record<string, unknown> = {}) {
        super(message);
        this.name = 'StockError';
        this.reason = reason;
        this.detail = detail;
    }
}

export type SleepFn = (ms: number) => Promise<void>;

export interface Net {
    fetch: typeof fetch;
    sleep: SleepFn;
    /** Keys and secrets to scrub from messages. */
    secrets: string[];
}

export function userAgent(): string {
    return `flipbook/${appVersion()} (+https://github.com/liustack/flipbook)`;
}

const KEY_QUERY = /([?&](?:api_)?key=)[^&\s"'<>]*/gi;
const CLIENT_SECRET_QUERY = /(client_secret=)[^&\s"'<>]*/gi;

/**
 * Pixabay puts its key in the query string as `key=`, so both the query forms
 * and every known secret (6 characters or longer) are replaced.
 */
export function redactSecrets(text: string, secrets: string[]): string {
    let out = text;
    for (const secret of secrets.filter((s) => s.length >= 6).sort((a, b) => b.length - a.length)) {
        out = out.split(secret).join('[redacted]');
    }
    return out.replace(KEY_QUERY, '$1[redacted]').replace(CLIENT_SECRET_QUERY, '$1[redacted]');
}

function retryDelayMs(res: Response, attempt: number): number {
    const raw = res.headers.get('Retry-After');
    const seconds = raw ? Number(raw) : Number.NaN;
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(10_000, seconds * 1000);
    return attempt === 0 ? 500 : 1500;
}

/**
 * GET or POST one API endpoint and parse its JSON. 429 is retried twice.
 * A failed connection, a 5xx, a 429 that persists and non-JSON are
 * `unreachable`, 401 and 403 are `key`, 404 is `not-found`.
 */
export async function fetchJson(
    service: string,
    url: string,
    init: RequestInit,
    net: Net,
): Promise<unknown> {
    const scrub = (text: string) => redactSecrets(text, net.secrets);
    for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
            res = await net.fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
        } catch (error) {
            const cause = (error as { cause?: { code?: string } }).cause?.code;
            throw new StockError(
                'unreachable',
                scrub(
                    `${service} could not be reached: ${(error as Error).message}${cause ? ` (${cause})` : ''}`,
                ),
                { service },
            );
        }
        const text = await res.text();
        if (res.status === 429 && attempt < 2) {
            await net.sleep(retryDelayMs(res, attempt));
            continue;
        }
        const body = scrub(text.slice(0, 300));
        if (res.status === 401 || res.status === 403) {
            throw new StockError(
                'key',
                `${service} refused the key (HTTP ${res.status}): ${body}`,
                {
                    service,
                    status: res.status,
                },
            );
        }
        if (res.status === 404) {
            throw new StockError('not-found', `${service} has no such image (HTTP 404)`, {
                service,
                status: 404,
            });
        }
        if (!res.ok) {
            throw new StockError('unreachable', `${service} answered HTTP ${res.status}: ${body}`, {
                service,
                status: res.status,
            });
        }
        try {
            return JSON.parse(text) as unknown;
        } catch {
            throw new StockError('unreachable', `${service} did not answer with JSON`, {
                service,
                status: res.status,
            });
        }
    }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

export function asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
