import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { COMMAND_NAME, NAME, OWNER, PACKAGE_NAME, REPO, SKILL_NAME } from '../src/names.ts';
import { repoRoot } from './helpers.ts';

const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf-8');

describe('public names', () => {
    it('derive from one owner and one name', () => {
        expect(PACKAGE_NAME).toBe(`@${OWNER}/${NAME}`);
        expect(COMMAND_NAME).toBe(NAME);
        expect(SKILL_NAME).toBe(NAME);
        expect(REPO).toBe(`${OWNER}/${NAME}`);
    });

    it('match package.json', () => {
        const pkg = JSON.parse(read('package.json'));
        expect(pkg.name).toBe(PACKAGE_NAME);
        expect(pkg.bin).toEqual({ [COMMAND_NAME]: 'dist/main.js' });
        expect(pkg.repository.url).toBe(`git+https://github.com/${REPO}.git`);
        expect(pkg.bugs.url).toBe(`https://github.com/${REPO}/issues`);
        expect(pkg.homepage).toBe(`https://github.com/${REPO}#readme`);
        expect(pkg.files).toContain(`skills/${SKILL_NAME}`);
    });

    it('match the skill folder, SKILL.md and both launchers', () => {
        expect(fs.existsSync(path.join(repoRoot, 'skills', SKILL_NAME))).toBe(true);
        expect(read(`skills/${SKILL_NAME}/SKILL.md`)).toMatch(
            new RegExp(`^---\\nname: ${SKILL_NAME}\\n`),
        );
        const sh = read(`skills/${SKILL_NAME}/scripts/run.sh`);
        expect(sh).toContain(`PKG="${PACKAGE_NAME}"`);
        expect(sh).toContain(`BIN="${COMMAND_NAME}"`);
        const ps1 = read(`skills/${SKILL_NAME}/scripts/run.ps1`);
        expect(ps1).toContain(`$Package = '${PACKAGE_NAME}'`);
        expect(ps1).toContain(`$Bin = '${COMMAND_NAME}'`);
    });
});
