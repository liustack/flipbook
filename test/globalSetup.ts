import { execSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

/** Build dist once before any suite: the CLI tests spawn dist/main.js and pages load dist/runtime. */
export default function setup(): void {
    if (process.env.FLIPBOOK_TEST_SKIP_BUILD === '1') return;
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    // Through a shell: on Windows pnpm is a .cmd shim, which execFile cannot start.
    execSync('pnpm build', { cwd: root, stdio: 'ignore', windowsHide: true });
}
