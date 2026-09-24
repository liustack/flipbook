import * as fs from 'fs';
import * as path from 'path';
import type { Browser } from 'playwright-core';
import { type Finding, finding, UsageError } from '../cli/report.ts';
import {
    ensureHeadlessShell,
    type HeadlessShell,
    type LaunchMode,
    launchBrowser,
} from './browser.ts';
import { type Ffmpeg, requireFfmpeg, VIDEO_FEATURES } from './ffmpeg.ts';
import { ensureFonts } from './fonts.ts';
import { CompositionPage, type OpenOptions } from './page.ts';

/** Everything a check, snapshot or render needs from the machine. */
export interface Session {
    ffmpeg: Ffmpeg;
    shell: HeadlessShell;
    mode: LaunchMode;
    chromium: { version: string; revision: string; launchMode: LaunchMode };
    /**
     * A browser for one page. Normal mode shares one browser across pages;
     * single-process mode supports a single browser context, so each page
     * gets its own browser, closed with the page.
     */
    browserForPage(): Promise<{ browser: Browser; dispose: () => Promise<void> }>;
    close(): Promise<void>;
}

/** Check ffmpeg, install Chromium and fonts when missing, launch the browser. */
export async function openSession(env: NodeJS.ProcessEnv = process.env): Promise<Session> {
    const ffmpeg = await requireFfmpeg(VIDEO_FEATURES, env);
    const shell = await ensureHeadlessShell(env);
    await ensureFonts(env);
    const launched = await launchBrowser(shell);
    let spare: Browser | null = launched.browser;
    const open = new Set<Browser>([launched.browser]);
    return {
        ffmpeg,
        shell,
        mode: launched.mode,
        chromium: {
            version: launched.browser.version(),
            revision: shell.revision,
            launchMode: launched.mode,
        },
        async browserForPage() {
            if (launched.mode === 'normal') {
                return { browser: launched.browser, dispose: async () => undefined };
            }
            const browser = spare ?? (await launchBrowser(shell)).browser;
            spare = null;
            open.add(browser);
            return {
                browser,
                dispose: async () => {
                    open.delete(browser);
                    await browser.close().catch(() => undefined);
                },
            };
        },
        async close() {
            await Promise.all([...open].map((browser) => browser.close().catch(() => undefined)));
            open.clear();
        },
    };
}

/** Open a composition page on a browser from the session. */
export async function openPage(
    session: Session,
    options: Omit<OpenOptions, 'browser' | 'onClose'>,
): ReturnType<typeof CompositionPage.open> {
    const { browser, dispose } = await session.browserForPage();
    try {
        return await CompositionPage.open({ ...options, browser, onClose: dispose });
    } catch (error) {
        await dispose();
        throw error;
    }
}

/** Resolve and validate the composition directory argument. */
export function compositionDir(input: string): string {
    const dir = path.resolve(input);
    let stat: fs.Stats;
    try {
        stat = fs.statSync(dir);
    } catch {
        throw new UsageError(`${input} does not exist. Pass a composition directory.`);
    }
    if (!stat.isDirectory()) {
        throw new UsageError(
            `${input} is not a directory. Pass the composition directory, not a file.`,
        );
    }
    return dir;
}

export function indexFinding(dir: string): Finding | null {
    return fs.existsSync(path.join(dir, 'index.html'))
        ? null
        : finding('index-missing', `No index.html in ${dir}.`);
}

/** Empty (or create) a scratch directory. */
export function freshDir(dir: string): string {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
