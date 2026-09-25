// examples/eggs-five: the two films share their drawing code.
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './helpers.ts';

const FILMS = ['five', 'shu'];

describe('examples/eggs-five', () => {
    it('shares one film.js and one eggs.js between the two films', () => {
        for (const file of ['film.js', 'eggs.js']) {
            const [a, b] = FILMS.map((film) =>
                fs.readFileSync(path.join(repoRoot, 'examples', 'eggs-five', film, file), 'utf-8'),
            );
            expect(b, file).toBe(a);
        }
    });
});
