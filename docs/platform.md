---
summary: 'Supported systems and hosts, what was tested on each platform, the sandbox signature table, GPU findings, measured render speed and memory, determinism of scaled DOM text, Windows status'
read_when:
  - Changing the launch flags or the sandbox signature table in src/engine/browser.ts
  - A user reports that Chromium will not start in a sandbox, the first download fails, or a container cannot run it
  - Considering turning on the GPU or supporting Windows
  - Changing capture, parallel pages, page reopening or encoder settings, to compare speed and memory with before
---

# Platform

English | [中文](platform.zh-CN.md)

## Support matrix

| Platform | Status | Tested |
|---|---|---|
| macOS arm64 | Supported | Directly on the machine, the Claude Code sandbox, the Codex `workspace-write` and `read-only` sandboxes, GPU comparison |
| Linux x64 (Ubuntu 22.04 and 24.04, Debian 12) | Supported | CI (ubuntu-latest) installs from scratch following INSTALL.md and renders hello |
| Linux arm64 | Best effort | Ubuntu 24.04 arm64 container: 13 restricted container setups, the Claude Code sandbox runtime, the Codex Linux sandbox |
| macOS x64 | Best effort | Untested |
| Windows | Not supported, use WSL2 | Native `win32` exits 78. CI has a windows-latest column that runs with `FLIPBOOK_ALLOW_WIN32=1`, see the Windows section below |

| Host | Status |
|---|---|
| Claude Code | Runs inside the sandbox. The first run downloads Chromium and fonts, which the sandbox blocks. On that exit 78 the agent reruns the same command with `dangerouslyDisableSandbox` as the fix says, and the user clicks allow once. Every run after that stays inside the sandbox, with no settings to change and no restart. The allow settings in INSTALL.md step 3e are only for users who want no prompt at all, and Claude Code applies sandbox settings as soon as they are saved |
| Codex | Runs inside the `workspace-write` sandbox on macOS, and the first download works the same way. On Linux, Codex's seccomp filter blocks `shutdown()` on sockets, unix socketpairs included, and Chromium calls it as soon as it starts. flipbook cannot change that: turn on `network_access = true` in the Codex config. `read-only` mode does not allow writing files at all: use `workspace-write` |

## Test environment

Tested on 2026-09-25 with these versions:

- Local machine: Apple M4, macOS 15.3, Node 24.13.0, ffmpeg 8.1.1, playwright-core 1.63.0, Chromium headless shell 153.0.8010.12 (r1243).
- The Bash sandbox of Claude Code 2.1.281 (macOS Seatbelt).
- Codex CLI 0.156.1: commands run directly under `codex sandbox -P :workspace` and `-P :read-only`, then `codex exec` has the model (gpt-6-astra) run doctor, check and render following the skill.
- Docker 29.5.2, image ubuntu:24.04 linux/arm64, Node 22.19.0, ffmpeg 6.1.1. The container also has Claude Code's sandbox runtime `@anthropic-ai/sandbox-runtime` 0.0.77 (bubblewrap plus seccomp) and the linux-arm64 build of Codex CLI 0.156.1.

## Sandbox signature table

`SANDBOX_SIGNATURES` in `src/engine/browser.ts` matches the error from a failed Chromium launch against the rows below in order, and the first match wins. The matching row goes into the report's `detail.signature` and the host into `detail.host` (read from the environment variables `CODEX_SANDBOX` and `SANDBOX_RUNTIME=1`).

