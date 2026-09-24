import { defineConfig } from 'tsup';
import pkg from './package.json' with { type: 'json' };

export default defineConfig([
    {
        entry: { main: 'src/main.ts' },
        format: ['esm'],
        platform: 'node',
        target: 'node22',
        outDir: 'dist',
        splitting: false,
        sourcemap: false,
        clean: false,
        define: { __APP_VERSION__: JSON.stringify(pkg.version) },
        loader: { '.txt': 'text' },
    },
    {
        entry: { runtime: 'src/runtime/index.ts', audio: 'src/runtime/audio.ts' },
        format: ['esm'],
        platform: 'browser',
        target: 'chrome120',
        outDir: 'dist/runtime',
        splitting: false,
        sourcemap: false,
        clean: false,
    },
]);
