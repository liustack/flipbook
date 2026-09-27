---
name: flipbook
description: "Make short animated films as MP4 that tell a story: a short film, an animated explainer, a story-driven product or brand film, an animated title. You write the story (story.json), then timeline.json and one HTML composition, and flipbook renders it frame by frame and checks the result against the story before delivery. Use when the user asks for an animated video or film, a story told in animation, or an animation exported to MP4. Hard rules: the picture is a pure function of t (no CSS animation or transition, timers, requestAnimationFrame, Date.now, performance.now, unseeded Math.random, network), text uses only the fonts \"Noto Serif SC\", \"LXGW WenKai\" and, for the pixel look, \"Fusion Pixel 12px Prop zh-Hans\", or font files the user supplied with a license, every command runs through this skill's scripts/run.sh, and a video is delivered only after flipbook render exits 0."
metadata:
  compatibility: "Node 22.19+ (or Bun) and ffmpeg with libx264. macOS arm64 or Linux x64, Windows through WSL2. The first check or render downloads Chromium (about 95 MB) and three fonts (about 55 MB)."
---

# flipbook

Use it to turn a request into a short animated film that tells one story, checked before delivery. A film about a product or a brand is made the same way: one idea, with the product moving the story rather than starring in it. Do not use it for editing real footage, 3D characters, voice-over, AI-generated video, or a tour of product features.

## Run it

Every command goes through the launcher next to this file. Replace `<skill-dir>` with the directory this SKILL.md lives in:

```bash
bash <skill-dir>/scripts/run.sh doctor                          # can this machine render?
bash <skill-dir>/scripts/run.sh check <dir>                     # test the composition
bash <skill-dir>/scripts/run.sh snapshot <dir>                  # contact sheet of frames
bash <skill-dir>/scripts/run.sh snapshot <dir> --zoom x,y,w,h --at 3.5
bash <skill-dir>/scripts/run.sh render <dir>                    # MP4 plus acceptance checks
bash <skill-dir>/scripts/run.sh render <dir> --size 9:16        # another shape: 1:1, 4:5 or WxH too
bash <skill-dir>/scripts/run.sh render <dir> --scale 2          # 3840x2160 from a 1920x1080 stage
bash <skill-dir>/scripts/run.sh stock search <dir> beetle plate  # public domain images, see references/photo.md
bash <skill-dir>/scripts/run.sh stock fetch <dir> openverse:<id> --as beetle
bash <skill-dir>/scripts/run.sh stock search <dir> page turn --audio  # public domain sounds and music, see references/audio.md
bash <skill-dir>/scripts/run.sh cutout <dir> assets/beetle.jpg          # every specimen as a transparent PNG, before composing
bash <skill-dir>/scripts/run.sh puppet <dir> postman                    # rig cut parts into a puppet, see references/characters.md
bash <skill-dir>/scripts/run.sh sprite <dir> postman                    # cut sprite sheets into clips, see references/characters.md
```

Once check has passed its determinism checks (seek order, shifted clock and seed, late paint), render draws on several pages at once (CPU cores minus one, at most 6, fewer for short films or big frames). `--jobs <n>` sets the count. `check` and `snapshot` take `--size` too, and `check` takes `--scale`: check at the size and scale you will render, so text and the safe area are checked in that shape, and render gets parallel pages only after a check at the same size and scale.

`<dir>` is the composition directory. stdout carries one JSON report, progress goes to stderr. Each report is also saved to `<dir>/.flipbook/reports/<command>.json`, whose path is in `artifacts.report`. When the report has `reportSaveError` instead, nothing was saved: the stdout JSON is the report to hand over.

| Exit | Meaning | Do |
|---|---|---|
| 0 | passed | continue |
| 1 | the composition has problems | fix every code in `failures`, see `references/troubleshooting.md` |
| 2 | the command is wrong | fix the command |
| 78 | the machine is missing something | relay the `fix` lines to the user (from the JSON on stderr, or on stdout for `doctor`), leave the composition alone |

If scripts cannot run, use the first line that works (the pinned version is 0.7.3):

1. A `flipbook` on PATH with the same major.minor as the pinned version and not older than it: `flipbook <args>`.
2. `npx --yes --package @liustack/flipbook@0.7.3 flipbook <args>`.
3. `bunx --bun @liustack/flipbook@0.7.3 <args>`.
4. None: tell the user to install Node 22.19+ from https://nodejs.org.

