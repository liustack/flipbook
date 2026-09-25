// flipbook writes only inside the composition directory: links planted in
// .flipbook/ or out/ must never lead a write or delete outside it.
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../src/cli/check.ts';
import { runRender } from '../src/cli/render.ts';
import { runSnapshot } from '../src/cli/snapshot.ts';
import { run } from '../src/engine/proc.ts';
import { loadTimeline } from '../src/engine/timeline.ts';
import { probeAudio } from '../src/engine/verify.ts';
import { Workspace, WorkspaceError } from '../src/engine/workspace.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps, codes, tempDir } from './helpers.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

const TIMELINE = {
    version: 1,
    width: 320,
    height: 180,
    fps: 12,
    seed: 1,
    bpm: 120,
    beatsPerBar: 4,
    scenes: [{ id: 'main', bars: 1 }],
};

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<style>html, body { margin: 0; width: 320px; height: 180px; overflow: hidden; background: #fff; }
canvas { position: absolute; left: 0; top: 0; }</style></head><body>
<canvas id="ink"></canvas>
<script type="module">
import { composition, setupCanvas } from '/__flipbook/runtime.js';
const ink = setupCanvas(document.getElementById('ink'), 320, 180);
composition({ seek(t) {
  ink.clearRect(0, 0, 320, 180);
  ink.fillStyle = '#2a6f97';
  ink.fillRect(20 + t * 100, 60, 60, 60);
} });
</script></body></html>`;

function composition(): string {
    const dir = tempDir('ws-comp');
    fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(TIMELINE));
    fs.writeFileSync(path.join(dir, 'index.html'), PAGE);
    return dir;
}

/** Files flipbook would write or delete if it followed a link into this directory. */
const SENTINELS = [
    'keep.txt',
    'timeline.resolved.json',
    'attempts.json',
    'frame-hashes.json',
    'reports/check.json',
    'evidence/check/keep.png',
    'evidence/render/keep.png',
    'check/keep.png',
    'render/keep.png',
    'snapshot/contact-sheet.png',
    'rejected/video.mp4',
    'video.mp4',
    'contact-sheet.png',
];

function outside(): string {
    const dir = tempDir('ws-outside');
    for (const rel of SENTINELS) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), `sentinel ${rel}`);
    }
    const old = new Date('2020-01-01T00:00:00Z');
    for (const rel of SENTINELS) fs.utimesSync(path.join(dir, rel), old, old);
    return dir;
}

/** Every file and directory under `dir` with its size, mtime and hash. */
function state(dir: string): string[] {
    const out: string[] = [];
    const walk = (current: string) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            const rel = path.relative(dir, full);
            const stat = fs.lstatSync(full);
            if (entry.isDirectory()) {
                out.push(`${rel}/`);
                walk(full);
            } else {
                const hash = createHash('sha256').update(fs.readFileSync(full)).digest('hex');
                out.push(`${rel} ${stat.size} ${stat.mtimeMs} ${hash}`);
            }
        }
    };
    walk(dir);
    return out.sort();
}

const LINKS: { name: string; plant: (dir: string, ext: string) => void }[] = [
    {
        name: '.flipbook is a link',
        plant: (dir, ext) => fs.symlinkSync(ext, path.join(dir, '.flipbook')),
    },
    {
        name: 'out is a link',
        plant: (dir, ext) => fs.symlinkSync(ext, path.join(dir, 'out')),
    },
    {
        name: '.flipbook/evidence is a link',
        plant: (dir, ext) => {
            fs.mkdirSync(path.join(dir, '.flipbook'));
            fs.symlinkSync(ext, path.join(dir, '.flipbook', 'evidence'));
        },
    },
    {
        name: '.flipbook/timeline.resolved.json is a link',
        plant: (dir, ext) => {
            fs.mkdirSync(path.join(dir, '.flipbook'));
            fs.symlinkSync(
                path.join(ext, 'timeline.resolved.json'),
                path.join(dir, '.flipbook', 'timeline.resolved.json'),
            );
        },
    },
    {
        name: 'out/snapshot is a link',
        plant: (dir, ext) => {
            fs.mkdirSync(path.join(dir, 'out'));
            fs.symlinkSync(path.join(ext, 'snapshot'), path.join(dir, 'out', 'snapshot'));
        },
    },
];

describe('commands never write or delete through links in .flipbook/ and out/', () => {
    for (const link of LINKS) {
        it(`${link.name}: check, snapshot and render leave the outside untouched`, async () => {
            const s = await session();
            for (const run of [
                (dir: string) => runCheck({ dir, session: s, recordAttempts: true }),
                (dir: string) => runSnapshot({ dir, session: s }),
                (dir: string) => runRender({ dir, session: s, recordAttempts: true }),
            ]) {
                const ext = outside();
                const before = state(ext);
                const dir = composition();
                link.plant(dir, ext);
                const report = await run(dir);
                expect(state(ext), `${report.command}: files outside changed`).toEqual(before);
                expect(codes(report), report.command).toContain('unsafe-output');
                expect(report.exitCode).toBe(1);
            }
        });
    }
});

/** A composition whose timeline asks for audio.file. */
function withAudio(file: string): string {
    const dir = composition();
    fs.writeFileSync(
        path.join(dir, 'timeline.json'),
        JSON.stringify({ ...TIMELINE, audio: { mode: 'file', file, bpmOffset: 0 } }),
    );
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.writeFileSync(
        path.join(dir, 'assets', 'SOURCES.json'),
        JSON.stringify({
            [path.relative('assets', file)]: { source: 'made by the test', license: 'cc0' },
        }),
    );
    return dir;
}

async function tone(ffmpeg: string, file: string, codec: string[] = []): Promise<void> {
    const made = await run(ffmpeg, [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000:duration=3',
        ...codec,
        file,
    ]);
    expect(made.code, made.stderr).toBe(0);
}

describe('audio.file stays inside the composition', () => {
    it('refuses a linked assets/music.wav that leads outside, in check, snapshot and render', async () => {
        const s = await session();
        const ext = tempDir('ws-audio-ext');
        await tone(s.ffmpeg.ffmpeg, path.join(ext, 'music.wav'));
        const before = state(ext);
        for (const runIt of [
            (dir: string) => runCheck({ dir, session: s, recordAttempts: false }),
            (dir: string) => runSnapshot({ dir, session: s }),
            (dir: string) => runRender({ dir, session: s, recordAttempts: false }),
        ]) {
            const dir = withAudio('assets/music.wav');
            fs.symlinkSync(path.join(ext, 'music.wav'), path.join(dir, 'assets', 'music.wav'));
            const report = await runIt(dir);
            const invalid = report.failures.find((f) => f.code === 'timeline-invalid');
            expect(invalid?.detail?.path, report.command).toBe('$.audio.file');
            expect(report.artifacts.video, report.command).toBeUndefined();
            expect(state(ext)).toEqual(before);
        }
    });

    it('accepts a link that stays inside and refuses a directory', () => {
        const dir = withAudio('assets/music.wav');
        fs.writeFileSync(path.join(dir, 'assets', 'real.wav'), 'x');
        fs.symlinkSync('real.wav', path.join(dir, 'assets', 'music.wav'));
        expect(loadTimeline(dir, false).findings).toEqual([]);
        const folder = withAudio('assets/music.wav');
        fs.mkdirSync(path.join(folder, 'assets', 'music.wav'));
        expect(loadTimeline(folder, false).findings[0]?.detail?.path).toBe('$.audio.file');
    });

    it('does not let ffmpeg follow a playlist to a file outside', async () => {
        const s = await session();
        const ext = tempDir('ws-playlist-ext');
        await tone(s.ffmpeg.ffmpeg, path.join(ext, 'secret.aac'), ['-c:a', 'aac']);
        const dir = withAudio('assets/list.m3u8');
        fs.writeFileSync(
            path.join(dir, 'assets', 'list.m3u8'),
            `#EXTM3U\n#EXT-X-TARGETDURATION:3\n#EXTINF:3,\n${path.join(ext, 'secret.aac')}\n#EXT-X-ENDLIST\n`,
        );
        const report = await runRender({ dir, session: s, recordAttempts: false });
        const invalid = report.failures.find((f) => f.code === 'timeline-invalid');
        expect(invalid?.detail?.path).toBe('$.audio.file');
        const delivered = report.artifacts.rejectedVideo ?? report.artifacts.video;
        expect(await probeAudio(s.ffmpeg.ffprobe, delivered)).toBeNull();
    });
});

