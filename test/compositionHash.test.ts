// The composition hash is what a check report and a render agree on: every
// input that can change the frames has to change it, including a brand.json
// kept outside the composition folder and links inside it.
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadTimeline } from '../src/engine/timeline.ts';
import { compositionHash } from '../src/engine/workspace.ts';
import { buildTestFont } from './fontBuilder.ts';
import { cleanTemps, tempDir } from './helpers.ts';

afterAll(() => cleanTemps());

function write(file: string, content: string | Buffer): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

/** A composition in <root>/film whose timeline points at <root>/brand.json. */
function branded(): { root: string; dir: string } {
    const root = tempDir('hash');
    const dir = path.join(root, 'film');
    write(
        path.join(dir, 'timeline.json'),
        JSON.stringify({
            version: 1,
            width: 640,
            height: 360,
            fps: 12,
            seed: 1,
            bpm: 120,
            beatsPerBar: 4,
            scenes: [{ id: 'main', bars: 1 }],
            brand: '../brand.json',
        }),
    );
    write(path.join(dir, 'index.html'), '<!doctype html><html><body></body></html>');
    write(path.join(root, 'Brand.ttf'), buildTestFont({ family: 'Wren Hand', chars: 'ab' }));
    return { root, dir };
}

function brandJson(root: string, name: string): void {
    write(
        path.join(root, 'brand.json'),
        JSON.stringify({
            version: 1,
            name,
            colors: { primary: '#c8452d' },
            fonts: { files: [{ file: 'Brand.ttf', family: 'Wren Hand', license: 'OFL-1.1' }] },
        }),
    );
}

function hashOf(dir: string): string {
    const loaded = loadTimeline(dir, false);
    expect(loaded.findings).toEqual([]);
    return compositionHash(dir, loaded.resolved);
}

describe('compositionHash', () => {
    it('changes when a brand.json outside the folder changes', () => {
        const { root, dir } = branded();
        brandJson(root, 'Original');
        const before = hashOf(dir);
        brandJson(root, 'Changed');
        expect(hashOf(dir)).not.toBe(before);
    });

    it('changes when a font that brand.json names changes', () => {
        const { root, dir } = branded();
        brandJson(root, 'Original');
        const before = hashOf(dir);
        write(path.join(root, 'Brand.ttf'), buildTestFont({ family: 'Wren Hand', chars: 'abc' }));
        expect(hashOf(dir)).not.toBe(before);
    });

    it.skipIf(process.platform === 'win32')(
        'changes when a link inside is pointed elsewhere',
        () => {
            const dir = tempDir('hash-link');
            write(path.join(dir, 'a.svg'), '<svg/>');
            write(path.join(dir, 'b.svg'), '<svg></svg>');
            fs.symlinkSync('a.svg', path.join(dir, 'art.svg'));
            const before = compositionHash(dir);
            fs.rmSync(path.join(dir, 'art.svg'));
            fs.symlinkSync('b.svg', path.join(dir, 'art.svg'));
            expect(compositionHash(dir)).not.toBe(before);
        },
    );

    it('stays the same for a composition without a brand, with or without its timeline', () => {
        const dir = tempDir('hash-plain');
        write(path.join(dir, 'index.html'), '<!doctype html>');
        expect(compositionHash(dir, undefined)).toBe(compositionHash(dir));
    });
});
