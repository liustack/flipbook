import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { scanComposition, stripJs } from '../src/engine/scan.ts';
import { tempDir } from './helpers.ts';

describe('stripJs', () => {
    it('blanks comments and strings but keeps offsets and newlines', () => {
        const code = "const a = 'Math.random()'; // Date.now()\n/* setTimeout() */ b();";
        const stripped = stripJs(code);
        expect(stripped.length).toBe(code.length);
        expect(stripped).not.toContain('Math.random');
        expect(stripped).not.toContain('Date.now');
        expect(stripped).not.toContain('setTimeout');
        expect(stripped).toContain('b();');
        expect(stripped.split('\n').length).toBe(2);
    });
});

describe('scanComposition', () => {
    it('warns on forbidden constructs in scripts, styles and markup, with line numbers', () => {
        const dir = tempDir('scan');
        fs.writeFileSync(
            path.join(dir, 'index.html'),
            [
                '<style>.a { animation: spin 1s; } .b { transition: none; }</style>',
                '<video src="x.mp4"></video>',
                '<script type="module">',
                "const shown = 'Math.random() in a string is fine';",
                'const x = Math.random();',
                'setTimeout(() => {}, 10);',
                '</script>',
            ].join('\n'),
        );
        fs.writeFileSync(
            path.join(dir, 'extra.js'),
            '// performance.now()\nconst t = performance.now();\n',
        );
        const found = scanComposition(dir).map((f) => f.message);
        expect(found).toContain('CSS animation at index.html:1');
        expect(found).toContain('<video> at index.html:2');
        expect(found).toContain('Math.random() at index.html:5');
        expect(found).toContain('setTimeout at index.html:6');
        expect(found).toContain('performance.now() at extra.js:2');
        expect(found.filter((m) => m.startsWith('CSS transition'))).toEqual([]);
        expect(found.filter((m) => m.includes(':4'))).toEqual([]);
        expect(scanComposition(dir).every((f) => f.severity === 'warning')).toBe(true);
    });
});
