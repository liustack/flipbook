// Fonts published only inside a release zip: one member taken out of the
// archive, stored or deflated, and a font download that goes through a zip.
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { afterAll, describe, expect, it } from 'vitest';
import { deflateRawSync } from 'zlib';
import { downloadFont, type FontEntry, fontPath } from '../src/engine/fonts.ts';
import { zipMember } from '../src/engine/zip.ts';
import { cleanTemps, tempDir } from './helpers.ts';

process.env.FLIPBOOK_QUIET = '1';
afterAll(() => cleanTemps());

/** A zip of `files`, each stored or deflated, with a central directory and its end record. */
function makeZip(files: { name: string; data: Buffer; deflate?: boolean }[]): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const f of files) {
        const packed = f.deflate ? deflateRawSync(f.data) : f.data;
        const name = Buffer.from(f.name);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(f.deflate ? 8 : 0, 8);
        local.writeUInt32LE(packed.length, 18);
        local.writeUInt32LE(f.data.length, 22);
        local.writeUInt16LE(name.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(f.deflate ? 8 : 0, 10);
        central.writeUInt32LE(packed.length, 20);
        central.writeUInt32LE(f.data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);
        locals.push(local, name, packed);
        centrals.push(central, name);
        offset += 30 + name.length + packed.length;
    }
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
}

const FONT = Buffer.from('pixel font bytes '.repeat(200));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('zipMember', () => {
    const zip = makeZip([
        { name: 'OFL.txt', data: Buffer.from('license') },
        { name: 'a.woff2', data: FONT },
        { name: 'b.woff2', data: FONT, deflate: true },
    ]);

    it('takes a stored or a deflated member out whole', () => {
        expect(zipMember(zip, 'a.woff2')).toEqual(FONT);
        expect(zipMember(zip, 'b.woff2')).toEqual(FONT);
        expect(zipMember(zip, 'OFL.txt').toString()).toBe('license');
    });

    it('passes over an end record inside the comment, and says what else it does not read', () => {
        // A comment that holds the end signature: only the real record reaches the file's end.
        const comment = Buffer.concat([Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(30)]);
        const commented = Buffer.concat([
            zip.subarray(0, zip.length - 2),
            Buffer.alloc(2),
            comment,
        ]);
        commented.writeUInt16LE(comment.length, zip.length - 2);
        expect(zipMember(commented, 'a.woff2')).toEqual(FONT);
        // The central directory cut short.
        const cut = Buffer.from(zip);
        cut.writeUInt32LE(zip.length, zip.length - 6);
        expect(() => zipMember(cut, 'a.woff2')).toThrow('runs past the end of the archive');
        // A zip64 size in the member's entry.
        const directory = zip.readUInt32LE(zip.length - 6);
        const wide = Buffer.from(zip);
        wide.writeUInt32LE(0xffffffff, directory + 24);
        expect(() => zipMember(wide, 'OFL.txt')).toThrow('zip64 archives are not read');
        // A comment that ends with a whole empty end record of its own.
        const fake = Buffer.alloc(22);
        fake.writeUInt32LE(0x06054b50, 0);
        const tail = Buffer.concat([zip.subarray(0, zip.length - 2), Buffer.alloc(2), fake]);
        tail.writeUInt16LE(fake.length, zip.length - 2);
        expect(zipMember(tail, 'a.woff2')).toEqual(FONT);
        // The UTF-8 bytes of a name, without the UTF-8 flag: an old code page, never matched.
        const unflagged = makeZip([{ name: 'café.txt', data: Buffer.from('x') }]);
        expect(() => zipMember(unflagged, 'café.txt')).toThrow('old code page');
        // An old code page name, without the UTF-8 flag.
        const old = makeZip([{ name: 'caf\x82.txt', data: Buffer.from('x') }]);
        const at = old.indexOf(Buffer.from('caf'), old.readUInt32LE(old.length - 6));
        old[at + 3] = 0x82;
        expect(() => zipMember(old, 'café.txt')).toThrow('old code page');
    });

    it('says what is wrong with a missing member or a file that is no zip', () => {
        expect(() => zipMember(zip, 'c.woff2')).toThrow('the zip has no c.woff2');
        expect(() => zipMember(Buffer.from('plain text, no archive here'), 'a')).toThrow(
            'not a zip archive',
        );
    });
});

describe('a font published inside a zip', () => {
    function setup(zip: Buffer): { font: FontEntry; env: NodeJS.ProcessEnv } {
        const dir = tempDir('font-zip');
        fs.writeFileSync(path.join(dir, 'release.zip'), zip);
        const font: FontEntry = {
            id: 'test-pixel',
            family: 'Test Pixel',
            file: 'a.woff2',
            weight: '400',
            style: 'normal',
            size: FONT.length,
            sha256: sha(FONT),
            license: 'OFL-1.1',
            licenseFile: 'fusion-pixel.OFL.txt',
            reservedNames: [],
            source: 'test',
            archive: { member: 'a.woff2', size: zip.length, sha256: sha(zip) },
            urls: [pathToFileURL(path.join(dir, 'release.zip')).href],
        };
        return { font, env: { ...process.env, FLIPBOOK_CACHE_DIR: tempDir('font-cache') } };
    }

    it('downloads the zip, checks it, and keeps only the font', async () => {
        const zip = makeZip([
            { name: 'OFL.txt', data: Buffer.from('license') },
            { name: 'a.woff2', data: FONT },
        ]);
        const { font, env } = setup(zip);
        const target = await downloadFont(font, env);
        expect(target).toBe(fontPath(font, env));
        expect(fs.readFileSync(target)).toEqual(FONT);
        expect(fs.readdirSync(path.dirname(target)).sort()).toEqual(['OFL.txt', 'a.woff2']);
    });

    it('refuses a zip whose hash is not the pinned one', async () => {
        const zip = makeZip([{ name: 'a.woff2', data: FONT }]);
        const { font, env } = setup(zip);
        font.archive = { member: 'a.woff2', size: zip.length, sha256: sha(Buffer.from('other')) };
        const error = (await downloadFont(font, env).catch((e: unknown) => e)) as {
            code?: string;
            detail?: { errors?: string[] };
        };
        expect(error.code).toBe('font-download-failed');
        expect(JSON.stringify(error)).toContain('zip sha256');
    });
});
