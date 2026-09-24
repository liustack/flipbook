# Installing flipbook (for an AI agent)

You are an AI agent and your user asked you to install `flipbook`. This file is the procedure. Follow it in order. Every step is safe to run again, and every step says what to do when it fails. Commands are POSIX shell for macOS or Linux. On Windows, do all of this inside WSL2 (Ubuntu).

The whole install is four steps:

1. Find the skill directory for your harness.
2. Put the `skills/flipbook` folder into it.
3. Prepare the machine: Node, ffmpeg, the first download, the sandbox.
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
git clone --depth 1 --branch v0.1.0 https://github.com/liustack/flipbook.git /tmp/flipbook-src
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

```bash
npx -y skills add liustack/flipbook#v0.1.0 --skill flipbook --global
```

**If it fails**, or the folder does not appear under your `TARGET`, use Path A.

---

## Step 3: Prepare the machine

### 3a. Node 22.19 or newer

```bash
node --version
```

Below v22.19, or `command not found`: install Node 22 LTS or newer from https://nodejs.org (or the user's version manager). The launcher finds the CLI through `npx`, so nothing else from npm has to be installed. Optional, to skip the npx download on every run: `npm install -g @liustack/flipbook@0.1.0`.

### 3b. ffmpeg with libx264

```bash
ffmpeg -hide_banner -encoders 2>/dev/null | grep libx264
```

No output means ffmpeg is missing or lacks libx264:

- macOS: `brew install ffmpeg`
- Debian or Ubuntu: `sudo apt-get update && sudo apt-get install -y ffmpeg`

### 3c. First download (Chromium and fonts)

The first `check` or `render` downloads the pinned Chromium headless shell (about 95 MB) and two fonts (about 50 MB) into the user cache: `~/Library/Caches/liustack/flipbook` on macOS, `${XDG_CACHE_HOME:-~/.cache}/liustack/flipbook` on Linux. Step 4 triggers it. `doctor` never downloads anything.

On Linux, Chromium needs system libraries (on Ubuntu 24.04 with ffmpeg already installed, the first missing ones are `libnspr4` and `libnss3`). When a command exits 78 with `linux-deps-missing`, run the command from its `fix`. It needs sudo, or drop `sudo` when you are root. On Ubuntu 24.04 it installs about 26 packages (105 MB, including Xvfb and fonts):

```bash
sudo npx --yes playwright-core@1.63.0 install-deps chromium-headless-shell
```

### 3d. Host sandbox

Claude Code: Chromium starts inside the sandbox by itself, but the sandbox does not allow writing the cache. The first download therefore has to run outside the sandbox once. When a command exits 78 with `cache-unwritable`, ask the user to approve running that same command outside the sandbox. Later runs work inside it.

To avoid the prompt for good, the user can add one of these to `~/.claude/settings.json` (use the absolute home path):

```json
{
    "sandbox": {
        "filesystem": { "allowWrite": ["/Users/<user>/Library/Caches/liustack/flipbook"] }
    }
}
```

```json
{
    "sandbox": {
        "excludedCommands": ["bash /Users/<user>/.claude/skills/flipbook/scripts/run.sh"]
    }
}
```

Codex: its sandbox has not been tested with flipbook yet. If a command fails with a permission error, run it with the sandbox relaxed for that command and tell the user.

---

## Step 4: Verify

```bash
bash ~/.claude/skills/flipbook/scripts/run.sh doctor   # replace with your TARGET
```

`doctor` prints one JSON object. On a fresh machine it exits 78 with `chromium-missing` in `problems`. That is expected before the first render. For any other problem, relay the lines in its top-level `fix`.

Then render the example (this is the first download from step 3c):

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
- Exit 78 from `check` or `render`: read `error` and `fix` in the JSON on stderr. `cache-unwritable` means 3d, `linux-deps-missing` means 3c, `ffmpeg-missing` means 3b, `font-download-failed` means the network or proxy (a mirror can be set with `FLIPBOOK_FONT_BASE_URL`).
- Exit 1: the example failed a check on this machine. Send the report JSON to https://github.com/liustack/flipbook/issues.

---

## Done

The skill triggers on its own when the user asks for a video. To free disk space after an upgrade, run `bash ~/.claude/skills/flipbook/scripts/run.sh doctor --prune`.
