---
name: flipbook
description: "Make short animated videos as MP4: motion graphics, explainers, animated titles, data stories, kinetic text, beat-synced clips. You write one HTML composition plus timeline.json, flipbook renders it frame by frame and checks the result before delivery. Use when the user asks for a video, an animation exported to MP4, or a clip built with HTML, CSS, canvas or SVG. Hard rules: the picture is a pure function of t (no CSS animation or transition, timers, requestAnimationFrame, Date.now, performance.now, unseeded Math.random, network), text uses only the fonts \"Noto Serif SC\" and \"LXGW WenKai\" or font files the user supplied with a license, every command runs through this skill's scripts/run.sh, and a video is delivered only after flipbook render exits 0."
metadata:
  compatibility: "Node 22.19+ (or Bun) and ffmpeg with libx264. macOS arm64 or Linux x64, Windows through WSL2. The first check or render downloads Chromium (about 95 MB) and two fonts (about 50 MB)."
---

# flipbook

Use it to turn a video request into a verified MP4. Do not use it for editing real footage, 3D characters, voice-over, or AI-generated video.

## Run it

Every command goes through the launcher next to this file. Replace `<skill-dir>` with the directory this SKILL.md lives in:

```bash
bash <skill-dir>/scripts/run.sh doctor                          # can this machine render?
bash <skill-dir>/scripts/run.sh check <dir>                     # test the composition
bash <skill-dir>/scripts/run.sh snapshot <dir>                  # contact sheet of frames
bash <skill-dir>/scripts/run.sh snapshot <dir> --zoom x,y,w,h --at 3.5
bash <skill-dir>/scripts/run.sh render <dir>                    # MP4 plus acceptance checks
```

`<dir>` is the composition directory. stdout carries one JSON report, progress goes to stderr. Each report is also saved to `<dir>/.flipbook/reports/<command>.json`, whose path is in `artifacts.report`. When the report has `reportSaveError` instead, nothing was saved: the stdout JSON is the report to hand over.

| Exit | Meaning | Do |
|---|---|---|
| 0 | passed | continue |
| 1 | the composition has problems | fix every code in `failures`, see `references/troubleshooting.md` |
| 2 | the command is wrong | fix the command |
| 78 | the machine is missing something | relay the `fix` lines to the user (from the JSON on stderr, or on stdout for `doctor`), leave the composition alone |

If scripts cannot run, use the first line that works (the pinned version is 0.3.0):

1. A `flipbook` on PATH with the same major.minor as the pinned version and not older than it: `flipbook <args>`.
2. `npx --yes --package @liustack/flipbook@0.3.0 flipbook <args>`.
3. `bunx --bun @liustack/flipbook@0.3.0 <args>`.
4. None: tell the user to install Node 22.19+ from https://nodejs.org.

## Sandbox

- Chromium starts inside the Claude Code sandbox and the Codex `workspace-write` sandbox on its own.
- The first check or render downloads Chromium and fonts into `~/Library/Caches/liustack/flipbook` (macOS) or `~/.cache/liustack/flipbook` (Linux). Inside a sandbox this exits 78 with `cache-unwritable` or `chromium-install-failed`: run that one command outside the sandbox after the user approves. Later runs work inside it.
- Lasting settings the user can add instead:
  - Claude Code, `~/.claude/settings.json`: the cache directory in `sandbox.filesystem.allowWrite` plus `cdn.playwright.dev`, `storage.googleapis.com`, `github.com` and `*.githubusercontent.com` in `sandbox.network.allowedDomains`. Or the launcher command in `sandbox.excludedCommands`.
  - Codex, `~/.codex/config.toml` under `[sandbox_workspace_write]`: the cache directory in `writable_roots` and `network_access = true`. Codex on Linux needs `network_access = true` for every run.
- Codex `read-only` cannot run flipbook: ask the user for `workspace-write`.
- Exit 78 with `sandbox-blocked` or `tmp-unwritable`: relay its `fix` lines.

## The six steps

