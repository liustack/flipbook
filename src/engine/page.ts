import * as fs from 'fs';
import * as path from 'path';
import type {
    Browser,
    BrowserContext,
    CDPSession,
    Page,
    Route,
    WebSocketRoute,
} from 'playwright-core';
import { type Finding, finding, progress } from '../cli/report.ts';
import { runtimeFile } from '../paths.ts';
import { FONT_URL_PREFIX, fontFaces, fontFileFor } from './fonts.ts';
import {
    type ForbiddenCalls,
    type HostApi,
    type HostConfig,
    installHost,
    type RegisteredText,
} from './host.ts';
import { RendererWatch } from './rendererWatch.ts';
import { PROTOCOL_VERSION, type ResolvedTimeline } from './timelineResolve.ts';

export const ORIGIN = 'http://flipbook.local';
/** Where the page reports a channel the host refused (WebRTC, WebTransport). */
const BLOCKED_PREFIX = '/__flipbook/blocked/';
export const DEFAULT_EPOCH_MS = Date.UTC(2026, 0, 1);
export const SEEK_TIMEOUT_MS = 10_000;
export const READY_TIMEOUT_MS = 60_000;
/** Longest wait for a page's context to close. */
export const CLOSE_TIMEOUT_MS = 10_000;
/** Longest wait in close() for a renderer that stopped answering to report a crash. */
export const CRASH_WAIT_MS = 3000;

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
};

export interface ClockConfig {
    epochMs: number;
    perfOriginMs: number;
    randomSeed: number;
}

export function defaultClock(timeline: ResolvedTimeline): ClockConfig {
    return { epochMs: DEFAULT_EPOCH_MS, perfOriginMs: 0, randomSeed: timeline.seed >>> 0 };
}

