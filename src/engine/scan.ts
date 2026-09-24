import * as fs from 'fs';
import * as path from 'path';
import { type Finding, finding } from '../cli/report.ts';

interface Rule {
    pattern: RegExp;
    what: string;
}

const JS_RULES: Rule[] = [
    { pattern: /\bsetTimeout\s*\(/g, what: 'setTimeout' },
    { pattern: /\bsetInterval\s*\(/g, what: 'setInterval' },
    { pattern: /\brequestAnimationFrame\s*\(/g, what: 'requestAnimationFrame' },
    { pattern: /\bDate\s*\.\s*now\s*\(/g, what: 'Date.now()' },
    { pattern: /\bnew\s+Date\s*\(\s*\)/g, what: 'new Date()' },
    { pattern: /\bperformance\s*\.\s*now\s*\(/g, what: 'performance.now()' },
    { pattern: /\bMath\s*\.\s*random\s*\(/g, what: 'Math.random()' },
    { pattern: /\bcrypto\s*\.\s*(getRandomValues|randomUUID)\s*\(/g, what: 'crypto random' },
    { pattern: /\btransferControlToOffscreen\s*\(/g, what: 'OffscreenCanvas in a Worker' },
    { pattern: /\bdesynchronized\s*:\s*true\b/g, what: 'desynchronized canvas' },
    { pattern: /\bnew\s+(Shared)?Worker\s*\(/g, what: 'Worker' },
];

const CSS_RULES: Rule[] = [
    { pattern: /@keyframes\b/g, what: 'CSS @keyframes animation' },
    { pattern: /(^|[;{\s])animation(-name)?\s*:(?!\s*none\b)[^;}]+/g, what: 'CSS animation' },
    { pattern: /(^|[;{\s])transition(-property)?\s*:(?!\s*none\b)[^;}]+/g, what: 'CSS transition' },
    { pattern: /content-visibility\s*:\s*auto/g, what: 'content-visibility: auto' },
];

const HTML_RULES: Rule[] = [
    { pattern: /<video\b/gi, what: '<video>' },
    { pattern: /<iframe\b/gi, what: '<iframe>' },
    { pattern: /\bloading\s*=\s*["']?lazy/gi, what: 'loading="lazy"' },
];

/**
 * JavaScript with comments and string or template literal contents blanked
 * out. Newlines and offsets are preserved so matches keep their line numbers.
 */
export function stripJs(code: string): string {
    const out = code.split('');
    const blank = (from: number, to: number) => {
        for (let i = from; i < to; i++) {
            if (out[i] !== '\n') out[i] = ' ';
        }
    };
    let i = 0;
    while (i < code.length) {
        const ch = code[i];
        const next = code[i + 1];
        if (ch === '/' && next === '/') {
            const end = code.indexOf('\n', i);
            const stop = end < 0 ? code.length : end;
            blank(i, stop);
            i = stop;
        } else if (ch === '/' && next === '*') {
            const end = code.indexOf('*/', i + 2);
            const stop = end < 0 ? code.length : end + 2;
            blank(i, stop);
            i = stop;
        } else if (ch === '"' || ch === "'" || ch === '`') {
            let j = i + 1;
            while (j < code.length && code[j] !== ch) {
                if (code[j] === '\\') j++;
                else if (ch !== '`' && code[j] === '\n') break;
                j++;
            }
            blank(i + 1, j);
            i = j + 1;
        } else {
            i++;
        }
    }
    return out.join('');
}

/** CSS with comments blanked out. */
export function stripCss(code: string): string {
    return code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function lineAt(text: string, offset: number): number {
    let line = 1;
    for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === '\n') line++;
    }
    return line;
}

interface Hit {
    what: string;
    file: string;
    line: number;
}

function applyRules(
    rules: Rule[],
    text: string,
    file: string,
    baseOffset: number,
    whole: string,
): Hit[] {
    const hits: Hit[] = [];
    for (const rule of rules) {
        rule.pattern.lastIndex = 0;
        for (const match of text.matchAll(rule.pattern)) {
            hits.push({
                what: rule.what,
                file,
                line: lineAt(whole, baseOffset + (match.index ?? 0)),
            });
        }
    }
    return hits;
}

const SKIP_DIRS = new Set(['.flipbook', 'out', 'node_modules', '.git']);

function listFiles(dir: string, root: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) listFiles(path.join(dir, entry.name), root, out);
        } else if (entry.isFile()) {
            out.push(path.relative(root, path.join(dir, entry.name)));
        }
    }
    return out;
}

/** Scan the composition's HTML, JS and CSS for forbidden constructs. Warnings only. */
export function scanComposition(dir: string): Finding[] {
    const hits: Hit[] = [];
    for (const rel of listFiles(dir, dir)) {
        const ext = path.extname(rel).toLowerCase();
        const file = path.join(dir, rel);
        if (ext === '.html' || ext === '.htm') {
            const html = fs.readFileSync(file, 'utf-8');
            hits.push(
                ...applyRules(
                    HTML_RULES,
                    html.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' ')),
                    rel,
                    0,
                    html,
                ),
            );
            for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
                if (
                    /\bsrc\s*=/.test(m[1]) ||
                    /type\s*=\s*["']?(application\/json|importmap)/i.test(m[1])
                )
                    continue;
                const start = (m.index ?? 0) + m[0].indexOf('>') + 1;
                hits.push(...applyRules(JS_RULES, stripJs(m[2]), rel, start, html));
            }
            for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
                const start = (m.index ?? 0) + m[0].indexOf('>') + 1;
                hits.push(...applyRules(CSS_RULES, stripCss(m[1]), rel, start, html));
            }
            for (const m of html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)) {
                const start = (m.index ?? 0) + m[0].indexOf('"') + 1;
                hits.push(...applyRules(CSS_RULES, m[1], rel, start, html));
            }
        } else if (ext === '.js' || ext === '.mjs') {
            const code = fs.readFileSync(file, 'utf-8');
            hits.push(...applyRules(JS_RULES, stripJs(code), rel, 0, code));
        } else if (ext === '.css') {
            const css = fs.readFileSync(file, 'utf-8');
            hits.push(...applyRules(CSS_RULES, stripCss(css), rel, 0, css));
        }
    }
    const seen = new Set<string>();
    const unique = hits.filter((hit) => {
        const key = `${hit.what}|${hit.file}|${hit.line}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    return unique.map((hit) =>
        finding('static-forbidden', `${hit.what} at ${hit.file}:${hit.line}`, {
            severity: 'warning',
            element: `${hit.file}:${hit.line}`,
            detail: { construct: hit.what },
        }),
    );
}
