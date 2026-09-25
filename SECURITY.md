# Security policy

English | [中文](SECURITY.zh-CN.md)

## Reporting a vulnerability

Report it privately. Do not open a public issue.

Send a private report through [GitHub Security Advisories](https://github.com/liustack/flipbook/security/advisories/new). Until the fix is released, the details stay between you and the maintainer.

Include the exact command, the full output, `flipbook --version` and your Node version, the same as for a bug report. We will confirm we got it, fix it, and credit you if you agree.

## Supported versions

Only the latest release on npm (`@liustack/flipbook`) gets fixes. Please upgrade before reporting.

## Security model

- A composition is code that runs in Chromium, and it may come from a model or from the internet. flipbook serves its files from the fake origin `http://flipbook.local/`. Each path is first resolved to its real path (following symlinks) and then confirmed to still be inside the composition directory. Any request outside it is refused.
- flipbook writes only to `.flipbook/` and `out/` inside the composition directory. Before writing, it checks every level down from the composition directory's real path. If either of those two, or any level on the way, is a symlink, the whole command refuses to write (`unsafe-output`). Files are written under a new name and then renamed into place, so nothing gets written outside by following a symlink or a hard link. `audio.file` must also be a regular file inside the composition directory once symlinks are resolved, and ffmpeg reads it only as a local file in an allowlisted format.
- HTTP requests the page makes while rendering (fetch, XHR, images, fonts, stylesheets and so on) and WebSockets are stopped at the Playwright layer. No connection is made, and each one is recorded in the report as `external-request`.
- In the page, the WebRTC and WebTransport constructors are replaced with ones that throw, and each call is also recorded as `external-request`. As a fallback, the browser starts with WebRTC over UDP and in-browser DNS resolution turned off.
- Channels beyond these are outside what flipbook guarantees, for example code in a Worker or an iframe that gets around the page-level replacements, or a TCP connection straight to an IP address. When you run a composition of unknown origin, only a process-level network limit (the host sandbox, a container or a firewall) can make sure nothing goes online. flipbook itself makes no such promise.
- Chromium's own renderer sandbox is off: flipbook launches Chromium through Playwright without `chromiumSandbox`, so Playwright adds `--no-sandbox`. If code in a composition escapes the renderer through a browser vulnerability, it gets every permission of the user running flipbook. The host's sandbox (such as Claude Code's Seatbelt sandbox) and Chromium's own sandbox are two different boundaries, and running inside the host sandbox does not mean the Chromium sandbox is on. Run compositions of unknown origin inside a host sandbox, a container or a dedicated account.
- flipbook itself goes online for two things only, both on the first run of check or render: downloading the pinned Chromium headless shell and the fonts in the manifest (SHA-256 verified). doctor never goes online and never installs anything.
