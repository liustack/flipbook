import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { run, tail, terminate } from './proc.ts';

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

    /** `options.output` must sit in a directory the caller made with Workspace.fresh. */
    static start(ffmpeg: string, options: EncoderOptions): Encoder {
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

export interface MuxOptions {
    video: string;
    audio: string;
    /** Seconds into the audio file where the first beat falls; that point lands on t = 0. */
    offsetSec: number;
    durationSec: number;
    output: string;
}

/**
 * Put the user's soundtrack under the picture: trim the file at the first
 * beat, pad or cut it to the video length, fade out over the last second,
 * encode AAC 48 kHz stereo, copy the video stream as is.
 */
export async function muxSoundtrack(ffmpeg: string, options: MuxOptions): Promise<void> {
    const d = options.durationSec;
    const fade = Math.min(1, d / 4);
    const filter =
        `[1:a]atrim=start=${options.offsetSec},asetpts=PTS-STARTPTS,aresample=48000,` +
        `aformat=channel_layouts=stereo,apad,atrim=0:${d},` +
        `afade=t=out:st=${Math.max(0, d - fade)}:d=${fade}[a]`;
    const result = await run(
        ffmpeg,
        [
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-i',
            options.video,
            '-i',
            options.audio,
            '-filter_complex',
            filter,
            '-map',
            '0:v',
            '-map',
            '[a]',
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-ar',
            '48000',
            '-map_metadata',
            '0',
            '-movflags',
            '+faststart',
            options.output,
        ],
        { timeoutMs: 600_000 },
    );
    if (result.code !== 0)
        throw new Error(`ffmpeg could not add the soundtrack: ${tail(result.stderr)}`);
}
