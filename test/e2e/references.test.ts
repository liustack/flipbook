// Every code snippet in skills/flipbook/references/*.md runs through check.
//
// A snippet is the fenced block right after a marker comment:
//   <!-- check: pass -->              exit 0, no warnings
//   <!-- check: warn <code> -->       exit 0, that warning present
//   <!-- check: fail <code> -->       exit 1, that failure present
//   <!-- check: timeline -->          a timeline.json that must validate
// A ```js block is wrapped into a 640x360 page with <canvas id="stage">; a
// ```html block is the whole page. Both run against the block marked
// <!-- snippet-timeline --> in the same file, next to every block marked
// <!-- snippet-file: <path> --> (written to that path in the composition).
// A .wav file the snippet timeline names (an sfx cue's `file`, `audio.file`)
// and no block supplies is written as a short generated tone.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../../src/cli/check.ts';
import { validateTimeline } from '../../src/engine/timeline.ts';
import { closeSession, session } from '../browser.ts';
import { cleanTemps, repoRoot, TEST_SEEK_TIMEOUT_MS, tempDir } from '../helpers.ts';

const referencesDir = path.join(repoRoot, 'skills', 'flipbook', 'references');

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

interface Snippet {
    file: string;
    line: number;
    expect: string;
    lang: string;
    code: string;
}

function snippets(file: string): {
    timeline: string | null;
    files: Record<string, string>;
    items: Snippet[];
} {
    const text = fs.readFileSync(file, 'utf-8');
    const lines = text.split('\n');
    const items: Snippet[] = [];
    const files: Record<string, string> = {};
    let timeline: string | null = null;
    for (let i = 0; i < lines.length; i++) {
        const marker = /^<!-- (check: [^>]+|snippet-timeline|snippet-file: [^>]+) -->$/.exec(
            lines[i].trim(),
        );
        if (!marker) continue;
        const open = /^```(\w+)/.exec(lines[i + 1] ?? '');
        if (!open) throw new Error(`${file}:${i + 1}: marker not followed by a code fence`);
        const end = lines.indexOf('```', i + 2);
        const code = lines.slice(i + 2, end).join('\n');
        if (marker[1] === 'snippet-timeline') timeline = code;
        else if (marker[1].startsWith('snippet-file: ')) files[marker[1].slice(14).trim()] = code;
        else
            items.push({
                file,
                line: i + 1,
                expect: marker[1].slice(7).trim(),
                lang: open[1],
                code,
            });
        i = end;
    }
    return { timeline, files, items };
}

/** A 0.4 s 16-bit mono WAV: a quiet tone with one loud click in the middle. */
function toneWav(): Buffer {
    const rate = 8000;
    const frames = Math.round(0.4 * rate);
    const data = Buffer.alloc(frames * 2);
    for (let i = 0; i < frames; i++) {
        const click = Math.abs(i - frames / 2) < 4 ? 0.8 : 0;
        const v = 0.1 * Math.sin((2 * Math.PI * 660 * i) / rate) + click;
        data.writeInt16LE(Math.round(v * 32767), i * 2);
    }
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVEfmt ', 8, 'ascii');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
}

/** The .wav files a timeline names. */
function namedWavs(timeline: string): string[] {
    const t = JSON.parse(timeline) as {
        cues?: { file?: string }[];
        audio?: { file?: string };
    };
    return [t.audio?.file, ...(t.cues ?? []).map((cue) => cue.file)].filter(
        (file): file is string => typeof file === 'string' && file.endsWith('.wav'),
    );
}

function page(code: string): string {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 640px; height: 360px; overflow: hidden; background: #f4efe4; }
  canvas { position: absolute; left: 0; top: 0; }
</style>
</head>
<body>
<canvas id="stage"></canvas>
<script type="module">
${code}
</script>
</body>
</html>
`;
}

const files = fs
    .readdirSync(referencesDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join(referencesDir, name));

describe.concurrent('reference snippets pass check as marked', () => {
    for (const file of files) {
        const { timeline, files: extra, items } = snippets(file);
        for (const snippet of items) {
            const label = `${path.basename(file)}:${snippet.line} ${snippet.expect}`;
            it(label, async () => {
                if (snippet.expect === 'timeline') {
                    expect(validateTimeline(JSON.parse(snippet.code)).errors).toEqual([]);
                    return;
                }
                expect(
                    timeline,
                    `${path.basename(file)} has no snippet-timeline block`,
                ).not.toBeNull();
                const dir = tempDir('snippet');
                fs.writeFileSync(path.join(dir, 'timeline.json'), timeline as string);
                for (const [name, content] of Object.entries(extra)) {
                    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
                    fs.writeFileSync(path.join(dir, name), content);
                }
                for (const name of namedWavs(timeline as string)) {
                    if (name in extra) continue;
                    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
                    fs.writeFileSync(path.join(dir, name), toneWav());
                }
                fs.writeFileSync(
                    path.join(dir, 'index.html'),
                    snippet.lang === 'html' ? snippet.code : page(snippet.code),
                );
                const report = await runCheck({
                    dir,
                    session: await session(),
                    // Only the seek-timeout snippet needs a short limit. The others run
                    // concurrently on busy CI runners and get a generous one.
                    seekTimeoutMs:
                        snippet.expect === 'fail seek-timeout' ? 1500 : TEST_SEEK_TIMEOUT_MS,
                    recordAttempts: false,
                });
                const [verdict, code] = snippet.expect.split(/\s+/);
                const failures = report.failures.map((f) => f.code);
                const warnings = report.warnings.map((f) => f.code);
                if (verdict === 'pass') {
                    expect(report.failures, label).toEqual([]);
                    expect(report.warnings, label).toEqual([]);
                } else if (verdict === 'warn') {
                    expect(report.failures, label).toEqual([]);
                    expect(warnings, label).toContain(code);
                } else if (verdict === 'fail') {
                    expect(failures, label).toContain(code);
                } else {
                    throw new Error(`${label}: unknown marker`);
                }
            });
        }
    }
});
