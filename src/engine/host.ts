// The init script installed in every page before any page script runs.
// Serialized with Function.prototype.toString: no imports, no module scope.
import type { ResolvedTimeline } from './timelineResolve.ts';

export interface HostConfig {
    /** Date.now() at t = 0. */
    epochMs: number;
    /** performance.now() at t = 0. */
    perfOriginMs: number;
    /** Seed behind Math.random and crypto.getRandomValues. */
    randomSeed: number;
    timeline: ResolvedTimeline;
    fonts: { family: string; url: string; weight: string; style: string }[];
    /** The fake origin; blocked channels are reported to <origin>/__flipbook/blocked/<what>. */
    origin: string;
}

/** Attribute on <html> that hides every layer except the paper layer. */
export const CONTENT_ATTR = 'data-flipbook-content';
/** Attribute that marks the paper layer. */
export const LAYER_ATTR = 'data-flipbook-layer';

export interface RegisteredText {
    id?: string;
    text: string;
    font: string;
    box: { x: number; y: number; width: number; height: number };
    /** Exempt from the safe-area checks, like data-flipbook-allow-overflow. */
    allowOverflow?: boolean;
}

/** Calls the page made to clock and random APIs flipbook forbids: count and first call site. */
export type ForbiddenCalls = Record<string, { count: number; at?: string }>;

export interface HostApi {
    render: true;
    timeline: ResolvedTimeline;
    now(): number;
    advance(ms: number): void;
    syncAnimations(): void;
    setContent(visible: boolean): void;
    setTextVisible(visible: boolean): void;
    texts: RegisteredText[];
    registerText(entry: RegisteredText): void;
    forbiddenCalls(): ForbiddenCalls;
}

