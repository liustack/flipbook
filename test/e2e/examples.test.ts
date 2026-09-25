// Every example passes check with no findings, and on the machine that
// recorded expected.json (pnpm examples:baseline) the frames snapshot takes
// hash to the digest in it. Elsewhere, CI included, the digest is skipped: the
// same Chromium on another Mac already gives other hashes. No video is encoded
// here: the full renders are in test/release/, run by the release gate.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../../src/cli/check.ts';
import { runSnapshot } from '../../src/cli/snapshot.ts';
import { closeSession, session } from '../browser.ts';
import { cleanTemps, copyFixture, repoRoot } from '../helpers.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

/** Same as machineId() in scripts/examples-baseline.mjs. */
const machine = `${process.platform}-${process.arch} ${os.release()} ${os.cpus()[0]?.model ?? 'unknown CPU'}`;

/** Every folder under examples/ holding a timeline.json, as a path under examples/. */
function exampleNames(): string[] {
    const root = path.join(repoRoot, 'examples');
    const names: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name === 'out' || entry.name === '.flipbook') {
                continue;
            }
            const child = path.join(dir, entry.name);
            if (fs.existsSync(path.join(child, 'timeline.json'))) {
                names.push(path.relative(root, child).split(path.sep).join('/'));
            }
            walk(child);
        }
    };
    walk(root);
    return names.sort();
}

describe.concurrent.each(exampleNames())('examples/%s', (name) => {
    const expected = JSON.parse(
        fs.readFileSync(path.join(repoRoot, 'examples', name, 'expected.json'), 'utf-8'),
    );

    it('passes check with no findings', async () => {
        const dir = copyFixture(name, 'examples');
        const checked = await runCheck({ dir, session: await session(), recordAttempts: false });
        expect(checked.failures).toEqual([]);
        expect(checked.warnings).toEqual([]);
    });

    it.runIf(expected.snapshot?.machine === machine)(
        'snapshot frames match the digest in expected.json',
        async () => {
            const s = await session();
            expect(
                s.chromium.revision,
                'expected.json was recorded on another Chromium: run pnpm examples:baseline',
            ).toBe(expected.snapshot?.chromium);
            const dir = copyFixture(name, 'examples');
            const snap = await runSnapshot({ dir, session: s });
            expect(snap.failures).toEqual([]);
            const { digest, tiles } = snap.snapshot as {
                digest: string;
                tiles: { frame: number; sha256: string }[];
            };
            expect(
                digest,
                `frames ${tiles.map((tile) => tile.frame).join(', ')} changed: if on purpose, run pnpm examples:baseline`,
            ).toBe(expected.snapshot.digest);
        },
    );
});
