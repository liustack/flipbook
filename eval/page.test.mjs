import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { pageModel, resolveRef } from './page.mjs';

const temps = [];
afterAll(() => {
    for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const IMPORT = "import { puppet, riso } from '/__flipbook/runtime.js';\n";
const inline = (code) => `<!doctype html><body><script type="module">\n${code}\n</script></body>`;

/** The page model of a composition made of `files`, without the program. */
function model(files) {
    const dir = mkdtempSync(join(tmpdir(), 'flipbook-page-'));
    temps.push(dir);
    for (const [rel, text] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, rel)), { recursive: true });
        writeFileSync(join(dir, rel), text);
    }
    const { program, files: _files, texts, ...rest } = pageModel(dir);
    return rest;
}
const calls = (code) => model({ 'index.html': inline(code) }).calls;

describe('runtime calls, by binding', () => {
    it('counts a call however it is spaced or wrapped', () => {
        expect(calls(`${IMPORT}puppet ({});`)).toEqual(['puppet']);
        expect(calls(`${IMPORT}const man = puppet(\n  { parts },\n);`)).toEqual(['puppet']);
        expect(calls(`${IMPORT}(puppet)({});`)).toEqual(['puppet']);
    });

    it('does not count a call in a comment or a string', () => {
        expect(calls(`${IMPORT}// puppet({})`)).toEqual([]);
        expect(calls(`${IMPORT}/* riso(1, 2) */`)).toEqual([]);
        expect(calls(`${IMPORT}const note = "puppet({})";`)).toEqual([]);
    });

    it('does not count a parameter, a local or a namespace that shadows the runtime name', () => {
        expect(calls(`${IMPORT}function local(puppet) { puppet({}); }\nlocal(() => {});`)).toEqual(
            [],
        );
        expect(calls(`${IMPORT}{ const riso = () => {}; riso(); }`)).toEqual([]);
        expect(
            calls(
                "import * as fb from '/__flipbook/runtime.js';\nfunction f(fb) { fb.riso(1); }\nf({ riso() {} });",
            ),
        ).toEqual([]);
        expect(calls('function puppet() {}\npuppet({});')).toEqual([]);
    });

    it('counts imports under another name, namespaces, dynamic imports and const aliases by the runtime name', () => {
        expect(
            calls("import { puppet as makeMan } from '/__flipbook/runtime.js';\nmakeMan({});"),
        ).toEqual(['puppet']);
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
        expect(calls(`${IMPORT}const make = puppet;\nmake({});`)).toEqual(['puppet']);
    });

    it('follows a local module that passes the runtime on', () => {
        const page = model({
            'index.html': inline(
                "import { puppet } from './lib/rt.js';\nimport * as S from './lib/rt.js';\npuppet({});\nS.riso(1);",
            ),
            'lib/rt.js': "export { puppet, riso } from '/__flipbook/runtime.js';",
        });
        expect(page).toMatchObject({
            modules: ['index.html#1', 'lib/rt.js'],
            calls: ['puppet', 'riso'],
        });
    });

    it('reports a runtime function handed on where its calls are out of sight', () => {
        const page = model({ 'index.html': inline(`${IMPORT}let make = puppet;\nmake({});`) });
        expect(page).toMatchObject({ calls: [], passed: ['puppet'] });
    });
});

describe('what the page loads', () => {
    it('does not read a script index.html does not load', () => {
        const page = model({
            'index.html': '<p>Drawn in canvas</p>',
            'unused.js': `${IMPORT}puppet({});`,
        });
        expect(page).toMatchObject({ entries: [], modules: [], imports: false, calls: [] });
    });

    it('reads a script index.html loads by src, and what it imports', () => {
        const page = model({
            'index.html': '<script type="module" src="js/main.js"></script>',
            'js/main.js': "import { walkIn } from './scene.js';\nwalkIn();",
            'js/scene.js': `${IMPORT}export function walkIn() { puppet({}); }`,
            'js/draft.js': `${IMPORT}riso(1, 2);`,
        });
        expect(page).toMatchObject({
            entries: ['js/main.js'],
            modules: ['js/main.js', 'js/scene.js'],
            imports: true,
            calls: ['puppet'],
            notes: [],
        });
    });

    it('skips commented-out and non-JavaScript script tags', () => {
        const page = model({
            'index.html': `<!-- <script type="module">${IMPORT}riso(1);</script> -->
<script type="application/json">{"puppet": 1}</script>
${inline(`${IMPORT}puppet({});`)}`,
        });
        expect(page).toMatchObject({ entries: ['index.html#1'], calls: ['puppet'] });
    });

    it('notes imports it cannot follow: computed paths, bare names, missing scripts', () => {
        const page = model({
            'index.html': `<script src="missing.js"></script>${inline("await import('./' + 'scene.js');\nimport 'lodash';")}`,
        });
        expect(page.notes).toEqual([
            'index.html loads the script missing.js, which the runner cannot find',
            'index.html#1 imports lodash, which the runner cannot follow',
            'index.html#1 imports a module by a path it computes, not followed',
        ]);
    });

    it('resolves a path the way the page requests it', () => {
        expect(resolveRef('', './assets/a.png?v=2#x')).toBe('assets/a.png');
        expect(resolveRef('js', '../assets/b%20c.png')).toBe('assets/b c.png');
        expect(resolveRef('js', '/assets/d.png')).toBe('assets/d.png');
        expect(resolveRef('', 'http://flipbook.local/assets/e.png')).toBe('assets/e.png');
        expect(resolveRef('', 'https://example.org/f.png')).toBeNull();
        expect(resolveRef('', 'data:image/png;base64,AAAA')).toBeNull();
        expect(resolveRef('', '../outside.png')).toBeNull();
        expect(resolveRef('', 'lodash', { bare: false })).toBeNull();
    });
});
