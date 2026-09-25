// brand.json and user fonts: the sfnt reader, the checks before a page opens,
// fonts served under /__flipbook/fonts/ and recognized by the glyph checks,
// and brand() in the page.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../src/cli/check.ts';
import { FontFileError, readFontFile } from '../src/engine/fontFile.ts';
import { ensureFonts, FONTS, fontFileFor, fontPath, readUserFont } from '../src/engine/fonts.ts';
import { auditCanvasText } from '../src/engine/textAudit.ts';
import { loadTimeline } from '../src/engine/timeline.ts';
import codepoints from '../src/fonts/codepoints.json' with { type: 'json' };
import { closeSession, session } from './browser.ts';
import { buildTestFont } from './fontBuilder.ts';
import { cleanTemps, codes, tempDir } from './helpers.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

const LOGO =
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><rect width="200" height="100" fill="#c8452d"/></svg>';

function write(dir: string, file: string, content: string | Buffer): void {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
}

function encode(ranges: Uint32Array): string {
    const parts: string[] = [];
    for (let i = 0; i < ranges.length; i += 2) {
        const [a, b] = [ranges[i], ranges[i + 1]];
        parts.push(a === b ? a.toString(16) : `${a.toString(16)}-${b.toString(16)}`);
    }
    return parts.join(',');
}

describe('font files', () => {
    it('reads family, weight, style and the mapped characters of a TrueType file', () => {
        const info = readFontFile(
            buildTestFont({ family: 'Kestrel Sans', chars: 'ABC', weight: 700 }),
        );
        expect(info.family).toBe('Kestrel Sans');
        expect(info.weight).toBe('700');
        expect(info.style).toBe('normal');
        expect(encode(info.ranges)).toBe('41-43');
        const italic = readFontFile(buildTestFont({ family: 'K', chars: 'x', italic: true }));
        expect(italic.style).toBe('italic');
    });

    it('agrees with the code point table built for the flipbook fonts', async () => {
        await ensureFonts();
        const table = codepoints as Record<string, string>;
        for (const font of FONTS) {
            const info = readFontFile(fs.readFileSync(fontPath(font)));
            expect(encode(info.ranges), font.id).toBe(table[font.id]);
            expect(info.family).toBe(font.family);
        }
        const serif = readFontFile(fs.readFileSync(fontPath(FONTS[0])));
        expect(serif.weight).toBe('200 900');
    });

    it('refuses collections, web fonts, other files and cut-short fonts', () => {
        const font = buildTestFont({ family: 'K', chars: 'A' });
        const cases: [Buffer, RegExp][] = [
            [Buffer.from('ttcf0000000000000000'), /collection/],
            [Buffer.from('wOF2000000000000000000'), /WOFF/],
            [Buffer.from('<svg></svg>          '), /not a TrueType or OpenType/],
            [font.subarray(0, 200), /cut short|past/],
        ];
        for (const [bytes, reason] of cases) {
            expect(() => readFontFile(bytes)).toThrow(FontFileError);
            expect(() => readFontFile(bytes)).toThrow(reason);
        }
    });

    it('registers a user font under its content hash and serves it', () => {
        const dir = tempDir('userfont');
        write(dir, 'a.ttf', buildTestFont({ family: 'Kestrel', chars: 'AB' }));
        write(dir, 'b.TTF', buildTestFont({ family: 'Kestrel', chars: 'AB' }));
        const a = readUserFont(path.join(dir, 'a.ttf'));
        const b = readUserFont(path.join(dir, 'b.TTF'));
        expect(a.id).toBe(b.id);
        expect(a.id).toMatch(/^user-[0-9a-f]{16}$/);
        expect(fontFileFor(b.name)).toBe(b.file);
        expect(fontFileFor('user/0000000000000000.ttf')).toBeNull();
    });
});

/** A composition directory with a timeline naming `brand`. */
function composition(brand?: string, extra: Record<string, unknown> = {}): string {
    const root = tempDir('brand');
    const dir = path.join(root, 'film');
    write(
        dir,
        'timeline.json',
        JSON.stringify({
            version: 1,
            width: 640,
            height: 360,
            fps: 12,
            seed: 1,
            bpm: 120,
            beatsPerBar: 4,
            scenes: [{ id: 'main', bars: 1 }],
            ...(brand ? { brand } : {}),
            ...extra,
        }),
    );
    write(dir, 'index.html', '<!doctype html><html><body></body></html>');
    return dir;
}

function brandJson(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        version: 1,
        name: 'Kestrel',
        tagline: 'Paper that keeps up',
        logo: { file: 'logo.svg', license: 'owned by the user' },
        colors: { primary: '#C8452D', secondary: '#2a6f97' },
        fonts: {
            title: 'Kestrel Display',
            text: 'LXGW WenKai',
            files: [{ family: 'Kestrel Display', file: 'fonts/display.ttf', license: 'OFL-1.1' }],
        },
        ...overrides,
    });
}

