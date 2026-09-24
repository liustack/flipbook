import { type ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface RunResult {
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: Buffer;
    stderr: string;
    timedOut: boolean;
}

export interface RunOptions {
    input?: Buffer;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    cwd?: string;
}

/** Time allowed for pipes to drain after the child exits. */
const DRAIN_MS = 200;
/** Time between SIGTERM and SIGKILL. */
const KILL_GRACE_MS = 2000;

/** First executable named `bin` on PATH, or null. Nothing is spawned. */
export function findOnPath(bin: string, env: NodeJS.ProcessEnv = process.env): string | null {
    const dirs = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
    for (const dir of dirs) {
        const candidate = path.join(dir, bin);
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            if (fs.statSync(candidate).isFile()) return candidate;
        } catch {
            // not here
        }
    }
    return null;
}

/** Stop a child: SIGTERM first, SIGKILL if it is still running after a grace period. */
export function terminate(child: ChildProcess): void {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, KILL_GRACE_MS);
    child.once('exit', () => clearTimeout(timer));
}

/**
 * Run a command to completion. stdout stays bytes, stderr is decoded once at
 * the end. Resolves on `exit` plus a short drain window.
 */
export function run(cmd: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            env: options.env ?? process.env,
            cwd: options.cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        let timedOut = false;
        let settled = false;
        child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
        child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
        const timer =
            options.timeoutMs !== undefined
                ? setTimeout(() => {
                      timedOut = true;
                      terminate(child);
                  }, options.timeoutMs)
                : null;
        const finish = (code: number | null, signal: NodeJS.Signals | null) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            resolve({
                code,
                signal,
                stdout: Buffer.concat(out),
                stderr: Buffer.concat(err).toString('utf-8'),
                timedOut,
            });
        };
        child.on('error', (error) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            reject(error);
        });
        child.on('exit', (code, signal) => {
            const drain = setTimeout(() => finish(code, signal), DRAIN_MS);
            child.once('close', () => {
                clearTimeout(drain);
                finish(code, signal);
            });
        });
        child.stdin.on('error', () => {
            // EPIPE surfaces through the exit code.
        });
        if (options.input) child.stdin.end(options.input);
        else child.stdin.end();
    });
}

/** Last lines of a stderr capture, for error messages. */
export function tail(text: string, lines = 12): string {
    return text.trim().split('\n').slice(-lines).join('\n');
}
