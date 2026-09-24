import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NAME, OWNER } from '../names.ts';

/**
 * The per-user cache: macOS ~/Library/Caches/liustack/flipbook, Linux
 * ${XDG_CACHE_HOME:-~/.cache}/liustack/flipbook, Windows
 * %LOCALAPPDATA%\liustack\flipbook. FLIPBOOK_CACHE_DIR overrides.
 */
export function cacheRoot(
    env: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
): string {
    if (env.FLIPBOOK_CACHE_DIR) return path.resolve(env.FLIPBOOK_CACHE_DIR);
    if (platform === 'win32') {
        const local =
            env.LOCALAPPDATA ||
            path.win32.join(env.USERPROFILE || os.homedir(), 'AppData', 'Local');
        return path.win32.join(local, OWNER, NAME);
    }
    const home = env.HOME || os.homedir();
    if (platform === 'darwin') {
        return path.join(home, 'Library', 'Caches', OWNER, NAME);
    }
    const xdg = env.XDG_CACHE_HOME || path.join(home, '.cache');
    return path.join(xdg, OWNER, NAME);
}

/** PLAYWRIGHT_BROWSERS_PATH for flipbook's own Chromium. */
export function browsersDir(env: NodeJS.ProcessEnv = process.env): string {
    return path.join(cacheRoot(env), 'browsers');
}

export function fontsDir(env: NodeJS.ProcessEnv = process.env): string {
    return path.join(cacheRoot(env), 'fonts');
}

/** True when `dir` (or its nearest existing parent) accepts a new file; probes with a real create and delete. */
export function isWritable(dir: string): boolean {
    let probe = dir;
    while (!fs.existsSync(probe)) {
        const parent = path.dirname(probe);
        if (parent === probe) return false;
        probe = parent;
    }
    const file = path.join(probe, `.flipbook-probe-${process.pid}-${Date.now()}`);
    try {
        fs.writeFileSync(file, '');
        fs.rmSync(file, { force: true });
        return true;
    } catch {
        return false;
    }
}
