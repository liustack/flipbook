---
summary: '支持哪些系统和宿主、每个平台实测过什么、沙箱特征识别表、GPU 结论、Windows 现状'
read_when:
  - 改 src/engine/browser.ts 的启动参数或沙箱识别表
  - 用户报告沙箱里起不来、首次下载失败、容器里跑不动
  - 考虑打开 GPU 或支持 Windows
---

# 平台

## 支持矩阵

| 平台 | 状态 | 实测 |
|---|---|---|
| macOS arm64 | 支持 | 本机直跑、Claude Code 沙箱、Codex 沙箱 `workspace-write` 和 `read-only`、GPU 对比 |
| Linux x64（Ubuntu 22.04、24.04，Debian 12） | 支持 | CI（ubuntu-latest）按 INSTALL.md 从头装到渲出 hello |
| Linux arm64 | 尽力而为 | Ubuntu 24.04 arm64 容器：受限容器 13 种、Claude Code 沙箱运行时、Codex Linux 沙箱 |
| macOS x64 | 尽力而为 | 没测 |
| Windows | 不支持，在 WSL2 里用 | 原生 `win32` 退 78。CI 有一列 windows-latest，设 `FLIPBOOK_ALLOW_WIN32=1` 跑，结果见下面 Windows 一节 |

| 宿主 | 状态 |
|---|---|
| Claude Code | 沙箱里能跑。首次下载要在沙箱外跑一次，或加放行设置（INSTALL.md 第 3e 步） |
| Codex | macOS 上 `workspace-write` 沙箱里能跑，首次下载同上。Linux 上要开 `network_access = true` 才起得来。`read-only` 跑不了 |

## 实测环境

2026-09-25 测的，版本如下：

- 本机：Apple M4，macOS 15.3，Node 24.13.0，ffmpeg 8.1.1，playwright-core 1.63.0，Chromium headless shell 153.0.8010.12（r1243）。
- Claude Code 2.1.281 的 Bash 沙箱（macOS Seatbelt）。
- Codex CLI 0.156.1：`codex sandbox -P :workspace` 和 `-P :read-only` 直接跑命令，再用 `codex exec` 让模型（gpt-6-astra）照 skill 跑 doctor、check、render。
- Docker 29.5.2，镜像 ubuntu:24.04 linux/arm64，Node 22.19.0，ffmpeg 6.1.1。容器里另装 Claude Code 的沙箱运行时 `@anthropic-ai/sandbox-runtime` 0.0.77（bubblewrap 加 seccomp）和 Codex CLI 0.156.1 的 linux-arm64 版。

## 沙箱特征识别表

`src/engine/browser.ts` 的 `SANDBOX_SIGNATURES` 按下表顺序匹配 Chromium 启动失败的报错，先中先用。命中的行写进报告的 `detail.signature`，宿主写进 `detail.host`（看 `CODEX_SANDBOX` 和 `SANDBOX_RUNTIME=1` 这两个环境变量）。

| 行 | 报错原文 | 在哪见到 | 处理 |
|---|---|---|---|
| `temp-dir` | `browserType.launch: EPERM: operation not permitted, mkdtemp '/var/folders/.../T/playwright-artifacts-XXXXXX'` | Codex `read-only`（macOS） | 不重试，退 78 `tmp-unwritable`，提示把 TMPDIR 指到能写的目录，Codex 换 `workspace-write` |
| | `browserType.launch: EROFS: read-only file system, mkdtemp '/tmp/playwright-artifacts-XXXXXX'` | Codex `read-only`（Linux），只读根文件系统又没挂可写 /tmp 的容器 | 同上 |
| | `browserType.launch: ENOENT: no such file or directory, mkdtemp '/tmp/claude/playwright-artifacts-XXXXXX'` | Claude Code 沙箱运行时，TMPDIR 指的目录还没建 | 同上 |
| `linux-socket-filter` | `FATAL:content/browser/sandbox_host_linux.cc:41] Check failed: . shutdown: Operation not permitted (1)` | Codex Linux 沙箱，没开网络时它的 seccomp 过滤器拒绝 socket 上的 `shutdown`。正常和单进程两种方式都一样 | 不重试，退 78 `sandbox-blocked`，提示开 `network_access = true` 或在沙箱外跑 |
| `mach-port` | `FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.<pid>: Permission denied (1100)` | Claude Code 沙箱（macOS），Codex `workspace-write`（macOS）。Codex 的拒绝日志是 `mach-register org.chromium.Chromium.MachPortRendezvousServer.<pid>` | 用 `--single-process --no-zygote` 重试，两个宿主里都起得来。单进程也失败才退 78 `sandbox-blocked` |
| `operation-not-permitted` | 其他含 `EPERM` 或 `Operation not permitted` 的报错 | 没在已知宿主里见过，兜底 | 同 `mach-port` |

