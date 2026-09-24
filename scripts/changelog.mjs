// CHANGELOG.md edits made at release time by scripts/release.mjs.

/** The local calendar day of `now` as YYYY-MM-DD. */
export function localDate(now = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Rewrite the "## <version>" heading as "## <version> - <date>". Whatever
 * followed " - " on that heading (an older date, "Unreleased") is replaced.
 */
export function stampChangelogDate(text, version, date) {
    const escaped = version.replace(/\./g, '\\.');
    const heading = new RegExp(`^## ${escaped}(?:[ \\t]+-[ \\t]+[^\\n]*)?[ \\t]*$`, 'm');
    if (!heading.test(text)) {
        throw new Error(`CHANGELOG.md has no "## ${version}" heading.`);
    }
    return text.replace(heading, `## ${version} - ${date}`);
}