## Sandbox

- Chromium starts inside the Claude Code sandbox and the Codex `workspace-write` sandbox on its own.
- The first check or render downloads Chromium and fonts into `~/Library/Caches/liustack/flipbook` (macOS) or `~/.cache/liustack/flipbook` (Linux). Inside a sandbox this exits 78 with `cache-unwritable` or `chromium-install-failed`: run that same command once more outside the sandbox (Claude Code: `dangerouslyDisableSandbox`). The user approves once, and later runs work inside the sandbox with no settings to change.
- Lasting settings the user can add instead:
  - Claude Code, `~/.claude/settings.json`: the cache directory in `sandbox.filesystem.allowWrite` plus `cdn.playwright.dev`, `storage.googleapis.com`, `github.com` and `*.githubusercontent.com` in `sandbox.network.allowedDomains`. Or the launcher command in `sandbox.excludedCommands`.
  - Codex, `~/.codex/config.toml` under `[sandbox_workspace_write]`: the cache directory in `writable_roots` and `network_access = true`. Codex on Linux needs `network_access = true` for every run.
- Codex `read-only` cannot run flipbook: ask the user for `workspace-write`.
- `stock search` and `stock fetch` reach image and sound services every time. Inside a sandbox that blocks them they exit 78 with `stock-unreachable`: run that command outside the sandbox after the user approves.
- Exit 78 with `sandbox-blocked` or `tmp-unwritable`: relay its `fix` lines.

## The steps

1. **Story.** Write `story.json`: the idea, what it leaves the viewer with, the subject that changes, the device and three to six beats. Read `references/story.md` before writing the first one. When the user is there, show them the story in one message and go on once they agree. When they said to just make it, go on with your own.
2. **Spec.** Settle size, duration, frame rate, look, text and music. Use the defaults for anything the user did not say. When the request is about a product or a brand, first search the workspace for its assets (logo files, theme color variables, design tokens, color values in the README) and list them for the user to confirm. When none turn up, ask for them instead of guessing. Then write `brand.json` as `references/brand.md` describes.
3. **timeline.json.** Scenes in bars, text and marker cues in beats, a scene or two per story beat. Read `references/timeline.md` before writing the first one.
4. **index.html.** One composition that calls `composition({ setup, seek })` from `/__flipbook/runtime.js`. Read `references/rules.md` before writing the first one.
5. **Check and look.** Run `check`, fix every failure, repeat until it exits 0. Then run `snapshot`, open `out/snapshot/contact-sheet.png` and fix what looks wrong. Rerun `check` after every edit.
6. **Render.** Run `render`. Exit 1 means the finished video failed acceptance: fix the codes and go back to step 5.
7. **Deliver.** Open `out/contact-sheet.png` and read it against the story: each beat's first and last pictures show its `change`, and the film can be retold from the pictures alone. Then give the user `out/video.mp4` and the contact sheet path.

Defaults:

| Setting | Default |
|---|---|
| size | 1920×1080 (16:9) |
| frame rate | 24 fps |
| duration | about 30 s, within 5% of what the user asked, at most 180 s |
| look | the paper skin: `paperLayer()` and `grainLayer()` from `references/paper.md`, dark ink, one or two accent colors, serif type. When the user asks for a riso or screen print look: two or three spot inks printed with `riso()`, see `references/riso.md`. When they ask for pixel art or a game look: a small grid of cells and a few colors with `pixel()`, see `references/pixel.md` |
| music | a score written for this story (`"audio": { "mode": "score", ... }`, see `references/audio.md`) so each film gets its own tune. A preset such as `pluck` for a short, plain clip. Silent only when the user asks |
| found music or effects | when the user names a recorded piece or an instrument the score lacks, or a real sound matters (a page turn, a pencil): `stock search --audio`, see `references/audio.md` |
| the user's own music | put the file in `assets/`, ask for its bpm and the second where beat 1 falls. The bpm goes in the top-level `bpm`, the rest in `audio`: `"audio": { "mode": "file", "file": "assets/music.mp3", "bpmOffset": 0.42 }` |
| characters | none unless the story needs someone to act it out: then a cut-out puppet drawn in code, or cut from a picture of its parts the user gives, or sprite sheets played frame by frame, see `references/characters.md` |
| photos | none unless asked, or the film calls for real specimens, plates, micrographs or maps: `references/photo.md` |