不在表里的：

- `error while loading shared libraries`：Linux 缺系统库，退 78 `linux-deps-missing`，给 `install-deps` 命令。
- 首次下载被拒：`getaddrinfo ENOTFOUND cdn.playwright.dev`（Codex 没开网络），`server returned code 403 body 'Connection blocked by network allowlist'`（Claude Code 沙箱的代理）。退 78 `chromium-install-failed`，`detail.signature` 是 `network-blocked`，提示在沙箱外跑一次或开网络。
- 缓存写不进：`cache-unwritable`，写之前就先探过。

## 各宿主实测

### Claude Code

- macOS 沙箱：正常启动撞 `mach-port`，单进程起得来。
- Linux 沙箱运行时（容器里的 bubblewrap 加 seccomp，嵌套用 `enableWeakerNestedSandbox`，`--privileged` 下也测了完整模式）：Unix socket 确实被拦（`listen EPERM`），网络确实只走代理，但 Chromium 正常模式就能起。check 退 0，render 退 0（约 24 帧/秒）。
- 首次下载：缓存目录不在 `allowWrite` 里退 `cache-unwritable`。把缓存目录加进 `sandbox.filesystem.allowWrite`，再把 `cdn.playwright.dev`、`storage.googleapis.com`、`github.com`、`*.githubusercontent.com` 加进 `sandbox.network.allowedDomains`，冷启动的 check 在沙箱里 23 秒装完退 0。Chromium 从 `cdn.playwright.dev` 307 跳到 `storage.googleapis.com`，霞鹜文楷从 `github.com` 302 跳到 `release-assets.githubusercontent.com`。Playwright 顺带下的自家 ffmpeg 走 `playwright.download.prss.microsoft.com`，被拦也不影响安装，flipbook 用的是系统 ffmpeg。

### Codex（macOS）

- skill 加载：`codex debug prompt-input` 渲出的技能列表里有 flipbook，`compatibility` 放顶层和放 `metadata` 下都能加载。Codex 自带的 skill 校验脚本（skill-creator 的 `quick_validate.py`）只认 `name`、`description`、`license`、`allowed-tools`、`metadata`，顶层 `compatibility` 报错，挪进 `metadata` 后通过。
- `workspace-write`（默认，不联网）：doctor 退 0，`launch.mode` 是 `single-process`。check 退 0，render 退 0，截帧约 28 帧/秒。`codex exec` 让模型照 skill 跑同样三条命令，结果一样，成片和直接跑的逐字节一致。
- 这个模式下 `~/Library/Caches/liustack/flipbook` 写不进（EPERM），网络不通（ENOTFOUND）。冷启动时默认缓存退 `cache-unwritable`，缓存指到可写目录后退 `chromium-install-failed`。
- `~/.codex/config.toml` 的 `[sandbox_workspace_write]` 里加 `writable_roots = [缓存目录]` 和 `network_access = true` 后，冷启动的 check 在沙箱里 40 秒装完退 0（Chromium 198 MB，字体 49 MB）。
- `read-only`：Playwright 建临时目录就失败，命中 `temp-dir`。
- 用户自己的 execpolicy 规则会挡启动器：本机 `~/.codex/rules/` 里有一条把 `bash` 设成 `prompt` 的规则，又配了 `approval_policy = "never"`，`bash .../run.sh` 直接被拒（`approval required by policy, but AskForApproval is set to Never`）。这不是 Codex 默认行为，换干净的 `CODEX_HOME` 就没有了。SKILL.md 的手工兜底顺序（PATH 上的 flipbook、npx、bunx）能绕开。

### Codex（Linux）

容器里用 `codex sandbox -P :workspace` 跑（容器要放开 seccomp 和 apparmor，bubblewrap 才建得了命名空间）：

- 默认不联网：正常和单进程都撞 `linux-socket-filter`，check 和 render 退 78。
- 权限配置开网络（`permissions.<名字>.network.enabled = true`）：Chromium 正常模式起得来，check 和 render 退 0。
- `-P :workspace` 这个内置配置不读老的 `sandbox_workspace_write.network_access`。`codex exec` 走老配置时 `network_access = true` 是否同样去掉过滤器，在 macOS 上确认了网络通，Linux 上没测（容器里没有 Codex 登录）。

## 受限的 Linux 容器

ubuntu:24.04 arm64，除第一行外都用非 root 用户（uid 1000），缓存事先装好，跑 `flipbook check` 渲 hello。

