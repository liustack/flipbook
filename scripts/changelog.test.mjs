import { describe, expect, it } from 'vitest';
import { localDate, releaseChangelog, releaseNotes, stampChangelogDate } from './changelog.mjs';

const changelog = [
    '# Changelog',
    '',
    '## 0.2.0',
    '',
    '- new things',
    '',
    '## 0.1.0 - 2026-09-25',
    '',
    '- first',
    '',
].join('\n');

describe('stampChangelogDate', () => {
    it('adds the date to a bare version heading', () => {
        const out = stampChangelogDate(changelog, '0.2.0', '2026-10-02');
        expect(out).toContain('\n## 0.2.0 - 2026-10-02\n');
        expect(out).toContain('\n## 0.1.0 - 2026-09-25\n');
        expect(out.split('\n')).toHaveLength(changelog.split('\n').length);
    });

    it('replaces a date or placeholder already on the heading', () => {
        for (const suffix of [' - 2026-09-30', ' - Unreleased', ' - TBD  ']) {
            const text = changelog.replace('## 0.2.0', `## 0.2.0${suffix}`);
            expect(stampChangelogDate(text, '0.2.0', '2026-10-02')).toContain(
                '\n## 0.2.0 - 2026-10-02\n',
            );
        }
    });

    it('leaves other versions alone and does not match a longer version', () => {
        const text = changelog.replace('## 0.2.0', '## 0.2.01');
        expect(() => stampChangelogDate(text, '0.2.0', '2026-10-02')).toThrow(/no "## 0.2.0"/);
        expect(stampChangelogDate(changelog, '0.1.0', '2026-10-02')).toContain('\n## 0.2.0\n');
    });
});

const pending = [
    '# Changelog',
    '',
    '## Unreleased',
    '',
    '### Paper',
    '',
    '- paper things',
    '',
    '## 0.1.0 - 2026-09-25',
    '',
    '- first',
    '',
].join('\n');

describe('releaseChangelog', () => {
    it('turns "## Unreleased" into the version and today, keeping its subsections', () => {
        const out = releaseChangelog(pending, '0.2.0', '2026-10-02');
        expect(out).toContain('\n## 0.2.0 - 2026-10-02\n\n### Paper\n\n- paper things\n');
        expect(out).not.toContain('Unreleased');
        expect(out).toContain('\n## 0.1.0 - 2026-09-25\n');
    });

    it('dates the version heading when there is no "## Unreleased"', () => {
        expect(releaseChangelog(changelog, '0.2.0', '2026-10-02')).toContain(
            '\n## 0.2.0 - 2026-10-02\n',
        );
    });

    it('refuses both, or neither', () => {
        const both = pending.replace('## 0.1.0 - 2026-09-25', '## 0.2.0');
        expect(() => releaseChangelog(both, '0.2.0', '2026-10-02')).toThrow(/both/);
        expect(() => releaseChangelog(changelog, '0.3.0', '2026-10-02')).toThrow(
            /no "## Unreleased" or "## 0.3.0"/,
        );
    });
});

describe('releaseNotes', () => {
    it('reads the Unreleased section up to the next version, subsections included', () => {
        expect(releaseNotes(pending, '0.2.0').trim()).toBe('### Paper\n\n- paper things');
        expect(releaseNotes(changelog, '0.1.0').trim()).toBe('- first');
    });
});

describe('localDate', () => {
    it('formats the local calendar day as YYYY-MM-DD', () => {
        expect(localDate(new Date(2026, 8, 5, 23, 59))).toBe('2026-09-05');
        expect(localDate(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31');
    });
});
