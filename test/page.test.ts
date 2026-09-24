import * as fs from 'fs';
import * as path from 'path';
import type { Browser } from 'playwright-core';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../src/cli/check.ts';
import { runRender } from '../src/cli/render.ts';
import { runSnapshot } from '../src/cli/snapshot.ts';
import { CompositionPage } from '../src/engine/page.ts';
import { loadTimeline } from '../src/engine/timeline.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps, codes, copyFixture, tempDir } from './helpers.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

describe('fake origin', () => {
    it('refuses files outside the composition and blocks the network', async () => {
        const outside = tempDir('outside');
        fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
        const dir = tempDir('escape');
        fs.symlinkSync(outside, path.join(dir, 'link'));
        fs.writeFileSync(
            path.join(dir, 'timeline.json'),
            JSON.stringify({
                version: 1,
                width: 320,
                height: 180,
                fps: 12,
                seed: 1,
                bpm: 120,
                beatsPerBar: 4,
                scenes: [{ id: 'main', bars: 1 }],
            }),
        );
        fs.writeFileSync(
            path.join(dir, 'index.html'),
            `<!doctype html><body style="margin:0;background:#fff">
<div style="position:absolute;left:20px;top:20px;width:80px;height:80px;background:#246"></div>
<script type="module">
import { composition } from '/__flipbook/runtime.js';
const leaked = await fetch('/link/secret.txt').then((r) => r.status, () => 'failed');
const net = await fetch('https://example.com/beacon').then((r) => r.status, () => 'failed');
window.results = { leaked, net };
composition({ seek() {} });
</script></body>`,
        );
        const report = await runCheck({ dir, session: await session(), recordAttempts: false });
        expect(codes(report)).toContain('path-escape');
        expect(codes(report)).toContain('external-request');
        const refused = report.failures.find((f) => f.code === 'path-escape');
        expect(refused?.message).toContain('/link/secret.txt');
    });
});

describe('stage size', () => {
    it('warns when body is laid out larger than the stage, not when content is clipped', async () => {
        const dir = tempDir('stage');
        fs.writeFileSync(
            path.join(dir, 'timeline.json'),
            JSON.stringify({
                version: 1,
                width: 320,
                height: 180,
                fps: 12,
                seed: 1,
                bpm: 120,
                beatsPerBar: 4,
                scenes: [{ id: 'main', bars: 1 }],
            }),
        );
        fs.writeFileSync(
            path.join(dir, 'index.html'),
            `<!doctype html><body style="margin:0;width:400px;height:180px;background:#fff">
<div style="position:absolute;left:20px;top:20px;width:80px;height:80px;background:#246"></div>
<script type="module">
import { composition } from '/__flipbook/runtime.js';
composition({ seek(t) { document.body.firstElementChild.style.left = 20 + t * 40 + 'px'; } });
</script></body>`,
        );
        const report = await runCheck({ dir, session: await session(), recordAttempts: false });
        expect(report.warnings.map((w) => w.code)).toContain('stage-size');
    });
});

describe('virtual clock', () => {
    it('gives the virtual time through every native clock entry point', async () => {
        const s = await session();
        const { browser } = await s.browserForPage();
        const dir = copyFixture('hello', 'examples');
        const timeline = loadTimeline(dir, false).resolved;
        if (!timeline) throw new Error('hello timeline did not load');
        const { page } = await CompositionPage.open({ browser, dir, timeline });
        try {
            const seen = await page.page.evaluate(() => {
                const T = (
                    globalThis as {
                        Temporal?: { Now: { instant(): { epochMilliseconds: number } } };
                    }
                ).Temporal;
                return {
                    now: Date.now(),
                    viaPrototype: (Date.prototype.constructor as DateConstructor).now(),
                    sameConstructor: new Date().constructor === Date,
                    temporal: T ? T.Now.instant().epochMilliseconds : null,
                    intlMonth: new Intl.DateTimeFormat('en-US', {
                        timeZone: 'UTC',
                        month: 'numeric',
                    }).format(),
                    originPlusNow: performance.timeOrigin + performance.now(),
                    documentTimeline: document.timeline.currentTime,
                };
            });
            const epoch = Date.UTC(2026, 0, 1);
            expect(seen).toEqual({
                now: epoch,
                viaPrototype: epoch,
                sameConstructor: true,
                temporal: seen.temporal === null ? null : epoch,
                intlMonth: '1',
                originPlusNow: epoch,
                documentTimeline: 0,
            });
        } finally {
            await page.close();
        }
    });
});

/** `browser`, except that every new context fails to open a page. */
function failingNewPage(browser: Browser): Browser {
    return new Proxy(browser, {
        get(target, prop) {
            if (prop === 'newContext') {
                return async (...args: Parameters<Browser['newContext']>) => {
                    const context = await target.newContext(...args);
                    return new Proxy(context, {
                        get(ctx, key) {
                            if (key === 'newPage') {
                                return async () => {
                                    throw new Error('injected: newPage failed');
                                };
                            }
                            const value = Reflect.get(ctx, key);
                            return typeof value === 'function' ? value.bind(ctx) : value;
                        },
                    });
                };
            }
            const value = Reflect.get(target, prop);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

/** A directory whose contents cannot be deleted. Undo with the returned function. */
function undeletable(dir: string): () => void {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'stuck'), '');
    fs.chmodSync(dir, 0o500);
    return () => fs.chmodSync(dir, 0o700);
}

const asRoot = process.getuid?.() === 0;

describe('cleanup when something fails half way', () => {
    it('closes the context when the page cannot be set up', async () => {
        const s = await session();
        const { browser } = await s.browserForPage();
        const dir = copyFixture('hello', 'examples');
        const timeline = loadTimeline(dir, false).resolved;
        if (!timeline) throw new Error('hello timeline did not load');
        const before = browser.contexts().length;
        await expect(
            CompositionPage.open({ browser: failingNewPage(browser), dir, timeline }),
        ).rejects.toThrow(/injected/);
        expect(browser.contexts().length).toBe(before);
    });

    it.skipIf(asRoot)(
        'render releases the lock and removes tmp when a directory cannot be emptied',
        async () => {
            const s = await session();
            const { browser } = await s.browserForPage();
            const dir = copyFixture('hello', 'examples');
            const restore = undeletable(path.join(dir, '.flipbook', 'evidence', 'render'));
            const before = browser.contexts().length;
            try {
                await expect(
                    runRender({ dir, session: s, recordAttempts: false }),
                ).rejects.toThrow();
            } finally {
                restore();
            }
            expect(fs.existsSync(path.join(dir, '.flipbook', 'render.lock'))).toBe(false);
            expect(fs.readdirSync(path.join(dir, '.flipbook', 'tmp'))).toEqual([]);
            expect(browser.contexts().length).toBe(before);
        },
    );

    it.skipIf(asRoot)(
        'snapshot closes its page when its scratch directory cannot be emptied',
        async () => {
            const s = await session();
            const { browser } = await s.browserForPage();
            const dir = copyFixture('hello', 'examples');
            const restore = undeletable(path.join(dir, '.flipbook', 'snapshot', 'frames'));
            const before = browser.contexts().length;
            try {
                await expect(runSnapshot({ dir, session: s })).rejects.toThrow();
            } finally {
                restore();
            }
            expect(browser.contexts().length).toBe(before);
        },
    );
});
