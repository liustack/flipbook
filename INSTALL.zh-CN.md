# 安装 flipbook（写给 AI agent）

[English](INSTALL.md) | 中文

你是一个 AI agent，用户让你安装 `flipbook`。这份文件就是安装步骤，按顺序做。每一步都可以重跑，每一步都写了失败时怎么办。命令是 macOS 或 Linux 的 POSIX shell。Windows 上所有步骤都在 WSL2（Ubuntu）里做。

整个安装分四步：

1. 找到你所在宿主的 skill 目录。
2. 把 `skills/flipbook` 文件夹放进去。
3. 准备机器：Node、ffmpeg、内存和进程数、首次下载、沙箱。
4. 用 `doctor` 和一次 5 秒的试渲验证。

---

## 第 1 步：找到 skill 目录

| 宿主 | skill 目录（`TARGET`） |
| :-- | :-- |
| Claude Code | `~/.claude/skills/` |
| Codex | `~/.codex/skills/` |
| Pi、OpenCode | `~/.agents/skills/` |

装进这个全局目录，skill 在每个项目里都能用。分不清自己在哪个宿主里，就看哪个配置目录存在：

```bash
ls -d ~/.claude ~/.codex ~/.agents 2>/dev/null
```

建目录：

```bash
mkdir -p ~/.claude/skills   # 换成你的 TARGET
```

**失败时：** 报权限错误说明路径不在用户主目录下。查 `echo $HOME` 和路径。

---

## 第 2 步：把 `skills/flipbook` 放进 skill 目录

skill 就是仓库里的 `skills/flipbook` 文件夹：`SKILL.md`、`references/` 和放启动器的 `scripts/`。整个文件夹拷过去。克隆下来的仓库留着，第 4 步要从里面渲一个例子。

### 路径 A：克隆再拷贝

```bash
rm -rf /tmp/flipbook-src
git clone --depth 1 --branch v0.5.6 https://github.com/liustack/flipbook.git /tmp/flipbook-src
mkdir -p ~/.claude/skills/flipbook          # 换成你的 TARGET
cp -R /tmp/flipbook-src/skills/flipbook/. ~/.claude/skills/flipbook/
```

再跑一次会原地覆盖之前的副本。

**失败时：**
- `git: command not found`：装 git，或者走路径 B，但第 4 步仍要克隆仓库。
- 克隆连不上 GitHub：查网络或 `HTTPS_PROXY`，再试。
- 确认文件到位：
  ```bash
  ls ~/.claude/skills/flipbook/SKILL.md ~/.claude/skills/flipbook/scripts/run.sh ~/.claude/skills/flipbook/references
  ```

### 路径 B：skills CLI（第三方）

Claude Code：

```bash
npx -y skills add liustack/flipbook#v0.5.6 --skill flipbook --global --agent claude-code -y
```

Codex：

```bash
npx -y skills add liustack/flipbook#v0.5.6 --skill flipbook --global --agent codex -y
```

`--agent` 指定宿主，`-y` 替你回答确认提示，命令一路跑完，不停下来等输入。Codex 这条会把文件夹放到 `~/.agents/skills/flipbook`，Codex 也从这里读，后面的 `TARGET` 就用 `~/.agents/skills/`。其他宿主走路径 A。

**失败时**，或者 `TARGET` 下面没出现这个文件夹，走路径 A。

---

## 第 3 步：准备机器

### 3a. Node 22.19 或更新

```bash
node --version
```

低于 v22.19 或者 `command not found`：从 https://nodejs.org（或用户的版本管理器）装 Node 22 LTS 或更新的版本。启动器经 `npx` 找 CLI，npm 上别的东西都不用装。可选，想省掉每次 npx 的下载：`npm install -g @liustack/flipbook@0.5.6`。

### 3b. 带 libx264 的 ffmpeg

```bash
ffmpeg -hide_banner -encoders 2>/dev/null | grep libx264
```

没有输出说明没装 ffmpeg 或者缺 libx264：

- macOS：`brew install ffmpeg`
- Debian 或 Ubuntu：`sudo apt-get update && sudo apt-get install -y ffmpeg`

### 3c. 内存和进程数

按 1920×1080 渲染至少要 2 GB 内存，并允许这个用户开 128 个进程。普通电脑都够。容器里给 `--memory 2g --pids-limit 128` 或更多。低于这个数，系统会在半路杀掉 Chromium 或 ffmpeg，flipbook 退 78 并报 `resource-exhausted`。

### 3d. 首次下载（Chromium 和字体）

第一次 `check` 或 `render` 会把钉死版本的 Chromium headless shell（约 95 MB）和两款字体（约 50 MB）下载到用户缓存：macOS 是 `~/Library/Caches/liustack/flipbook`，Linux 是 `${XDG_CACHE_HOME:-~/.cache}/liustack/flipbook`。第 4 步会触发它。`doctor` 从不下载任何东西。

防火墙、代理或沙箱白名单要为首次下载放行这四个域名：

- `cdn.playwright.dev`（Chromium）
- `storage.googleapis.com`（Chromium 下载会跳转到这里）
- `github.com`（字体）
- `*.githubusercontent.com`（字体，GitHub Release 的下载也会跳转到这里）