| Row | Error text | Seen in | Handling |
|---|---|---|---|
| `temp-dir` | `browserType.launch: EPERM: operation not permitted, mkdtemp '/var/folders/.../T/playwright-artifacts-XXXXXX'` | Codex `read-only` (macOS) | No retry. Exits 78 with `tmp-unwritable`, telling the user to point TMPDIR at a writable directory, or to switch Codex to `workspace-write` |
| | `browserType.launch: EROFS: read-only file system, mkdtemp '/tmp/playwright-artifacts-XXXXXX'` | Codex `read-only` (Linux), containers with a read-only root file system and no writable /tmp | Same |
| | `browserType.launch: ENOENT: no such file or directory, mkdtemp '/tmp/claude/playwright-artifacts-XXXXXX'` | The Claude Code sandbox runtime, when the directory TMPDIR points to does not exist yet | Same |
| `linux-socket-filter` | `FATAL:content/browser/sandbox_host_linux.cc:41] Check failed: . shutdown: Operation not permitted (1)` | The Codex Linux sandbox: without network, its seccomp filter refuses `shutdown` on sockets. Normal and single-process launches fail alike | No retry. Exits 78 with `sandbox-blocked`, telling the user to set `network_access = true` or run outside the sandbox |
| `mach-port` | `FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.<pid>: Permission denied (1100)` | The Claude Code sandbox (macOS), Codex `workspace-write` (macOS). Codex's denial log reads `mach-register org.chromium.Chromium.MachPortRendezvousServer.<pid>` | Retry with `--single-process --no-zygote`, which starts in both hosts. Exits 78 with `sandbox-blocked` only when single-process fails too |
| `operation-not-permitted` | Any other error containing `EPERM` or `Operation not permitted` | Not seen in any known host, a catch-all | Same as `mach-port` |

Not in the table:

- `error while loading shared libraries`: Linux is missing system libraries. Exits 78 with `linux-deps-missing` and gives the `install-deps` command.
- A refused first download: `getaddrinfo ENOTFOUND cdn.playwright.dev` (Codex without network), `server returned code 403 body 'Connection blocked by network allowlist'` (the Claude Code sandbox proxy). Exits 78 with `chromium-install-failed` and `detail.signature` set to `network-blocked`, telling the user to run once outside the sandbox or open the network.
- An unwritable cache: `cache-unwritable`, probed before anything is written.

## Per-host results

### Claude Code

- macOS sandbox: the normal launch hits `mach-port`, single-process starts.
- Linux sandbox runtime (bubblewrap plus seccomp in a container, nested with `enableWeakerNestedSandbox`, and the full mode also tested under `--privileged`): Unix sockets really are blocked (`listen EPERM`) and the network really goes only through the proxy, yet Chromium starts in normal mode. check exits 0, render exits 0 (about 24 frames per second).
- First download: with the cache directory outside `allowWrite` it exits `cache-unwritable`. With the cache directory added to `sandbox.filesystem.allowWrite`, and `cdn.playwright.dev`, `storage.googleapis.com`, `github.com` and `*.githubusercontent.com` added to `sandbox.network.allowedDomains`, a cold check installs inside the sandbox in 23 seconds and exits 0. Chromium redirects from `cdn.playwright.dev` to `storage.googleapis.com` with a 307, LXGW WenKai from `github.com` to `release-assets.githubusercontent.com` with a 302. The ffmpeg Playwright fetches for itself comes from `playwright.download.prss.microsoft.com`. Blocking it does not affect the install, because flipbook uses the system ffmpeg.

### Codex (macOS)

- Skill loading: the skill list rendered by `codex debug prompt-input` includes flipbook, with `compatibility` either at the top level or under `metadata`. Codex's own skill validator (`quick_validate.py` from skill-creator) accepts only `name`, `description`, `license`, `allowed-tools` and `metadata`. It rejects a top-level `compatibility` and passes once it moves under `metadata`.
- `workspace-write` (the default, no network): doctor exits 0 with `launch.mode` set to `single-process`. check exits 0, render exits 0, capturing about 28 frames per second. Having the model run the same three commands through `codex exec` following the skill gives the same result, and the video is byte-for-byte identical to the one from running them directly.
- In this mode `~/Library/Caches/liustack/flipbook` is not writable (EPERM) and the network is down (ENOTFOUND). A cold start exits `cache-unwritable` with the default cache, and `chromium-install-failed` once the cache points at a writable directory.
- With `writable_roots = [cache directory]` and `network_access = true` under `[sandbox_workspace_write]` in `~/.codex/config.toml`, a cold check installs inside the sandbox in 40 seconds and exits 0 (Chromium 198 MB, fonts 49 MB).
- `read-only`: Playwright fails to create its temp directory, which hits `temp-dir`.
- The user's own execpolicy rules can block the launcher. On the test machine a rule in `~/.codex/rules/` sets `bash` to `prompt`, together with `approval_policy = "never"`, so `bash .../run.sh` is refused outright (`approval required by policy, but AskForApproval is set to Never`). That is not Codex's default behavior and goes away with a clean `CODEX_HOME`. The manual fallback order in SKILL.md (flipbook on PATH, npx, bunx) gets around it.

### Codex (Linux)

