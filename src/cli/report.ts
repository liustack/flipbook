import * as fs from 'fs';
import * as path from 'path';
import { Workspace } from '../engine/workspace.ts';
import { appVersion } from '../paths.ts';
import { ENV_CODES, type EnvCode, FINDING_CODES, type FindingCode } from './codes.ts';

export const REPORT_SCHEMA = 'flipbook.report/1';

export const EXIT = {
    ok: 0,
    failed: 1,
    usage: 2,
    env: 78,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
export type Command =
    | 'check'
    | 'snapshot'
    | 'render'
    | 'audio'
    | 'stock-search'
    | 'stock-fetch'
    | 'doctor'
    | 'usage';
export type Severity = 'error' | 'warning';

export interface Finding {
    code: FindingCode;
    severity: Severity;
    message: string;
    /** Seconds from the start of the composition. */
    time?: number;
    frame?: number;
    /** CSS selector or source location the finding points at. */
    element?: string;
    /** Evidence image paths. */
    evidence?: string[];
    fix: string;
    detail?: Record<string, unknown>;
}

/** How one of check's determinism checks came out. `skipped`: check stopped before it ran. */
export type DeterminismOutcome = 'pass' | 'fail' | 'skipped';

/** check's three determinism checks, saved as `check.determinism`. render reads it to allow parallel pages. */
export interface Determinism {
    /** The sampled frames seeked in a second order give the same pixels. */
    seekOrder: DeterminismOutcome;
    /** A shifted clock and a shifted random seed give the same pixels and no new problems. */
    perturbation: DeterminismOutcome;
    /** Two captures after one seek are the same. */
    latePaint: DeterminismOutcome;
}

export interface Report {
    schema: typeof REPORT_SCHEMA;
    command: Command;
    ok: boolean;
    exitCode: ExitCode;
    flipbook: { version: string };
    environment: {
        platform: string;
        node: string;
        chromium?: { version: string; revision: string; launchMode: string };
        ffmpeg?: string;
    };
    composition?: {
        dir: string;
        hash?: string;
        width?: number;
        height?: number;
        /** Device scale factor the pages ran at (check and render). */
        scale?: number;
        fps?: number;
        frames?: number;
        durationSec?: number;
    };
    failures: Finding[];
    warnings: Finding[];
    artifacts: Record<string, string>;
    attempts?: AttemptsSummary;
    stop: boolean;
    stopReason?: string;
    timing: { startedAt: string; durationMs: number };
    [key: string]: unknown;
}

export interface AttemptsSummary {
    checkRounds: number;
    checkLimit: number;
    renderFailures: number;
    renderLimit: number;
    repeatedCodes: Record<string, number>;
    repeatLimit: number;
}

/** A missing tool, library or permission. The CLI exits 78. */
export class EnvError extends Error {
    readonly code: EnvCode;
    readonly fix: string[];
    readonly detail: Record<string, unknown>;

    constructor(
        code: EnvCode,
        message: string,
        fix: string[] = [],
        detail: Record<string, unknown> = {},
    ) {
        super(message);
        this.name = 'EnvError';
        this.code = code;
        this.fix = fix;
        this.detail = detail;
    }
}

/** A bad flag or argument. The CLI exits 2. */
export class UsageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UsageError';
    }
}

export function finding(
    code: FindingCode,
    message: string,
    extra: Partial<Omit<Finding, 'code' | 'message'>> = {},
): Finding {
    return {
        code,
        severity: extra.severity ?? 'error',
        message,
        ...extra,
        fix: extra.fix ?? FINDING_CODES[code].fix,
    };
}

export function platformId(): string {
    return `${process.platform}-${process.arch}`;
}

export class ReportBuilder {
    private readonly started = Date.now();
    readonly report: Report;

    constructor(command: Command, dir?: string) {
        this.report = {
            schema: REPORT_SCHEMA,
            command,
            ok: true,
            exitCode: EXIT.ok,
            flipbook: { version: appVersion() },
            environment: { platform: platformId(), node: process.version },
            composition: dir ? { dir: path.resolve(dir) } : undefined,
            failures: [],
            warnings: [],
            artifacts: {},
            stop: false,
            timing: { startedAt: new Date(this.started).toISOString(), durationMs: 0 },
        };
    }

    add(item: Finding): void {
        if (item.severity === 'error') this.report.failures.push(item);
        else this.report.warnings.push(item);
    }

    addAll(items: Finding[]): void {
        for (const item of items) this.add(item);
    }

    hasErrors(): boolean {
        return this.report.failures.length > 0;
    }

    finish(exitCode?: ExitCode): Report {
        const code = exitCode ?? (this.hasErrors() ? EXIT.failed : EXIT.ok);
        this.report.exitCode = code;
        this.report.ok = code === EXIT.ok;
        this.report.timing.durationMs = Date.now() - this.started;
        return this.report;
    }
}

/** The JSON written to stderr when the CLI exits 78. */
export function envDiagnosis(error: EnvError): Record<string, unknown> {
    return {
        error: error.code,
        message: error.message,
        meaning: ENV_CODES[error.code].meaning,
        fix: error.fix.length > 0 ? error.fix : [ENV_CODES[error.code].fix],
        detail: error.detail,
        platform: platformId(),
        node: process.version,
    };
}

/**
 * Keep the report at <dir>/.flipbook/reports/<command>.json and record the path
 * in artifacts.report. When it cannot be saved (no composition directory, a
 * refused or failed write), artifacts.report is left out and reportSaveError
 * says why: the report on stdout is then the only copy.
 */
export function saveReport(report: Report): void {
    const dir = report.composition?.dir;
    if (!dir || report.command === 'usage' || report.command === 'doctor') return;
    let ws: Workspace;
    try {
        if (!fs.statSync(dir).isDirectory()) throw new Error(`${dir} is not a directory`);
        ws = Workspace.open(dir);
    } catch (error) {
        report.reportSaveError = `The report was not saved: ${(error as Error).message}`;
        return;
    }
    const target = ws.path('.flipbook', 'reports', `${report.command}.json`);
    report.artifacts.report = target;
    try {
        ws.writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
    } catch (error) {
        delete report.artifacts.report;
        report.reportSaveError = `The report was not saved: ${(error as Error).message}`;
    }
}

export function writeJson(stream: NodeJS.WritableStream, value: unknown): void {
    stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** Progress lines go to stderr; stdout carries only the JSON report. */
export function progress(message: string): void {
    if (process.env.FLIPBOOK_QUIET === '1') return;
    process.stderr.write(`[flipbook] ${message}\n`);
}
