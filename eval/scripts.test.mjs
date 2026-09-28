import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { normalizeRef, pageReferences } from './scripts.mjs';

const temps = [];
afterAll(() => {
    for (const dir of temps) rmSync(dir, { recursive: true, force: true });
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