Run in a container with `codex sandbox -P :workspace` (the container needs seccomp and apparmor relaxed so bubblewrap can create namespaces):

- No network by default: normal and single-process launches both hit `linux-socket-filter`, and check and render exit 78.
- Network turned on through a permission profile (`permissions.<name>.network.enabled = true`): Chromium starts in normal mode, check and render exit 0.
- The built-in `-P :workspace` profile does not read the older `sandbox_workspace_write.network_access`. Whether `network_access = true` removes the filter the same way when `codex exec` runs on the older config is untested on Linux (no Codex login in the container). On macOS it was confirmed to open the network.

## Restricted Linux containers

ubuntu:24.04 arm64. Every row except the first runs as a non-root user (uid 1000) with the cache installed beforehand, and runs `flipbook check` on hello.

| Limit | Result |
|---|---|
| root, Docker defaults | Exits 0, normal mode |
| Non-root | Exits 0, normal mode |
| Installed cache made read-only | Exits 0 |
| Empty cache, `~/.cache` read-only | Exits 78 `cache-unwritable` |
| HOME pointing at a directory that does not exist | Exits 78 `cache-unwritable` |
| No /dev/shm (`--ipc=none`) | Exits 0, Playwright passes `--disable-dev-shm-usage` by default |
| /dev/shm of only 1 MB | Exits 0 |
| `--cap-drop ALL`, `no-new-privileges` | Exits 0 |
| Read-only root file system, only the working directory writable | Exits 78 `tmp-unwritable`, hits `temp-dir` (EROFS) |
| Read-only root file system with a writable /tmp mounted | Exits 0 |
| No network, empty cache | Exits 78 `chromium-install-failed` |
| Process limit 48, 64, 96 | Unstable: Playwright throws `Assertion error` and exits 1, or Node exits 13, or Chromium gets SIGABRT and exits 78 `browser-launch-failed` |
| Process limit 128, 192 | Exits 0 all three times |
| Memory 256 MB, 512 MB | check is killed by OOM, exits 137, no report |
| Memory 768 MB | check exits 0, render exits 1 |
| Memory 1 GB | check exits 0. One render had its renderer killed and reported `page-error` (The page crashed) plus `glitch`, exiting 1. In another, ffmpeg was killed and then hung for more than ten minutes without exiting |
| Memory 2 GB | check and render both exit 0 |

With too few processes or too little memory the errors vary too much to become one signature row, so they are not in the table. Plan on at least 2 GB of memory and 128 processes for 1080p rendering.

A kill in the middle of a render is recognized now: a renderer ending with a CDP termination status (`killed`, `oom`, `failed to launch`, `evicted for memory`), the whole browser exiting, or ffmpeg getting SIGKILL all report 78 `resource-exhausted`, no longer `page-error` or `glitch`. After ffmpeg is killed, sending frames and finishing fail right away instead of hanging. Too few processes at launch still report whatever each failure reports. Single-process mode has no exit signal from the browser, so a page that crashes the whole process also reports `resource-exhausted`.

Single-process mode on Linux arm64: flipbook's own frame capture works (forced into single-process with a wrapper script, check and render exit 0 at about 13 frames per second), but Playwright's `page.screenshot` often fails with `Unable to capture screenshot` in this mode. flipbook only ends up here when Linux really hits a signature that single-process gets around, and none of the Linux sandboxes tested so far do.

## GPU

The question: on macOS, with `--use-angle=metal --enable-gpu` added for 2D compositions, do two renders on the same machine still give identical raw frames?

Method: in a copy of the packed CLI, add those two flags to the launch arguments and write every frame's PNG to disk. Render four compositions twice with software raster and twice with the GPU, and stress six times each. The default launch arguments stayed unchanged.

First, confirm the GPU is really on: CDP `SystemInfo.getInfo` shows SwiftShader by default (`2d_canvas: unavailable_software`). With the flags it shows `2d_canvas: enabled`, `rasterization: enabled` and `skia_graphite: enabled_on`, and the renderer is `ANGLE Metal Renderer: Apple M4`.

