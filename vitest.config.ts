import { availableParallelism } from 'os';
import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

// Two tiers. `unit` (pnpm test) is unit tests and the quick engine tests, under
// a minute on a laptop. `e2e` (pnpm test:e2e) is test/e2e/: whole compositions
// through check and render, the bad-film corpus, the reference snippets, the
// examples and the two-render hash comparisons. CI and the release gate run both.
const E2E = 'test/e2e/**/*.test.ts';

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
                    exclude: [E2E],
                },
            },
            {
                extends: true,
                test: { name: 'e2e', include: [E2E] },
            },
        ],
    },
});
