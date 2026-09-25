// Every finding code the CLI can emit, with the default fix text.
// docs/report-schema.md lists the same set; test/units.test.ts checks it.

export interface CodeInfo {
    /** What went wrong, one line. */
    meaning: string;
    /** What the agent should change. */
    fix: string;
}

/** Composition problems: the agent edits index.html or timeline.json. Exit 1. */
export const FINDING_CODES = {
    'index-missing': {
        meaning: 'The composition directory has no index.html.',
        fix: 'Create index.html in the composition directory.',
    },
    'timeline-missing': {
        meaning: 'The composition directory has no timeline.json.',
        fix: 'Create timeline.json as references/timeline.md describes.',
    },
    'timeline-invalid': {
        meaning: 'timeline.json does not match timeline schema v1.',
        fix: 'Fix the field named in `detail.path` as the message says.',
    },
    'protocol-missing': {
        meaning: 'The page never defined window.__flipbook.',
        fix: 'Call composition({ seek }) from /__flipbook/runtime.js, or assign window.__flipbook = { protocol: 1, ready, seek } in a module script.',
    },
    'protocol-mismatch': {
        meaning: 'window.__flipbook.protocol is not a protocol this CLI speaks.',
        fix: 'Set window.__flipbook.protocol to 1.',
    },
    'ready-timeout': {
        meaning: 'window.__flipbook.ready did not settle in time.',
        fix: 'Make ready resolve without waiting on setTimeout, setInterval or requestAnimationFrame.',
    },
    'ready-failed': {
        meaning: 'window.__flipbook.ready rejected.',
        fix: 'Fix the error in `message`. A font or image that fails to load rejects ready.',
    },
    'seek-timeout': {
        meaning: 'seek(t) did not finish within the time limit.',
        fix: 'Do not await requestAnimationFrame, setTimeout or events inside seek. Draw from t and return.',
    },
    'seek-failed': {
        meaning: 'seek(t) threw or rejected.',
        fix: 'Fix the error in `message` at the time shown.',
    },
    'page-error': {
        meaning: 'The page threw an uncaught exception.',
        fix: 'Fix the exception in `message`.',
    },
    'console-error': {
        meaning: 'The page logged an error to the console.',
        fix: 'Fix the cause in `message`.',
    },
    'resource-failed': {
        meaning: 'A file the page requested does not exist in the composition directory.',
        fix: 'Add the file under the composition directory or fix its path. Put images in assets/.',
    },
    'external-request': {
        meaning: 'The page tried to reach the network and the request was blocked.',
        fix: 'Copy the file into assets/ and load it by relative path. Fonts come from /__flipbook/fonts/.',
    },
    'path-escape': {
        meaning: 'The page requested a file outside the composition directory and it was refused.',
        fix: 'Keep every file the page loads inside the composition directory.',
    },
    'unsafe-output': {
        meaning:
            'A path flipbook writes under .flipbook/ or out/ is a symbolic link or the wrong kind of file, so nothing was written.',
        fix: 'Delete the paths in `detail.paths` (for a link, the link itself, not what it points to), then run the command again. flipbook recreates .flipbook/ and out/ on its own.',
    },
    'static-forbidden': {
        meaning: 'The source uses a construct the rules forbid.',
        fix: 'Replace it with a pure function of t: seeded rng from the runtime instead of Math.random, t instead of clocks, direct drawing in seek instead of timers or CSS animation.',
    },
    'seek-order-dependent': {
        meaning: 'The same t renders differently depending on which frames were drawn before it.',
        fix: 'Remove state carried between frames (counters, positions updated per frame, appended DOM). Compute everything from t. Bake simulations into a lookup table in setup.',
    },
    'clock-dependent': {
        meaning:
            'The frame changes when the wall clock origin changes: the page reads Date or performance.now.',
        fix: 'Drive every change from the t passed to seek. Never read Date.now, new Date() or performance.now.',
    },
    'random-dependent': {
        meaning:
            'The frame changes when the random seed changes: the page uses Math.random or crypto.',
        fix: 'Use rng(seed) or rand(seed, ...keys) from the runtime with a fixed seed.',
    },
    'forbidden-api-call': {
        meaning:
            'The page called a clock or random function the rules forbid (Date.now, new Date(), performance.now, Math.random, crypto random, Temporal.Now and the like), even if this sample of frames did not change because of it.',
        fix: 'Remove every call named in `detail.api`, starting at `element`: take time from the t passed to seek, randomness from rng(seed) or rand(seed, ...keys).',
    },
    'late-paint': {
        meaning:
            'Two captures of the same t without a seek in between differ: something paints after seek returns.',
        fix: 'Finish drawing inside seek. Decode images in ready, not in seek. Do not start work that lands on a later frame.',
    },
    'blank-frame': {
        meaning: 'Frames are a single flat color: nothing was drawn.',
        fix: 'Check that seek draws at these times and that no error stopped the script.',
    },
    'paper-only': {
        meaning: 'Frames match the paper layer alone: the content layer drew nothing.',
        fix: 'Check that seek draws content at these times and that no script error stopped it.',
    },
    'missing-glyph': {
        meaning: 'Text uses characters that no flipbook font or supplied font covers.',
        fix: 'Replace the characters listed in `detail.chars`, or drop them.',
    },
    'font-fallback': {
        meaning: 'Text rendered with a system font instead of a flipbook font or a supplied font.',
        fix: 'Set font-family to "Noto Serif SC" or "LXGW WenKai", the fonts flipbook serves, or to a font supplied in brand.json or assets/fonts/. List "Noto Serif SC" after a supplied font that lacks some characters.',
    },
    'brand-invalid': {
        meaning:
            "The brand.json that timeline.json's `brand` names is missing or breaks the brand schema, or a file it names is not local or has no license.",
        fix: 'Fix the field at `detail.path` in `detail.file` as the message says. See references/brand.md.',
    },
    'font-invalid': {
        meaning:
            'A font file in assets/fonts/ has no license, is not a readable .ttf or .otf, or clashes with another font.',
        fix: 'Write the license in assets/SOURCES.json, replace the file with its .ttf or .otf, or rename the family, as the message says. See references/brand.md.',
    },
    'text-offstage': {
        meaning: 'A line of text runs past the edge of the frame at the moment it settles.',
        fix: 'Move or shrink the text so every line sits inside the frame, or mark a deliberate bleed with data-flipbook-allow-overflow.',
    },
    'text-safe-area': {
        meaning: 'A line of text reaches into the outer 5% margin of the frame.',
        fix: 'Keep text at least 5% of the width and height away from the edges, or mark it with data-flipbook-allow-overflow.',
    },
    'low-contrast': {
        meaning: 'Text contrast against what is drawn behind it is below 3:1.',
        fix: 'Darken or lighten the text or its background, or add a solid panel behind it, until the contrast reaches 3:1.',
    },
    'stage-size': {
        meaning:
            'The html or body element is laid out larger than the stage size from timeline.json.',
        fix: 'Size the stage to timeline width and height and hide overflow on html and body.',
    },
    freeze: {
        meaning: 'The picture does not change for longer than allowed in a scene without hold.',
        fix: 'Keep something moving in that scene, or set "hold": true on it in timeline.json when the still is intended.',
    },
    glitch: {
        meaning: 'Decoded video frames do not match the captured frames.',
        fix: 'Render again. If it repeats, report it with this JSON: the encoder pipeline, not the composition, is at fault.',
    },
    'frame-count': {
        meaning: 'The video has a different number of frames than the timeline.',
        fix: 'Render again. If it repeats, report it with this JSON.',
    },
    'duration-mismatch': {
        meaning: 'The video duration does not match the timeline.',
        fix: 'Render again. If it repeats, report it with this JSON.',
    },
    'color-tags': {
        meaning: 'The video is missing yuv420p or bt709 color tags.',
        fix: 'Report it with this JSON and the output of ffmpeg -version.',
    },
    'audio-skipped': {
        meaning:
            'flipbook audio found nothing to synthesize: audio.mode is not "preset" and there are no sfx cues.',
        fix: 'Nothing to fix when the video should have no synthesized sound. For music, set "audio": { "mode": "preset", "preset": "pluck" }, see references/audio.md.',
    },
    'audio-missing': {
        meaning: 'timeline.json asks for sound, but the video has no audio stream.',
        fix: 'Render again. If it repeats, report it with this JSON.',
    },
    'audio-loudness': {
        meaning: 'The soundtrack with music is not within 1 LU of -14 LUFS integrated loudness.',
        fix: 'Render again. If it repeats, report it with this JSON. With your own music, check that the file is not silent or clipped at the first beat you gave.',
    },
    'audio-peak': {
        meaning: 'The soundtrack true peak is above -1 dBTP.',
        fix: 'Render again. If it repeats, report it with this JSON.',
    },
    'audio-cue-offset': {
        meaning:
            'A sound effect peaks more than one frame away from its sfx cue frame, or cannot be found.',
        fix: 'Keep sfx cues at least 1/8 beat apart and inside the scene they belong to. If the cues are clean, render again and report it with this JSON if it repeats.',
    },
    'render-busy': {
        meaning: 'Another render of this composition is running.',
        fix: 'Wait for it to finish, then run render again.',
    },
    'internal-error': {
        meaning: 'flipbook itself failed.',
        fix: 'Do not edit the composition for this. Report it with this JSON at https://github.com/liustack/flipbook/issues.',
    },
} as const satisfies Record<string, CodeInfo>;

