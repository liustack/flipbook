---
summary: 'The JSON report from check, snapshot, render and audio: exit codes, fields, what each code means and how to fix it'
read_when:
  - Parsing flipbook output
  - Adding or changing a code
---

# Report format flipbook.report/1

English | [中文](report-schema.zh-CN.md)

`check`, `snapshot`, `render` and `audio` print one JSON report to stdout whether they pass or fail. Progress and logs go to stderr. `doctor --json` has its own format, `flipbook.doctor/1` (see the end of this page).

## Exit codes

| Code | Meaning | Who acts |
|---|---|---|
| 0 | Everything passed | Nobody |
| 1 | The video has problems | The agent fixes the composition according to `failures` |
| 2 | Usage error (bad arguments, missing directory) | The agent fixes the command |
| 78 | The environment is missing something (Node, ffmpeg, Chromium, fonts, sandbox, system libraries) | Fix the machine with the command on stderr |

On exit 78, stderr carries a separate JSON diagnosis: `error` (the environment code), `message`, `meaning`, `fix` (commands or settings ready to copy), `detail`, `platform`, `node`. stdout still carries the report, with the same diagnosis in its `environmentError` field.

For `sandbox-blocked` and `tmp-unwritable`, `detail.signature` names the row of the sandbox signature table that matched (`tmp-unwritable` maps to `temp-dir`, `sandbox-blocked` to `linux-socket-filter`, `mach-port` or `operation-not-permitted`, see [platform.md](platform.md)). A refused download, `chromium-install-failed`, carries `detail.signature: "network-blocked"`. These codes and `cache-unwritable` all carry `detail.host`: `claude-code`, `codex` or `null`, identified by the environment variables the host sets.

## Top-level fields

| Field | Type | Description |
|---|---|---|
| `schema` | string | Always `flipbook.report/1` |
| `command` | string | `check`, `snapshot`, `render`, `audio`, or `usage` on a usage error |
| `ok` | boolean | true when the exit code is 0 |
| `exitCode` | 0, 1, 2, 78 | Same as the process exit code |
| `flipbook.version` | string | CLI version |
| `environment` | object | `platform` (such as `darwin-arm64`), `node`, `chromium` (`version`, `revision`, `launchMode`: `normal` or `single-process`), `ffmpeg` |
| `composition` | object | `dir`, `hash` (hash of the composition directory, starting with `sha256:`, excluding `out/` and `.flipbook/`), `width`, `height`, `fps`, `frames`, `durationSec` |
| `failures` | Finding[] | Errors. Any one of them makes the exit code 1 |
| `warnings` | Finding[] | Hints. They do not change the exit code |
| `artifacts` | object | Output paths: `video`, `contactSheet`, `rejectedVideo`, `zoom1` and so on. `report` is where this report was saved |
| `reportSaveError` | string | Present only when the report could not be saved, with the reason (no composition directory, write refused or failed). The copy on stdout is then the only one |
| `attempts` | object | Retry counts, see below |
| `stop` | boolean | true when a retry limit is reached. The agent should stop and report to the user |
| `stopReason` | string | When `stop` is true, where it is stuck |
| `timing` | object | `startedAt`, `durationMs` |

