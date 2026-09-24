import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { SKILL_NAME } from '../src/names.ts';
import { repoRoot } from './helpers.ts';

/** Top-level keys Codex's skill validator accepts (skill-creator quick_validate.py). */
const CODEX_ALLOWED = ['name', 'description', 'license', 'allowed-tools', 'metadata'];

interface Frontmatter {
    top: Map<string, string>;
    metadata: Map<string, string>;
}

/** Read a scalar that is either a JSON-compatible double-quoted string or a bare word. */
function scalar(raw: string): string {
    const value = raw.trim();
    return value.startsWith('"') ? (JSON.parse(value) as string) : value;
}

/** Parse the flat frontmatter SKILL.md uses: top-level scalars plus one level under metadata. */
function parseFrontmatter(text: string): Frontmatter {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
    if (!match) throw new Error('SKILL.md does not start with a frontmatter block');
    const top = new Map<string, string>();
    const metadata = new Map<string, string>();
    let parent: string | null = null;
    for (const line of match[1].split('\n')) {
        const nested = /^ {2}([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
        if (nested && parent === 'metadata') {
            metadata.set(nested[1], scalar(nested[2]));
            continue;
        }
        const key = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
        if (!key) throw new Error(`Unreadable frontmatter line: ${line}`);
        top.set(key[1], scalar(key[2]));
        parent = key[1];
    }
    return { top, metadata };
}

const skill = fs.readFileSync(path.join(repoRoot, 'skills', SKILL_NAME, 'SKILL.md'), 'utf-8');

describe('SKILL.md frontmatter', () => {
    const fm = parseFrontmatter(skill);

    it('uses only the top-level keys Codex accepts', () => {
        expect([...fm.top.keys()].filter((k) => !CODEX_ALLOWED.includes(k))).toEqual([]);
    });

    it('passes the rest of the Codex validator', () => {
        expect(fm.top.get('name')).toBe(SKILL_NAME);
        const description = fm.top.get('description') ?? '';
        expect(description.length).toBeGreaterThan(0);
        expect(description.length).toBeLessThanOrEqual(1024);
        expect(description).not.toMatch(/[<>]/);
    });

    it('keeps the runtime requirements under metadata.compatibility', () => {
        const compatibility = fm.metadata.get('compatibility') ?? '';
        expect(compatibility).toMatch(/Node 22\.19\+/);
        expect(compatibility).toMatch(/ffmpeg/);
        expect(compatibility.length).toBeLessThanOrEqual(500);
    });
});
