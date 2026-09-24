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
}

export interface HostApi {
    render: true;
    timeline: ResolvedTimeline;
    now(): number;
    advance(ms: number): void;
    syncAnimations(): void;
    setContent(visible: boolean): void;
    texts: RegisteredText[];
    registerText(entry: RegisteredText): void;
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

    const RealDate = Date;
    function FakeDate(this: unknown, ...args: unknown[]): unknown {
        if (!new.target) return new RealDate(config.epochMs + now).toString();
        if (args.length === 0) return new RealDate(config.epochMs + now);
        return new (RealDate as unknown as new (...a: unknown[]) => Date)(...args);
    }
    FakeDate.prototype = RealDate.prototype;
    FakeDate.now = () => config.epochMs + now;
    FakeDate.parse = RealDate.parse;
    FakeDate.UTC = RealDate.UTC;
    w.Date = FakeDate;
    const perfNow = () => config.perfOriginMs + now;
    Object.defineProperty(performance, 'now', { value: perfNow, configurable: true });

    const random = mulberry(config.randomSeed);
    Math.random = random;
    const cryptoRandom = mulberry(config.randomSeed ^ 0x9e3779b9);
    const getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
        if (array) {
            const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
            for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(cryptoRandom() * 256);
        }
        return array;
    };
    Object.defineProperty(crypto, 'getRandomValues', {
        value: getRandomValues,
        configurable: true,
    });
    Object.defineProperty(crypto, 'randomUUID', {
        value: () => {
            const b = getRandomValues(new Uint8Array(16));
            b[6] = (b[6] & 0x0f) | 0x40;
            b[8] = (b[8] & 0x3f) | 0x80;
            const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
            return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
        },
        configurable: true,
    });

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

    for (const face of config.fonts) {
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
        registerText(entry: RegisteredText) {
            api.texts.push(entry);
        },
    };
    Object.defineProperty(window, '__flipbookHost', {
        value: api,
        writable: false,
        configurable: false,
        enumerable: false,
    });
}