| Composition | Frames | Software raster, two runs | GPU, two runs | PSNR, software against GPU |
|---|---|---|---|---|
| examples/hello (canvas square plus DOM text) | 120 | Identical | Identical | Every frame differs, lowest 60.17 dB, mean 62.07 dB |
| test/fixtures/color (solid color blocks) | 24 | Identical | Identical | Exactly the same |
| test/fixtures/music | 24 | Identical | Identical | Every frame differs, lowest 51.40 dB, mean 52.39 dB |
| stress (canvas gradients, shadow blur, transparency, multiply blending, Bézier curves, DOM rounded-corner shadows and text shadows) | 120 | All six identical | Runs 2 to 6 against run 1: 20, 21, 120, 43 and 43 frames differ | Lowest 48.52 dB, mean 49.02 dB |

The GPU runs of stress differ from each other only slightly: at most 2 gray levels, PSNR no lower than 91.84 dB. But the raw frame hashes no longer match.

Speed: six stress renders took 11.6 to 23.3 seconds each with software raster and 9.7 to 19.1 seconds with the GPU. hello took 7.9 and 9.3 seconds with software raster and 8.9 seconds with the GPU. These totals include encoding and acceptance, and show no clear advantage for the GPU.

Conclusion: 2D compositions stay on software raster. Under Metal, canvas content with shadows, blur and blending does not render frame-identical twice on the same machine, so it cannot pass the A-level raw frame hash gate. Turning on the GPU for 2D later would mean switching the determinism check from hashes to PSNR (for example at least 90 dB). 3D compositions are accepted by PSNR by design and are not affected. Whether single-process mode inside a sandbox can use Metal is untested. Codex's denial log contains `iokit-open-user-client AGXDeviceUserClient`, so most likely it cannot.

## Render performance

Measured on 2026-09-25 on the local machine: Apple M4 (4 performance cores and 6 efficiency cores), 16 GB of memory, macOS 15.3, Node 24.13.0, ffmpeg 8.1.1, Chromium headless shell 153.0.8010.12, normal launch mode. Other agents were running tests and renders on the same machine at the time, so the load kept jumping between 3 and 25 (on a 10-core machine a load of 10 is roughly full), with 15 GB of memory in use and 5 GB compressed. Each row gives the 1-minute load when it started, and a case measured twice lists both runs. Compare numbers only within one table. An idle machine is quite a bit faster.

### Capture format

Capture only, no encoding, eggs-five/five (textured beige paper, 1920×1080), one page seeking in order, averaged over 48 frames, load 6.7 to 7.2. This table was measured before `--disable-frame-rate-limit`, which does not affect the comparison between formats.

| Method | Frames/s | KB per frame | PSNR against PNG |
|---|---|---|---|
| PNG, `optimizeForSpeed` (what it already used) | 12.0 | 2967 | Lossless |
| PNG, default compression | 2.7 | 2404 | Lossless |
| WebP quality 100 (lossless in practice) | 1.3 | 1865 | Lossless |
| JPEG quality 90 | 29.8 | 313 | Lowest 41.9 dB, mean 43.3 dB |
| JPEG quality 95 | 25.7 | 484 | Lowest 44.0 dB, mean 45.0 dB |
| JPEG quality 98 | 24.0 | 742 | Lowest 46.2 dB, mean 47.1 dB |
| JPEG quality 100 | 23.3 | 1084 | Lowest 47.6 dB, mean 48.4 dB |
| `Page.startScreencast`, PNG | 14.0 | | |
| `Page.startScreencast`, JPEG quality 100 | 29.2 | | |
| One browser with 2 or 4 pages capturing PNG in parallel | 13.3, 15.6 | | |
| 2 or 4 browsers with one page each capturing PNG in parallel | 23.1, 39.8 | | |

- PNG encoding is why textured paper is slow: JPEG of the same picture is twice as fast. Each PNG frame is about 3 MB against 6 MB of raw 1920×1080 RGB, because the texture barely compresses.
- A lower PNG compression level is not available: CDP's `Page.captureScreenshot` takes only `format`, `quality`, `clip`, `fromSurface`, `captureBeyondViewport` and `optimizeForSpeed`, and `optimizeForSpeed` is already the fastest setting (default compression is 4.5 times slower).
- WebP quality 100 decodes to the same pixels as PNG, but encodes 9 times slower.
- JPEG quality 100 reaches only 49.4 dB even when compared after conversion to the video's yuv420p, short of 50 dB. The video itself (x264 crf 18) averages 50.7 dB against the captured frames, 47.7 dB at the lowest, and JPEG would add another layer of loss on top.
- Screencasting (startScreencast) with PNG is no faster than screenshots, and it sends no frame when the picture does not change, which would need a timeout as a fallback.
- More pages in one browser barely help, because the browser queues screenshots. Only more browsers scale with the page count.