连不上 GitHub 时，字体会经 `ghfast.top` 镜像再试一次（同样的文件，按 SHA-256 校验）。`FLIPBOOK_FONT_BASE_URL` 可以把字体下载指到你自己的镜像。

Linux 上 Chromium 需要一些系统库（在已装 ffmpeg 的 Ubuntu 24.04 上，最先缺的是 `libnspr4` 和 `libnss3`）。命令退 78 并报 `linux-deps-missing` 时，运行它 `fix` 里的命令。这条命令要 sudo，是 root 就去掉 `sudo`。在 Ubuntu 24.04 上它会装约 26 个包（105 MB，含 Xvfb 和字体）：

```bash
sudo npx --yes playwright-core@1.63.0 install-deps chromium-headless-shell
```

### 3e. 宿主沙箱

Claude Code 和 Codex 在沙箱里跑命令。Chromium 在 Claude Code 的沙箱和 Codex 的 `workspace-write` 沙箱里自己就能起来：正常启动被拒时，flipbook 会改用单进程模式重试。沙箱唯一挡住的是首次下载，它要写缓存、要联网。命令退 78 并报 `cache-unwritable` 或 `chromium-install-failed` 时，在沙箱外把同一条命令再跑一次：用户会看到一次确认，点允许就行。之后每次都在沙箱里跑，不用改设置，也不用重启。

Codex 有两种情况要多做一步：

- **Linux 上的 Codex：** 在 `~/.codex/config.toml` 里加 `network_access = true`。Codex 的 Linux 沙箱把 Chromium 启动要用的 socket 调用挡了，不加的话每次都起不来，不只是第一次（退 78 并报 `sandbox-blocked`）：

  ```toml
  [sandbox_workspace_write]
  network_access = true
  ```

- **`read-only` 模式的 Codex：** 这个模式不让写文件，flipbook 跑不了（退 78 并报 `tmp-unwritable`）。请用户换成 `workspace-write`。

#### 可选：连那一次确认也省掉

只给连那一次确认都不想看到的用户。Claude Code 的沙箱设置存盘即生效，不用重启。

Claude Code，`~/.claude/settings.json`：让沙箱能写缓存，并能连 3d 里的四个下载域名：

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

或者让启动器在沙箱外跑（用主目录的绝对路径）：

```json
{
    "sandbox": {
        "excludedCommands": ["bash /Users/<user>/.claude/skills/flipbook/scripts/run.sh"]
    }
}
```

Codex，`~/.codex/config.toml`：

```toml
[sandbox_workspace_write]
writable_roots = ["/Users/<user>/Library/Caches/liustack/flipbook"]
network_access = true
```

Linux 上两个宿主的缓存都是 `~/.cache/liustack/flipbook`。

---

## 第 4 步：验证

```bash
bash ~/.claude/skills/flipbook/scripts/run.sh doctor   # 换成你的 TARGET
```

`doctor` 打出一个 JSON 对象。在新机器上它会退 78，`problems` 里有 `chromium-missing`，第一次渲染之前这是正常的。遇到别的问题，把它顶层 `fix` 里的几行转给用户。

然后渲染例子（这一步就会触发 3d 说的首次下载）：

```bash
HELLO="${TMPDIR:-/tmp}/flipbook-hello"
rm -rf "$HELLO" && cp -R /tmp/flipbook-src/examples/hello "$HELLO"
bash ~/.claude/skills/flipbook/scripts/run.sh check "$HELLO"
bash ~/.claude/skills/flipbook/scripts/run.sh render "$HELLO"
bash ~/.claude/skills/flipbook/scripts/run.sh doctor
```

**成功的标准：**
- `render` 退 0，JSON 里是 `"ok": true`。
- `$HELLO/out/video.mp4` 存在：5 秒，1920×1080，一个红方块在「你好，翻页书」和「Hello, flipbook」下面移动。
- 最后一次 `doctor` 退 0。

打开 `$HELLO/out/contact-sheet.png` 看各帧。

**失败时：**
- 启动器打出一份 `"error": "runtime-missing"` 的 JSON 诊断并退 78：没找到 Node 或 npx。把 `fix` 转给用户，重做 3a。
- `check` 或 `render` 退 78：读 stderr 上那份 JSON 里的 `error` 和 `fix`。`cache-unwritable`、`chromium-install-failed`、`sandbox-blocked` 和 `tmp-unwritable` 看 3e，`linux-deps-missing` 看 3d，`ffmpeg-missing` 看 3b，`resource-exhausted` 看 3c，`font-download-failed` 是网络或代理的问题（见 3d 的域名，镜像可以用 `FLIPBOOK_FONT_BASE_URL` 设）。
- 退 1：例子在这台机器上没过某项检查。把报告 JSON 发到 https://github.com/liustack/flipbook/issues。

---

## 完成

用户要视频时 skill 会自己触发。升级后想腾出磁盘空间，跑 `bash ~/.claude/skills/flipbook/scripts/run.sh doctor --prune`。
