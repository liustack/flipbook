import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { tail, terminate } from './proc.ts';

export interface EncoderOptions {
    fps: number;
    output: string;
    /** Written into the mp4 comment tag as JSON. */
    metadata: Record<string, unknown>;
}

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

/** A running ffmpeg that takes PNG frames on stdin. */
export class Encoder {
    private readonly stderr: Buffer[] = [];
    private exitCode: number | null = null;
    private exited: Promise<number | null>;
    private failure: Error | null = null;

    private constructor(private readonly child: ChildProcessWithoutNullStreams) {
        child.stderr.on('data', (chunk: Buffer) => this.stderr.push(chunk));
        child.stdin.on('error', (error) => {
            this.failure = error;
        });
        this.exited = new Promise((resolve) => {
            child.on('error', (error) => {
                this.failure = error;
                resolve(null);
            });
            child.on('exit', (code) => {
                this.exitCode = code;
                resolve(code);
            });
        });
    }

    static start(ffmpeg: string, options: EncoderOptions): Encoder {
        fs.mkdirSync(path.dirname(options.output), { recursive: true });
        const child = spawn(ffmpeg, encoderArgs(options), { stdio: ['pipe', 'ignore', 'pipe'] });
        return new Encoder(child as unknown as ChildProcessWithoutNullStreams);
    }

    private error(prefix: string): Error {
        const log = tail(Buffer.concat(this.stderr).toString('utf-8'));
        return new Error(
            `${prefix}${this.failure ? `: ${this.failure.message}` : ''}${log ? `\n${log}` : ''}`,
        );
    }

    /** Queue one PNG frame, waiting when the pipe is full. */
    async write(png: Buffer): Promise<void> {
        if (this.failure || this.exitCode !== null)
            throw this.error('ffmpeg stopped accepting frames');
        if (!this.child.stdin.write(png)) {
            await new Promise<void>((resolve) => {
                const done = () => {
                    this.child.stdin.off('drain', done);
                    this.child.off('exit', done);
                    resolve();
                };
                this.child.stdin.once('drain', done);
                this.child.once('exit', done);
            });
            if (this.failure || this.exitCode !== null)
                throw this.error('ffmpeg stopped accepting frames');
        }
    }

    /** Close stdin and wait for ffmpeg to finish writing the file. */
    async finish(timeoutMs = 600_000): Promise<void> {
        this.child.stdin.end();
        const timer = setTimeout(() => terminate(this.child), timeoutMs);
        const code = await this.exited;
        clearTimeout(timer);
        if (code !== 0) throw this.error(`ffmpeg exited with ${code}`);
    }

    abort(): void {
        terminate(this.child);
    }
}
