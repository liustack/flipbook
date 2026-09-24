import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { Report } from '../src/cli/report.ts';

process.env.FLIPBOOK_QUIET = '1';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const cli = path.join(repoRoot, 'dist', 'main.js');

const temps: string[] = [];

/** Copy test/fixtures/<name> (or examples/<name>) into a fresh temp directory. */
export function copyFixture(name: string, from: 'fixtures' | 'examples' = 'fixtures'): string {
    const source =
        from === 'fixtures'
            ? path.join(repoRoot, 'test', 'fixtures', name)
            : path.join(repoRoot, 'examples', name);
    const target = fs.mkdtempSync(path.join(os.tmpdir(), `flipbook-${name.replace(/\W+/g, '-')}-`));
    fs.cpSync(source, target, {
        recursive: true,
        filter: (src) => !/[\\/](\.flipbook|out)([\\/]|$)/.test(src),
    });
    temps.push(target);
    return target;
}

export function tempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `flipbook-${prefix}-`));
    temps.push(dir);
    return dir;
}

export function cleanTemps(): void {
    while (temps.length > 0) fs.rmSync(temps.pop() as string, { recursive: true, force: true });
}

export function codes(report: Report): string[] {
    return report.failures.map((f) => f.code);
}

export function warningCodes(report: Report): string[] {
    return report.warnings.map((f) => f.code);
}

export interface CliRun {
    status: number | null;
    stdout: string;
    stderr: string;
    json: unknown;
}

/** Run the built CLI and parse its stdout as JSON when it is JSON. */
export function runCli(args: string[], env: NodeJS.ProcessEnv = process.env): CliRun {
    const result = spawnSync(process.execPath, [cli, ...args], {
        env,
        encoding: 'utf-8',
        timeout: 300_000,
    });
    let json: unknown = null;
    try {
        json = JSON.parse(result.stdout);
    } catch {
        json = null;
    }
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}
