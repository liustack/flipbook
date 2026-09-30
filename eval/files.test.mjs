import { describe, expect, it } from 'vitest';
import { assetPath } from '../src/engine/assetSources.ts';
import { compositionAsset, assetPath as evalAssetPath } from './files.mjs';

describe('the eval reads SOURCES.json paths as flipbook does', () => {
    it('spells a path under assets/ the same way', () => {
        for (const rel of [
            'a.png',
            './a.png',
            'x/../a.png',
            'cut/a/a-01.png',
            'assets/a.png',
            '../a.png',
            'a/..',
            '.',
            '',
            '/a.png',
            'a\\b.png',
            'a\u0000.png',
            'dir/',
        ]) {
            expect(evalAssetPath(rel), JSON.stringify(rel)).toBe(assetPath(rel));
        }
    });

    it('spells a path from the composition the same way, or gives null outside assets/', () => {
        expect(compositionAsset('assets/./a.png')).toBe('assets/a.png');
        expect(compositionAsset('./assets/a.png')).toBe('assets/a.png');
        expect(compositionAsset('assets/../a.png')).toBeNull();
        expect(compositionAsset('index.html')).toBeNull();
        expect(compositionAsset(undefined)).toBeNull();
    });
});