Conclusion: the capture format stays PNG with `optimizeForSpeed`. The speed comes from two things: the launch flag `--disable-frame-rate-limit`, and more browsers in parallel.

### The 60 Hz frame limit

By default Chromium produces frames at 60 Hz and a screenshot waits for the next tick, which holds simple pictures at about 30 frames per second on one page. With `--disable-frame-rate-limit` (capture only, no encoding, 96 frames, load 2.6 to 2.7):

| Composition | Before | With the flag | Frame hashes |
|---|---|---|---|
| hello | 29.7 | 56.9 | Unchanged |
| eggs-five/five | 11.8 | 13.6 | Unchanged |

The same flag also fixed two renders disagreeing when DOM text scales frame by frame, see "DOM text scaled frame by frame" below.

### Page count

Capture only, no encoding, eggs-five/five, 192 frames, one browser per page, with `--disable-frame-rate-limit`, load 2.5 to 3.7:

| Pages | 1 | 2 | 3 | 4 | 6 | 8 | 9 |
|---|---|---|---|---|---|---|---|
| Frames/s | 13.6 | 26.2 | 35.5 | 43.2 | 50.8 | 49.4 | 54.9 |

For every page count the frame hashes match the single-page run.

### Whole renders

`flipbook render` from start to finish, encoding and acceptance included. "v0.3" is the engine before these changes (one page, 60 Hz limit). "One page", "auto" and "4 pages" are the current engine, where "auto" works out the page count from the CPU core count minus one, memory and the video's length. The 30-second video is long-scroll cut to 30 seconds (15 bars). "Plain paper" uses `paperLayer({ grain: 0 })`, "textured paper" the default paper with `grainLayer()` on top. Each cell gives capture frames per second and total time for both runs, with the load at the start in brackets.

| Video | v0.3, one page | One page | Auto | 4 pages |
|---|---|---|---|---|
| hello, 5 s, 120 frames | 22.8, 22.7 frames/s, 7.5, 7.8 s (7, 7) | 32.1, 32.1 frames/s, 5.2, 5.4 s (4, 3) | 2 pages, 37.7, 39.2 frames/s, 4.9, 4.9 s (4, 6) | Not measured |
| eggs-five/five, 8 s, 192 frames | 6.5, 5.2 frames/s, 34.3, 42.4 s (7, 7) | 9.7, 10.0 frames/s, 22.3, 21.9 s (5, 5) | 4 pages, 16.7, 15.6 frames/s, 14.1, 15.0 s (4, 5) | Not measured |
| 30 s plain paper, 720 frames | 17.1, 16.8 frames/s, 52.3, 53.0 s (9, 7) | 25.1, 24.7 frames/s, 35.0, 35.7 s (7, 6) | 9 pages, 30.3, 29.2 frames/s, 30.9, 33.6 s (7, 11) | 29.3, 31.2 frames/s, 31.8, 30.1 s (17, 17) |
| 30 s textured paper, 720 frames | 6.5, 8.1 frames/s, 122.7, 100.3 s (9, 5) | 8.6, 8.9 frames/s, 94.5, 91.3 s (22, 8) | 9 pages, 14.0, 16.2 frames/s, 67.0, 57.0 s (5, 16) | 15.6, 15.5 frames/s, 58.1, 58.8 s (18, 19) |

The second v0.3 run of eggs-five/five overlapped a round of unit tests and is slow. In every cell the frame hashes match the single-page render of the same video.

- The target of 30 seconds of 1080p24 within 60 seconds: plain paper meets it at 30 to 36 seconds. Textured paper takes 57 to 67 seconds under a load of 5 to 19, which also counts as meeting it. That was measured under high load, and an idle machine is faster.
- Encoding takes a big share: for the same 30-second plain-paper video, replacing ffmpeg with a pipe that only reads gives 36, 54 and 50 frames per second on 1, 4 and 9 pages, against 23, 34 and 31 with real encoding (load 8 to 15). x264 medium spends 55 seconds of CPU time on this video (76 milliseconds per frame), `faster` 48 seconds and `veryfast` 35 seconds, but PSNR drops from 50.4 dB to 49.3 dB and 47.6 dB, and the `veryfast` file is 70% larger. The encoder settings stayed as they were.
- When other processes fill the machine, the automatic 9 pages are about as fast as 4, and more pages only fight over the CPU.

