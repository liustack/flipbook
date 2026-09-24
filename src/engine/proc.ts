import { type ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { EnvError } from '../cli/report.ts';

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

/** What to do when the system killed a process flipbook started. */
export const RESOURCE_FIX = [
    'Give flipbook at least 2 GB of memory and 128 processes: close other heavy programs, or raise the container limits (for example docker run --memory 2g --pids-limit 128).',
    'Then run the same command again. Leave the composition as it is.',
];

/**
 * Exit 78 for a process the system took away. The OOM killer, a cgroup memory
 * limit and a pids limit all end processes from outside.
 */
export function resourceExhausted(message: string, detail: Record<string, unknown>): EnvError {
    return new EnvError('resource-exhausted', message, [...RESOURCE_FIX], detail);
}

/** A helper killed by SIGKILL that flipbook did not kill itself. */
export function killedBySystem(program: string, signal: NodeJS.Signals | null): EnvError | null {
    if (signal !== 'SIGKILL') return null;
    const name = path.basename(program);
    return resourceExhausted(
        `${name} was killed (SIGKILL) while flipbook was running. The system does this when memory or the process count runs out.`,
        { program: name, signal },
    );
}

/** Time allowed for pipes to drain after the child exits. */
const DRAIN_MS = 200;
/** Time between SIGTERM and SIGKILL. */
const KILL_GRACE_MS = 2000;

/**
 * First executable named `bin` on PATH, or null. Nothing is spawned. On win32
 * the name gets `.exe` and the PATH key matches in any case (a copied env
 * often spells it Path).
 */
export function findOnPath(
    bin: string,
    env: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
): string | null {
    const windows = platform === 'win32';
    const key = windows ? Object.keys(env).find((k) => k.toUpperCase() === 'PATH') : 'PATH';
    const value = key === undefined ? '' : (env[key] ?? '');
    const name = windows && !bin.toLowerCase().endsWith('.exe') ? `${bin}.exe` : bin;
    const dirs = value.split(windows ? ';' : ':').filter(Boolean);
    for (const dir of dirs) {
        const candidate = path.join(dir, name);
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
 * the end. Resolves on `exit` plus a short drain window. A child the system
 * killed (SIGKILL outside the time limit) rejects with resource-exhausted.
 */
export function run(cmd: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            env: options.env ?? process.env,
            cwd: options.cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
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
            const killed = timedOut ? null : killedBySystem(cmd, signal);
            if (killed) {
                reject(killed);
                return;
            }
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
