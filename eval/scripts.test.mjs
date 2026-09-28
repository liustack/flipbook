import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
    analyzeScript,
    inlineScripts,
    normalizeRef,
    pageReferences,
    runtimeUse,
} from './scripts.mjs';

const temps = [];
afterAll(() => {
    for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const IMPORT = "import { puppet, riso } from '/__flipbook/runtime.js';\n";
const calls = (code) => [...analyzeScript(code).calls].sort();

describe('runtime calls in a page script', () => {
    it('counts a call however it is spaced or wrapped', () => {
        expect(calls(`${IMPORT}puppet ({});`)).toEqual(['puppet']);
        expect(calls(`${IMPORT}const man = puppet(\n  { parts },\n);`)).toEqual(['puppet']);
        expect(calls(`${IMPORT}(puppet)({});`)).toEqual(['puppet']);
    });

    it('does not count a call in a comment or a string', () => {
        expect(calls(`${IMPORT}// puppet({})`)).toEqual([]);
        expect(calls(`${IMPORT}/* riso(1, 2) */`)).toEqual([]);
        expect(calls(`${IMPORT}const note = "puppet({})";`)).toEqual([]);
        expect(calls(`${IMPORT}const note = \`riso(\${1})\`;`)).toEqual([]);
    });

    it('counts a function imported under another name by its own name', () => {
        const code = "import { puppet as makeMan } from '/__flipbook/runtime.js';\nmakeMan({});";
        expect(calls(code)).toEqual(['puppet']);
    });

    it('counts calls through a namespace import and a dynamic import', () => {
        expect(calls("import * as fb from '/__flipbook/runtime.js';\nfb.riso(1, 2);")).toEqual([
            'riso',
        ]);
        expect(
            calls(
                "const { pixel: grid } = await import('/__flipbook/runtime.js');\ngrid(320, 180);",
            ),
        ).toEqual(['pixel']);
        expect(
            calls("const rt = await import('/__flipbook/runtime.js');\nrt.photo('a.png');"),
        ).toEqual(['photo']);
    });

    it('does not count a function of the same name that is not the runtime one', () => {
        expect(calls('function puppet() {}\npuppet({});')).toEqual([]);
        expect(calls("import { puppet } from './my-puppet.js';\npuppet({});")).toEqual([]);
        expect(analyzeScript('puppet({});').imports).toBe(false);
    });
});

describe('page scripts of a composition', () => {
    it('runs inline scripts, skips commented-out ones, JSON blocks and src tags', () => {
        const html = `<!doctype html><body>
<!-- <script type="module">${IMPORT}riso(1, 2);</script> -->
<script type="application/json">{"puppet": 1}</script>
<script src="scene.js"></script>
<script type="module">${IMPORT}puppet({});</script>
</body>`;
        expect(inlineScripts(html)).toEqual([`${IMPORT}puppet({});`]);
    });

    it('gathers the calls of every page and script file, and says when nothing imports the runtime', () => {
        const dir = mkdtempSync(join(tmpdir(), 'flipbook-scripts-'));
        temps.push(dir);
        const write = (rel, text) => {
            mkdirSync(dirname(join(dir, rel)), { recursive: true });
            writeFileSync(join(dir, rel), text);
        };
        write('index.html', '<script type="module" src="scene.js"></script>');
        expect(runtimeUse(dir)).toEqual({ imports: false, calls: [] });
        write('scene.js', `${IMPORT}puppet({});\n// riso(1, 2)`);
        write('.claude/skills/flipbook/example.js', `${IMPORT}riso(1, 2);`);
        write('out/leftover.js', `${IMPORT}riso(1, 2);`);
        expect(runtimeUse(dir)).toEqual({ imports: true, calls: ['puppet'] });
    });
});

describe('files a composition names', () => {
    it('reads a file name the way the page requests it', () => {
        expect(normalizeRef('./assets/a.png?v=2#x')).toBe('assets/a.png');
        expect(normalizeRef('/assets/b%20c.png')).toBe('assets/b c.png');
        expect(normalizeRef('http://flipbook.local/assets/d.png')).toBe('assets/d.png');
        expect(normalizeRef('https://example.org/e.png')).toBeNull();
        expect(normalizeRef('data:image/png;base64,AAAA')).toBeNull();
        expect(normalizeRef('/__flipbook/runtime.js')).toBeNull();
        expect(normalizeRef('../outside.png')).toBeNull();
    });

    it('takes names from strings, attributes and CSS, and none from comments', () => {
        const dir = mkdtempSync(join(tmpdir(), 'flipbook-refs-'));
        temps.push(dir);
        const write = (rel, text) => {
            mkdirSync(dirname(join(dir, rel)), { recursive: true });
            writeFileSync(join(dir, rel), text);
        };
        write(
            'index.html',
            `<!-- <img src="assets/commented.png"> -->
<img src="assets/plate.png" srcset="assets/a.png 1x, assets/b.png 2x">
<div style="background: url('assets/paper.jpg')"></div>
<script type="module">
// photo('assets/in-comment.png')
const cut = 'assets/cut/one.png';
photo(\`assets/cut/\${name}-01.png\`);
</script>`,
        );
        write('style.css', '/* url(assets/old.png) */ body { background: url(assets/grain.png); }');
        expect(pageReferences(dir)).toEqual({
            exact: [
                'assets/a.png',
                'assets/b.png',
                'assets/cut/one.png',
                'assets/grain.png',
                'assets/paper.jpg',
                'assets/plate.png',
            ],
            prefixes: ['assets/cut/'],
        });
    });
});
