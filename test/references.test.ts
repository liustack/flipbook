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
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../src/cli/check.ts';
import { ENV_CODES, FINDING_CODES } from '../src/cli/codes.ts';
import { validateTimeline } from '../src/engine/timeline.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps, repoRoot, tempDir } from './helpers.ts';

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
                fs.writeFileSync(
                    path.join(dir, 'index.html'),
                    snippet.lang === 'html' ? snippet.code : page(snippet.code),
                );
                const report = await runCheck({
                    dir,
                    session: await session(),
                    // Only the seek-timeout snippet needs a short limit; the others run
                    // concurrently and keep the default so a busy machine does not fail them.
                    seekTimeoutMs: snippet.expect === 'fail seek-timeout' ? 1500 : undefined,
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

/**
 * references/troubleshooting.md, rendered from src/cli/codes.ts. After changing
 * a code, run UPDATE_REFERENCES=1 pnpm test test/references.test.ts.
 */
function troubleshooting(): string {
    const lines = [
        '# Troubleshooting',
        '',
        'Every code flipbook reports, what it means, and what to change.',
        '',
        '- Exit 1: the composition has a problem. Fix the codes under `failures`, then run `check` again.',
        '- Exit 2: the command itself is wrong (a flag, a missing directory). Fix the command.',
        '- Exit 78: the machine is missing something. Relay `fix` from the JSON on stderr and leave the composition alone.',
        '- `stop: true`: the retry limit is reached. Stop, and give the user the contact sheet, the report and `stopReason`.',
        '- Every finding carries `time`, `frame`, `element` and `evidence` when they apply. Open the evidence images before changing code.',
        '',
        '## Composition problems (exit 1)',
        '',
    ];
    for (const [code, info] of Object.entries(FINDING_CODES)) {
        lines.push(`### \`${code}\``, '', info.meaning, '', `Fix: ${info.fix}`, '');
    }
    lines.push('## Environment problems (exit 78)', '');
    for (const [code, info] of Object.entries(ENV_CODES)) {
        lines.push(`### \`${code}\``, '', info.meaning, '', `Fix: ${info.fix}`, '');
    }
    return `${lines.join('\n').trimEnd()}\n`;
}

describe('skill files speak to the agent using the skill', () => {
    it('carry no maintainer steps (regenerating files, CI)', () => {
        const skillDir = path.join(repoRoot, 'skills', 'flipbook');
        for (const file of [path.join(skillDir, 'SKILL.md'), ...files]) {
            const text = fs.readFileSync(file, 'utf-8');
            for (const phrase of ['UPDATE_REFERENCES', 'src/cli/', ' in CI', 'Generated from']) {
                expect(text, `${path.basename(file)} mentions ${phrase}`).not.toContain(phrase);
            }
        }
    });
});

describe('troubleshooting reference', () => {
    it('matches src/cli/codes.ts', () => {
        const file = path.join(referencesDir, 'troubleshooting.md');
        const expected = troubleshooting();
        if (process.env.UPDATE_REFERENCES === '1') fs.writeFileSync(file, expected);
        expect(fs.readFileSync(file, 'utf-8')).toBe(expected);
    });
});
