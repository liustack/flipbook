import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { PACKAGE_NAME } from './names.ts';

let cachedRoot: string | null = null;

/**
 * The installed package root, found by walking up from this module. Works for
 * dist/main.js and for src/ under the test runner alike.
 */
export function packageRoot(): string {
    if (cachedRoot) return cachedRoot;
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (;;) {
        const candidate = path.join(dir, 'package.json');
        if (fs.existsSync(candidate)) {
            const pkg = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as { name?: string };
            if (pkg.name === PACKAGE_NAME) {
                cachedRoot = dir;
                return dir;
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            throw new Error(`Cannot locate the ${PACKAGE_NAME} package root.`);
        }
        dir = parent;
    }
}

/**
 * Built browser runtime files served under /__flipbook/: the runtime/ folder
 * beside the running bundle, or dist/runtime/ when running from source.
 */
export function runtimeFile(name: 'runtime.js' | 'audio.js'): string {
    const beside = path.join(path.dirname(fileURLToPath(import.meta.url)), 'runtime', name);
    if (fs.existsSync(beside)) return beside;
    return path.join(packageRoot(), 'dist', 'runtime', name);
}

/** This CLI's version. */
export function appVersion(): string {
    return __APP_VERSION__;
}