## Hard rules

- `seek(t)` draws the frame for `t` from `t` alone. No CSS animation or transition, timers, `requestAnimationFrame`, `Date.now()`, `new Date()`, `performance.now()`, `Math.random()`, `crypto` random, state carried between frames, or network. Use `rng(seed)`, `rand(seed, ...)`, `ease`, `cueProgress` and the other runtime helpers.
- `seek(t)` must not await frames, timers or events.
- check samples a few frames under a moved clock and seed and counts clock and random calls. It catches most slips, not all of them: keep these rules even when check passes.
- Size `html` and `body` to the stage (`100vw` by `100vh`) with `overflow: hidden`, and place things from `tl.width` and `tl.height`, not fixed pixels, so `--size` works. Mark paper and grain layers `data-flipbook-layer="paper"`. Draw static layers once in `setup()`.
- Text lives in the DOM or goes through the runtime's `fillText()`. Fonts: `"Noto Serif SC"` or `"LXGW WenKai"` (for the pixel look, `"Fusion Pixel 12px Prop zh-Hans"`), or font files the user supplied with their license in brand.json or `assets/fonts/` (`references/brand.md`). Keep text inside the frame and away from the outer 5% margin when it settles, with contrast of at least 3:1 (check measures DOM text only: judge canvas text on the contact sheet). Mark deliberate bleeds `data-flipbook-allow-overflow`. Never animate `transform: scale()` on DOM text (on Linux and Windows two renders of it can differ): text that grows or shrinks goes through `fillText()` on a canvas.
- Scenes where the picture stands still for more than 1.5 s need `"hold": true`.
- Images and sound files go in `assets/` with their source and license in `assets/SOURCES.json`: fetch them with `stock fetch`, which writes both, or take them from the user. Never download images or sounds any other way. A still picture an image model made (a character's parts, a backdrop, a prop) is material too: its entry has `"license": "generated"`, the `tool` and the whole `prompt`. Never use video from a video model, and never generate a picture per frame.
- Cut specimens out with `cutout` before composing, open its sheet (`out/cutout/<name>.png`) and use only cutouts that look clean on all three grounds. Draw them with `photo('assets/cut/<name>/<name>-01.png')`. A plate `cutout` cannot part (`cutout-none`) is used whole and moved by the camera, never cropped by guess. A photo with a real background is cut with `cutout --subject` on macOS 14 or newer.
- Never edit `.flipbook/` or `out/`.

## Stopping

- The CLI counts attempts per composition. When a report has `stop: true`, stop: tell the user where it is stuck and give them the contact sheet, the report path and `stopReason`.
- The limits are 3 consecutive runs failing with the same code, 8 check rounds, 3 failed renders.
- `internal-error` is a flipbook bug: stop and give the user the report.

## References

| Read | When |
|---|---|
| `references/story.md` | before the first story.json, and when a `story-*` code appears |
| `references/characters.md` | when the story needs a character: what code draws well, puppet parts and bones, walking, waving, blinking, talking, parts cut from a picture, sprite sheets |
| `references/rules.md` | before the first index.html, and when a determinism, text or layer code is unclear |
| `references/timeline.md` | before the first timeline.json, and when matching a requested duration |
| `references/audio.md` | before choosing or writing the music, finding sounds or placing sound effects, and when an `audio-*` code appears |
| `references/troubleshooting.md` | whenever check or render exits non-zero |
| `references/paper.md` | before the first index.html, for the paper and grain layers of the default look |
| `references/materials.md` | when a picture needs pencil lines, hatching, halftone, stipple or torn paper |
| `references/riso.md` | when the look is a risograph print: spot inks, overprint, misregistration, grain and dots |
| `references/pixel.md` | when the look is pixel art: the grid, the palette, drawings from rows of characters, moving by whole cells |
| `references/text.md` | when text goes on a canvas: handwriting, words appearing one by one, text along a curve |
| `references/templates.md` | when the film needs one device throughout: objects assembling a glyph, a page turn or a book opening, a lens montage, an arc match cut |
| `references/brand.md` | when the film is about a product or a brand, and before using a font file the user supplies |
| `references/photo.md` | before searching for images, and before putting a photo, plate or map in a film |