function brandProblems(dir: string): { path: unknown; message: string }[] {
    const loaded = loadTimeline(dir, false);
    expect(loaded.resolved).toBeUndefined();
    return loaded.findings.map((f) => {
        expect(f.code).toBe('brand-invalid');
        return { path: f.detail?.path, message: f.message };
    });
}

describe('brand.json', () => {
    it('resolves a brand at the workspace root with its logo and font', () => {
        const dir = composition('../brand.json');
        const root = path.dirname(dir);
        write(root, 'brand.json', brandJson());
        write(root, 'logo.svg', LOGO);
        write(
            root,
            'fonts/display.ttf',
            buildTestFont({ family: 'Internal Name', chars: 'KESTRL' }),
        );
        const loaded = loadTimeline(dir, false);
        expect(loaded.findings).toEqual([]);
        const tl = loaded.resolved;
        expect(tl?.brand?.name).toBe('Kestrel');
        expect(tl?.brand?.colors).toEqual({
            primary: '#c8452d',
            secondary: '#2a6f97',
            ink: null,
            paper: null,
        });
        expect(tl?.brand?.logo?.src.startsWith('data:image/svg+xml;base64,')).toBe(true);
        expect(tl?.brand?.fonts).toEqual({ title: 'Kestrel Display', text: 'LXGW WenKai' });
        expect(tl?.fonts).toHaveLength(1);
        expect(tl?.fonts[0]).toMatchObject({
            family: 'Kestrel Display',
            weight: '400',
            style: 'normal',
            source: 'fonts/display.ttf',
        });
        expect(tl?.fonts[0].url).toMatch(/^\/__flipbook\/fonts\/user\/[0-9a-f]{16}\.ttf$/);
    });

    it('points at the field that is wrong', () => {
        const cases: [Record<string, unknown>, string, RegExp][] = [
            [{ logo: { file: 'logo.svg' } }, '$.logo.license', /license|terms/],
            [
                { logo: { file: 'https://example.com/logo.svg', license: 'x' } },
                '$.logo.file',
                /relative/,
            ],
            [{ logo: { file: '../logo.svg', license: 'x' } }, '$.logo.file', /outside/],
            [{ logo: { file: 'nope.svg', license: 'x' } }, '$.logo.file', /does not exist/],
            [{ colors: { primary: 'red' } }, '$.colors.primary', /#rgb/],
            [
                { colors: { primary: '#fff', accent: '#000' } },
                '$.colors.accent',
                /not a brand color/,
            ],
            [{ name: '' }, '$.name', /brand name/],
            [{ fonts: { title: 'Arial' } }, '$.fonts.title', /Noto Serif SC/],
            [
                {
                    fonts: {
                        files: [{ family: 'serif', file: 'fonts/display.ttf', license: 'x' }],
                    },
                },
                '$.fonts.files[0].family',
                /generic/,
            ],
            [
                { fonts: { files: [{ family: 'K', file: 'fonts/display.ttf' }] } },
                '$.fonts.files[0].license',
                /terms/,
            ],
            [
                { fonts: { files: [{ family: 'K', file: 'logo.svg', license: 'x' }] } },
                '$.fonts.files[0].file',
                /\.ttf or \.otf/,
            ],
            [{ extra: 1 }, '$.extra', /not a brand.json field/],
        ];
        for (const [override, at, reason] of cases) {
            const dir = composition('brand.json');
            write(dir, 'brand.json', brandJson(override));
            write(dir, 'logo.svg', LOGO);
            write(dir, 'fonts/display.ttf', buildTestFont({ family: 'D', chars: 'K' }));
            write(path.dirname(dir), 'logo.svg', LOGO);
            const problems = brandProblems(dir);
            const hit = problems.find((p) => p.path === at);
            expect(hit, `${at}: ${JSON.stringify(problems)}`).toBeDefined();
            expect(hit?.message).toMatch(reason);
        }
    });

    it('reports a missing brand.json and refuses a URL in timeline.json', () => {
        expect(brandProblems(composition('brand.json'))[0].message).toMatch(/does not exist/);
        const loaded = loadTimeline(composition('https://example.com/brand.json'), false);
        expect(loaded.findings.map((f) => [f.code, f.detail?.path])).toEqual([
            ['timeline-invalid', '$.brand'],
        ]);
    });
});

describe('fonts in assets/fonts/', () => {
    it('need a license in assets/SOURCES.json and a name of their own', () => {
        const dir = composition();
        write(dir, 'assets/fonts/Hand.ttf', buildTestFont({ family: 'Wren Hand', chars: 'ab' }));
        let loaded = loadTimeline(dir, false);
        expect(loaded.findings.map((f) => f.code)).toEqual(['font-invalid']);
        expect(loaded.findings[0].message).toMatch(/SOURCES\.json/);

        write(
            dir,
            'assets/SOURCES.json',
            JSON.stringify({ 'fonts/Hand.ttf': { license: 'OFL-1.1' } }),
        );
        loaded = loadTimeline(dir, false);
        expect(loaded.findings).toEqual([]);
        expect(loaded.resolved?.fonts.map((f) => [f.family, f.source])).toEqual([
            ['Wren Hand', 'assets/fonts/Hand.ttf'],
        ]);

        write(
            dir,
            'assets/fonts/Clash.otf',
            buildTestFont({ family: 'Noto Serif SC', chars: 'a' }),
        );
        write(
            dir,
            'assets/SOURCES.json',
            JSON.stringify({
                'fonts/Hand.ttf': { license: 'OFL-1.1' },
                'assets/fonts/Clash.otf': { license: 'OFL-1.1' },
            }),
        );
        loaded = loadTimeline(dir, false);
        expect(loaded.findings.map((f) => [f.code, f.detail?.file])).toEqual([
            ['font-invalid', 'assets/fonts/Clash.otf'],
        ]);
        expect(loaded.findings[0].message).toMatch(/flipbook font already/);
    });

    // Windows needs admin rights to make symbolic links.
    it.skipIf(process.platform === 'win32')(
        'stay inside the composition folder, links included',
        () => {
            const dir = composition();
            const outside = path.join(path.dirname(dir), 'outside.ttf');
            fs.writeFileSync(outside, buildTestFont({ family: 'Wren Hand', chars: 'ab' }));
            fs.mkdirSync(path.join(dir, 'assets/fonts'), { recursive: true });
            fs.symlinkSync(outside, path.join(dir, 'assets/fonts/Out.ttf'));
            fs.symlinkSync(
                path.join(dir, 'assets/fonts/missing.ttf'),
                path.join(dir, 'assets/fonts/Broken.ttf'),
            );
            write(
                dir,
                'assets/SOURCES.json',
                JSON.stringify({
                    'fonts/Out.ttf': { license: 'OFL-1.1' },
                    'fonts/Broken.ttf': { license: 'OFL-1.1' },
                }),
            );
            const loaded = loadTimeline(dir, false);
            expect(loaded.findings.map((f) => [f.code, f.detail?.file])).toEqual([
                ['font-invalid', 'assets/fonts/Broken.ttf'],
                ['font-invalid', 'assets/fonts/Out.ttf'],
            ]);
            expect(loaded.findings[0].message).toMatch(/cannot be read/);
            expect(loaded.findings[1].message).toMatch(/outside the composition folder/);
            expect(loaded.resolved?.fonts ?? []).toEqual([]);

            // The whole folder linked from elsewhere is outside too.
            const other = composition();
            fs.mkdirSync(path.join(other, 'assets'), { recursive: true });
            fs.symlinkSync(path.join(dir, 'assets/fonts'), path.join(other, 'assets/fonts'));
            fs.copyFileSync(outside, path.join(dir, 'assets/fonts/In.ttf'));
            write(
                other,
                'assets/SOURCES.json',
                JSON.stringify({ 'fonts/In.ttf': { license: 'OFL-1.1' } }),
            );
            const linked = loadTimeline(other, false);
            expect(
                linked.findings.filter((f) => f.detail?.file === 'assets/fonts/In.ttf'),
            ).toHaveLength(1);
        },
    );

    it('follow brand.json when it declares them, license and family included', () => {
        const dir = composition('brand.json');
        write(dir, 'assets/fonts/Hand.ttf', buildTestFont({ family: 'Internal', chars: 'ab' }));
        write(dir, 'logo.svg', LOGO);
        write(
            dir,
            'brand.json',
            brandJson({
                fonts: {
                    title: 'Wren Hand',
                    files: [
                        { family: 'Wren Hand', file: 'assets/fonts/Hand.ttf', license: 'OFL-1.1' },
                    ],
                },
            }),
        );
        const loaded = loadTimeline(dir, false);
        expect(loaded.findings).toEqual([]);
        expect(loaded.resolved?.fonts.map((f) => [f.family, f.source])).toEqual([
            ['Wren Hand', 'assets/fonts/Hand.ttf'],
        ]);
    });

    it('count as known fonts in the canvas glyph check, character by character', () => {
        const dir = composition();
        write(dir, 'assets/fonts/Hand.ttf', buildTestFont({ family: 'Wren Hand', chars: 'ab' }));
        write(
            dir,
            'assets/SOURCES.json',
            JSON.stringify({ 'fonts/Hand.ttf': { license: 'OFL-1.1' } }),
        );
        const tl = loadTimeline(dir, false).resolved;
        if (!tl) throw new Error('timeline did not load');
        const audit = (text: string, font: string) =>
            auditCanvasText(
                [{ id: 't', text, font, box: { x: 0, y: 0, width: 1, height: 1 } }],
                0,
                12,
                tl.fonts,
            ).map((f) => [f.code, f.detail?.chars ?? null]);
        expect(audit('ab', '40px "Wren Hand"')).toEqual([]);
        expect(audit('abc', '40px "Wren Hand"')).toEqual([['font-fallback', ['c']]]);
        expect(audit('abc', '40px "Wren Hand", "Noto Serif SC"')).toEqual([]);
        const unsupplied = auditCanvasText(
            [{ text: 'ab', font: '40px "Wren Hand"', box: { x: 0, y: 0, width: 1, height: 1 } }],
            0,
            12,
        );
        expect(unsupplied.map((f) => f.code)).toEqual(['font-fallback']);
    });
});

function page(fontCss: string, script: string): string {
    return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; width: 640px; height: 360px; overflow: hidden; background: #f3ebdd; }
canvas { position: absolute; left: 0; top: 0; }
#word { position: absolute; left: 80px; top: 60px; margin: 0; font: 64px/1.2 ${fontCss}; color: #2a211b; }
</style></head><body><canvas id="stage"></canvas><p id="word">abab</p>
<script type="module">
${script}
</script></body></html>`;
}

describe('user fonts and brand() in the page', () => {
    it('load from /__flipbook/fonts/ for DOM and canvas text and pass check', async () => {
        const dir = composition('brand.json');
        write(
            dir,
            'assets/fonts/Hand.ttf',
            buildTestFont({ family: 'Wren Hand', chars: 'abKestrl' }),
        );
        write(
            dir,
            'assets/SOURCES.json',
            JSON.stringify({ 'fonts/Hand.ttf': { license: 'OFL-1.1' } }),
        );
        write(dir, 'logo.svg', LOGO);
        write(
            dir,
            'brand.json',
            brandJson({
                fonts: { title: 'Wren Hand' },
                colors: { primary: '#c8452d', ink: '#2a211b' },
            }),
        );
        write(
            dir,
            'index.html',
            page(
                '"Wren Hand"',
                `import { brand, composition, fillText, setupCanvas, timeline } from '/__flipbook/runtime.js';
const tl = await timeline();
const b = await brand();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
composition({
  seek(t) {
    ctx.clearRect(0, 0, tl.width, tl.height);
    ctx.drawImage(b.logo, 60 + t * 20, 200, 120, 60);
    ctx.fillStyle = b.colors.ink;
    ctx.font = b.font('title', 48);
    fillText(ctx, b.name, 300, 260);
  },
});`,
            ),
        );
        const s = await session();
        const report = await runCheck({ dir, session: s, recordAttempts: false });
        expect(report.failures).toEqual([]);
        expect(report.warnings).toEqual([]);
    });

    it('a character the user font lacks, with no fallback listed, fails with font-fallback', async () => {
        const dir = composition();
        write(dir, 'assets/fonts/Hand.ttf', buildTestFont({ family: 'Wren Hand', chars: 'ab' }));
        write(
            dir,
            'assets/SOURCES.json',
            JSON.stringify({ 'fonts/Hand.ttf': { license: 'OFL-1.1' } }),
        );
        write(
            dir,
            'index.html',
            page(
                '"Wren Hand"',
                `import { composition, fillText, setupCanvas, timeline } from '/__flipbook/runtime.js';
const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
composition({
  seek(t) {
    ctx.clearRect(0, 0, tl.width, tl.height);
    ctx.fillStyle = '#2a211b';
    ctx.font = '48px "Wren Hand"';
    fillText(ctx, 'abz', 100 + t * 10, 260);
  },
});`,
            ),
        );
        const report = await runCheck({ dir, session: await session(), recordAttempts: false });
        expect(codes(report)).toContain('font-fallback');
        const fallback = report.failures.find((f) => f.code === 'font-fallback');
        expect(fallback?.detail?.chars).toEqual(['z']);
    });

    it('brand() without a brand in timeline.json fails with a page error that says what to add', async () => {
        const dir = composition();
        write(
            dir,
            'index.html',
            page(
                '"Noto Serif SC"',
                `import { brand, composition } from '/__flipbook/runtime.js';
await brand();
composition({ seek() {} });`,
            ),
        );
        // The page throws before it defines window.__flipbook, so check waits out
        // the ready deadline: keep it short.
        const report = await runCheck({
            dir,
            session: await session(),
            recordAttempts: false,
            readyTimeoutMs: 3000,
        });
        const messages = report.failures.map((f) => f.message).join(' ');
        expect(messages).toMatch(/"brand": "<path to brand.json>"/);
    });
});
