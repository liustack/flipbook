// The skill's text files: troubleshooting.md is rendered from src/cli/codes.ts,
// and no skill file carries steps meant for maintainers. The snippets inside
// the references run through check in test/e2e/references.test.ts.
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { ENV_CODES, FINDING_CODES } from '../src/cli/codes.ts';
import { repoRoot } from './helpers.ts';

const skillDir = path.join(repoRoot, 'skills', 'flipbook');
const referencesDir = path.join(skillDir, 'references');
const files = fs
    .readdirSync(referencesDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join(referencesDir, name));

/**
 * references/troubleshooting.md, rendered from src/cli/codes.ts. After changing
 * a code, run UPDATE_REFERENCES=1 pnpm test test/skillText.test.ts.
 */
function troubleshooting(): string {
    const lines = [
        '# Troubleshooting',
        '',
        'Every code flipbook reports, what it means, and what to change.',
        '',
        '- Exit 1: the composition has a problem. Fix the codes under `failures`, then run `check` again.',
        '- Exit 2: the command itself is wrong (a flag, a missing directory). Fix the command.',
        '- Exit 78: the machine is missing something. Relay `fix` from the JSON on stderr and leave the composition alone.',
        '- `stop: true`: the retry limit is reached. Stop, and give the user the contact sheet, the report and `stopReason`.',
        '- Every finding carries `time`, `frame`, `element` and `evidence` when they apply. Open the evidence images before changing code.',
        '',
        '## Composition problems (exit 1)',
        '',
    ];
    for (const [code, info] of Object.entries(FINDING_CODES)) {
        lines.push(`### \`${code}\``, '', info.meaning, '', `Fix: ${info.fix}`, '');
    }
    lines.push('## Environment problems (exit 78)', '');
    for (const [code, info] of Object.entries(ENV_CODES)) {
        lines.push(`### \`${code}\``, '', info.meaning, '', `Fix: ${info.fix}`, '');
    }
    return `${lines.join('\n').trimEnd()}\n`;
}

describe('skill files speak to the agent using the skill', () => {
    it('carry no maintainer steps (regenerating files, CI)', () => {
        for (const file of [path.join(skillDir, 'SKILL.md'), ...files]) {
            const text = fs.readFileSync(file, 'utf-8');
            for (const phrase of ['UPDATE_REFERENCES', 'src/cli/', ' in CI', 'Generated from']) {
                expect(text, `${path.basename(file)} mentions ${phrase}`).not.toContain(phrase);
            }
        }
    });
});

describe('troubleshooting reference', () => {
    it('matches src/cli/codes.ts', () => {
        const file = path.join(referencesDir, 'troubleshooting.md');
        const expected = troubleshooting();
        if (process.env.UPDATE_REFERENCES === '1') fs.writeFileSync(file, expected);
        expect(fs.readFileSync(file, 'utf-8')).toBe(expected);
    });
});