Each command adds a field named after itself: `check` (`seed`, the sampled frames, the order of the two seek passes, the evidence directory, `contrastSkipped` for canvas text whose contrast was not measured), `snapshot` (`layout`, `tiles` with each tile's frame, time and scene, `zooms`), `render` (`frames`, `fps`, `digest` summarizing the raw frame hashes, `captureMs`, `encodeMs`, `verifyMs`, `totalMs`, `captureFps`, `probe`, `audio`, `contactSheetTiles`), `audio` (see [Audio](#audio)). `render` also has `metadata`, the same content written into the mp4 comment tag.

## Output directory

Inside a composition directory, flipbook writes only to `out/` and `.flipbook/`. Before writing it checks the path one level at a time: if either of them, or any level below, is a symlink, the command reports `unsafe-output` and exits 1 right at the start, writing and deleting nothing. Files are written under a new name in the same directory and then renamed into place, so a write never follows an existing symlink or hard link out of the directory:

| Path | Written by | Contents |
|---|---|---|
| `out/video.mp4`, `out/contact-sheet.png` | render | The video that passed acceptance and its contact sheet. `out/` is left alone when acceptance fails |
| `out/snapshot/contact-sheet.png`, `out/snapshot/zoom-f<frame>.png` | snapshot | Preview contact sheet and zoomed crops |
| `.flipbook/rejected/` | render | The video and contact sheet that failed acceptance, pointed to by `artifacts.rejectedVideo` |
| `.flipbook/evidence/<command>/` | check, render | Evidence images, cleared before each run |
| `.flipbook/timeline.resolved.json` | all | The resolved timeline |
| `.flipbook/frame-hashes.json` | render | sha256 of every raw frame, plus the summary |
| `.flipbook/attempts.json` | check, render | Retry counts |
| `.flipbook/reports/<command>.json` | check, snapshot, audio, render | The latest report of that command, identical to stdout. Runs that exit 78, hit `unsafe-output` or `internal-error` are saved too, with the path in `artifacts.report` |
| `.flipbook/tmp/` | render | Intermediate render files, deleted at the end |
| `.flipbook/render.lock` | render | One render per directory at a time (re-entry from the same process counts). A second one gets `render-busy` and exit 1, which does not count as an attempt. The lock is created with O_EXCL and holds a pid and a random token. It counts as stale, and gets taken over, only when its holder has exited, or when it has no readable holder and is more than 10 seconds old. Releasing deletes the lock only while the token is still its own |
| `.flipbook/audio/` | audio, render | The synthesized `music.wav` and `sfx.wav`, `score.json` (chords, dynamics, sound-effect positions), `audio.json` (hash and peak of each track, actual peak position of each sound effect). The audio command takes `render.lock` too |

## Finding

| Field | Type | Description |
|---|---|---|
| `code` | string | The code, see the tables below |
| `severity` | `error` or `warning` | |
| `message` | string | What happened |
| `time` | number | Second, optional |
| `frame` | number | Frame number, optional |
| `element` | string | CSS selector, `file:line` or `scene <id>`, optional |
| `evidence` | string[] | Evidence image paths, optional |
| `fix` | string | How to fix it |
| `detail` | object | Extra data such as `path`, `chars`, `frames` |

## Codes: composition problems (exit 1)

| Code | Reported by | Meaning | Fix |
|---|---|---|---|
| `index-missing` | all | No index.html in the directory | Create index.html |
| `timeline-missing` | all | No timeline.json in the directory | Write one following docs/timeline-schema.md |
| `timeline-invalid` | all | timeline.json does not match the v1 schema. `detail.path` gives the JSON path | Fix the field `detail.path` points to |
| `protocol-missing` | all | The page does not define `window.__flipbook`, or reading it throws | Call the runtime's `composition({ seek })` |
| `protocol-mismatch` | all | `window.__flipbook.protocol` is not 1 | Set it to 1 |
| `ready-timeout` | all | `ready` did not settle within 60 seconds (counted from when the page starts loading). A page that stops responding while `window.__flipbook` is read (an endless loop in a script or getter) uses up the same 60 seconds. On timeout this code is reported and the page closed | Do not wait for timers or rAF in ready |
| `ready-failed` | all | `ready` rejected, usually because a font or image failed to load | Fix what the message says |
| `seek-timeout` | all | One seek took longer than 10 seconds (change it with `--seek-timeout`) | Do not wait for rAF, timers or events in seek |
| `seek-failed` | all | seek threw | Fix what the message says |
| `page-error` | all | The page has an uncaught exception | Fix what the message says |
| `console-error` | all | The page logged an error to the console | Fix what the message says |
| `resource-failed` | all | A requested file does not exist in the composition directory | Add the file or fix the path. Images go in assets/ |
| `external-request` | all | The page tried to reach the network and was blocked. HTTP requests and WebSocket are blocked at the Playwright layer, with the target in `detail.url`. WebRTC and WebTransport throw inside the page, with `detail.url` set to `webrtc:<constructor name>` or `webtransport:<address>` | Copy the file into assets/ and use a relative path |
| `path-escape` | all | A requested path resolves outside the composition directory and was refused | Keep every file inside the composition directory |
| `unsafe-output` | check, snapshot, audio, render | `.flipbook/` or `out/` contains a symlink, or a file sits where a directory should be. Nothing was written this time. `detail.paths` lists the paths | Delete them (for a symlink, only the link itself) and run again |
| `static-forbidden` | check | The source uses a forbidden pattern. Warning only | Rewrite it as a pure function of t |
| `seek-order-dependent` | check | The picture for the same t changes when frames are seeked in another order: state is carried from frame to frame | Remove state that builds up between frames and compute everything from t |
| `clock-dependent` | check | The picture changes when the virtual clock starts elsewhere: the page reads Date or performance.now. Only three frames are compared, so no change does not prove the clock is never read | Use only the t passed to seek |
| `random-dependent` | check | The picture changes when the underlying random seed changes: the page uses Math.random or crypto | Use the runtime's `rng` or `rand` |
| `forbidden-api-call` | check | The page called a clock or random function the rules forbid. One finding per function, with the function name in `detail.api`, the count in `detail.count`, and the `file:line` of the first call in `element`. Counting covers the reference page from load to the last seek. Counted: `Date.now()`, `new Date()`, `Date()`, `performance.now()`, `performance.timeOrigin`, `document.timeline.currentTime`, `Intl.DateTimeFormat` without a date, `Temporal.Now.*`, `Math.random()`, `crypto.getRandomValues()`, `crypto.randomUUID()`. These calls still get values from the virtual clock and a fixed seed, so the picture may not change, but they are always an error. Calls inside Workers and iframes are not counted | Use the t passed to seek, and `rng` or `rand` for random numbers |
| `late-paint` | check | Two captures of the same t without a new seek differ: something paints late | Finish drawing inside seek, decode images in ready |
| `blank-frame` | check, render | The frame is one flat color: after scaling to 320×180 grayscale, fewer than 0.05% of pixels differ from the median gray by more than 16 levels. In check it is an error only when every sampled frame is blank, a warning when some are. In render it is an error from 1.5 seconds in a row | Check whether seek draws at those times |
| `paper-only` | check, render | The frame matches the baseline with only the paper layers on: after scaling to 320×180 grayscale, fewer than 0.05% of pixels differ from the nearest baseline by more than 16 levels. check and render judge it like `blank-frame`. render captures one baseline per second. In render, blank frames and paper-only frames count together as "no content", so switching between the two does not break the run. The code is whichever of the two has more frames, and `detail` has `blankFrames` and `paperFrames` | Check whether the content layer failed to draw because of an error |
| `missing-glyph` | check, render | The text has characters that none of the flipbook fonts contain. `detail.chars` lists them | Replace those characters |
| `font-fallback` | check, render | Text uses a system font instead of a flipbook font. DOM text is judged by the font Chromium actually used. Canvas text is checked one character at a time along the `ctx.font` font list: a character is reported when the list reaches another font name (a system font or a generic name such as `serif`) before a flipbook font that contains it, or when no font in the list contains it. `detail.chars` lists them | Use "Noto Serif SC" or "LXGW WenKai" in font-family |
| `text-offstage` | check | At the moment the text has fully appeared (the cue's settle time), a line crosses the edge of the frame. Each line's box comes from `Range.getClientRects`, transforms included. Text lying entirely outside the frame is reported too. Only text with `display: none`, `visibility: hidden` or `opacity: 0` is exempt. For canvas text registered by the runtime's `fillText`, the box bounds the glyph's four corners after the canvas's current transform (rotation, skew and flips included) and `maxWidth` squeezing, converted to page pixels by the canvas's layout size. CSS rotation on the canvas element itself is not included | Move the text into the frame or make it smaller. Mark deliberate bleeds `data-flipbook-allow-overflow` |
| `text-safe-area` | check | At the same moment, a line falls into the outer 5% margin of the frame. Warning only | Keep at least 5% of the width and height from each edge, or add `data-flipbook-allow-overflow` |
| `low-contrast` | check | At the same moment, the contrast between the text and what lies behind it is below 3:1 (the large-text standard). Warning only. How it is measured: the same frame is captured twice, the second time with DOM text made transparent, and the pixels that change are the glyphs. The text color is the mean, in the first capture, of the 30% of those pixels that changed most. The background is the mean of the same pixels in the second capture. The ratio uses WCAG relative luminance, and `detail.measured` is true. When the text cannot be told apart from what is behind it (fewer than 12 pixels change by more than 6 levels, usually text the same color as its background), the same warning is reported with `detail.measured` false. Text drawn on a canvas is not measured and is listed in `check.contrastSkipped` (`frame`, `element`, `reason`) | Darken or lighten the text or the background, or put a solid block behind the text |
| `stage-size` | check | The layout size of html or body is larger than the timeline width and height. Warning only. Offstage content clipped by `overflow: hidden` does not count | Size the stage to the timeline and hide overflow |
| `freeze` | render | In a scene without a declared hold, the picture stays still for 1.5 seconds or more: the video is scaled to 320×180, Gaussian-blurred (sigma 1.5) and run through ffmpeg freezedetect (`n=-60dB`). Only the part inside scenes without hold counts. Neighboring non-hold scenes are joined, so a scene boundary does not split a freeze. When it spans several scenes, `element` is `scenes <id>, <id>` | Make the picture move, or add `"hold": true` to the scene |
| `glitch` | render | 8 evenly spaced frames are decoded from the video and compared with the captured frames at 480×270 by PSNR. Below 30 dB is reported, with the worst frame's captured and decoded images as evidence (`glitch-f<frame>-captured.png`, `-decoded.png`). A broken frame pipe is reported under this code too | Render again. If it happens again, open an issue with the JSON |
| `frame-count` | render | The video's frame count does not match the timeline | Render again. If it happens again, open an issue with the JSON |
| `duration-mismatch` | render | The video's duration does not match the timeline (one frame of tolerance). With an audio track, this code also covers a track whose duration differs from the picture by more than the larger of one frame and one AAC packet (1024 samples) | Render again. If it happens again, open an issue with the JSON |
| `color-tags` | render | The video is not yuv420p or lacks the bt709 color tags | Open an issue with the JSON |
| `audio-skipped` | audio | The `audio` command has nothing to synthesize: `audio.mode` is not `preset` and there are no sfx cues. Warning only | Nothing to change when the video needs no synthesized sound. For music, write `"mode": "preset"` |
| `audio-missing` | render | The timeline asks for sound (`preset`, `file`, or sfx cues) but the video has no audio track | Render again. If it happens again, open an issue with the JSON |
| `audio-loudness` | render | A track with music has integrated loudness outside -14 LUFS ±1 LU | Render again. If it happens again, open an issue with the JSON. With your own music, first make sure it is not silent after `bpmOffset` |
| `audio-peak` | render | The track's true peak is above -1 dBTP | Render again. If it happens again, open an issue with the JSON |
| `audio-cue-offset` | render | A sound effect's peak is more than one frame away from its cue frame, or cannot be found in the track. `element` is `cue <id>` | Keep sfx cues at least 1/8 beat apart. If they are and it still happens, render again, and if it happens again open an issue with the JSON |
| `render-busy` | render | Another render is running in the same composition directory. Does not count as an attempt | Wait for it to finish |
| `internal-error` | all | flipbook itself failed | Leave the composition alone and open an issue with the JSON |

`clock-dependent` and `random-dependent` each open a new page, move the virtual clock start about 34 hours later or swap the underlying random seed, and compare three frames with the reference. Any problem on a perturbed page (a load failure, protocol, `seek-failed`, `seek-timeout`, `external-request`, `page-error` and so on) that the reference page does not have is reported as a failure under its own code. The `message` ends by naming the perturbation, and `detail.perturbation` gives its conditions (`change` is `clock` or `random seed`, plus the offset or the seed).

Text checks (`missing-glyph`, `font-fallback`, `text-offstage`, `text-safe-area`, `low-contrast`) sample at the settle time of each text cue in the timeline, or at three sampled frames when there are no text cues. Elements marked `data-flipbook-allow-overflow`, and their children, skip `text-offstage` and `text-safe-area`. Canvas text registered with the runtime's `registerText` can pass `allowOverflow: true`.

In check, `blank-frame` and `paper-only` look only at sampled frames: an error when every sampled frame is empty, a warning when some are. In render they look at every frame and report an error only when frames without content (both kinds together) run longer than 1.5 seconds.

Audio checks (`audio-missing`, `audio-loudness`, `audio-peak`, `audio-cue-offset`) run only when the timeline asks for sound. How they measure is in [Audio](#audio).

## Audio

### The audio command

`flipbook audio <dir>` synthesizes the music and sound effects from the timeline into `.flipbook/audio/`, and the report's `command` is `audio`. render calls it on its own: run it separately to listen first. It synthesizes afresh every time, with no cache.

- `artifacts`: `music` (with preset music) and `sfx` (with sfx cues), both WAV paths.
- `audio`: `mode`, `preset`, `key`, `progression`, `sampleRate` (48000), `samples`, `durationSec`, `synthMs`. `music` and `sfx` each have `file`, `sha256`, `peakDb`. Each item in `sfx.cues[]` has `id`, `sfx`, `frame`, `target` (the cue frame's sample position at 48 kHz) and `peakSample` (the sample position near the cue where the synthesized effect track actually peaks).
- With nothing to synthesize it reports an `audio-skipped` warning and exits 0.

### audio in the render report

`render.audio` is `null` when the timeline asks for no sound. Otherwise it has:

| Field | Description |
|---|---|
| `codec`, `sampleRate`, `channels`, `durationSec` | The video's audio track, read with ffprobe |
| `mode`, `preset`, `key` | As in the timeline |
| `integratedLufs`, `truePeakDbtp` | Integrated loudness and true peak of the track, measured with ffmpeg `ebur128` (`peak=true`). Integrated loudness is `null` when the track is shorter than 0.4 seconds or silent |
| `loudnessChecked` | true when there is music and its integrated loudness could be measured. Only then is -14 LUFS checked |
| `effectsLagMs` | How many milliseconds late the effect track sits in the video overall, `null` when it cannot be found |
| `cues[]` | Each sound effect: `id`, `sfx`, `frame`, `expectedSec` (frame divided by fps), `measuredSec`, `offsetMs`, `match` |
| `mix` | Mix parameters: `musicLufs` (loudness of the music alone), `mixLufs` (loudness of the mix before gain), `sfxGainDb`, `gainDb`, `limitDb` |
| `synthMs`, `stemsReused` | Synthesis time, and whether existing tracks were reused |

### How it is measured

- Track duration: the tolerance against the picture is the larger of one frame and one AAC packet (1024 / 48000 seconds). Beyond that is `duration-mismatch`.
- Loudness: with music (`preset` or `file`), integrated loudness must be within -14 LUFS ±1 LU, otherwise `audio-loudness`. With only sound effects, integrated loudness is not checked. Every track gets a true-peak check: above -1 dBTP is `audio-peak`.
- Effects on their frames: the effect track and the video are both brought down to 8 kHz mono. With music, the music alone is first rendered through the same mix chain, located in the video along with its gain, and subtracted, which leaves mostly the effects. For each effect, the span from 0.35 seconds before its peak to 30 milliseconds after, trimmed to the part holding 90% of the energy, is differenced once and slid within ±0.25 seconds to find the offset that correlates best with the video. One offset is found for all effects together. Each effect's actual peak is `peakSample` plus that offset, and more than one frame from the cue frame's time is `audio-cue-offset`. A correlation below 0.12 counts as not found and is reported under the same code.

## Codes: environment (exit 78)

| Code | Meaning |
|---|---|
| `platform-unsupported` | Unsupported system (on Windows, use WSL2) |
| `node-too-old` | Node is older than 22.19 |
| `ffmpeg-missing` | No ffmpeg or ffprobe on PATH |
| `ffmpeg-feature-missing` | ffmpeg lacks libx264 or a required filter |
| `chromium-missing` | The pinned Chromium headless shell is not installed (doctor reports it, check and render install it on their own) |
| `chromium-install-failed` | Installing Chromium failed |
| `browser-launch-failed` | Chromium does not start |
| `sandbox-blocked` | The host sandbox stops Chromium: it starts neither normally nor in single-process mode |
| `tmp-unwritable` | Chromium cannot create its temp directory: TMPDIR does not exist or is read-only (common in read-only sandboxes). Single-process mode does not help either, so there is no retry |
| `resource-exhausted` | The system killed a Chromium or ffmpeg process that flipbook started, which is what happens when memory or the process limit runs out. How it is recognized: Chromium reports through CDP `Target.targetCrashed` that a renderer ended with status `killed`, `oom`, `failed to launch` or `evicted for memory` (`detail.process` is `renderer`, with `status` and `errorCode`). Or the whole browser exits (`detail.process` is `browser`, the only case in single-process mode). Or ffmpeg or another helper gets a SIGKILL that flipbook did not send for a timeout (`detail.program`, `detail.signal`). A page that crashes on its own (status `crashed`, which includes blowing the V8 heap) is still `page-error` |
| `linux-deps-missing` | Linux lacks system libraries that Chromium needs |
| `font-download-failed` | A font download failed or did not verify |
| `cache-unwritable` | The cache directory cannot be written (common on a first run inside a sandbox) |

## Retry counts

The counts live in the composition's `.flipbook/attempts.json`. The report's `attempts` field summarizes them:

| Field | Description |
|---|---|
| `checkRounds` / `checkLimit` | Rounds of check so far, limit 8 |
| `renderFailures` / `renderLimit` | Failed renders, limit 3 (the first try plus 2 more) |
| `repeatedCodes` / `repeatLimit` | Consecutive failures per code, limit 3 |

When any count reaches its limit and this run still fails, `stop` is true. One successful render resets every count.

## doctor --json

`doctor --prune` first deletes what this version no longer uses from the cache (other Chromium builds, half-downloaded fonts, fonts no longer in the manifest), and the report gains a `pruned` field (`removed` lists the deleted paths, plus `bytesFreed`). Apart from the cache write probe described below, this is the only switch that lets doctor change the machine, and it still does not touch the network or install anything.

`flipbook.doctor/1`: `ok`, `exitCode` (0 or 78), `version`, `platform`, `node`, `ffmpeg` (path, version, and `features` saying which features work), `chromium` (`revision`, `browserVersion`, `playwrightCore`, `executable`, `installed`), `launch` (`ok`, `mode`, `version`, `error`), `cache` (`root`, `exists`, `writable`, and `fonts` saying whether each font is present. Writability is tested by creating an empty file in the cache directory, or in its nearest existing parent, and deleting it right away. This is doctor's only write. If it fails, doctor reports `cache-unwritable` and exits 78), `skillInstalls` (the version each host's copy of the skill pins, and whether it is older than the CLI), `problems` (environment codes with fix commands), `fix` (every `problems[].fix` merged in order without duplicates, which is what to relay to the user on exit 78), `warnings`.

When doctor runs through the skill launcher `scripts/run.sh doctor`, stdout is one JSON object with or without `--json`. When the CLI can run, it is the report above with a `launcher` field first (the pinned version, the flipbook, npx, bunx and node it found, and the launch method it picked), and the exit code is the CLI's. When nothing can run, it is `{ ok: false, exitCode: 78, error: "runtime-missing", message, fix, launcher }` with exit 78. For the other commands, when nothing can run, the same JSON goes to stderr. Fonts not downloaded yet are only a warning: check and render download them on their first run.
