# Troubleshooting

Every code flipbook reports, what it means, and what to change. Generated from `src/cli/codes.ts` (edit it there, then run `UPDATE_REFERENCES=1 pnpm test test/references.test.ts`).

- Exit 1: the composition has a problem. Fix the codes under `failures`, then run `check` again.
- Exit 2: the command itself is wrong (a flag, a missing directory). Fix the command.
- Exit 78: the machine is missing something. Relay `fix` from the JSON on stderr and leave the composition alone.
- `stop: true`: the retry limit is reached. Stop, and give the user the contact sheet, the report and `stopReason`.
- Every finding carries `time`, `frame`, `element` and `evidence` when they apply. Open the evidence images before changing code.

## Composition problems (exit 1)

### `index-missing`

The composition directory has no index.html.

Fix: Create index.html in the composition directory.

### `timeline-missing`

The composition directory has no timeline.json.

Fix: Create timeline.json as references/timeline.md describes.

### `timeline-invalid`

timeline.json does not match timeline schema v1.

Fix: Fix the field named in `detail.path` as the message says.

### `protocol-missing`

The page never defined window.__flipbook.

Fix: Call composition({ seek }) from /__flipbook/runtime.js, or assign window.__flipbook = { protocol: 1, ready, seek } in a module script.

### `protocol-mismatch`

window.__flipbook.protocol is not a protocol this CLI speaks.

Fix: Set window.__flipbook.protocol to 1.

### `ready-timeout`

window.__flipbook.ready did not settle in time.

Fix: Make ready resolve without waiting on setTimeout, setInterval or requestAnimationFrame.

### `ready-failed`

window.__flipbook.ready rejected.

Fix: Fix the error in `message`. A font or image that fails to load rejects ready.

### `seek-timeout`

seek(t) did not finish within the time limit.

Fix: Do not await requestAnimationFrame, setTimeout or events inside seek. Draw from t and return.

### `seek-failed`

seek(t) threw or rejected.

Fix: Fix the error in `message` at the time shown.

### `page-error`

The page threw an uncaught exception.

Fix: Fix the exception in `message`.

### `console-error`

The page logged an error to the console.

Fix: Fix the cause in `message`.

### `resource-failed`

A file the page requested does not exist in the composition directory.

Fix: Add the file under the composition directory or fix its path. Put images in assets/.

### `external-request`

The page tried to reach the network and the request was blocked.

Fix: Copy the file into assets/ and load it by relative path. Fonts come from /__flipbook/fonts/.

### `path-escape`

The page requested a file outside the composition directory and it was refused.

Fix: Keep every file the page loads inside the composition directory.

### `static-forbidden`

The source uses a construct the rules forbid.

Fix: Replace it with a pure function of t: seeded rng from the runtime instead of Math.random, t instead of clocks, direct drawing in seek instead of timers or CSS animation.

### `seek-order-dependent`

The same t renders differently depending on which frames were drawn before it.

Fix: Remove state carried between frames (counters, positions updated per frame, appended DOM). Compute everything from t. Bake simulations into a lookup table in setup.

### `clock-dependent`

The frame changes when the wall clock origin changes: the page reads Date or performance.now.

Fix: Drive every change from the t passed to seek. Never read Date.now, new Date() or performance.now.

### `random-dependent`

The frame changes when the random seed changes: the page uses Math.random or crypto.

Fix: Use rng(seed) or rand(seed, ...keys) from the runtime with a fixed seed.

### `late-paint`

Two captures of the same t without a seek in between differ: something paints after seek returns.

Fix: Finish drawing inside seek. Decode images in ready, not in seek. Do not start work that lands on a later frame.

### `blank-frame`

Frames are a single flat color: nothing was drawn.

Fix: Check that seek draws at these times and that no error stopped the script.

### `paper-only`

Frames match the paper layer alone: the content layer drew nothing.

Fix: Check that seek draws content at these times and that no script error stopped it.

### `missing-glyph`

Text uses characters that no flipbook font covers.

Fix: Replace the characters listed in `detail.chars`, or drop them.

