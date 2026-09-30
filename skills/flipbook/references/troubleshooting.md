# Troubleshooting

Every code flipbook reports, what it means, and what to change.

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

### `story-missing`

The composition directory has no story.json.

Fix: Write story.json before the timeline, as references/story.md describes: who wants what, because of what, what they become and where the viewer finds each, what the film leaves the viewer with, the device and the beats.

### `story-invalid`

story.json does not match story schema v2 (a v1 file among them), its slots leave the story to a record and to memory at once or lack the record or memory block they need, or it names a scene, cue or beat that does not exist.

Fix: Fix the field named in `detail.path` as the message says.

### `story-slot`

A slot of the story on stage has nothing to land on: it goes through the words in a beat with no text, through the sound in a beat with no sound, or through the picture alone in the hold beat.

Fix: Carry the slot where the beat can hold it: put the words on screen and list them in the beat's text, give the beat its sfx cue, or land it in a beat whose picture moves. Or change the slot's via or beat to where the film does show it.

### `story-coverage`

The beats do not follow the film: the first beat does not start where the film starts, a beat starts before the one ahead of it, or a beat covers no frame.

Fix: Start the first beat at the first scene and give each later beat a later `at`, at least one frame later. A beat lasts until the next one starts.

### `story-arc`

The beats do not make a story: no opening first, no resolution last, or no turn between them. As a warning: more than six beats.

Fix: Find the turn: the moment something goes wrong or changes course. Parts that sit side by side are a list, not a story. Merge beats that do the same job.

### `story-text`

A beat's `text` does not match the text cues that fall inside it.

Fix: List the words on screen in each beat exactly as its text cues show them, in order, or move the cues into the beat that shows them.

### `story-text-fast`

A beat puts more words on screen than a viewer can read in its time.

Fix: Cut words, or give the beat more bars in timeline.json.

### `story-ending-short`

The film stops too soon after its story lands: the last words settle less than 2 s before the end (less for a very short film), or with no words the last beat is shorter than 2.5 s.

Fix: Give the ending room, see the ending in references/story.md: lengthen the last scene or bring the last words in earlier, and use the time for a last small action, the camera and light settling and the music landing on its home chord.

### `story-static-beat`

A beat's first and last frames look the same: the change the story promises does not show.

Fix: Draw the change written in the beat: the picture at its end must differ from its start. Mark the one beat that stands still on purpose with "hold": true.

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

### `unsafe-output`

A path flipbook writes under .flipbook/ or out/ is a symbolic link or the wrong kind of file, so nothing was written.

Fix: Delete the paths in `detail.paths` (for a link, the link itself, not what it points to), then run the command again. flipbook recreates .flipbook/ and out/ on its own.

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

### `forbidden-api-call`

The page called a clock or random function the rules forbid (Date.now, new Date(), performance.now, Math.random, crypto random, Temporal.Now and the like), even if this sample of frames did not change because of it.

Fix: Remove every call named in `detail.api`, starting at `element`: take time from the t passed to seek, randomness from rng(seed) or rand(seed, ...keys).

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

Text uses characters that no flipbook font or supplied font covers.

Fix: Replace the characters listed in `detail.chars`, or drop them.

### `font-fallback`

Text rendered with a system font instead of a flipbook font or a supplied font.

Fix: Set font-family to "Noto Serif SC", "LXGW WenKai" or "Fusion Pixel 12px Prop zh-Hans", the fonts flipbook serves, or to a font supplied in brand.json or assets/fonts/. List "Noto Serif SC" after a supplied font that lacks some characters.

### `brand-invalid`

The brand.json that timeline.json's `brand` names is missing or breaks the brand schema, or a file it names is not local or has no license.

Fix: Fix the field at `detail.path` in `detail.file` as the message says. See references/brand.md.

### `font-invalid`

A font file in assets/fonts/ has no license, is not a readable .ttf or .otf, or clashes with another font.

Fix: Write the license in assets/SOURCES.json, replace the file with its .ttf or .otf, or rename the family, as the message says. See references/brand.md.

### `stock-no-results`

stock search found no image or sound for the query.

Fix: Search again with two to four other concrete English words, or with --source for one collection. When nothing fits, leave the picture or sound out and tell the user.

### `stock-smaller`

stock fetch saved a smaller copy than the service lists: the collection hands out only a preview of the original.

Fix: Use the picture only where it shows no larger than the size the report gives, or search again for a larger one. The warning names both sizes.

### `stock-rejected`