| 限制 | 结果 |
|---|---|
| root，Docker 默认 | 退 0，正常模式 |
| 非 root | 退 0，正常模式 |
| 装好的缓存设成只读 | 退 0 |
| 空缓存，`~/.cache` 只读 | 退 78 `cache-unwritable` |
| HOME 指到不存在的目录 | 退 78 `cache-unwritable` |
| 没有 /dev/shm（`--ipc=none`） | 退 0，Playwright 默认带 `--disable-dev-shm-usage` |
| /dev/shm 只有 1 MB | 退 0 |
| `--cap-drop ALL`，`no-new-privileges` | 退 0 |
| 根文件系统只读，只有工作目录可写 | 退 78 `tmp-unwritable`，命中 `temp-dir`（EROFS） |
| 根文件系统只读，另挂可写 /tmp | 退 0 |
| 断网，空缓存 | 退 78 `chromium-install-failed` |
| 进程数上限 48、64、96 | 不稳定：Playwright 抛 `Assertion error` 退 1，或 Node 退 13，或 Chromium 收到 SIGABRT 退 78 `browser-launch-failed` |
| 进程数上限 128、192 | 三次都退 0 |
| 内存 256 MB、512 MB | check 被 OOM 杀掉，退 137，没有报告 |
| 内存 768 MB | check 退 0，render 退 1 |
| 内存 1 GB | check 退 0。render 一次渲染进程被杀，报 `page-error`（The page crashed）加 `glitch` 退 1，另一次 ffmpeg 被杀后卡住十几分钟不退 |
| 内存 2 GB | check 和 render 都退 0 |

进程数和内存不足时报错五花八门，没法认成一行特征，所以不进识别表。1080p 渲染按至少 2 GB 内存、128 个进程准备。

渲染中途被杀的情况现在认得出：渲染进程按 CDP 报的终止状态（`killed`、`oom`、`failed to launch`、`evicted for memory`），浏览器整个退出，ffmpeg 被 SIGKILL，都报 78 `resource-exhausted`，不再报 `page-error` 或 `glitch`。ffmpeg 被杀后送帧和收尾立刻出错，不会卡住。启动阶段进程数不够时仍然各报各的。单进程模式下拿不到浏览器的退出信号，页面自己把整个进程搞崩也会报成 `resource-exhausted`。

单进程模式在 Linux arm64 上：flipbook 自己的截帧没问题（用包装脚本逼它走单进程，check 和 render 退 0，约 13 帧/秒），但 Playwright 的 `page.screenshot` 在这个模式下经常报 `Unable to capture screenshot`。只有 Linux 上真撞到能靠单进程绕过的特征时才会走到这里，目前实测的 Linux 沙箱都不是这种。

## GPU

问题：macOS 上给 2D 合成加 `--use-angle=metal --enable-gpu`，同机两次渲染的原始帧还逐帧一致吗。

做法：在打包好的 CLI 副本里给启动参数加上这两个开关，并把每帧 PNG 落盘，四个合成各渲两次软件光栅、两次 GPU。stress 另各渲到六次。默认启动参数没动。

先确认 GPU 真的开了：CDP `SystemInfo.getInfo` 显示默认是 SwiftShader（`2d_canvas: unavailable_software`），加开关后 `2d_canvas: enabled`、`rasterization: enabled`、`skia_graphite: enabled_on`，渲染器是 `ANGLE Metal Renderer: Apple M4`。

| 合成 | 帧数 | 软件光栅两次 | GPU 两次 | 软件对 GPU 的 PSNR |
|---|---|---|---|---|
| examples/hello（canvas 方块加 DOM 文字） | 120 | 一致 | 一致 | 帧帧不同，最低 60.17 dB，平均 62.07 dB |
| test/fixtures/color（纯色块） | 24 | 一致 | 一致 | 完全相同 |
| test/fixtures/music | 24 | 一致 | 一致 | 帧帧不同，最低 51.40 dB，平均 52.39 dB |
| stress（canvas 渐变、阴影模糊、透明、multiply 混合、贝塞尔，DOM 圆角阴影和文字阴影） | 120 | 六次全一致 | 第 2 到 6 次和第 1 次比，分别有 20、21、120、43、43 帧不同 | 最低 48.52 dB，平均 49.02 dB |

stress 的 GPU 各次之间差得很小：灰度最大差 2 级，PSNR 不低于 91.84 dB。但原始帧哈希对不上了。

速度：stress 六次渲染的总耗时，软件光栅 11.6 到 23.3 秒，GPU 9.7 到 19.1 秒，hello 软件光栅 7.9 和 9.3 秒，GPU 8.9 秒。总耗时含编码和验收，看不出 GPU 有明显优势。

结论：2D 合成保持软件光栅。Metal 下带阴影、模糊、混合的 canvas 内容同机两次渲染不逐帧一致，过不了 A 级的原始帧哈希门槛。以后要对 2D 打开 GPU，确定性检查得从哈希改成 PSNR（比如不低于 90 dB）。3D 合成按设计本来就用 PSNR 验收，不受影响。沙箱里的单进程模式能不能用上 Metal 没测，Codex 的拒绝日志里有 `iokit-open-user-client AGXDeviceUserClient`，大概率用不上。

