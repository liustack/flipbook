import { availableParallelism } from 'os';
import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

// Three tiers. `unit` (pnpm test): unit tests and quick engine tests on small
// fixtures, under a minute. `e2e` (pnpm test:e2e, test/e2e/): the bad-film
// corpus, the reference snippets, and every example through check plus its
// snapshot digest, with no video encoded. CI runs both. `release`
// (pnpm test:release, test/release/): full renders of a few examples, compared
// frame by frame across two renders. Only scripts/release.mjs runs it.
const E2E = 'test/e2e/**/*.test.ts';
const RELEASE = 'test/release/**/*.test.ts';

export default defineConfig({
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    plugins: [
        {
            name: 'flipbook-text-loader',
            transform(code, id) {
                if (id.endsWith('.txt')) {
                    return { code: `export default ${JSON.stringify(code)};`, map: null };
                }
                return undefined;
            },
        },
    ],
    test: {
        globalSetup: './test/globalSetup.ts',
        testTimeout: 240_000,
        hookTimeout: 240_000,
        // Each worker drives Chromium and ffmpeg, which need more CPU than the
        // worker itself: leave one core to them. Four workers on the 3-core
        // macOS runner let a seek wait over 10 s.
        maxWorkers: Math.max(1, Math.min(4, availableParallelism() - 1)),
        projects: [
            {
                extends: true,
                test: {
                    name: 'unit',
                    include: ['test/**/*.test.ts', 'scripts/**/*.test.mjs'],
                    exclude: [E2E, RELEASE],
                },
            },
            {
                extends: true,
                test: { name: 'e2e', include: [E2E] },
            },
            {
                extends: true,
                test: { name: 'release', include: [RELEASE] },
            },
        ],
    },
});