export interface OpenOptions {
    browser: Browser;
    dir: string;
    timeline: ResolvedTimeline;
    clock?: ClockConfig;
    readyTimeoutMs?: number;
    deviceScaleFactor?: number;
    env?: NodeJS.ProcessEnv;
    /** Called after the page's context closes. */
    onClose?: () => Promise<void>;
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface DomText {
    key: string;
    text: string;
    family: string;
    selector: string;
    /** Union of the line boxes. */
    box: Rect;
    /** One box per rendered line (Range.getClientRects), transforms included. */
    lines: Rect[];
    /** The element or an ancestor carries data-flipbook-allow-overflow. */
    allowOverflow: boolean;
    /** Laid out but entirely outside the frame. */
    offscreen: boolean;
}

export interface PlatformFont {
    familyName: string;
    postScriptName?: string;
    isCustomFont: boolean;
    glyphCount: number;
}

function isInside(root: string, target: string): boolean {
    const rel = path.relative(root, target);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function errorMessage(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error);
    return text.replace(/^page\.evaluate: /, '').split('\n')[0];
}

type Outcome<T> = { ok: true; value: T } | { ok: false; timedOut: boolean; message: string };

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<Outcome<T>> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<Outcome<T>>((resolve) => {
        timer = setTimeout(
            () => resolve({ ok: false, timedOut: true, message: `timed out after ${ms} ms` }),
            ms,
        );
    });
    const settled = promise.then(
        (value): Outcome<T> => ({ ok: true, value }),
        (error): Outcome<T> => ({ ok: false, timedOut: false, message: errorMessage(error) }),
    );
    try {
        return await Promise.race([settled, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

/** One composition loaded under the fake origin with the virtual clock installed. */
export class CompositionPage {
    readonly issues: Finding[] = [];
    /** Set once a seek timed out or the page crashed; later calls are refused. */
    broken = false;
    /** Set when the renderer went away; close() then asks the watch why. */
    private crashed = false;
    private readonly seenIssues = new Set<string>();

    private constructor(
        readonly context: BrowserContext,
        readonly page: Page,
        readonly cdp: CDPSession,
        readonly timeline: ResolvedTimeline,
        private readonly realDir: string,
        private readonly watch: RendererWatch,
        private readonly onClose?: () => Promise<void>,
    ) {}

    static async open(
        options: OpenOptions,
    ): Promise<{ page: CompositionPage; findings: Finding[] }> {
        const { browser, timeline } = options;
        const realDir = fs.realpathSync(options.dir);
        const context = await browser.newContext({
            viewport: { width: timeline.width, height: timeline.height },
            deviceScaleFactor: options.deviceScaleFactor ?? 1,
            timezoneId: 'UTC',
            locale: 'en-US',
            colorScheme: 'light',
            serviceWorkers: 'block',
            acceptDownloads: false,
        });
        const watch = await RendererWatch.start(browser);
        // Until the page is handed over, this function owns the context and the watch.
        try {
            const clock = options.clock ?? defaultClock(timeline);
            const config: HostConfig = { ...clock, timeline, fonts: fontFaces(), origin: ORIGIN };
            await context.addInitScript(installHost, config);
            const page = await context.newPage();
            const cdp = await context.newCDPSession(page);
            // A clipped screenshot puts back the device metrics of the session that took
            // it. Without our own copy of Playwright's, the first one drops the page to
            // device scale 1 and an 800x600 screen for every later frame.
            const landscape = timeline.width >= timeline.height;
            await cdp.send('Emulation.setDeviceMetricsOverride', {
                width: timeline.width,
                height: timeline.height,
                deviceScaleFactor: options.deviceScaleFactor ?? 1,
                mobile: false,
                screenWidth: timeline.width,
                screenHeight: timeline.height,
                screenOrientation: landscape
                    ? { angle: 90, type: 'landscapePrimary' }
                    : { angle: 0, type: 'portraitPrimary' },
            });
            await watch.follow(cdp);
            const cp = new CompositionPage(
                context,
                page,
                cdp,
                timeline,
                realDir,
                watch,
                options.onClose,
            );
            await context.route('**/*', (route) => cp.handle(route, options.env ?? process.env));
            // context.route does not see WebSocket; every socket is refused here, unconnected.
            await context.routeWebSocket(/.*/, (socket) => cp.refuseSocket(socket));
            cp.listen();
            const findings = await cp.load(options.readyTimeoutMs ?? READY_TIMEOUT_MS);
            return { page: cp, findings };
        } catch (error) {
            // A renderer that could not start, or was killed while starting, is the machine's problem.
            const lost = await watch.systemExit(true);
            await watch.stop();
            await context.close().catch(() => undefined);
            throw lost ?? error;
        }
    }

    private note(item: Finding): void {
        const key = `${item.code}|${item.message}`;
        if (this.seenIssues.has(key)) return;
        this.seenIssues.add(key);
        this.issues.push(item);
    }

    private listen(): void {
        this.page.on('pageerror', (error) => {
            this.note(
                finding('page-error', error.message.split('\n')[0], {
                    detail: { stack: (error.stack ?? '').split('\n').slice(0, 6).join('\n') },
                }),
            );
        });
        this.page.on('console', (message) => {
            if (message.type() !== 'error') return;
            const text = message.text();
            if (/^Failed to load resource/.test(text)) return;
            const location = message.location();
            this.note(
                finding('console-error', text.split('\n')[0], {
                    element: location.url
                        ? `${location.url}:${location.lineNumber + 1}`
                        : undefined,
                }),
            );
        });
        this.page.on('crash', () => {
            this.broken = true;
            this.crashed = true;
            this.note(finding('page-error', 'The page crashed.'));
        });
    }

    private async refuseSocket(socket: WebSocketRoute): Promise<void> {
        const url = new URL(socket.url());
        this.note(
            finding('external-request', `Blocked WebSocket to ${url.origin}${url.pathname}`, {
                detail: { url: url.href },
            }),
        );
        await socket.close({ code: 1008, reason: 'flipbook renders without network' });
    }

    private async handle(route: Route, env: NodeJS.ProcessEnv): Promise<void> {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) {
            this.note(
                finding('external-request', `Blocked request to ${url.origin}${url.pathname}`, {
                    detail: { url: url.href },
                }),
            );
            await route.abort('blockedbyclient');
            return;
        }
        let pathname: string;
        try {
            pathname = decodeURIComponent(url.pathname);
        } catch {
            await route.fulfill({ status: 400, body: 'bad path' });
            return;
        }
        const headers = { 'cache-control': 'no-store' };
        if (pathname.startsWith('/__flipbook/')) {
            const served = this.internalFile(pathname, env);
            if (served) {
                await route.fulfill({ path: served.file, contentType: served.type, headers });
                return;
            }
            if (pathname.startsWith(BLOCKED_PREFIX)) {
                const what = pathname.slice(BLOCKED_PREFIX.length);
                this.note(
                    finding('external-request', `Blocked ${what}`, { detail: { url: what } }),
                );
                await route.fulfill({ status: 204, headers });
                return;
            }
            if (pathname === '/__flipbook/timeline.json') {
                await route.fulfill({
                    status: 200,
                    contentType: MIME['.json'],
                    body: JSON.stringify(this.timeline),
                    headers,
                });
                return;
            }
            this.note(
                finding('resource-failed', `No flipbook resource at ${pathname}`, {
                    detail: { url: url.href },
                }),
            );
            await route.fulfill({ status: 404, body: 'not found', headers });
            return;
        }
        const relative = pathname === '/' ? 'index.html' : `.${pathname}`;
        const target = path.resolve(this.realDir, relative);
        let real: string;
        try {
            real = fs.realpathSync(target);
        } catch {
            this.note(
                finding('resource-failed', `Missing file ${pathname}`, {
                    detail: { url: url.href },
                }),
            );
            await route.fulfill({ status: 404, body: 'not found', headers });
            return;
        }
        if (!isInside(this.realDir, real)) {
            this.note(
                finding('path-escape', `Refused ${pathname}: it resolves outside the composition`, {
                    detail: { url: url.href },
                }),
            );
            await route.fulfill({ status: 403, body: 'forbidden', headers });
            return;
        }
        if (fs.statSync(real).isDirectory()) {
            await route.fulfill({ status: 404, body: 'not found', headers });
            return;
        }
        const type = MIME[path.extname(real).toLowerCase()] ?? 'application/octet-stream';
        await route.fulfill({ path: real, contentType: type, headers });
    }

    private internalFile(
        pathname: string,
        env: NodeJS.ProcessEnv,
    ): { file: string; type: string } | null {
        if (pathname === '/__flipbook/runtime.js') {
            return { file: runtimeFile('runtime.js'), type: MIME['.js'] };
        }
        if (pathname === '/__flipbook/audio.js') {
            return { file: runtimeFile('audio.js'), type: MIME['.js'] };
        }
        if (pathname.startsWith(FONT_URL_PREFIX)) {
            const file = fontFileFor(pathname.slice(FONT_URL_PREFIX.length), env);
            if (file && fs.existsSync(file)) return { file, type: MIME[path.extname(file)] };
        }
        return null;
    }

    private async load(readyTimeoutMs: number): Promise<Finding[]> {
        const deadline = Date.now() + readyTimeoutMs;
        const nav = await withTimeout(
            this.page.goto(`${ORIGIN}/index.html`, { waitUntil: 'load', timeout: readyTimeoutMs }),
            readyTimeoutMs + 1000,
        );
        if (!nav.ok) {
            this.broken = true;
            return [finding('page-error', `index.html did not load: ${nav.message}`)];
        }
        for (;;) {
            // The read itself runs page code (a getter can loop or throw), so it gets the
            // rest of the ready limit too.
            const probe = await withTimeout(
                this.page.evaluate(() => {
                    const fb = (window as unknown as { __flipbook?: { protocol?: unknown } })
                        .__flipbook;
                    return fb ? { present: true, protocol: fb.protocol } : { present: false };
                }),
                Math.max(1, deadline - Date.now()),
            );
            if (!probe.ok) {
                this.broken = true;
                return [
                    probe.timedOut
                        ? finding(
                              'ready-timeout',
                              `The page stopped answering while flipbook read window.__flipbook: no reply within ${readyTimeoutMs} ms.`,
                              {
                                  fix: 'Look for an endless loop in a page script or in a getter on window.__flipbook. Nothing may run without end while the page loads.',
                              },
                          )
                        : finding(
                              'protocol-missing',
                              `Reading window.__flipbook failed: ${probe.message}`,
                          ),
                ];
            }
            const state = probe.value;
            if (state.present) {
                if (state.protocol !== PROTOCOL_VERSION) {
                    this.broken = true;
                    return [
                        finding(
                            'protocol-mismatch',
                            `window.__flipbook.protocol is ${JSON.stringify(state.protocol)}, expected ${PROTOCOL_VERSION}.`,
                        ),
                    ];
                }
                break;
            }
            if (Date.now() > deadline) {
                this.broken = true;
                return [
                    finding(
                        'protocol-missing',
                        `window.__flipbook was not defined within ${readyTimeoutMs} ms.`,
                    ),
                ];
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const remaining = Math.max(1000, deadline - Date.now());
        const ready = await withTimeout(
            this.page.evaluate(async () => {
                const failures: string[] = [];
                await Promise.all(
                    Array.from(document.fonts).map((face) =>
                        face.load().then(
                            () => undefined,
                            (error: unknown) => {
                                failures.push(`${face.family}: ${String(error)}`);
                            },
                        ),
                    ),
                );
                const fb = (window as unknown as { __flipbook: { ready?: Promise<unknown> } })
                    .__flipbook;
                await fb.ready;
                return failures;
            }),
            remaining,
        );
        if (!ready.ok) {
            this.broken = true;
            return [
                ready.timedOut
                    ? finding(
                          'ready-timeout',
                          `window.__flipbook.ready did not settle within ${readyTimeoutMs} ms.`,
                      )
                    : finding('ready-failed', `window.__flipbook.ready rejected: ${ready.message}`),
            ];
        }
        if (ready.value.length > 0) {
            return [finding('ready-failed', `Fonts failed to load: ${ready.value.join(', ')}`)];
        }
        return [];
    }

    /** Draw frame `frame`: advance the virtual clock, call seek, pin CSS and SMIL animations. */
    async seek(frame: number, timeoutMs = SEEK_TIMEOUT_MS): Promise<Finding | null> {
        if (this.broken) throw new Error('page is unusable after an earlier failure');
        const fps = this.timeline.fps;
        const t = frame / fps;
        const ms = (frame * 1000) / fps;
        const outcome = await withTimeout(
            this.page.evaluate(
                async ({ t, ms }) => {
                    const w = window as unknown as {
                        __flipbookHost: HostApi;
                        __flipbook: { seek(t: number): unknown };
                    };
                    w.__flipbookHost.advance(ms);
                    await w.__flipbook.seek(t);
                    w.__flipbookHost.syncAnimations();
                },
                { t, ms },
            ),
            timeoutMs,
        );
        if (outcome.ok) return null;
        if (outcome.timedOut) {
            this.broken = true;
            return finding(
                'seek-timeout',
                `seek(${t.toFixed(3)}) did not finish within ${timeoutMs} ms.`,
                {
                    time: t,
                    frame,
                },
            );
        }
        return finding('seek-failed', `seek(${t.toFixed(3)}) failed: ${outcome.message}`, {
            time: t,
            frame,
        });
    }

    /**
     * PNG of the viewport as it is now, in device pixels (CSS size times the
     * scale). A clip captures that region, enlarged by its own scale.
     */
    async capture(clip?: {
        x: number;
        y: number;
        width: number;
        height: number;
        scale: number;
    }): Promise<Buffer> {
        const { data } = await this.cdp.send('Page.captureScreenshot', {
            format: 'png',
            optimizeForSpeed: true,
            captureBeyondViewport: false,
            fromSurface: true,
            ...(clip ? { clip } : {}),
        });
        return Buffer.from(data, 'base64');
    }

    /**
     * What the page holds that can grow while it renders: the JS heap and the
     * DOM node count (detached nodes included). With `collect`, a full garbage
     * collection runs first, so garbage waiting to be freed is not counted.
     */
    async memory(collect = false): Promise<{ heapBytes: number; nodes: number }> {
        if (collect) await this.cdp.send('HeapProfiler.collectGarbage');
        const heap = await this.cdp.send('Runtime.getHeapUsage');
        const dom = await this.cdp.send('Memory.getDOMCounters');
        return { heapBytes: heap.usedSize, nodes: dom.nodes };
    }

    /** Make DOM text transparent (false) or restore it (true); backgrounds stay. */
    async setTextVisible(visible: boolean): Promise<void> {
        await this.page.evaluate((on) => {
            (window as unknown as { __flipbookHost: HostApi }).__flipbookHost.setTextVisible(on);
        }, visible);
    }

    async setContent(visible: boolean): Promise<void> {
        await this.page.evaluate((on) => {
            (window as unknown as { __flipbookHost: HostApi }).__flipbookHost.setContent(on);
        }, visible);
    }

    /** Text the runtime text module registered during the last seek. */
    async registeredTexts(): Promise<RegisteredText[]> {
        return this.page.evaluate(() =>
            (window as unknown as { __flipbookHost: HostApi }).__flipbookHost.texts.slice(),
        );
    }

    /** Forbidden clock and random calls the page has made since it opened. */
    async forbiddenCalls(): Promise<ForbiddenCalls> {
        return this.page.evaluate(() =>
            (window as unknown as { __flipbookHost: HostApi }).__flipbookHost.forbiddenCalls(),
        );
    }

    /**
     * Visible DOM text nodes with their boxes, including text laid out outside
     * the frame; tags each parent element for CDP lookups.
     */
    async domTexts(): Promise<DomText[]> {
        return this.page.evaluate(() => {
            type Box = { x: number; y: number; width: number; height: number };
            const out: {
                key: string;
                text: string;
                family: string;
                selector: string;
                box: Box;
                lines: Box[];
                allowOverflow: boolean;
                offscreen: boolean;
            }[] = [];
            const describe = (el: Element): string => {
                if (el.id) return `#${el.id}`;
                const parts: string[] = [];
                let node: Element | null = el;
                while (node && node !== document.body && parts.length < 4) {
                    const cls =
                        node.classList.length > 0 ? `.${Array.from(node.classList).join('.')}` : '';
                    parts.unshift(`${node.tagName.toLowerCase()}${cls}`);
                    node = node.parentElement;
                }
                return parts.join(' > ');
            };
            let next = 0;
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                const text = node.nodeValue ?? '';
                if (!text.trim()) continue;
                const el = node.parentElement;
                if (!el || el.closest('script,style,noscript,template')) continue;
                if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
                    continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                const rects = Array.from(range.getClientRects()).filter(
                    (r) => r.width > 0 && r.height > 0,
                );
                if (rects.length === 0) continue;
                const left = Math.min(...rects.map((r) => r.left));
                const top = Math.min(...rects.map((r) => r.top));
                const right = Math.max(...rects.map((r) => r.right));
                const bottom = Math.max(...rects.map((r) => r.bottom));
                let key = el.getAttribute('data-flipbook-text');
                if (!key) {
                    key = String(next++);
                    el.setAttribute('data-flipbook-text', key);
                }
                out.push({
                    key,
                    text,
                    family: getComputedStyle(el).fontFamily,
                    selector: describe(el),
                    box: { x: left, y: top, width: right - left, height: bottom - top },
                    lines: rects.map((r) => ({
                        x: r.left,
                        y: r.top,
                        width: r.width,
                        height: r.height,
                    })),
                    allowOverflow: el.closest('[data-flipbook-allow-overflow]') !== null,
                    // Kept for the frame-edge check: text moved off the frame is not hidden text.
                    offscreen:
                        right <= 0 || bottom <= 0 || left >= innerWidth || top >= innerHeight,
                });
            }
            return out;
        });
    }

    /** Fonts Chromium actually used for each tagged element, keyed by data-flipbook-text. */
    async platformFonts(): Promise<Map<string, PlatformFont[]>> {
        const result = new Map<string, PlatformFont[]>();
        await this.cdp.send('DOM.enable');
        await this.cdp.send('CSS.enable');
        try {
            const { root } = await this.cdp.send('DOM.getDocument', { depth: 0 });
            const { nodeIds } = await this.cdp.send('DOM.querySelectorAll', {
                nodeId: root.nodeId,
                selector: '[data-flipbook-text]',
            });
            for (const nodeId of nodeIds) {
                const { attributes } = await this.cdp.send('DOM.getAttributes', { nodeId });
                const index = attributes.indexOf('data-flipbook-text');
                if (index < 0) continue;
                const { fonts } = await this.cdp.send('CSS.getPlatformFontsForNode', { nodeId });
                result.set(attributes[index + 1], fonts as PlatformFont[]);
            }
        } finally {
            await this.cdp.send('CSS.disable').catch(() => undefined);
            await this.cdp.send('DOM.disable').catch(() => undefined);
            await this.page.evaluate(() => {
                for (const el of document.querySelectorAll('[data-flipbook-text]')) {
                    el.removeAttribute('data-flipbook-text');
                }
            });
        }
        return result;
    }

    /** Laid-out size of html and body, to compare with the stage size. */
    async stageSize(): Promise<{ width: number; height: number }> {
        return this.page.evaluate(() => {
            const boxes = [document.documentElement, document.body]
                .filter((el): el is HTMLElement => el !== null)
                .map((el) => el.getBoundingClientRect());
            return {
                width: Math.round(Math.max(...boxes.map((b) => b.width))),
                height: Math.round(Math.max(...boxes.map((b) => b.height))),
            };
        });
    }

    /**
     * Close the context, waiting at most CLOSE_TIMEOUT_MS: a page whose main
     * thread never returns must not hold the command. A context that is already
     * gone (crashed page, closed browser) counts as closed. When the system
     * killed the renderer or the browser, this throws resource-exhausted
     * (exit 78) after closing, in place of the page-error the crash left.
     */
    async close(): Promise<void> {
        // A renderer that died a moment ago may not have fired 'crash' yet; one quick call tells.
        if (!this.crashed && this.watch.browserConnected()) {
            const alive = await withTimeout(
                this.page.evaluate(() => true),
                1000,
            );
            if (!alive.ok && !alive.timedOut) this.crashed = true;
            // No answer from a page not known to hang: Chromium can hear late of a
            // renderer that is gone (a core dump handler holds a crashed one, a busy
            // machine delays a kill), so wait for the crash.
            const deadline = Date.now() + CRASH_WAIT_MS;
            while (!alive.ok && !this.broken && !this.crashed && Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        }
        const lost = await this.watch.systemExit(this.crashed);
        await this.watch.stop();
        const closed = await withTimeout(this.context.close(), CLOSE_TIMEOUT_MS);
        if (!closed.ok && closed.timedOut) {
            progress(`a page did not close within ${CLOSE_TIMEOUT_MS} ms; moving on`);
        }
        await this.onClose?.();
        if (lost) throw lost;
    }
}