### Frame sizes

hello and eggs-five, check first, then render with the automatic page count (2 pages for hello's 120 frames, 4 for eggs-five's 192). Each cell gives capture frames per second and total time, with the load at the start in brackets. All passed acceptance.

| Video | 16:9, 1920×1080 | 9:16, 1080×1920 | 1:1, 1080×1080 | 4:5, 1080×1350 | `--scale 2`, 3840×2160 |
|---|---|---|---|---|---|
| hello | 39.9, 4.6 s (11) | 40.0, 4.8 s (11) | 54.0, 3.5 s (10) | 48.9, 3.9 s (10) | 12.5, 13.0 s (9). 7.0, 29.7 s (13) |
| eggs-five/five | 14.2, 16.2 s (8) | 15.1, 15.5 s (13) | 25.6, 9.6 s (12) | 20.9, 11.5 s (11) | 4.7, 47.4 s (10). 2.8, 77.9 s (16). 2.1, 99.2 s (17) |
| eggs-five/shu | 16.1, 14.5 s (15) | 16.6, 14.2 s (13) | 25.2, 10.0 s (12) | 21.2, 13.2 s (13) | 1.6, 140.3 s (13). 3.1, 70.6 s (13). 3.6, 64.9 s (24) |

- Portrait has as many pixels as landscape and runs about as fast. 1:1 and 4:5 have fewer pixels and run faster.
- 4K has 4 times the pixels of 1080p. A textured-paper PNG frame is about 10 MB, and eggs-five runs at 2 to 5 frames per second. 4K was measured two or three times, and the same video varied by a factor of two. Under high load the machine was also short of memory, so the speed mostly depends on what else is running. At 4K the per-page memory estimate grows, and on a 16 GB machine the memory limit works out to 7 pages, while these two videos get only 4 pages because of their length.
- At 4K the egg outlines and stippling are drawn at twice the pixels, not scaled up from 1080p: `setupCanvas` sizes the backing store by `devicePixelRatio`, and the screenshot takes device pixels, pixel for pixel the same as Playwright's `screenshot({ scale: 'device' })`.
- A trap: after Chromium captures a screenshot with `clip`, it restores the device metrics to whatever the CDP session that asked for the screenshot had set. flipbook captures through its own session, which had set none, so after one clipped screenshot (`snapshot --zoom`) the page's `devicePixelRatio` fell back to 1 and `screen` became 800×600. Now the page also sets the same device metrics on its own session when it opens, full frames are captured without `clip`, and `test/size.test.ts` checks the metrics and the pixels of the next frame after a zoom.

### Memory for a three-minute video

examples/long-scroll (3 minutes, 4320 frames, 1920×1080). During the render, the physical footprint of every process in the render's process tree was read once per second (macOS `phys_footprint`, which counts compressed memory too). The first round measured RSS, but the leaking video fills its array with the same number, macOS compresses it away and RSS barely grows, so the measure was switched. The "leaking video" is long-scroll pushing 50,000 different floats into a global array on every seek (about 400 KB of heap per frame, with the picture unchanged), to see whether reopening pages works.

The Chromium column shows 6 readings taken evenly through the capture (MB, all Chromium processes together), and "peak total" includes Node and ffmpeg. ffmpeg stayed at 780 to 865 MB throughout.

| Method | Chromium readings | Chromium range | Peak total | Reopens | Frames/s, total time (load) |
|---|---|---|---|---|---|
| One page, default reopening | 356 → 358 → 350 → 347 → 359 → 361 | 321 to 363 | 1321 | 1 (at 2400 frames) | 28.5, 177 s (17) |
| One page, `--recycle 0` | 357 → 358 → 351 → 355 → 356 → 333 | 323 to 365 | 1345 | 0 | 28.4, 178 s (6) |
| Auto, 9 pages | 2884 → 3164 → 3161 → 3076 → 3054 → 3096 | 2884 to 3189 | 4218 | 0 | 38.4, 140 s (9) |
| Leaking video, one page, `--recycle 0` | 422 → 781 → 1081 → 1366 → 1745 → 2101 | 422 to 2101 | 3112 | 0 | 25.8, 194 s (7) |
| Leaking video, one page, default reopening | 313 → 732 → 454 → 767 → 566 → 367 | 103 to 977 | 1976 | 3 (heap past the line) | 14.4, 339 s (30) |
| Leaking video, auto 9 pages, a 256 MB line per page (since changed) | 2854 → 3657 → 3819 → 4155 → 4659 → 4978 | 2854 to 5000 | 6151 | 0 | 18.8, 295 s (6) |
| Leaking video, auto 9 pages, now | 2862 → 3761 → 4026 → 3275 → 3708 → 4044 | 1484 to 4051 | 5115 | 17 (heap past the line) | 24.4, 245 s (19) |

