import * as fs from 'fs';
import { createRequire } from 'module';
import * as path from 'path';
import { EnvError } from '../cli/report.ts';
import { browsersDir, fontsDir, isWritable } from './cache.ts';
import { FONTS } from './fonts.ts';

export interface PruneResult {
    removed: string[];
    bytesFreed: number;
}

function sizeOf(target: string): number {
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory()) return stat.size;
    let total = 0;
    for (const entry of fs.readdirSync(target)) total += sizeOf(path.join(target, entry));
    return total;
}

/** Browser directories this playwright-core version uses: the headless shell and its ffmpeg. */
function currentBrowserDirs(): Set<string> {
    const require = createRequire(import.meta.url);
    const manifest = JSON.parse(
        fs.readFileSync(
            path.join(
                path.dirname(require.resolve('playwright-core/package.json')),
                'browsers.json',
            ),
            'utf-8',
        ),
    ) as { browsers: { name: string; revision: string }[] };
    const keep = new Set<string>(['.links']);
    for (const browser of manifest.browsers) {
        if (browser.name === 'chromium-headless-shell')
            keep.add(`chromium_headless_shell-${browser.revision}`);
        if (browser.name === 'ffmpeg') keep.add(`ffmpeg-${browser.revision}`);
    }
    return keep;
}

/** Delete cached browsers and fonts that this version of flipbook does not use. */
export function pruneCache(env: NodeJS.ProcessEnv = process.env): PruneResult {
    const result: PruneResult = { removed: [], bytesFreed: 0 };
    const remove = (target: string) => {
        result.bytesFreed += sizeOf(target);
        fs.rmSync(target, { recursive: true, force: true });
        result.removed.push(target);
    };
    const browsers = browsersDir(env);
    const fonts = fontsDir(env);
    for (const dir of [browsers, fonts]) {
        if (fs.existsSync(dir) && !isWritable(dir)) {
            throw new EnvError('cache-unwritable', `Cannot write ${dir} to prune it.`, [
                'Run flipbook doctor --prune outside the sandbox',
            ]);
        }
    }
    if (fs.existsSync(browsers)) {
        const keep = currentBrowserDirs();
        for (const entry of fs.readdirSync(browsers)) {
            if (!keep.has(entry)) remove(path.join(browsers, entry));
        }
    }
    if (fs.existsSync(fonts)) {
        for (const id of fs.readdirSync(fonts)) {
            const font = FONTS.find((f) => f.id === id);
            const dir = path.join(fonts, id);
            if (!font || !fs.statSync(dir).isDirectory()) {
                remove(dir);
                continue;
            }
            for (const version of fs.readdirSync(dir)) {
                const versionDir = path.join(dir, version);
                if (version !== font.sha256.slice(0, 12)) {
                    remove(versionDir);
                    continue;
                }
                for (const file of fs.readdirSync(versionDir)) {
                    if (file.endsWith('.part')) remove(path.join(versionDir, file));
                }
            }
        }
    }
    return result;
}