describe('Workspace', () => {
    it('creates directories only through real directories inside the root', () => {
        const dir = tempDir('ws-dir');
        const ext = tempDir('ws-dir-ext');
        const ws = Workspace.open(dir);
        const made = ws.ensureDir(ws.path('.flipbook', 'evidence', 'check'));
        expect(fs.statSync(made).isDirectory()).toBe(true);
        fs.symlinkSync(ext, path.join(dir, '.flipbook', 'linked'));
        expect(() => ws.ensureDir(ws.path('.flipbook', 'linked', 'x'))).toThrow(WorkspaceError);
        expect(fs.readdirSync(ext)).toEqual([]);
        fs.writeFileSync(path.join(dir, '.flipbook', 'plain'), '');
        expect(() => ws.ensureDir(ws.path('.flipbook', 'plain', 'x'))).toThrow(WorkspaceError);
        expect(() => ws.ensureDir(path.join(ext, 'x'))).toThrow(WorkspaceError);
        expect(() => ws.ensureDir(ws.path('..', 'x'))).toThrow(WorkspaceError);
    });

    it('empties a directory without following a linked parent', () => {
        const dir = tempDir('ws-fresh');
        const ext = tempDir('ws-fresh-ext');
        fs.mkdirSync(path.join(ext, 'check'));
        fs.writeFileSync(path.join(ext, 'check', 'keep'), 'keep');
        fs.mkdirSync(path.join(dir, '.flipbook'));
        fs.symlinkSync(ext, path.join(dir, '.flipbook', 'evidence'));
        const ws = Workspace.open(dir);
        expect(() => ws.fresh(ws.path('.flipbook', 'evidence', 'check'))).toThrow(WorkspaceError);
        expect(fs.readFileSync(path.join(ext, 'check', 'keep'), 'utf-8')).toBe('keep');
        const fresh = ws.fresh(ws.path('.flipbook', 'tmp', 'a'));
        fs.writeFileSync(path.join(fresh, 'old'), '');
        expect(fs.readdirSync(ws.fresh(ws.path('.flipbook', 'tmp', 'a')))).toEqual([]);
    });

    it('writes files by replacing them, never through a link or a hard link', () => {
        const dir = tempDir('ws-write');
        const ext = tempDir('ws-write-ext');
        fs.writeFileSync(path.join(ext, 'target'), 'outside');
        const ws = Workspace.open(dir);
        const report = ws.path('.flipbook', 'reports', 'check.json');
        ws.writeFile(report, 'one');
        expect(fs.readFileSync(report, 'utf-8')).toBe('one');
        ws.writeFile(report, 'two');
        expect(fs.readFileSync(report, 'utf-8')).toBe('two');

        const linked = ws.path('.flipbook', 'linked.json');
        fs.symlinkSync(path.join(ext, 'target'), linked);
        expect(() => ws.writeFile(linked, 'inside')).toThrow(WorkspaceError);
        expect(fs.readFileSync(path.join(ext, 'target'), 'utf-8')).toBe('outside');

        const hard = ws.path('.flipbook', 'hard.json');
        fs.linkSync(path.join(ext, 'target'), hard);
        ws.writeFile(hard, 'inside');
        expect(fs.readFileSync(hard, 'utf-8')).toBe('inside');
        expect(fs.readFileSync(path.join(ext, 'target'), 'utf-8')).toBe('outside');
    });

    it('moves files into place only when the target is not a link', () => {
        const dir = tempDir('ws-move');
        const ext = tempDir('ws-move-ext');
        fs.writeFileSync(path.join(ext, 'video.mp4'), 'outside');
        const ws = Workspace.open(dir);
        const source = ws.path('.flipbook', 'tmp', 'video.mp4');
        ws.writeFile(source, 'rendered');
        ws.ensureDir(ws.path('out'));
        fs.symlinkSync(path.join(ext, 'video.mp4'), ws.path('out', 'video.mp4'));
        expect(() => ws.move(source, ws.path('out', 'video.mp4'))).toThrow(WorkspaceError);
        expect(fs.readFileSync(path.join(ext, 'video.mp4'), 'utf-8')).toBe('outside');
        fs.unlinkSync(ws.path('out', 'video.mp4'));
        ws.move(source, ws.path('out', 'video.mp4'));
        expect(fs.readFileSync(ws.path('out', 'video.mp4'), 'utf-8')).toBe('rendered');
    });

    it('lists every link under .flipbook/ and out/', () => {
        const dir = tempDir('ws-links');
        const ext = tempDir('ws-links-ext');
        fs.mkdirSync(path.join(dir, '.flipbook', 'evidence'), { recursive: true });
        fs.symlinkSync(ext, path.join(dir, '.flipbook', 'evidence', 'check'));
        fs.symlinkSync(ext, path.join(dir, 'out'));
        fs.symlinkSync(ext, path.join(dir, 'assets'));
        expect(Workspace.open(dir).links()).toEqual([
            path.join('.flipbook', 'evidence', 'check'),
            'out',
        ]);
    });
});
