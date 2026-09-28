import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

describe('files the page loads, and files it only names', () => {
    it('reads loads from markup and linked stylesheets, and not from comments or links to other pages', () => {
        const page = model({
            'index.html': `<!doctype html><head>
<link rel="stylesheet" href="css/page.css">
<style>body { background: url('assets/paper.jpg'); } /* url(assets/old.png) */</style>
</head><body>
<!-- <img src="assets/commented.png"> -->
<img src="assets/plate.png" srcset="assets/a.png 1x, assets/b.png 2x">
<video poster="assets/poster.jpg"></video>
<div style="background-image: url(assets/tile.png)"></div>
<a href="assets/credits.html">credits</a>
</body>`,
            'css/page.css': "@import 'more.css';\nh1 { background: url(../assets/grain.png); }",
            'css/more.css': 'p { background: url("/assets/dots.png"); }',
        });
        expect(page.loads).toEqual([
            'assets/a.png',
            'assets/b.png',
            'assets/dots.png',
            'assets/grain.png',
            'assets/paper.jpg',
            'assets/plate.png',
            'assets/poster.jpg',
            'assets/tile.png',
            'css/page.css',
        ]);
        expect(page.mentions).toEqual(['assets/credits.html']);
    });

    it('reads loads only from runtime loaders, and fetch, .src and setAttribute only as mentions', () => {
        const page = model({
            'index.html': inline(`import { photo, loadRig } from '/__flipbook/runtime.js';
await photo('assets/a.png');
await loadRig('./assets/puppets/man/rig.json');
await fetch('assets/data.json');
const img = new Image();
img.src = '/assets/b.png';
document.body.setAttribute('src', 'assets/c.png');
photo(\`assets/cut/\${name}-01.png\`);
photo(pick());
const note = 'assets/left-out.png';
console.info('not used:', note);`),
        });
        expect(page).toMatchObject({
            loads: ['assets/a.png', 'assets/puppets/man/rig.json'],
            possibleLoads: ['assets/cut/'],
            computedLoads: 1,
            mentions: ['assets/b.png', 'assets/c.png', 'assets/data.json', 'assets/left-out.png'],
        });
    });

    it('does not take a plain object, a method of the same name or a template for a load', () => {
        const page = model({
            'index.html': `<template><img src="assets/in-template.png"><div style="background: url(assets/t.png)"></div></template>
${inline(`import { photo } from '/__flipbook/runtime.js';
const omitted = {};
omitted.src = 'assets/omitted.png';
console.log('omitted', omitted);
const album = { photo(path) { return path; } };
album.photo('assets/album.png');
await photo('assets/real.png');`)}
<img src="assets/plate.png">`,
        });
        expect(page).toMatchObject({
            loads: ['assets/plate.png', 'assets/real.png'],
            mentions: [
                'assets/album.png',
                'assets/in-template.png',
                'assets/omitted.png',
                'assets/t.png',
            ],
        });
    });

    it('does not take a local function named photo or fetch for a loader', () => {
        const page = model({
            'index.html': inline(
                "function photo(p) { return p; }\nconst fetch = (p) => p;\nphoto('assets/a.png');\nfetch('assets/b.png');",
            ),
        });
        expect(page).toMatchObject({ loads: [], mentions: ['assets/a.png', 'assets/b.png'] });
    });

    it('takes nothing from a script the page does not load', () => {
        const page = model({
            'index.html': '<p>Drawn in canvas</p>',
            'draft.js': "import { photo } from '/__flipbook/runtime.js';\nphoto('assets/a.png');",
        });
        expect(page).toMatchObject({ loads: [], mentions: [] });
    });
});

describe('reading only inside the workspace', () => {
    /** A workspace and a folder outside it, with `files` in each and `links` from the workspace. */
    function linked({ inside = {}, outside = {}, links = {} }) {
        const ws = mkdtempSync(join(tmpdir(), 'flipbook-page-ws-'));
        const away = mkdtempSync(join(tmpdir(), 'flipbook-page-away-'));
        temps.push(ws, away);
        const put = (root, files) => {
            for (const [rel, text] of Object.entries(files)) {
                mkdirSync(dirname(join(root, rel)), { recursive: true });
                writeFileSync(join(root, rel), text);
            }
        };
        put(ws, inside);
        put(away, outside);
        for (const [rel, to] of Object.entries(links)) {
            mkdirSync(dirname(join(ws, rel)), { recursive: true });
            symlinkSync(to.replace('<away>', away), join(ws, rel));
        }
        const { program, files: _files, texts, ...page } = pageModel(ws);
        return { page, away: realpathSync(away) };
    }
    const PUPPET = `${IMPORT}puppet({});`;

    it('does not read a script or stylesheet that is a link out of the workspace', () => {
        const { page, away } = linked({
            inside: {
                'index.html':
                    '<script type="module" src="scene.js"></script><link rel="stylesheet" href="page.css">',
            },
            outside: {
                'scene.js': PUPPET,
                'page.css': "body { background: url('external-marker.png'); }",
            },
            links: { 'scene.js': '<away>/scene.js', 'page.css': '<away>/page.css' },
        });
        expect(page).toMatchObject({ imports: false, calls: [] });
        expect(page.loads).not.toContain('external-marker.png');
        expect(page.refused).toEqual([
            `scene.js leads out of the workspace, to ${away}/scene.js, not read`,
            `page.css leads out of the workspace, to ${away}/page.css, not read`,
        ]);
        expect(page.notes).toEqual(expect.arrayContaining(page.refused));
    });

    it('does not read through a folder that is a link out of the workspace', () => {
        const { page, away } = linked({
            inside: { 'index.html': '<script type="module" src="js/main.js"></script>' },
            outside: { 'main.js': PUPPET },
            links: { js: '<away>' },
        });
        expect(page.calls).toEqual([]);
        expect(page.refused).toEqual([
            `js/main.js leads out of the workspace, to ${away}/main.js, not read`,
        ]);
    });

    it('does not read a link into a folder left out, a broken link, or an index.html from outside', () => {
        const excluded = linked({
            inside: {
                'index.html': '<script type="module" src="scene.js"></script>',
                'out/scene.js': PUPPET,
            },
            links: { 'scene.js': 'out/scene.js' },
        });
        expect(excluded.page.refused).toEqual([
            'scene.js lies in out/, a folder left out, not read',
        ]);
        const broken = linked({
            inside: { 'index.html': '<script type="module" src="scene.js"></script>' },
            links: { 'scene.js': 'missing.js' },
        });
        expect(broken.page.refused).toEqual(['scene.js is a link that leads nowhere, not read']);
        const page = linked({
            outside: { 'index.html': inline(PUPPET) },
            links: { 'index.html': '<away>/index.html' },
        });
        expect(page.page).toMatchObject({
            calls: [],
            notes: expect.arrayContaining(['index.html cannot be read']),
        });
    });

    it('reads a link that stays inside the workspace', () => {
        const { page } = linked({
            inside: {
                'index.html':
                    '<script type="module" src="scene.js"></script><link rel="stylesheet" href="page.css">',
                'lib/scene.js': PUPPET,
                'styles/page.css': "body { background: url('/assets/paper.jpg'); }",
            },
            links: { 'scene.js': 'lib/scene.js', 'page.css': 'styles/page.css' },
        });
        expect(page).toMatchObject({ calls: ['puppet'], refused: [] });
        expect(page.loads).toContain('assets/paper.jpg');
    });
});