1. **Spec.** Settle size, duration, frame rate, look, text and music. Use the defaults for anything the user did not say. When the request is about a product or a brand, first search the workspace for its assets (logo files, theme color variables, design tokens, color values in the README) and list them for the user to confirm. When none turn up, ask for them instead of guessing. Then write `brand.json` as `references/brand.md` describes.
2. **timeline.json.** Scenes in bars, text and marker cues in beats. Read `references/timeline.md` before writing the first one.
3. **index.html.** One composition that calls `composition({ setup, seek })` from `/__flipbook/runtime.js`. Read `references/rules.md` before writing the first one.
4. **Check and look.** Run `check`, fix every failure, repeat until it exits 0. Then run `snapshot`, open `out/snapshot/contact-sheet.png` and fix what looks wrong. Rerun `check` after every edit.
5. **Render.** Run `render`. Exit 1 means the finished video failed acceptance: fix the codes and go back to step 4.
6. **Deliver.** Open `out/contact-sheet.png`, confirm it shows what the user asked for, then give the user `out/video.mp4` and the contact sheet path.

Defaults:

| Setting | Default |
|---|---|
| size | 1920×1080 (16:9) |
| frame rate | 24 fps |
| duration | about 30 s, within 5% of what the user asked, at most 180 s |
| look | the paper skin: `paperLayer()` and `grainLayer()` from `references/paper.md`, dark ink, one or two accent colors, serif type |
| music | preset `pluck` (`"audio": { "mode": "preset", "preset": "pluck" }`), silent only when the user asks |
| the user's own music | put the file in `assets/`, ask for its bpm and the second where beat 1 falls. The bpm goes in the top-level `bpm`, the rest in `audio`: `"audio": { "mode": "file", "file": "assets/music.mp3", "bpmOffset": 0.42 }` |
| characters, photos | none unless asked |

## Hard rules

- `seek(t)` draws the frame for `t` from `t` alone. No CSS animation or transition, timers, `requestAnimationFrame`, `Date.now()`, `new Date()`, `performance.now()`, `Math.random()`, `crypto` random, state carried between frames, or network. Use `rng(seed)`, `rand(seed, ...)`, `ease`, `cueProgress` and the other runtime helpers.
- `seek(t)` must not await frames, timers or events.
- check samples a few frames under a moved clock and seed and counts clock and random calls. It catches most slips, not all of them: keep these rules even when check passes.
- Size `html` and `body` to the timeline width and height with `overflow: hidden`. Mark paper and grain layers `data-flipbook-layer="paper"`. Draw static layers once in `setup()`.
- Text lives in the DOM or goes through the runtime's `fillText()`. Fonts: `"Noto Serif SC"` or `"LXGW WenKai"`, or font files the user supplied with their license in brand.json or `assets/fonts/` (`references/brand.md`). Keep text inside the frame and away from the outer 5% margin when it settles, with contrast of at least 3:1 (check measures DOM text only: judge canvas text on the contact sheet). Mark deliberate bleeds `data-flipbook-allow-overflow`. Never animate `transform: scale()` on DOM text (two renders of it differ): text that grows or shrinks goes through `fillText()` on a canvas.
- Scenes where the picture stands still for more than 1.5 s need `"hold": true`.
- Images go in `assets/` with their source and license in `assets/SOURCES.json`.
- Never edit `.flipbook/` or `out/`.

## Stopping

- The CLI counts attempts per composition. When a report has `stop: true`, stop: tell the user where it is stuck and give them the contact sheet, the report path and `stopReason`.
- The limits are 3 consecutive runs failing with the same code, 8 check rounds, 3 failed renders.
- `internal-error` is a flipbook bug: stop and give the user the report.

## References

| Read | When |
|---|---|
| `references/rules.md` | before the first index.html, and when a determinism, text or layer code is unclear |
| `references/timeline.md` | before the first timeline.json, and when matching a requested duration |
| `references/audio.md` | before choosing the music or placing sound effects, and when an `audio-*` code appears |
| `references/troubleshooting.md` | whenever check or render exits non-zero |
| `references/paper.md` | before the first index.html, for the paper and grain layers of the default look |
| `references/materials.md` | when a picture needs pencil lines, hatching, halftone, stipple or torn paper |
| `references/text.md` | when text goes on a canvas: handwriting, words appearing one by one, text along a curve |
| `references/templates.md` | when the film needs one device throughout: objects assembling a glyph, a page turn or a book opening, a lens montage, an arc match cut |
| `references/brand.md` | when the film is about a product or a brand, and before using a font file the user supplies |
