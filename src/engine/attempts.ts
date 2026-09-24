import * as fs from 'fs';
import * as path from 'path';
import type { AttemptsSummary } from '../cli/report.ts';

export const LIMITS = {
    /** check rounds for one composition before stopping. */
    checkRounds: 8,
    /** Consecutive runs failing with the same code before stopping. */
    sameCode: 3,
    /** Failed renders (the first plus two retries) before stopping. */
    renderFailures: 3,
} as const;

interface AttemptsFile {
    version: 1;
    checkRounds: number;
    renderFailures: number;
    streaks: Record<string, number>;
}

function file(dir: string): string {
    return path.join(dir, '.flipbook', 'attempts.json');
}

function load(dir: string): AttemptsFile {
    try {
        const parsed = JSON.parse(fs.readFileSync(file(dir), 'utf-8')) as AttemptsFile;
        if (parsed.version === 1) return parsed;
    } catch {
        // fresh start
    }
    return { version: 1, checkRounds: 0, renderFailures: 0, streaks: {} };
}

function save(dir: string, data: AttemptsFile): void {
    fs.mkdirSync(path.dirname(file(dir)), { recursive: true });
    fs.writeFileSync(file(dir), `${JSON.stringify(data, null, 2)}\n`);
}

function updateStreaks(data: AttemptsFile, codes: string[]): void {
    const current = new Set(codes);
    for (const code of Object.keys(data.streaks)) {
        if (!current.has(code)) delete data.streaks[code];
    }
    for (const code of current) data.streaks[code] = (data.streaks[code] ?? 0) + 1;
}

function summarize(data: AttemptsFile): AttemptsSummary {
    return {
        checkRounds: data.checkRounds,
        checkLimit: LIMITS.checkRounds,
        renderFailures: data.renderFailures,
        renderLimit: LIMITS.renderFailures,
        repeatedCodes: { ...data.streaks },
        repeatLimit: LIMITS.sameCode,
    };
}

export interface AttemptsVerdict {
    summary: AttemptsSummary;
    stop: boolean;
    reason?: string;
}

function verdict(data: AttemptsFile, failed: boolean): AttemptsVerdict {
    const summary = summarize(data);
    if (!failed) return { summary, stop: false };
    const stuck = Object.entries(data.streaks).find(([, n]) => n >= LIMITS.sameCode);
    if (stuck) {
        return {
            summary,
            stop: true,
            reason: `"${stuck[0]}" failed ${stuck[1]} runs in a row. Stop and report to the user with the contact sheet and this JSON.`,
        };
    }
    if (data.checkRounds >= LIMITS.checkRounds) {
        return {
            summary,
            stop: true,
            reason: `check has run ${data.checkRounds} times without passing. Stop and report to the user with the contact sheet and this JSON.`,
        };
    }
    if (data.renderFailures >= LIMITS.renderFailures) {
        return {
            summary,
            stop: true,
            reason: `render failed ${data.renderFailures} times. Stop and report to the user with the contact sheet and this JSON.`,
        };
    }
    return { summary, stop: false };
}

/** Count one check run with the error codes it produced. */
export function recordCheck(dir: string, codes: string[]): AttemptsVerdict {
    const data = load(dir);
    data.checkRounds += 1;
    updateStreaks(data, codes);
    save(dir, data);
    return verdict(data, codes.length > 0);
}

/** Count one render. A passing render clears every counter. */
export function recordRender(dir: string, codes: string[]): AttemptsVerdict {
    if (codes.length === 0) {
        const fresh: AttemptsFile = { version: 1, checkRounds: 0, renderFailures: 0, streaks: {} };
        save(dir, fresh);
        return verdict(fresh, false);
    }
    const data = load(dir);
    data.renderFailures += 1;
    updateStreaks(data, codes);
    save(dir, data);
    return verdict(data, true);
}