- long-scroll itself does not leak: one page stays at 320 to 365 MB from start to finish, 9 pages at 2.9 to 3.2 GB, both flat. The default rule reopens once at 2400 frames, with the same memory as not reopening.
- A leaking video without reopening climbs all the way to 2.1 GB. Under the default rule one page reopens 3 times and the sawtooth stays under 1 GB.
- With 9 pages in parallel each page draws only about 480 frames. The old 256 MB line per page was never reached, and the 9 pages together grew by 2.1 GB. Now the line is 512 MB for all pages together, 64 MB per page when split, and the pages reopen 17 times, with readings moving between 3.3 and 4.1 GB.
- With 9 pages in parallel Chromium takes about 3 GB, 4.2 GB in total with ffmpeg and Node. The per-page memory estimate (300 MB plus 24 output frames) is 0.5 GB at 1080p, so going by half of 16 GB the machine could open 16 pages. In practice the CPU core count minus one holds it at 9.

### Parallel pages in a sandbox

In the Claude Code sandbox Chromium runs in single-process mode, with one browser per page. hello, check first, then `render --jobs 3`: 3 pages, frame hashes the same as in normal mode, and the video passes acceptance (load above 20, 9.5 frames per second).

## DOM text scaled frame by frame

The problem: the first version of beat-title changed `rotate()` and a non-uniform `scale()` on DOM text every frame, and two renders on the same machine had 9 to 14 of 288 frames with different hashes, which check did not catch. At the time it was blamed on the glyph cache, and rules.md got a rule forbidding per-frame `scale` changes on DOM text.

Reproduction: `test/fixtures/bad/dom-scale-drift` is a trimmed version of that passage (1920×1080, 115 frames, three characters squashing and bouncing back as they land). With the launch arguments before `--disable-frame-rate-limit` (2026-09-25, Apple M4, load 3 to 8):

| Method | Result |
|---|---|
| Two captures in a row after each seek on the same page | In three runs, 7, 14 and 8 frames differed between the two. A third capture (50 milliseconds later) matched the second |
| The combined hash of each run's first captures | Three runs, three values |
| The combined hash of each run's second captures | The same in all three runs |
| Single-process mode | The same happens |
| With `--disable-frame-rate-limit` | Eight processes running at once (load 21): first and second captures identical on every frame, all eight combined hashes identical, and equal to the "second captures" above |

Root cause: the screenshot races the compositor's repaint, and the glyph cache has nothing to do with it. By default Chromium produces frames at 60 Hz, and `Page.captureScreenshot` takes the next frame the compositor produces after the seek. When the text's transform changes, the compositor has to rasterize that text layer again at the new scale. On the 60 Hz tick, the frame a screenshot gets sometimes does not have the layer redrawn yet, and only the frame after it is right. Which frames get caught depends on the timing of the moment, so the same frame can differ between two renders. The finished pixels themselves are deterministic, as the three identical "second captures" in the table show. check's two captures in a row (`late-paint`) only look at the 8 sampled frames, and that run did not sample the frames that went wrong.

The fix: the launch flag `--disable-frame-rate-limit`. The compositor no longer waits for the 60 Hz tick, and the first frame a screenshot gets is already finished. `test/domScale.test.ts` pins two things: two captures in a row match on every frame, and two independent renders match on every frame. Without the flag both tests fail. The rule in rules.md and SKILL.md is gone, and DOM text may scale and rotate frame by frame.

## Windows

Native Windows is not supported: `win32` exits 78 and points to WSL2. Setting `FLIPBOOK_ALLOW_WIN32=1` bypasses that, for CI.

Done so far:

