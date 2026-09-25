// A bare page for work flipbook does in the browser outside a composition,
// such as cutting images out ahead of render: it loads only the runtime
// library and files from the composition directory, and nothing from the
// network. The composition's own index.html is never run.
import * as fs from 'fs';
import * as path from 'path';
import type { Page } from 'playwright-core';
import { runtimeFile } from '../paths.ts';
import { ORIGIN } from './page.ts';
import type { Session } from './session.ts';

const TOOL_PAGE = `${ORIGIN}/__flipbook/tool.html`;
const TOOL_HTML =
    '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    '<script type="module">import * as rt from "/__flipbook/runtime.js"; window.rt = rt;</script>' +
    '</body></html>';

const TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
};

/** Open the tool page for `dir`, with the runtime on window.rt. */
export async function openToolPage(
    session: Session,
    dir: string,
): Promise<{ page: Page; close(): Promise<void> }> {
    const root = fs.realpathSync(dir);
    const { browser, dispose } = await session.browserForPage();
    const context = await browser.newContext({
        serviceWorkers: 'block',
        acceptDownloads: false,
        deviceScaleFactor: 1,
    });
    await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) {
            await route.abort('blockedbyclient');
            return;
        }
        const pathname = decodeURIComponent(url.pathname);
        if (url.href === TOOL_PAGE) {
            await route.fulfill({
                status: 200,
                contentType: 'text/html; charset=utf-8',
                body: TOOL_HTML,
            });
            return;
        }
        if (pathname === '/__flipbook/runtime.js') {
            await route.fulfill({
                path: runtimeFile('runtime.js'),
                contentType: 'text/javascript; charset=utf-8',
            });
            return;
        }
        let file: string;
        try {
            file = fs.realpathSync(path.join(root, pathname));
        } catch {
            await route.fulfill({ status: 404, body: 'not found' });
            return;
        }
        const rel = path.relative(root, file);
        if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.statSync(file).isFile()) {
            await route.fulfill({ status: 404, body: 'not found' });
            return;
        }
        await route.fulfill({
            path: file,
            contentType: TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        });
    });
    const page = await context.newPage();
    await page.goto(TOOL_PAGE, { waitUntil: 'load' });
    await page.waitForFunction(
        () => (window as unknown as { rt?: unknown }).rt !== undefined,
        undefined,
        {
            timeout: 30_000,
        },
    );
    return {
        page,
        async close() {
            await context.close().catch(() => undefined);
            await dispose();
        },
    };
}
