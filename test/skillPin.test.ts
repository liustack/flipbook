// Copyright (c) 2026 Leon Liu (liustack). MIT License.
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { findSkillInstalls, readPinnedVersion } from '../src/skillPin.ts';
import { tempDir } from './helpers.ts';

function homeWith(copies: Record<string, string | null>): string {
    const home = tempDir('skillpin');
    for (const [relative, pin] of Object.entries(copies)) {
        const dir = path.join(home, relative, 'flipbook', 'scripts');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            path.join(dir, 'run.sh'),
            pin === null ? '#!/bin/sh\necho no pin here\n' : `#!/bin/sh\nPINNED="${pin}"\n`,
        );
    }
    return home;
}

describe('readPinnedVersion', () => {
    it('reads the launcher pin', () => {
        expect(readPinnedVersion('#!/bin/sh\nPINNED="0.1.0"\n')).toBe('0.1.0');
        expect(readPinnedVersion('#!/bin/sh\necho hi\n')).toBeNull();
    });
});

describe('findSkillInstalls', () => {
    it('flags a copy older than the CLI, numerically', () => {
        const home = homeWith({ '.claude/skills': '0.9.0' });
        const [install] = findSkillInstalls('0.10.0', home);
        expect(install.harness).toBe('claude-code');
        expect(install.outdated).toBe(true);
    });

    it('leaves current and newer copies alone and reports unreadable pins', () => {
        const home = homeWith({
            '.codex/skills': '0.1.0',
            '.agents/skills': '0.2.0',
            '.claude/skills': null,
        });
        const installs = findSkillInstalls('0.1.0', home);
        expect(installs).toHaveLength(3);
        expect(installs.every((i) => !i.outdated)).toBe(true);
        expect(installs.find((i) => i.harness === 'claude-code')?.pinned).toBeNull();
        expect(findSkillInstalls('0.1.0', homeWith({}))).toEqual([]);
    });
});
