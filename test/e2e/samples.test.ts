// Every technique sample under docs/samples/src/ that carries an expected.json
// passes check, and on the machine that recorded expected.json
// (pnpm samples:baseline) the frames snapshot takes hash to the digest in it.
// Elsewhere, CI included, the digest is skipped: the same Chromium on another
// Mac already gives other hashes. No video is encoded here.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../../src/cli/check.ts';
import { runSnapshot } from '../../src/cli/snapshot.ts';
import { closeSession, session } from '../browser.ts';
import { cleanTemps, copyFixture, repoRoot, TEST_SEEK_TIMEOUT_MS } from '../helpers.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

/** Same as machineId() in scripts/samples-baseline.mjs. */
const machine = `${process.platform}-${process.arch} ${os.release()} ${os.cpus()[0]?.model ?? 'unknown CPU'}`;

const samplesDir = path.join(repoRoot, 'docs', 'samples', 'src');

/** Every sample folder with an expected.json. */
function sampleNames(): string[] {
    return fs
        .readdirSync(samplesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => fs.existsSync(path.join(samplesDir, name, 'expected.json')))
        .sort();
}

describe.concurrent.each(sampleNames())('docs/samples/src/%s', (name) => {
    const expected = JSON.parse(
        fs.readFileSync(path.join(samplesDir, name, 'expected.json'), 'utf-8'),
    );

    it('passes check with no findings', async () => {
        const dir = copyFixture(name, 'samples');
        const checked = await runCheck({
            dir,
            session: await session(),
            seekTimeoutMs: TEST_SEEK_TIMEOUT_MS,
            recordAttempts: false,
        });
        expect(checked.failures).toEqual([]);
        expect(checked.warnings).toEqual([]);
    });

    it.runIf(expected.snapshot?.machine === machine)(
        'snapshot frames match the digest in expected.json',
        async () => {
            const s = await session();
            expect(
                s.chromium.revision,
                'expected.json was recorded on another Chromium: run pnpm samples:baseline',
            ).toBe(expected.snapshot?.chromium);
            const dir = copyFixture(name, 'samples');
            const snap = await runSnapshot({ dir, session: s });
            expect(snap.failures).toEqual([]);
            const { digest, tiles } = snap.snapshot as {
                digest: string;
                tiles: { frame: number; sha256: string }[];
            };
            expect(
                digest,
                `frames ${tiles.map((tile) => tile.frame).join(', ')} changed: if on purpose, run pnpm samples:baseline`,
            ).toBe(expected.snapshot.digest);
        },
    );
});
