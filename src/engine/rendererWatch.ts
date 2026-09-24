import type { Browser, CDPSession } from 'playwright-core';
import type { EnvError } from '../cli/report.ts';
import { resourceExhausted } from './proc.ts';

/**
 * Termination statuses Chromium reports (CDP Target.targetCrashed) for a
 * renderer the system took away: ended from outside ("killed", measured for
 * SIGKILL and SIGTERM), out of memory, or never started. A renderer that
 * crashes on its own, a page overflowing the V8 heap included (measured as
 * SIGTRAP), reports "crashed" and stays a page-error.
 */
export const SYSTEM_EXITS = new Set(['killed', 'oom', 'failed to launch', 'evicted for memory']);

/** Longest wait for Chromium's report after a page crashed. */
const REPORT_WAIT_MS = 2000;

export interface RendererExit {
    status: string;
    errorCode: number;
}

/**
 * Tells a renderer the system killed from a page that crashed by itself, for
 * one page. Chromium reports how each crashed renderer ended on a
 * browser-level CDP session. A browser that is gone altogether (single-process
 * mode dies whole) leaves no report and counts as taken away too.
 */
export class RendererWatch {
    private targetId: string | null = null;
    private readonly exits = new Map<string, RendererExit>();

    private constructor(
        private readonly browser: Browser,
        private readonly session: CDPSession,
    ) {}

    static async start(browser: Browser): Promise<RendererWatch> {
        const session = await browser.newBrowserCDPSession();
        const watch = new RendererWatch(browser, session);
        session.on('Target.targetCrashed', (event) => {
            watch.exits.set(event.targetId, { status: event.status, errorCode: event.errorCode });
        });
        await session.send('Target.setDiscoverTargets', { discover: true });
        return watch;
    }

    browserConnected(): boolean {
        return this.browser.isConnected();
    }

    /** The page's own target, read from its page-level CDP session. */
    async follow(pageSession: CDPSession): Promise<void> {
        const { targetInfo } = await pageSession.send('Target.getTargetInfo');
        this.targetId = targetInfo.targetId;
    }

    /** The report for this page, or for any page while it has no target yet. */
    private exit(): RendererExit | null {
        if (this.targetId !== null) return this.exits.get(this.targetId) ?? null;
        return [...this.exits.values()].find((exit) => SYSTEM_EXITS.has(exit.status)) ?? null;
    }

    /**
     * resource-exhausted when the system took the renderer or the browser
     * away, or null. After a crash, waits a moment for Chromium's report.
     */
    async systemExit(crashed: boolean): Promise<EnvError | null> {
        if (!this.browser.isConnected()) {
            return resourceExhausted(
                'Chromium exited while rendering, without a crash report. The system does this when memory or the process count runs out.',
                { process: 'browser', status: 'exited' },
            );
        }
        if (!crashed) return null;
        const deadline = Date.now() + REPORT_WAIT_MS;
        while (!this.exit() && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const exit = this.exit();
        if (!exit || !SYSTEM_EXITS.has(exit.status)) return null;
        return resourceExhausted(
            `The Chromium renderer was ${exit.status === 'killed' ? `killed (signal ${exit.errorCode})` : `ended: ${exit.status}`} while rendering. The system does this when memory or the process count runs out.`,
            { process: 'renderer', status: exit.status, errorCode: exit.errorCode },
        );
    }

    async stop(): Promise<void> {
        await this.session.detach().catch(() => undefined);
    }
}
