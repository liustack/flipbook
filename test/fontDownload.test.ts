// Several flipbook processes can download the same font at once (parallel
// tests, two renders on a fresh cache). The last step moves the verified file
// into place, and on Windows that rename fails with EPERM while another
// process holds the copy it already put there.
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { downloadFont, type FontEntry, fontPath } from '../src/engine/fonts.ts';
import { cleanTemps, tempDir } from './helpers.ts';

process.env.FLIPBOOK_QUIET = '1';

// Rename behaves as on Windows: it refuses to replace an existing font file.
vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    const renameSync = (from: fs.PathLike, to: fs.PathLike) => {
        if (String(to).endsWith('.ttf') && actual.existsSync(to)) {
            throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}'`), {
                code: 'EPERM',
            });
        }
        actual.renameSync(from, to);
    };
    return { ...actual, renameSync };
});

afterAll(() => cleanTemps());

const BYTES = Buffer.from('not really a font, but the bytes the manifest pins');

function setup(): { font: FontEntry; env: NodeJS.ProcessEnv } {
    const mirror = tempDir('font-mirror');
    fs.writeFileSync(path.join(mirror, 'Test.ttf'), BYTES);
    const font: FontEntry = {
        id: 'test-font',
        family: 'Test',
        file: 'Test.ttf',
        weight: '400',
        style: 'normal',
        size: BYTES.length,
        sha256: createHash('sha256').update(BYTES).digest('hex'),
        license: 'OFL-1.1',
        licenseFile: 'noto-serif-sc.OFL.txt',
        reservedNames: [],
        source: 'test',
        urls: [],
    };
    const env = {
        ...process.env,
        FLIPBOOK_CACHE_DIR: tempDir('font-cache'),
        FLIPBOOK_FONT_BASE_URL: pathToFileURL(mirror).href,
    };
    return { font, env };
}

describe('two processes downloading the same font', () => {
    it('keeps the copy another process already moved into place', async () => {
        const { font, env } = setup();
        const target = fontPath(font, env);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, BYTES);

        await expect(downloadFont(font, env)).resolves.toBe(target);
        expect(fs.readFileSync(target)).toEqual(BYTES);
        expect(fs.readdirSync(path.dirname(target)).filter((f) => f.endsWith('.part'))).toEqual([]);
    });

    it('reports a failed move as itself, not as a network failure', async () => {
        const { font, env } = setup();
        const target = fontPath(font, env);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, BYTES.subarray(1));

        const error = await downloadFont(font, env).catch((e: unknown) => e);
        expect((error as { code?: string }).code).toBe('EPERM');
    });
});
