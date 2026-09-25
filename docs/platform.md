---
summary: 'Supported systems and hosts, what was tested on each platform, the sandbox signature table, GPU findings, Windows status'
read_when:
  - Changing the launch flags or the sandbox signature table in src/engine/browser.ts
  - A user reports that Chromium will not start in a sandbox, the first download fails, or a container cannot run it
  - Considering turning on the GPU or supporting Windows
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
