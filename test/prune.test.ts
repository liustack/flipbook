import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { headlessShell } from '../src/engine/browser.ts';
import { FONTS } from '../src/engine/fonts.ts';
import { pruneCache } from '../src/engine/prune.ts';
import { tempDir } from './helpers.ts';

function touch(file: string, bytes = 10): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(bytes));
}

describe('doctor --prune', () => {
    it('keeps the current Chromium build and manifest fonts, deletes the rest', () => {
        const root = tempDir('prune');
        const env = { ...process.env, FLIPBOOK_CACHE_DIR: root };
        const current = `chromium_headless_shell-${headlessShell(env).revision}`;
        const font = FONTS[0];
        const keep = [
            path.join(root, 'browsers', current, 'chrome'),
            path.join(root, 'browsers', '.links', 'abc'),
            path.join(root, 'fonts', font.id, font.sha256.slice(0, 12), font.file),
        ];
        const drop = [
            path.join(root, 'browsers', 'chromium_headless_shell-1000', 'chrome'),
            path.join(root, 'browsers', 'chromium-1243', 'chrome'),
            path.join(root, 'fonts', font.id, '000000000000', font.file),
            path.join(root, 'fonts', font.id, font.sha256.slice(0, 12), `${font.file}.123.part`),
            path.join(root, 'fonts', 'retired-font', 'x', 'y.ttf'),
        ];
        for (const file of [...keep, ...drop]) touch(file);
        const result = pruneCache(env);
        for (const file of keep) expect(fs.existsSync(file), file).toBe(true);
        for (const file of drop) expect(fs.existsSync(file), file).toBe(false);
        expect(result.removed).toHaveLength(5);
        expect(result.bytesFreed).toBe(50);
    });
});
