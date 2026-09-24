// CHANGELOG.md edits made at release time by scripts/release.mjs.

/** The local calendar day of `now` as YYYY-MM-DD. */
export function localDate(now = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const UNRELEASED = /^## Unreleased[ \t]*$/m;

function versionHeading(version) {
    const escaped = version.replace(/\./g, '\\.');
    return new RegExp(`^## ${escaped}(?:[ \\t]+-[ \\t]+[^\\n]*)?[ \\t]*$`, 'm');
}

/** The body under the heading `pattern` matches, up to the next "## " heading. */
function sectionBody(text, pattern) {
    const match = pattern.exec(text);
    if (!match) return null;
    const rest = text.slice(match.index + match[0].length);
    const next = /^## /m.exec(rest);
    return next ? rest.slice(0, next.index) : rest;
}

/**
 * Rewrite the "## <version>" heading as "## <version> - <date>". Whatever
 * followed " - " on that heading (an older date, "Unreleased") is replaced.
 */
export function stampChangelogDate(text, version, date) {
    const heading = versionHeading(version);
    if (!heading.test(text)) {
        throw new Error(`CHANGELOG.md has no "## ${version}" heading.`);
    }
    return text.replace(heading, `## ${version} - ${date}`);
}

/**
 * What the release of `version` ships: the "## Unreleased" section when there
 * is one, otherwise the "## <version>" section. Throws when there is neither,
 * or both.
 */
export function releaseNotes(text, version) {
    const unreleased = sectionBody(text, UNRELEASED);
    const own = sectionBody(text, versionHeading(version));
    if (unreleased !== null && own !== null) {
        throw new Error(
            `CHANGELOG.md has both "## Unreleased" and "## ${version}". Fold one into the other first.`,
        );
    }
    if (unreleased !== null) return unreleased;
    if (own !== null) return own;
    throw new Error(
        `CHANGELOG.md has no "## Unreleased" or "## ${version}" section. Write what changed before releasing it.`,
    );
}

/**
 * CHANGELOG.md as committed for the release: "## Unreleased" becomes
 * "## <version> - <date>", or the version's own heading gets today's date.
 */
export function releaseChangelog(text, version, date) {
    releaseNotes(text, version);
    if (UNRELEASED.test(text)) return text.replace(UNRELEASED, `## ${version} - ${date}`);
    return stampChangelogDate(text, version, date);
}
