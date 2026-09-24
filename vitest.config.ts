import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

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
        include: ['test/**/*.test.ts', 'scripts/**/*.test.mjs'],
        globalSetup: './test/globalSetup.ts',
        testTimeout: 240_000,
        hookTimeout: 240_000,
        maxWorkers: 4,
    },
});
