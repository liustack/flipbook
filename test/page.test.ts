import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCheck } from '../src/cli/check.ts';
import { closeSession, session } from './browser.ts';
import { cleanTemps, codes, tempDir } from './helpers.ts';

afterAll(async () => {
    await closeSession();
    cleanTemps();
});

describe('fake origin', () => {
    it('refuses files outside the composition and blocks the network', async () => {
        const outside = tempDir('outside');
        fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
        const dir = tempDir('escape');
        fs.symlinkSync(outside, path.join(dir, 'link'));
        fs.writeFileSync(
            path.join(dir, 'timeline.json'),
            JSON.stringify({
                version: 1,
                width: 320,
                height: 180,
                fps: 12,
                seed: 1,
                bpm: 120,
                beatsPerBar: 4,
                scenes: [{ id: 'main', bars: 1 }],
            }),
        );
        fs.writeFileSync(
            path.join(dir, 'index.html'),
            `<!doctype html><body style="margin:0;background:#fff">
<div style="position:absolute;left:20px;top:20px;width:80px;height:80px;background:#246"></div>
<script type="module">
import { composition } from '/__flipbook/runtime.js';
const leaked = await fetch('/link/secret.txt').then((r) => r.status, () => 'failed');
const net = await fetch('https://example.com/beacon').then((r) => r.status, () => 'failed');
window.results = { leaked, net };
composition({ seek() {} });
</script></body>`,
        );
        const report = await runCheck({ dir, session: await session(), recordAttempts: false });
        expect(codes(report)).toContain('path-escape');
        expect(codes(report)).toContain('external-request');
        const refused = report.failures.find((f) => f.code === 'path-escape');
        expect(refused?.message).toContain('/link/secret.txt');
    });
});
