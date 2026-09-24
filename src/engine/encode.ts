import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { tail, terminate } from './proc.ts';

export interface EncoderOptions {
    fps: number;
    output: string;
    /** Written into the mp4 comment tag as JSON. */
    metadata: Record<string, unknown>;
    /** Longest wait for ffmpeg to take one frame from a full pipe. */
    writeTimeoutMs?: number;
}

/** Default limit for one frame to leave the pipe. */
export const WRITE_TIMEOUT_MS = 60_000;

/** ffmpeg arguments: PNG frames on stdin to H.264 yuv420p with bt709 matrix and tags. */
export function encoderArgs(options: EncoderOptions): string[] {
    return [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'image2pipe',
        '-framerate',
        String(options.fps),
        '-c:v',
        'png',
        '-i',
        '-',
        '-vf',
        'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,' +
            'setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv',
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '18',
        '-tune',
        'animation',
        '-pix_fmt',
        'yuv420p',
        '-colorspace',
        'bt709',
        '-color_primaries',
        'bt709',
        '-color_trc',
        'bt709',
        '-color_range',
        'tv',
        '-movflags',
        '+faststart',
        '-metadata',
        `comment=${JSON.stringify(options.metadata)}`,
        '-an',
        options.output,
    ];
}

/** ffmpeg failed or stalled while taking frames or writing the video. */
export class EncoderError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'EncoderError';
    }
}

/**
 * A running ffmpeg that takes PNG frames on stdin. Every wait on it has a
 * limit. When a limit runs out, or render gives up, ffmpeg is stopped
 * (SIGTERM, then SIGKILL) and the call returns only after it has exited.
 */
export class Encoder {
    private readonly stderr: Buffer[] = [];
    private readonly child: ChildProcessWithoutNullStreams;
    private readonly writeTimeoutMs: number;
    private readonly exited: Promise<number | null>;
    private done = false;
    private failure: Error | null = null;

    private constructor(child: ChildProcessWithoutNullStreams, writeTimeoutMs: number) {
        this.child = child;
        this.writeTimeoutMs = writeTimeoutMs;
        child.stderr.on('data', (chunk: Buffer) => this.stderr.push(chunk));
        child.stdin.on('error', (error) => {
            this.failure ??= error;
        });
        this.exited = new Promise((resolve) => {
            child.on('error', (error) => {
                this.failure ??= error;
                this.done = true;
                resolve(null);
            });
            child.on('exit', (code) => {
                this.done = true;
                resolve(code);
            });
        });
    }

    /** `options.output` must sit in a directory the caller made with Workspace.fresh. */
    static start(ffmpeg: string, options: EncoderOptions): Encoder {
        const child = spawn(ffmpeg, encoderArgs(options), {
            stdio: ['pipe', 'ignore', 'pipe'],
            windowsHide: true,
        });
        return new Encoder(
            child as unknown as ChildProcessWithoutNullStreams,
            options.writeTimeoutMs ?? WRITE_TIMEOUT_MS,
        );
    }

    /** Process id of ffmpeg, for diagnostics and tests. */
    get pid(): number | undefined {
        return this.child.pid;
    }

    private error(prefix: string): EncoderError {
        const log = tail(Buffer.concat(this.stderr).toString('utf-8'));
        return new EncoderError(
            `${prefix}${this.failure ? `: ${this.failure.message}` : ''}${log ? `\n${log}` : ''}`,
        );
    }

    /** Resolve on the first of `events`, or after `ms` with false. */
    private waitFor(ms: number, events: (() => Promise<unknown>)[]): Promise<boolean> {
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), ms);
        });
        return Promise.race([...events.map((event) => event().then(() => true)), timeout]).finally(
            () => clearTimeout(timer),
        );
    }

    /** Stop ffmpeg and wait until it has exited. */
    private async stop(): Promise<void> {
        if (!this.done) terminate(this.child);
        await this.exited;
    }

    /** Queue one PNG frame, waiting (within the write limit) when the pipe is full. */
    async write(png: Buffer): Promise<void> {
        if (this.failure || this.done) throw this.error('ffmpeg stopped accepting frames');
        if (this.child.stdin.write(png)) return;
        const stdin = this.child.stdin;
        const listeners: [string, () => void][] = [];
        const on = (event: string) => () =>
            new Promise<void>((resolve) => {
                listeners.push([event, resolve]);
                stdin.once(event, resolve);
            });
        const drained = await this.waitFor(this.writeTimeoutMs, [
            on('drain'),
            on('error'),
            on('close'),
            () => this.exited,
        ]);
        for (const [event, listener] of listeners) stdin.off(event, listener);
        if (!drained) {
            await this.stop();
            throw this.error(`ffmpeg did not take a frame within ${this.writeTimeoutMs} ms`);
        }
        if (this.failure || this.done) throw this.error('ffmpeg stopped accepting frames');
    }

    /** Close stdin and wait (within `timeoutMs`) for ffmpeg to finish writing the file. */
    async finish(timeoutMs = 600_000): Promise<void> {
        this.child.stdin.end();
        const finished = await this.waitFor(timeoutMs, [() => this.exited]);
        if (!finished) {
            await this.stop();
            throw this.error(`ffmpeg did not finish within ${timeoutMs} ms`);
        }
        const code = await this.exited;
        if (code !== 0) throw this.error(`ffmpeg exited with ${code}`);
    }

    /** Give up on the video: stop ffmpeg and wait until it has exited. */
    async abort(): Promise<void> {
        this.child.stdin.destroy();
        await this.stop();
    }
}
