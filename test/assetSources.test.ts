// Where the pictures under assets/ came from: every one needs a source and a
// license, and a generated one the tool and prompt that made it.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { pictureSourceFindings, sourceProblem } from '../src/engine/assetSources.ts';

describe('picture sources', () => {
    it('needs source and license, and a tool and prompt for a generated picture', () => {
        const one = (entry: unknown) => sourceProblem({ 'a.png': entry }, 'a.png');
        expect(one({ source: 'Rijksmuseum', license: 'cc0' })).toBeNull();
        expect(one(undefined)).toBe('has no entry');
        expect(one({ license: 'cc0' })).toBe('has no source');
        expect(one({ source: 'me', license: 'generated', prompt: 'a cat' })).toBe(
            'is generated but names no tool',
        );
        expect(one({ source: 'me', license: 'generated', tool: 'Codex' })).toBe(
            'is generated but gives no prompt',
        );
        expect(
            one({ source: 'me', license: 'generated', tool: 'Codex', prompt: 'a cat' }),
        ).toBeNull();
    });

    it('finds the tool and prompt of a cut piece on the plate it was cut from', () => {
        const plate = { source: 'me', license: 'generated', tool: 'Codex', prompt: 'a cat' };
        const piece = { source: 'me', license: 'generated', cutFrom: 'sheet.png' };
        const part = { source: 'me', license: 'generated', cutFrom: 'cut/sheet-01.png' };
        const sources = { 'sheet.png': plate, 'cut/sheet-01.png': piece, 'part.png': part };
        expect(sourceProblem(sources, 'part.png')).toBeNull();
        expect(
            sourceProblem({ ...sources, 'sheet.png': { ...plate, prompt: '' } }, 'part.png'),
        ).toBe('is generated but gives no prompt');
        expect(sourceProblem({ 'cut/sheet-01.png': piece }, 'cut/sheet-01.png')).toBe(
            'is cut from sheet.png, which has no entry of its own',
        );
        const loop = { source: 'me', license: 'generated', cutFrom: 'b.png' };
        expect(
            sourceProblem({ 'a.png': loop, 'b.png': { ...loop, cutFrom: 'a.png' } }, 'a.png'),
        ).toBe('is cut from a.png, which leads back to itself');
    });

    it('leaves fonts and a picture licensed elsewhere alone, and names every other picture without an entry', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flipbook-sources-'));
        try {
            fs.mkdirSync(path.join(dir, 'assets', 'fonts'), { recursive: true });
            for (const f of ['logo.svg', 'fonts/specimen.png', 'plate.png', 'notes.txt']) {
                fs.writeFileSync(path.join(dir, 'assets', f), 'x');
            }
            const logo = fs.realpathSync(path.join(dir, 'assets', 'logo.svg'));
            expect(pictureSourceFindings(dir, [logo]).map((f) => f.element)).toEqual([
                'assets/plate.png',
            ]);
            expect(pictureSourceFindings(dir).map((f) => f.element)).toEqual([
                'assets/logo.svg',
                'assets/plate.png',
            ]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