stock fetch did not save the file: the id is unknown, its license is not public domain, its address is not a public HTTPS address, or the file is not an image or sound it can read, or is too large.

Fix: Pick another result from stock search. `detail.reason` says why this one was refused.

### `cutout-invalid`

flipbook cutout did not start: the image is missing, lies outside the composition, is not in assets/, or has no source and license in assets/SOURCES.json (a generated image also needs its tool and prompt).

Fix: Pass an image under assets/ that stock fetch saved, or add its source and license to assets/SOURCES.json first (for a generated image, its tool and prompt too).

### `puppet-invalid`

flipbook puppet did not start or could not build the puppet: assets/puppets/<name>/puppet.json is missing, is not valid JSON, does not match puppet schema v1, names an image outside assets/ or without its source and license (a generated image also needs its tool and prompt), or its bones do not hang together.

Fix: Fix the field named in `detail.path` as the message says, see references/characters.md.

### `puppet-joint-missing`

flipbook puppet found no round joint tab at the named end of a part: the end is square or ragged, or the side is wrong.

Fix: Give that joint as [x, y] in the part's own pixels, read off the cut image, or name the side the tab is on.

### `sprite-invalid`

flipbook sprite did not start or could not cut a clip: assets/sprites/<name>/sprite.json is missing, is not valid JSON, does not match sprite schema v1, names a sheet outside assets/ or without its source and license (a generated sheet also needs its tool and prompt), shows more or fewer separate drawings than frames says, has drawings that reach past their crop, or, with grid, holds more or fewer drawings in its cells than frames or, for pixel art, does not split into cells of whole pixels.

Fix: Fix the field named in `detail.path` as the message says, see references/characters.md. Too few drawings: those that touch or nearly touch count as one, so give grid for a sheet in equal cells, lower gap, or ask for a sheet with wider gaps. Too many: pieces of one drawing count apart, so raise gap.

### `sprite-drift`

A drawing of a clip is much taller or shorter than the others, or, in a clip that stands still, its feet stand away from where they stand in the others, or, in a walk, a drawing had to be shifted a lot to keep the planted foot put, or the planted foot could not be followed at all, or, for pixel sprites, which are never rescaled, a whole clip is taller or shorter than the first: the character grows and shrinks, slides or sways as it plays.

Fix: Look at the drawing on the sheet (out/sprite/<name>.png, drawn on pink). Leave it when the change is part of the move (a crouch, a jump) or the sway looks natural, otherwise redraw or regenerate that drawing, or leave it out. For `stride` (no drawing named): look at the whole walk, a foot must touch the ground in every drawing and move back from one to the next. For `clip-height` (pixel sprites): redraw that clip at the size of the first one.

### `cutout-none`

flipbook cutout cut nothing: no specimen on the plate stands apart (they touch one another, or the ground color is wrong) and the picture cut whole lost everything with the ground or ran off the picture, or, with --subject, Vision found no subject bigger than a speck.

Fix: Use the picture whole with cutout: none and move the camera over it, pass --paper with the ground color, cut a photo with a real background with --subject on macOS 14 or newer, or search for a picture whose subjects stand apart.

### `cutout-clipped`

A specimen reaches past its crop, so its cutout would have a straight cut edge. It was left out.

Fix: Nothing to do when enough specimens were kept. Otherwise raise --gap so its pieces count as one, or use the plate whole.

### `asset-conflict`

stock fetch did not save the file: another file of the same kind already has that name in assets/, or assets/SOURCES.json is not a readable JSON object.

Fix: Pass another --as name, or fix assets/SOURCES.json as the message says.

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

The picture does not change for longer than allowed in a scene without hold. Change is judged over the whole frame, scaled down: a small thin figure moving in an otherwise still wide shot can count as no change.

Fix: Keep something moving in that scene, or set "hold": true on it in timeline.json when the still is intended. When only a small figure moves in a wide shot, give the shot a slow camera move (a gentle push or drift) or bring the camera closer.

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

flipbook audio found nothing to synthesize: audio.mode is not "preset" or "score" and there are no sfx cues.

Fix: Nothing to fix when the video should have no synthesized sound. For music, set "audio": { "mode": "preset", "preset": "pluck" }, see references/audio.md.

### `audio-missing`

timeline.json asks for sound, but the video has no audio stream.

Fix: Render again. If it repeats, report it with this JSON.

### `audio-loudness`

The soundtrack with music is not within 1 LU of -14 LUFS integrated loudness.

Fix: Render again. If it repeats, report it with this JSON. With your own music, check that the file is not silent or clipped at the first beat you gave.

