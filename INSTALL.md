# Installing flipbook (for an AI agent)

English | [中文](INSTALL.zh-CN.md)

You are an AI agent and your user asked you to install `flipbook`. This file is the procedure. Follow it in order. Every step is safe to run again, and every step says what to do when it fails. Commands are POSIX shell for macOS or Linux. On Windows, do all of this inside WSL2 (Ubuntu).

The whole install is four steps:

1. Find the skill directory for your harness.
2. Put the `skills/flipbook` folder into it.
3. Prepare the machine: Node, ffmpeg, memory and processes, the first download, the sandbox.
4. Verify with `doctor` and a 5-second test render.

---

## Step 1: Find the skill directory

| Harness | Skill directory (`TARGET`) |
| :-- | :-- |
| Claude Code | `~/.claude/skills/` |
| Codex | `~/.codex/skills/` |
| Pi, OpenCode | `~/.agents/skills/` |

Install into this global directory so the skill works in every project. If you cannot tell which harness you are in, see which config directory exists:

```bash
ls -d ~/.claude ~/.codex ~/.agents 2>/dev/null
```

Create the directory:

```bash
mkdir -p ~/.claude/skills   # replace with your TARGET
```

**If it fails:** a permission error means the path is not under the user's home directory. Check `echo $HOME` and the path.

---

## Step 2: Put `skills/flipbook` into the skill directory

The skill is the `skills/flipbook` folder of the repository: `SKILL.md`, `references/` and `scripts/` with the launcher. Copy the whole folder. Keep the clone: step 4 renders an example from it.

### Path A: clone and copy

```bash
rm -rf /tmp/flipbook-src
git clone --depth 1 --branch v0.5.1 https://github.com/liustack/flipbook.git /tmp/flipbook-src
mkdir -p ~/.claude/skills/flipbook          # replace with your TARGET
cp -R /tmp/flipbook-src/skills/flipbook/. ~/.claude/skills/flipbook/
```

Running it again overwrites the earlier copy in place.

**If it fails:**
- `git: command not found`: install git, or use Path B and still clone the repository for step 4.
- The clone cannot reach GitHub: check the network or `HTTPS_PROXY`, then retry.
- Confirm the files landed:
  ```bash
  ls ~/.claude/skills/flipbook/SKILL.md ~/.claude/skills/flipbook/scripts/run.sh ~/.claude/skills/flipbook/references
  ```

### Path B: the skills CLI (third party)

Claude Code:

```bash
npx -y skills add liustack/flipbook#v0.5.1 --skill flipbook --global --agent claude-code -y
```

Codex:

```bash
npx -y skills add liustack/flipbook#v0.5.1 --skill flipbook --global --agent codex -y
```

`--agent` names the harness and `-y` answers the confirmation prompts, so the command runs to the end without waiting for input. For Codex the skills CLI puts the folder in `~/.agents/skills/flipbook`, which Codex reads too: use `~/.agents/skills/` as `TARGET` from here on. For other harnesses, use Path A.

**If it fails**, or the folder does not appear under your `TARGET`, use Path A.

---

## Step 3: Prepare the machine

### 3a. Node 22.19 or newer

```bash
node --version
```

Below v22.19, or `command not found`: install Node 22 LTS or newer from https://nodejs.org (or the user's version manager). The launcher finds the CLI through `npx`, so nothing else from npm has to be installed. Optional, to skip the npx download on every run: `npm install -g @liustack/flipbook@0.5.1`.

### 3b. ffmpeg with libx264

```bash
ffmpeg -hide_banner -encoders 2>/dev/null | grep libx264
```

No output means ffmpeg is missing or lacks libx264:

- macOS: `brew install ffmpeg`
- Debian or Ubuntu: `sudo apt-get update && sudo apt-get install -y ffmpeg`

### 3c. Memory and processes

Rendering at 1920×1080 needs at least 2 GB of memory and room for 128 processes for the user. Desktops have that. In a container, give it `--memory 2g --pids-limit 128` or more. Below that the system kills Chromium or ffmpeg halfway, and flipbook exits 78 with `resource-exhausted`.

### 3d. First download (Chromium and fonts)

The first `check` or `render` downloads the pinned Chromium headless shell (about 95 MB) and two fonts (about 50 MB) into the user cache: `~/Library/Caches/liustack/flipbook` on macOS, `${XDG_CACHE_HOME:-~/.cache}/liustack/flipbook` on Linux. Step 4 triggers it. `doctor` never downloads anything.

A firewall, proxy or sandbox allowlist must let these four hosts through for the first download:

- `cdn.playwright.dev` (Chromium)
- `storage.googleapis.com` (where the Chromium download redirects)
- `github.com` (fonts)
- `*.githubusercontent.com` (fonts, and where GitHub release downloads redirect)