/** Environment problems: the machine is missing something. Exit 78. */
export const ENV_CODES = {
    'platform-unsupported': {
        meaning: 'This operating system is not supported.',
        fix: 'Run flipbook inside WSL2 (Ubuntu) on Windows, or on macOS or Linux.',
    },
    'node-too-old': {
        meaning: 'Node is older than the supported floor.',
        fix: 'Install Node 22.19 or newer from https://nodejs.org.',
    },
    'ffmpeg-missing': {
        meaning: 'ffmpeg or ffprobe is not on PATH.',
        fix: 'Install ffmpeg. macOS: brew install ffmpeg. Debian or Ubuntu: sudo apt-get install -y ffmpeg.',
    },
    'ffmpeg-feature-missing': {
        meaning: 'ffmpeg lacks a required encoder or filter.',
        fix: 'Install a full ffmpeg build with libx264. macOS: brew install ffmpeg. Debian or Ubuntu: sudo apt-get install -y ffmpeg.',
    },
    'chromium-missing': {
        meaning: 'The pinned Chromium headless shell is not installed.',
        fix: 'Run check or render once outside the sandbox to install it, or run the install command in `fix`.',
    },
    'chromium-install-failed': {
        meaning: 'Installing the Chromium headless shell failed.',
        fix: 'Check the network or proxy (HTTPS_PROXY) and run the install command in `fix` again.',
    },
    'browser-launch-failed': {
        meaning: 'Chromium was installed but did not start.',
        fix: 'Read `detail.log`. On Linux, install the system libraries with the command in `fix`.',
    },
    'sandbox-blocked': {
        meaning: 'The host sandbox stopped Chromium from starting, even in single-process mode.',
        fix: 'Allow Chromium in the sandbox: set sandbox.network.allowMachLookup, or add the flipbook launcher to sandbox.excludedCommands.',
    },
    'tmp-unwritable': {
        meaning:
            'Chromium could not create its temporary directory: TMPDIR is missing or read-only, as in a read-only sandbox.',
        fix: 'Point TMPDIR at an existing writable directory and run the command again, or ask the user for a sandbox that can write (Codex: workspace-write).',
    },
    'resource-exhausted': {
        meaning:
            'The system killed a Chromium or ffmpeg process flipbook started, which it does when memory or the process count runs out.',
        fix: 'Give flipbook at least 2 GB of memory and 128 processes (close heavy programs, or raise container limits), then run the same command again. Leave the composition as it is.',
    },
    'linux-deps-missing': {
        meaning: 'Chromium is missing Linux system libraries.',
        fix: 'Install them with the command in `fix` (needs sudo).',
    },
    'font-download-failed': {
        meaning: 'A font could not be downloaded or failed its checksum.',
        fix: 'Check the network or proxy, or set FLIPBOOK_FONT_BASE_URL to a mirror that serves the same files.',
    },
    'cache-unwritable': {
        meaning: 'The flipbook cache directory cannot be written.',
        fix: 'Run the command outside the sandbox once, or set FLIPBOOK_CACHE_DIR to a writable directory.',
    },
} as const satisfies Record<string, CodeInfo>;

export type FindingCode = keyof typeof FINDING_CODES;
export type EnvCode = keyof typeof ENV_CODES;