## Windows

原生 Windows 不支持，`win32` 退 78 提示 WSL2。设 `FLIPBOOK_ALLOW_WIN32=1` 可以绕过，给 CI 用。

已经做了：

- 缓存放 `%LOCALAPPDATA%\liustack\flipbook`，没有这个变量时用 `%USERPROFILE%\AppData\Local`。
- 认出 `chrome-headless-shell-win64\chrome-headless-shell.exe`。playwright-core 没有 Windows arm64 的 headless shell。
- 缺 Chromium 时给的安装命令是 PowerShell 写法（`$env:PLAYWRIGHT_BROWSERS_PATH="..."; npx ...`）。
- 装 Chromium 的子进程带 `windowsHide`。
- CI 加 windows-latest 一列，lint、typecheck、build 和平台无关的测试必须过。渲染相关的测试和只认 POSIX 的测试（run.sh 启动器、评测脚本的 sh 垫片、编码器测试里冒充 ffmpeg 的 sh 脚本和 `/bin/sleep`、`pgrep`）允许失败，报告存成 `windows-tests-node-*` 附件。
- 第一次跑（2026-09-25，Node 22.19 和 24 各一列）：必过的一组 22 个文件全过。允许失败的一组里 corpus、doctor、references、render 四个文件也过了，Windows 上能渲出片子。没过的是 encode（sh 冒充的 ffmpeg、`/bin/sleep`、`pgrep` 在 Windows 上起不来）、launcher（run.sh 在 Git Bash 里调不起假的 flipbook、npx、bunx）、eval（评测脚本的 sh 垫片）、page 里靠 chmod 做出删不掉的目录的两条（Windows 不认这个权限，render 和 snapshot 照常成功）。Node 24 那列另有一次 `chrome://kill` 之后 close() 没报 resource-exhausted，Node 22.19 那列同一条过了。

run.ps1 按 modlens 在 Windows 上踩过的坑逐条查过：

| 坑 | run.ps1 的情况 |
|---|---|
| `.cmd` 垫片 | Node 直接 spawn `.cmd` 会报 EINVAL，PowerShell 的 `&` 没这个问题。改成只找可执行文件和 `.cmd`（`Get-Command -CommandType Application`），不走 npm 同时装的 `.ps1` 垫片，执行策略拦不到 |
| PATH 大小写 | run.ps1 不自己拼环境变量，PowerShell 的 `$env:PATH` 本来不分大小写。测试里改 PATH 时先删掉原来任何大小写的 PATH 键 |
| 控制台闪窗 | run.ps1 的子进程共用 PowerShell 的控制台，不另开窗 |
| 退出码透传 | 修了一个：Windows PowerShell 5.1 在 `$ErrorActionPreference = 'Stop'` 下把重定向的 stderr 当成终止错误，`doctor --json` 撞上 CLI 往 stderr 写诊断时丢掉 78、退 0。现在原生命令都在 `Continue` 的作用域里跑，退出码取 `$LASTEXITCODE` |
| 编码 | 修了一个：5.1 按控制台代码页解读 CLI 的 UTF-8 输出，报告里的中文会乱。现在先把控制台编码设成 UTF-8 |

`test/launcherPs1.test.ts` 在找得到的每个 PowerShell 上跑这些情况。旧契约在 PowerShell 7.4（Linux 容器）上过过。run.ps1 后来跟 run.sh 对齐了新契约（`fix`、`launcher`、doctor 始终输出 JSON、预发布只认钉死版本），新版本在 CI 的 windows-latest 上过了，Windows PowerShell 5.1 和 PowerShell 7 各跑一遍。

代码审查时列出的 Windows 问题，前四条已经修了：

- `findOnPath` 在 win32 上给程序名补 `.exe`，PATH 键不分大小写，doctor、check、render 找得到 `ffmpeg.exe`。
- 起 ffmpeg 的地方（`proc.ts`、`encode.ts`、`pixels.ts`）都带 `windowsHide: true`，没有控制台的宿主不再闪黑窗。
- `test/globalSetup.ts` 经 shell 跑 `pnpm build`，Windows 上起得了 `pnpm.cmd`。
- `test/doctor.test.ts` 换 PATH 时先删掉任何大小写的 PATH 键，安装命令按平台断言，Windows 上跳过靠目录写权限的用例。

还没修的一条：Node 24.0 到 24.13 在 Windows 上 `fs.rmSync` 遇到非 ASCII 路径会直接崩（nodejs/node#58759，24.13.1 修复），中文用户名很常见。要支持 Windows 时 Node 下限得避开这一段。