### `font-fallback`

Text rendered with a system font instead of a flipbook font.

Fix: Set font-family to "Noto Serif SC" or "LXGW WenKai", the fonts flipbook serves.

### `text-offstage`

A line of text runs past the edge of the frame at the moment it settles.

Fix: Move or shrink the text so every line sits inside the frame, or mark a deliberate bleed with data-flipbook-allow-overflow.

### `text-safe-area`

A line of text reaches into the outer 5% margin of the frame.

Fix: Keep text at least 5% of the width and height away from the edges, or mark it with data-flipbook-allow-overflow.

### `low-contrast`

Text contrast against what is drawn behind it is below 3:1.

Fix: Darken or lighten the text or its background, or add a solid panel behind it, until the contrast reaches 3:1.

### `stage-size`

The html or body element is laid out larger than the stage size from timeline.json.

Fix: Size the stage to timeline width and height and hide overflow on html and body.

### `freeze`

The picture does not change for longer than allowed in a scene without hold.

Fix: Keep something moving in that scene, or set "hold": true on it in timeline.json when the still is intended.

### `glitch`

Decoded video frames do not match the captured frames.

Fix: Render again. If it repeats, report it with this JSON: the encoder pipeline, not the composition, is at fault.

### `frame-count`

The video has a different number of frames than the timeline.

Fix: Render again. If it repeats, report it with this JSON.

### `duration-mismatch`

The video duration does not match the timeline.

Fix: Render again. If it repeats, report it with this JSON.

### `color-tags`

The video is missing yuv420p or bt709 color tags.

Fix: Report it with this JSON and the output of ffmpeg -version.

### `audio-skipped`

timeline.json asks for audio, which this version does not render yet.

Fix: Set "audio": { "mode": "none" } to silence this, or add the soundtrack after rendering.

### `render-busy`

Another render of this composition is running.

Fix: Wait for it to finish, then run render again.

### `internal-error`

flipbook itself failed.

Fix: Do not edit the composition for this. Report it with this JSON at https://github.com/liustack/flipbook/issues.

## Environment problems (exit 78)

### `platform-unsupported`

This operating system is not supported.

Fix: Run flipbook inside WSL2 (Ubuntu) on Windows, or on macOS or Linux.

### `node-too-old`

Node is older than the supported floor.

Fix: Install Node 22.19 or newer from https://nodejs.org.

### `ffmpeg-missing`

ffmpeg or ffprobe is not on PATH.

Fix: Install ffmpeg. macOS: brew install ffmpeg. Debian or Ubuntu: sudo apt-get install -y ffmpeg.

### `ffmpeg-feature-missing`

ffmpeg lacks a required encoder or filter.

Fix: Install a full ffmpeg build with libx264. macOS: brew install ffmpeg. Debian or Ubuntu: sudo apt-get install -y ffmpeg.

### `chromium-missing`

The pinned Chromium headless shell is not installed.

Fix: Run check or render once outside the sandbox to install it, or run the install command in `fix`.

### `chromium-install-failed`

Installing the Chromium headless shell failed.

Fix: Check the network or proxy (HTTPS_PROXY) and run the install command in `fix` again.

### `browser-launch-failed`

Chromium was installed but did not start.

Fix: Read `detail.log`. On Linux, install the system libraries with the command in `fix`.

### `sandbox-blocked`

The host sandbox stopped Chromium from starting, even in single-process mode.

Fix: Allow Chromium in the sandbox: set sandbox.network.allowMachLookup, or add the flipbook launcher to sandbox.excludedCommands.

### `linux-deps-missing`

Chromium is missing Linux system libraries.

Fix: Install them with the command in `fix` (needs sudo).

### `font-download-failed`

A font could not be downloaded or failed its checksum.

Fix: Check the network or proxy, or set FLIPBOOK_FONT_BASE_URL to a mirror that serves the same files.

### `cache-unwritable`

The flipbook cache directory cannot be written.

Fix: Run the command outside the sandbox once, or set FLIPBOOK_CACHE_DIR to a writable directory.