- The cache lives in `%LOCALAPPDATA%\liustack\flipbook`, or in `%USERPROFILE%\AppData\Local` when that variable is missing.
- `chrome-headless-shell-win64\chrome-headless-shell.exe` is recognized. playwright-core has no headless shell for Windows arm64.
- When Chromium is missing, the install command is given in PowerShell form (`$env:PLAYWRIGHT_BROWSERS_PATH="..."; npx ...`).
- The child process that installs Chromium runs with `windowsHide`.
- CI has a windows-latest column that runs every test like the other columns, with no allowed-to-fail group. The run.sh tests run under Git for Windows' sh, the same as in Git Bash. The encoder tests fake ffmpeg with a Node script. The eval workspace gets an extra `flipbook.cmd` shim on Windows. Four tests are skipped on Windows, each with its reason: the two encoder tests where the system kills a process (Windows has no signals, and flipbook recognizes a system kill by SIGKILL), and the two page tests that make an undeletable directory with chmod (Windows does not govern directories by permission bits). The chrome://kill test flaked on both columns: running alongside other tests, Chromium takes anywhere from 5 milliseconds to 16 seconds to notice the renderer is gone, longer than close() waits, so this test now waits for the crash report before closing the page.
- First run (2026-09-25, one column each for Node 22.19 and 24): all 22 files in the must-pass group passed. In the allowed-to-fail group, corpus, doctor, references and render passed too, so Windows can render videos. What failed: encode (the sh fake ffmpeg, `/bin/sleep` and `pgrep` do not start on Windows), launcher (run.sh in Git Bash cannot call the fake flipbook, npx and bunx), eval (the eval script's sh shim), and the two page tests that make an undeletable directory with chmod (Windows ignores that permission, and render and snapshot succeed as usual). Both columns also saw close() fail to report resource-exhausted after `chrome://kill`.

run.ps1 was checked against the pitfalls a launcher usually hits on Windows, one by one:

| Pitfall | run.ps1 |
|---|---|
| `.cmd` shims | Node spawning a `.cmd` directly fails with EINVAL, PowerShell's `&` does not. It now looks only for executables and `.cmd` (`Get-Command -CommandType Application`) and never the `.ps1` shim npm installs alongside, so the execution policy cannot block it |
| PATH case | run.ps1 builds no environment variables itself, and PowerShell's `$env:PATH` is case-insensitive anyway. Tests that change PATH first delete any existing PATH key, whatever its case |
| Console window flashes | run.ps1's child processes share PowerShell's console and open no window of their own |
| Passing the exit code through | One fix: Windows PowerShell 5.1 under `$ErrorActionPreference = 'Stop'` treats redirected stderr as a terminating error, so `doctor --json` lost its 78 and exited 0 whenever the CLI wrote a diagnosis to stderr. Native commands now run in a `Continue` scope, and the exit code comes from `$LASTEXITCODE` |
| Encoding | One fix: 5.1 decoded the CLI's UTF-8 output with the console code page, which garbled Chinese in the report. The console encoding is now set to UTF-8 first |

`test/launcherPs1.test.ts` runs these cases on every PowerShell it can find. The old contract passed on PowerShell 7.4 (Linux container). run.ps1 later caught up with run.sh's new contract (`fix`, `launcher`, doctor always printing JSON, prereleases accepting only the pinned version), and the new version passed on CI's windows-latest, once each on Windows PowerShell 5.1 and PowerShell 7.

Of the Windows problems listed in code review, the first four are fixed:

- `findOnPath` adds `.exe` to program names on win32 and treats the PATH key case-insensitively, so doctor, check and render find `ffmpeg.exe`.
- Every place that starts ffmpeg (`proc.ts`, `encode.ts`, `pixels.ts`) passes `windowsHide: true`, so hosts without a console no longer flash a black window.
- `test/globalSetup.ts` runs `pnpm build` through a shell, so it can start `pnpm.cmd` on Windows.
- `test/doctor.test.ts` deletes the PATH key in any case before replacing PATH, asserts install commands per platform, and skips the cases that depend on directory write permission on Windows.

Still open: on Windows, Node 24.0 to 24.13 crashes in `fs.rmSync` on non-ASCII paths (nodejs/node#58759, fixed in 24.13.1), and non-ASCII user names are common among Chinese users. Supporting Windows needs a Node floor that avoids that range.