When GitHub cannot be reached, the fonts are tried once more through the `ghfast.top` mirror (same files, checked by SHA-256). `FLIPBOOK_FONT_BASE_URL` points font downloads at a mirror of your own.

On Linux, Chromium needs system libraries (on Ubuntu 24.04 with ffmpeg already installed, the first missing ones are `libnspr4` and `libnss3`). When a command exits 78 with `linux-deps-missing`, run the command from its `fix`. It needs sudo, or drop `sudo` when you are root. On Ubuntu 24.04 it installs about 26 packages (105 MB, including Xvfb and fonts):

```bash
sudo npx --yes playwright-core@1.63.0 install-deps chromium-headless-shell
```

### 3e. Host sandbox

Claude Code and Codex run commands in a sandbox. Chromium starts inside the Claude Code sandbox and the Codex `workspace-write` sandbox on its own: when the normal start is refused, flipbook retries in single-process mode. The only thing the sandbox blocks is the first download, which writes the cache and needs the network. When a command exits 78 with `cache-unwritable` or `chromium-install-failed`, run that same command again outside the sandbox: the user gets one confirmation and allows it. After that every run stays inside the sandbox, with no settings to change and no restart.

Codex needs more in two cases:

- **Codex on Linux:** add `network_access = true` to `~/.codex/config.toml`. Codex's Linux sandbox blocks the socket calls Chromium needs to start, so without it every run fails, not only the first (exit 78 with `sandbox-blocked`):

  ```toml
  [sandbox_workspace_write]
  network_access = true
  ```

- **Codex in `read-only` mode:** it does not allow writing files, so flipbook cannot run there (exit 78 with `tmp-unwritable`). Ask the user to switch to `workspace-write`.

#### Optional: skip the one-time confirmation

Only for users who would rather not see that confirmation at all. Claude Code applies sandbox settings as soon as the file is saved, with no restart.

Claude Code, `~/.claude/settings.json`: let the sandbox write the cache and reach the four download hosts from 3d:

```json
{
    "sandbox": {
        "filesystem": { "allowWrite": ["~/Library/Caches/liustack/flipbook"] },
        "network": {
            "allowedDomains": [
                "cdn.playwright.dev",
                "storage.googleapis.com",
                "github.com",
                "*.githubusercontent.com"
            ]
        }
    }
}
```

Or run the launcher outside the sandbox (use the absolute home path):

```json
{
    "sandbox": {
        "excludedCommands": ["bash /Users/<user>/.claude/skills/flipbook/scripts/run.sh"]
    }
}
```

Codex, `~/.codex/config.toml`:

```toml
[sandbox_workspace_write]
writable_roots = ["/Users/<user>/Library/Caches/liustack/flipbook"]
network_access = true
```

On Linux the cache is `~/.cache/liustack/flipbook` for both hosts.

---

## Step 4: Verify

```bash
bash ~/.claude/skills/flipbook/scripts/run.sh doctor   # replace with your TARGET
```

`doctor` prints one JSON object. On a fresh machine it exits 78 with `chromium-missing` in `problems`. That is expected before the first render. For any other problem, relay the lines in its top-level `fix`.

Then render the example (this is the first download from step 3d):

```bash
HELLO="${TMPDIR:-/tmp}/flipbook-hello"
rm -rf "$HELLO" && cp -R /tmp/flipbook-src/examples/hello "$HELLO"
bash ~/.claude/skills/flipbook/scripts/run.sh check "$HELLO"
bash ~/.claude/skills/flipbook/scripts/run.sh render "$HELLO"
bash ~/.claude/skills/flipbook/scripts/run.sh doctor
```

**Success is:**
- `render` exits 0 and its JSON says `"ok": true`.
- `$HELLO/out/video.mp4` exists: 5 seconds, 1920×1080, a red square moving under "你好，翻页书" and "Hello, flipbook".
- The last `doctor` exits 0.

Open `$HELLO/out/contact-sheet.png` to see the frames.

**If it fails:**
- The launcher printed a JSON diagnosis with `"error": "runtime-missing"` and exited 78: no Node or npx was found. Relay `fix` and redo 3a.
- Exit 78 from `check` or `render`: read `error` and `fix` in the JSON on stderr. `cache-unwritable`, `chromium-install-failed`, `sandbox-blocked` and `tmp-unwritable` mean 3e, `linux-deps-missing` means 3d, `ffmpeg-missing` means 3b, `resource-exhausted` means 3c, `font-download-failed` means the network or proxy (see the hosts in 3d, a mirror can be set with `FLIPBOOK_FONT_BASE_URL`).
- Exit 1: the example failed a check on this machine. Send the report JSON to https://github.com/liustack/flipbook/issues.

---

## Done

The skill triggers on its own when the user asks for a video. To free disk space after an upgrade, run `bash ~/.claude/skills/flipbook/scripts/run.sh doctor --prune`.
