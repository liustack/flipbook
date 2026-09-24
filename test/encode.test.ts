// The encoder pipe must never hang render: every wait on ffmpeg has a limit,
// and a stuck ffmpeg is killed and reaped before the error comes back.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { Encoder } from '../src/engine/encode.ts';
import { run } from '../src/engine/proc.ts';
import { cleanTemps, tempDir } from './helpers.ts';

afterAll(() => cleanTemps());

/** An "ffmpeg" that stays alive, never reads stdin and ignores SIGTERM. */
function stuckFfmpeg(): string {
    const dir = tempDir('stuck-ffmpeg');
    const file = path.join(dir, 'ffmpeg');
    fs.writeFileSync(file, "#!/bin/sh\ntrap '' TERM\nwhile :; do sleep 1; done\n", { mode: 0o755 });
    return file;
}

function alive(pid: number | undefined): boolean {
    if (pid === undefined) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function start(writeTimeoutMs = 300): Encoder {
    return Encoder.start(stuckFfmpeg(), {
        fps: 12,
        output: path.join(tempDir('encode-out'), 'video.mp4'),
        metadata: {},
        writeTimeoutMs,
    });
}

describe('encoder pipe limits', () => {
    it('gives up on a write ffmpeg never takes and leaves no process behind', async () => {
        const encoder = start();
        const chunk = Buffer.alloc(1 << 20);
        const started = Date.now();
        await expect(
            (async () => {
                for (let i = 0; i < 64; i++) await encoder.write(chunk);
            })(),
        ).rejects.toThrow(/did not take a frame/);
        expect(Date.now() - started).toBeLessThan(8000);
        expect(alive(encoder.pid)).toBe(false);
    }, 20_000);

    it('abort waits until ffmpeg has exited', async () => {
        const encoder = start();
        expect(alive(encoder.pid)).toBe(true);
        await encoder.abort();
        expect(alive(encoder.pid)).toBe(false);
    }, 20_000);

    it('finish kills an ffmpeg that never exits', async () => {
        const encoder = start();
        await expect(encoder.finish(300)).rejects.toThrow(/did not finish/);
        expect(alive(encoder.pid)).toBe(false);
    }, 20_000);
});

/** An "ffmpeg" that reads stdin until it is killed. */
function readingFfmpeg(): string {
    const dir = tempDir('reading-ffmpeg');
    const file = path.join(dir, 'ffmpeg');
    fs.writeFileSync(file, '#!/bin/sh\nexec cat > /dev/null\n', { mode: 0o755 });
    return file;
}

describe('a helper process the system kills', () => {
    it('fails the next encoder write at once with resource-exhausted', async () => {
        const encoder = Encoder.start(readingFfmpeg(), {
            fps: 12,
            output: path.join(tempDir('encode-out'), 'video.mp4'),
            metadata: {},
        });
        await encoder.write(Buffer.alloc(1024));
        process.kill(encoder.pid as number, 'SIGKILL');
        await new Promise((resolve) => setTimeout(resolve, 200));
        const started = Date.now();
        await expect(encoder.write(Buffer.alloc(1024))).rejects.toMatchObject({
            code: 'resource-exhausted',
            detail: { signal: 'SIGKILL' },
        });
        await expect(encoder.finish(5000)).rejects.toMatchObject({ code: 'resource-exhausted' });
        expect(Date.now() - started).toBeLessThan(2000);
    }, 20_000);

    it('rejects run() with resource-exhausted, but not when its own time limit killed it', async () => {
        const sleeping = run('/bin/sleep', ['30']);
        await new Promise((resolve) => setTimeout(resolve, 200));
        const pids = (await run('/usr/bin/pgrep', ['-P', String(process.pid), 'sleep'])).stdout
            .toString('utf-8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(Number);
        for (const pid of pids) process.kill(pid, 'SIGKILL');
        await expect(sleeping).rejects.toMatchObject({ code: 'resource-exhausted' });
        const limited = await run('/bin/sleep', ['30'], { timeoutMs: 100 });
        expect(limited.timedOut).toBe(true);
    }, 20_000);
});