export function installHost(config: HostConfig): void {
    const w = window as unknown as Record<string, unknown>;
    let now = 0;

    const mulberry = (seed: number) => {
        let a = seed >>> 0;
        return () => {
            a = (a + 0x6d2b79f5) >>> 0;
            let x = a;
            x = Math.imul(x ^ (x >>> 15), x | 1);
            x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
            return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
        };
    };

    // Every call below is one the rules forbid. It still gets the virtual
    // value, and it is counted with its first call site for check to report.
    const RealError = Error;
    const calls: ForbiddenCalls = {};
    const callSite = (): string | undefined => {
        const stack = new RealError().stack ?? '';
        const match = /https?:\/\/flipbook\.local\/([^\s:)]+):(\d+):\d+/.exec(stack);
        return match ? `${match[1]}:${match[2]}` : undefined;
    };
    const note = (api: string) => {
        const entry = calls[api];
        if (entry) entry.count += 1;
        else calls[api] = { count: 1, at: callSite() };
    };
    const wallNow = () => config.epochMs + now;

    const RealDate = Date;
    function FakeDate(this: unknown, ...args: unknown[]): unknown {
        if (!new.target) {
            note('Date()');
            return new RealDate(wallNow()).toString();
        }
        if (args.length === 0) {
            note('new Date()');
            return new RealDate(wallNow());
        }
        return new (RealDate as unknown as new (...a: unknown[]) => Date)(...args);
    }
    FakeDate.prototype = RealDate.prototype;
    // Without this, Date.prototype.constructor and new Date().constructor reach the real clock.
    Object.defineProperty(RealDate.prototype, 'constructor', {
        value: FakeDate,
        writable: true,
        configurable: true,
        enumerable: false,
    });
    FakeDate.now = () => {
        note('Date.now()');
        return wallNow();
    };
    FakeDate.parse = RealDate.parse;
    FakeDate.UTC = RealDate.UTC;
    w.Date = FakeDate;
    const perfNow = () => {
        note('performance.now()');
        return config.perfOriginMs + now;
    };
    Object.defineProperty(performance, 'now', { value: perfNow, configurable: true });
    Object.defineProperty(performance, 'timeOrigin', {
        get: () => {
            note('performance.timeOrigin');
            return config.epochMs - config.perfOriginMs;
        },
        configurable: true,
    });
    const timelineTime = Object.getOwnPropertyDescriptor(
        AnimationTimeline.prototype,
        'currentTime',
    );
    if (timelineTime?.get) {
        Object.defineProperty(document.timeline, 'currentTime', {
            get: () => {
                note('document.timeline.currentTime');
                return now;
            },
            configurable: true,
        });
    }

    // Intl formats the real current time when it gets no date.
    const Dtf = Intl.DateTimeFormat.prototype;
    const formatGetter = Object.getOwnPropertyDescriptor(Dtf, 'format')?.get;
    if (formatGetter) {
        Object.defineProperty(Dtf, 'format', {
            get(this: Intl.DateTimeFormat) {
                const format = formatGetter.call(this) as (date?: Date | number) => string;
                return (date?: Date | number) => {
                    if (date !== undefined) return format(date);
                    note('Intl.DateTimeFormat without a date');
                    return format(wallNow());
                };
            },
            configurable: true,
        });
    }
    const formatToParts = Dtf.formatToParts;
    Dtf.formatToParts = function (this: Intl.DateTimeFormat, date?: Date | number) {
        if (date !== undefined) return formatToParts.call(this, date);
        note('Intl.DateTimeFormat without a date');
        return formatToParts.call(this, wallNow());
    };

    // Temporal.Now reads the real clock too.
    type TemporalNow = Record<string, (...a: unknown[]) => unknown>;
    const temporal = (w.Temporal ?? null) as {
        Now: TemporalNow;
        Instant: {
            fromEpochMilliseconds(ms: number): {
                toZonedDateTimeISO(tz: unknown): Record<string, () => unknown>;
            };
        };
    } | null;
    if (temporal?.Now) {
        const Now = temporal.Now;
        const zoneOf = (tz: unknown) => (tz === undefined ? Now.timeZoneId() : tz);
        const zoned = (tz: unknown) =>
            temporal.Instant.fromEpochMilliseconds(wallNow()).toZonedDateTimeISO(zoneOf(tz));
        const replace = (name: string, value: (tz?: unknown) => unknown) => {
            if (typeof Now[name] !== 'function') return;
            Object.defineProperty(Now, name, {
                value: (tz?: unknown) => {
                    note(`Temporal.Now.${name}()`);
                    return value(tz);
                },
                writable: true,
                configurable: true,
            });
        };
        replace('instant', () => temporal.Instant.fromEpochMilliseconds(wallNow()));
        replace('zonedDateTimeISO', (tz) => zoned(tz));
        replace('plainDateTimeISO', (tz) => zoned(tz).toPlainDateTime());
        replace('plainDateISO', (tz) => zoned(tz).toPlainDate());
        replace('plainTimeISO', (tz) => zoned(tz).toPlainTime());
    }

    const random = mulberry(config.randomSeed);
    Math.random = () => {
        note('Math.random()');
        return random();
    };
    const cryptoRandom = mulberry(config.randomSeed ^ 0x9e3779b9);
    const fill = <T extends ArrayBufferView | null>(array: T): T => {
        if (array) {
            const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
            for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(cryptoRandom() * 256);
        }
        return array;
    };
    Object.defineProperty(crypto, 'getRandomValues', {
        value: <T extends ArrayBufferView | null>(array: T): T => {
            note('crypto.getRandomValues()');
            return fill(array);
        },
        configurable: true,
    });
    Object.defineProperty(crypto, 'randomUUID', {
        value: () => {
            note('crypto.randomUUID()');
            const b = fill(new Uint8Array(16));
            b[6] = (b[6] & 0x0f) | 0x40;
            b[8] = (b[8] & 0x3f) | 0x80;
            const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
            return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
        },
        configurable: true,
    });

    // Channels the HTTP and WebSocket routes cannot see. Each constructor reports
    // itself through the fake origin (recorded as external-request) and throws.
    const realFetch = window.fetch.bind(window);
    const refuse = (name: string, what: (args: unknown[]) => string) =>
        function refused(...args: unknown[]): never {
            // Best effort: the report fails only when the page is already closing.
            realFetch(
                `${config.origin}/__flipbook/blocked/${encodeURIComponent(what(args))}`,
            ).catch(() => undefined);
            throw new DOMException(
                `${name} is not available: flipbook renders without network.`,
                'NotSupportedError',
            );
        };
    for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection']) {
        if (name in w) {
            Object.defineProperty(w, name, {
                value: refuse(name, () => `webrtc:${name}`),
                writable: true,
                configurable: true,
            });
        }
    }
    if ('WebTransport' in w) {
        Object.defineProperty(w, 'WebTransport', {
            value: refuse('WebTransport', (args) => `webtransport:${String(args[0])}`),
            writable: true,
            configurable: true,
        });
    }

    let nextId = 1;
    const frames = new Map<number, FrameRequestCallback>();
    interface Timer {
        at: number;
        every: number;
        fn: unknown;
        args: unknown[];
        order: number;
    }
    const timers = new Map<number, Timer>();
    let order = 0;
    w.requestAnimationFrame = (fn: FrameRequestCallback) => {
        const id = nextId++;
        frames.set(id, fn);
        return id;
    };
    w.cancelAnimationFrame = (id: number) => {
        frames.delete(id);
    };
    const addTimer = (fn: unknown, ms: unknown, args: unknown[], repeat: boolean) => {
        const id = nextId++;
        const delay = Math.max(0, Number(ms) || 0);
        timers.set(id, {
            at: now + delay,
            every: repeat ? Math.max(1, delay) : 0,
            fn,
            args,
            order: order++,
        });
        return id;
    };
    w.setTimeout = (fn: unknown, ms?: unknown, ...args: unknown[]) => addTimer(fn, ms, args, false);
    w.setInterval = (fn: unknown, ms?: unknown, ...args: unknown[]) => addTimer(fn, ms, args, true);
    w.clearTimeout = (id: number) => {
        timers.delete(id);
    };
    w.clearInterval = w.clearTimeout;
    w.requestIdleCallback = (fn: unknown) => addTimer(fn, 0, [], false);
    w.cancelIdleCallback = w.clearTimeout;

    const report = (error: unknown) => {
        queueMicrotask(() => {
            throw error;
        });
    };
    const call = (fn: unknown, args: unknown[]) => {
        try {
            if (typeof fn === 'function') fn(...args);
        } catch (error) {
            report(error);
        }
    };

    // flipbook's fonts, then the fonts this composition supplied (brand.json, assets/fonts/).
    for (const face of [...config.fonts, ...config.timeline.fonts]) {
        const font = new FontFace(face.family, `url(${face.url})`, {
            weight: face.weight,
            style: face.style,
            display: 'block',
        });
        document.fonts.add(font);
    }

    const api: HostApi = {
        render: true,
        timeline: config.timeline,
        now: () => now,
        advance(ms: number) {
            api.texts.length = 0;
            for (;;) {
                let dueId = -1;
                let due: Timer | null = null;
                for (const [id, timer] of timers) {
                    if (timer.at > ms) continue;
                    if (
                        !due ||
                        timer.at < due.at ||
                        (timer.at === due.at && timer.order < due.order)
                    ) {
                        due = timer;
                        dueId = id;
                    }
                }
                if (!due) break;
                now = Math.max(now, due.at);
                if (due.every > 0) {
                    due.at += due.every;
                    due.order = order++;
                } else {
                    timers.delete(dueId);
                }
                call(due.fn, due.args);
            }
            now = ms;
            const pending = [...frames.values()];
            frames.clear();
            for (const fn of pending) call(fn, [config.perfOriginMs + now]);
        },
        syncAnimations() {
            for (const animation of document.getAnimations()) {
                animation.pause();
                animation.currentTime = now;
            }
            for (const svg of document.querySelectorAll('svg')) {
                if (svg.ownerSVGElement) continue;
                svg.pauseAnimations();
                svg.setCurrentTime(now / 1000);
            }
        },
        setContent(visible: boolean) {
            const attr = 'data-flipbook-content';
            if (!document.getElementById('__flipbook-content-style')) {
                const style = document.createElement('style');
                style.id = '__flipbook-content-style';
                style.textContent =
                    `html[${attr}="off"] body * { visibility: hidden !important; }` +
                    `html[${attr}="off"] [data-flipbook-layer="paper"],` +
                    `html[${attr}="off"] [data-flipbook-layer="paper"] * { visibility: visible !important; }`;
                (document.head ?? document.documentElement).appendChild(style);
            }
            if (visible) document.documentElement.removeAttribute(attr);
            else document.documentElement.setAttribute(attr, 'off');
        },
        texts: [],
        setTextVisible(visible: boolean) {
            const attr = 'data-flipbook-textlayer';
            if (!document.getElementById('__flipbook-text-style')) {
                const style = document.createElement('style');
                style.id = '__flipbook-text-style';
                style.textContent =
                    `html[${attr}="off"] body * { color: transparent !important;` +
                    ' -webkit-text-fill-color: transparent !important;' +
                    ' -webkit-text-stroke-color: transparent !important;' +
                    ' text-shadow: none !important; text-decoration-color: transparent !important;' +
                    ' caret-color: transparent !important; }' +
                    `html[${attr}="off"] body svg text, html[${attr}="off"] body svg tspan` +
                    ' { fill: transparent !important; stroke: transparent !important; }';
                (document.head ?? document.documentElement).appendChild(style);
            }
            if (visible) document.documentElement.removeAttribute(attr);
            else document.documentElement.setAttribute(attr, 'off');
        },
        registerText(entry: RegisteredText) {
            api.texts.push(entry);
        },
        forbiddenCalls() {
            return JSON.parse(JSON.stringify(calls)) as ForbiddenCalls;
        },
    };
    Object.defineProperty(window, '__flipbookHost', {
        value: api,
        writable: false,
        configurable: false,
        enumerable: false,
    });
}