### `audio-silent`

timeline.json asks for music, but the soundtrack measures as silence: most often audio.offset starts past the end of the file, or the file itself is silent.

Fix: Lower audio.offset below the length in `detail.fileDurationSec`, or pick a file that has sound where the film uses it.

### `audio-peak`

The soundtrack true peak is above -1 dBTP.

Fix: Render again. If it repeats, report it with this JSON.

### `audio-cue-offset`

A sound effect peaks more than one frame away from its sfx cue frame, or cannot be found.

Fix: Keep sfx cues at least 1/8 beat apart and inside the scene they belong to. If the cues are clean, render again and report it with this JSON if it repeats.

### `asset-unlicensed`

A picture under assets/ (fonts and the brand.json logo aside) has no source and license in assets/SOURCES.json, or is generated and does not name the tool and the prompt that made it.

Fix: Add its entry to assets/SOURCES.json: "source" and "license", and for a generated picture "license": "generated" with "tool" and "prompt". Pictures from stock fetch, cutout and puppet get theirs written for them.

### `audio-unlicensed`

An audio file timeline.json names (audio.file or an sfx cue file) has no source and license in assets/SOURCES.json.

Fix: Fetch sounds with stock search --audio and stock fetch, which record both. For a file the user supplied, write its source and license in assets/SOURCES.json from what the user says, and ask when the license is unknown.

### `render-busy`

Another render of this composition is running.

Fix: Wait for it to finish, then run render again.

### `internal-error`

flipbook itself failed.

Fix: Do not edit the composition for this. Report it with this JSON at https://github.com/liustack/flipbook/issues.

## Environment problems (exit 78)

### `vision-unavailable`

cutout --subject asks the Vision framework of macOS 14 or newer for the photo's subject, and this machine does not have it, or osascript could not run it.

Fix: Run the same cutout on a Mac with macOS 14 or newer and keep the PNGs it writes. Elsewhere, a photo on a plain light ground cuts without --subject, and any other photo can be used whole as a framed sticker with cutout: none.

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

Fix: Run the install command in `fix`, or: Run the flipbook check or render that needs the download once more outside the sandbox (Claude Code: rerun it with dangerouslyDisableSandbox). The user approves once, and every later run works inside the sandbox with no settings to change and no restart.

### `chromium-install-failed`

Installing the Chromium headless shell failed.

Fix: Check the network or proxy (HTTPS_PROXY) and run the install command in `fix` again.

### `browser-launch-failed`

Chromium was installed but did not start.

Fix: Read `detail.log`. On Linux, install the system libraries with the command in `fix`.

### `sandbox-blocked`

The host sandbox stopped Chromium from starting, even in single-process mode.

Fix: Allow Chromium in the sandbox: set sandbox.network.allowMachLookup, or add the flipbook launcher to sandbox.excludedCommands.

### `tmp-unwritable`

Chromium could not create its temporary directory: TMPDIR is missing or read-only, as in a read-only sandbox.

Fix: Point TMPDIR at an existing writable directory and run the command again, or ask the user for a sandbox that can write (Codex: workspace-write).

### `resource-exhausted`

The system killed a Chromium or ffmpeg process flipbook started, which it does when memory or the process count runs out.

Fix: Give flipbook at least 2 GB of memory and 128 processes (close heavy programs, or raise container limits), then run the same command again. Leave the composition as it is.

### `linux-deps-missing`

Chromium is missing Linux system libraries.

Fix: Install them with the command in `fix` (needs sudo).

### `font-download-failed`

A font could not be downloaded or failed its checksum.

Fix: Check the network or proxy, or set FLIPBOOK_FONT_BASE_URL to a mirror that serves the same files.

### `cache-unwritable`

The flipbook cache directory cannot be written.

Fix: Run the flipbook check or render that needs the download once more outside the sandbox (Claude Code: rerun it with dangerouslyDisableSandbox). The user approves once, and every later run works inside the sandbox with no settings to change and no restart. Or set FLIPBOOK_CACHE_DIR to a writable directory.

### `stock-key-missing`

The image service asked for needs an API key that is not set, or it turned the key down.

Fix: Ask the user for the key and set PEXELS_API_KEY or PIXABAY_API_KEY, or search without --provider to use Openverse, which needs no key.

### `stock-unreachable`

The image or sound service, or the host of the file, could not be reached, or answered with a server error or rate limit.

Fix: Check the network or HTTPS_PROXY and run the command again. Inside a sandbox, run the same stock command outside it once the user approves.
