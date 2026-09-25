---
summary: '支持哪些系统和宿主、每个平台实测过什么、沙箱特征识别表、GPU 结论、渲染性能和内存实测、DOM 文字缩放的确定性、Windows 现状'
read_when:
  - 改 src/engine/browser.ts 的启动参数或沙箱识别表
  - 用户报告沙箱里起不来、首次下载失败、容器里跑不动
  - 考虑打开 GPU 或支持 Windows
  - 改截帧、并行、页面重开或编码参数，要和之前的速度和内存比
---

# 平台

[English](platform.md) | 中文

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
| Claude Code | 沙箱里能跑。首次运行要下载 Chromium 和字体，被沙箱挡住退 78 时，agent 按提示带 `dangerouslyDisableSandbox` 把同一条命令重跑一次，用户在确认框里点一次允许，之后都在沙箱里跑，不用改设置也不用重启。INSTALL.zh-CN.md 第 3e 步的放行设置只给一次都不想弹的人，Claude Code 的沙箱设置改了即时生效 |
| Codex | macOS 上 `workspace-write` 沙箱里能跑，首次下载同上。Linux 上 Codex 的 seccomp 过滤把 socket 上的 `shutdown()` 连 unix socketpair 一起挡了，Chromium 一启动就要调它，flipbook 这边改不了，要在 Codex 配置里开 `network_access = true`。`read-only` 模式本来就不让写文件，换 `workspace-write` |

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

## 渲染性能

2026-09-25 在本机测的：Apple M4（4 个性能核加 6 个能效核），16 GB 内存，macOS 15.3，Node 24.13.0，ffmpeg 8.1.1，Chromium headless shell 153.0.8010.12，正常启动模式。测的时候同一台机器上还有别的 agent 在跑测试和渲染，负载一直在 3 到 25 之间跳（10 核机器，负载 10 大约就是满），内存 15 GB 在用、5 GB 被压缩。每行标了开始时的 1 分钟负载，同一条测两次的两次都列。数字只在同一张表里互相比，换一台空闲的机器会快不少。

### 截帧格式

只截不编码，eggs-five/five（带纹理的米褐纸底，1920×1080），单页按顺序 seek，48 帧取平均，负载 6.7 到 7.2。这张表测的时候还没有 `--disable-frame-rate-limit`，格式之间的比较不受影响。

| 做法 | 帧/秒 | 每帧 KB | 和 PNG 比的 PSNR |
|---|---|---|---|
| PNG，`optimizeForSpeed`（原来就是这个） | 12.0 | 2967 | 无损 |
| PNG，默认压缩 | 2.7 | 2404 | 无损 |
| WebP 质量 100（实测无损） | 1.3 | 1865 | 无损 |
| JPEG 质量 90 | 29.8 | 313 | 最低 41.9 dB，平均 43.3 dB |
| JPEG 质量 95 | 25.7 | 484 | 最低 44.0 dB，平均 45.0 dB |
| JPEG 质量 98 | 24.0 | 742 | 最低 46.2 dB，平均 47.1 dB |
| JPEG 质量 100 | 23.3 | 1084 | 最低 47.6 dB，平均 48.4 dB |
| `Page.startScreencast`，PNG | 14.0 | | |
| `Page.startScreencast`，JPEG 质量 100 | 29.2 | | |
| 同一个浏览器开 2 页、4 页并行截 PNG | 13.3、15.6 | | |
| 2 个、4 个浏览器各开 1 页并行截 PNG | 23.1、39.8 | | |

- PNG 编码是带纹理纸底慢的原因：同样的画面 JPEG 快一倍，PNG 每帧约 3 MB，1920×1080 的 RGB 原始数据是 6 MB，纹理几乎压不动。
- 降低 PNG 压缩级别走不通：CDP 的 `Page.captureScreenshot` 只有 `format`、`quality`、`clip`、`fromSurface`、`captureBeyondViewport`、`optimizeForSpeed` 这几个参数，`optimizeForSpeed` 已经是最快的一档（默认压缩慢 4.5 倍）。
- WebP 质量 100 解出来和 PNG 逐像素相同，但编码慢 9 倍。
- JPEG 质量 100 换成成片用的 yuv420p 再比也只有 49.4 dB，没过 50 dB。成片本身（x264 crf 18）相对原帧是平均 50.7 dB、最低 47.7 dB，JPEG 再叠一层损失。
- 屏幕推流（startScreencast）PNG 不比截图快，而且画面不变时不推帧，得另加超时兜底。
- 同一个浏览器里多开页面几乎不加速，截图在浏览器里是排队做的。换成多个浏览器才按页数涨。

结论：截图格式保持 PNG 加 `optimizeForSpeed`。提速靠两件事：启动参数 `--disable-frame-rate-limit`，和多开浏览器并行。

### 60 Hz 限帧

Chromium 默认按 60 Hz 出帧，截图要等下一个节拍，简单画面单页卡在每秒 30 帧左右。加 `--disable-frame-rate-limit` 后（只截不编码，96 帧，负载 2.6 到 2.7）：

| 合成 | 原来 | 加参数后 | 帧哈希 |
|---|---|---|---|
| hello | 29.7 | 56.9 | 不变 |
| eggs-five/five | 11.8 | 13.6 | 不变 |

这个参数同时修好了 DOM 文字逐帧缩放时两次渲染不一致的问题，见「DOM 文字逐帧缩放」一节。

### 并行页数

只截不编码，eggs-five/five，192 帧，每页一个浏览器，已加 `--disable-frame-rate-limit`，负载 2.5 到 3.7：

| 页数 | 1 | 2 | 3 | 4 | 6 | 8 | 9 |
|---|---|---|---|---|---|---|---|
| 帧/秒 | 13.6 | 26.2 | 35.5 | 43.2 | 50.8 | 49.4 | 54.9 |

所有页数的逐帧哈希都和单页相同。6 页以后帧/秒基本不再涨，自动页数后来封顶在 6 页，下面几张表里的「自动 9 页」是封顶之前测的。

### 整条 render

`flipbook render` 从头到尾，含编码和成片验收。「v0.3」是改动前的引擎（单页，60 Hz 限帧），「单页」「自动」「4 页」是现在的引擎，「自动」按 CPU 核数减一、内存和片长算出页数。30 秒片是 long-scroll 截成 30 秒（15 小节），「纯纸底」用 `paperLayer({ grain: 0 })`，「纹理纸底」换成默认纸底再盖 `grainLayer()`。每格是截帧帧/秒和总耗时，两次都列，括号里是开始时的负载。

| 片子 | v0.3 单页 | 单页 | 自动 | 4 页 |
|---|---|---|---|---|
| hello，5 秒 120 帧 | 22.8、22.7 帧/秒，7.5、7.8 秒（7、7） | 32.1、32.1 帧/秒，5.2、5.4 秒（4、3） | 2 页，37.7、39.2 帧/秒，4.9、4.9 秒（4、6） | 没测 |
| eggs-five/five，8 秒 192 帧 | 6.5、5.2 帧/秒，34.3、42.4 秒（7、7） | 9.7、10.0 帧/秒，22.3、21.9 秒（5、5） | 4 页，16.7、15.6 帧/秒，14.1、15.0 秒（4、5） | 没测 |
| 30 秒纯纸底，720 帧 | 17.1、16.8 帧/秒，52.3、53.0 秒（9、7） | 25.1、24.7 帧/秒，35.0、35.7 秒（7、6） | 9 页，30.3、29.2 帧/秒，30.9、33.6 秒（7、11） | 29.3、31.2 帧/秒，31.8、30.1 秒（17、17） |
| 30 秒纹理纸底，720 帧 | 6.5、8.1 帧/秒，122.7、100.3 秒（9、5） | 8.6、8.9 帧/秒，94.5、91.3 秒（22、8） | 9 页，14.0、16.2 帧/秒，67.0、57.0 秒（5、16） | 15.6、15.5 帧/秒，58.1、58.8 秒（18、19） |

eggs-five/five 的 v0.3 第二次和一轮单元测试撞在一起，偏慢。所有格子的逐帧哈希都和同一条片的单页结果相同。

- 30 秒 1080p24 不超过 60 秒的目标：纯纸底 30 到 36 秒达标。纹理纸底在负载 5 到 19 下 57 到 67 秒，也算达标。这是高负载下测的，空闲的机器更快。
- 编码吃掉一截：同一条 30 秒纯纸底片，把 ffmpeg 换成只读管道不编码，单页、4 页、9 页分别是每秒 36、54、50 帧，真编码是 23、34、31 帧（负载 8 到 15）。x264 medium 编这条片要 55 秒 CPU 时间（每帧 76 毫秒），`faster` 48 秒、`veryfast` 35 秒，但 PSNR 从 50.4 dB 降到 49.3 dB 和 47.6 dB，`veryfast` 的文件还大 70%。编码参数没动。
- 机器被别的进程占满时，自动的 9 页和 4 页差不多快，页数再多只是抢 CPU。

### 各画幅

hello 和 eggs-five 两条，先 check 再 render，页数自动（hello 120 帧给 2 页，eggs-five 192 帧给 4 页）。每格是截帧帧/秒和总耗时，括号里是开始时的负载。全部通过成片验收。

| 片子 | 16:9，1920×1080 | 9:16，1080×1920 | 1:1，1080×1080 | 4:5，1080×1350 | `--scale 2`，3840×2160 |
|---|---|---|---|---|---|
| hello | 39.9，4.6 秒（11） | 40.0，4.8 秒（11） | 54.0，3.5 秒（10） | 48.9，3.9 秒（10） | 12.5，13.0 秒（9）。7.0，29.7 秒（13） |
| eggs-five/five | 14.2，16.2 秒（8） | 15.1，15.5 秒（13） | 25.6，9.6 秒（12） | 20.9，11.5 秒（11） | 4.7，47.4 秒（10）。2.8，77.9 秒（16）。2.1，99.2 秒（17） |
| eggs-five/shu | 16.1，14.5 秒（15） | 16.6，14.2 秒（13） | 25.2，10.0 秒（12） | 21.2，13.2 秒（13） | 1.6，140.3 秒（13）。3.1，70.6 秒（13）。3.6，64.9 秒（24） |

- 竖版和横版像素数一样，速度也差不多。1:1 和 4:5 像素少，快。
- 4K 像素是 1080p 的 4 倍，纹理纸底的 PNG 每帧约 10 MB，eggs-five 每秒 2 到 5 帧。4K 测了两到三次，同一条片差出一倍，负载高时机器内存也吃紧，速度主要看当时别的进程。4K 时每页的内存估算变大，16 GB 机器上内存上限算出来是 7 页，这两条片按片长只给 4 页。
- 4K 的鸟蛋边线和点刻是按 2 倍像素画的，不是放大 1080p：`setupCanvas` 按 `devicePixelRatio` 建底层像素，截图拿的是设备像素，和 Playwright 的 `screenshot({ scale: 'device' })` 逐像素相同。
- 一个坑：Chromium 截带 `clip` 的图之后，会把设备参数恢复成发起截图的那个 CDP 会话设过的值。flipbook 截图用的是自己的会话，没设过，于是截一次带 `clip` 的图（`snapshot --zoom`）之后页面的 `devicePixelRatio` 回到 1、`screen` 变成 800×600。现在页面打开时在自己的会话上也设一份同样的设备参数，截全帧不带 `clip`，`test/size.test.ts` 核对 zoom 之后下一帧的参数和像素。

### 三分钟片的内存

examples/long-scroll（3 分钟，4320 帧，1920×1080），渲染时每秒读一次 render 进程树里每个进程的物理占用（macOS 的 `phys_footprint`，被压缩的内存也算在内）。第一轮用 RSS 量，泄漏片塞的是同一个数，macOS 把它压缩掉，RSS 几乎不涨，所以换了这个口径。「泄漏片」是 long-scroll 每次 seek 往全局数组里塞 5 万个不同的浮点数（每帧约 400 KB 堆，画面不变），用来看重开管不管用。

表里 Chromium 一列是截帧期间均匀取的 6 个读数（MB，所有 Chromium 进程加起来），「合计最高」含 Node 和 ffmpeg。ffmpeg 全程在 780 到 865 MB。

| 做法 | Chromium 读数 | Chromium 范围 | 合计最高 | 重开次数 | 帧/秒，总耗时（负载） |
|---|---|---|---|---|---|
| 单页，默认重开 | 356 → 358 → 350 → 347 → 359 → 361 | 321 到 363 | 1321 | 1（到 2400 帧） | 28.5，177 秒（17） |
| 单页，`--recycle 0` | 357 → 358 → 351 → 355 → 356 → 333 | 323 到 365 | 1345 | 0 | 28.4，178 秒（6） |
| 自动 9 页 | 2884 → 3164 → 3161 → 3076 → 3054 → 3096 | 2884 到 3189 | 4218 | 0 | 38.4，140 秒（9） |
| 泄漏片，单页，`--recycle 0` | 422 → 781 → 1081 → 1366 → 1745 → 2101 | 422 到 2101 | 3112 | 0 | 25.8，194 秒（7） |
| 泄漏片，单页，默认重开 | 313 → 732 → 454 → 767 → 566 → 367 | 103 到 977 | 1976 | 3（堆涨过线） | 14.4，339 秒（30） |
| 泄漏片，自动 9 页，每页各 256 MB 的线（已改掉） | 2854 → 3657 → 3819 → 4155 → 4659 → 4978 | 2854 到 5000 | 6151 | 0 | 18.8，295 秒（6） |
| 泄漏片，自动 9 页，现在 | 2862 → 3761 → 4026 → 3275 → 3708 → 4044 | 1484 到 4051 | 5115 | 17（堆涨过线） | 24.4，245 秒（19） |

- long-scroll 本身不漏：单页从头到尾在 320 到 365 MB，9 页在 2.9 到 3.2 GB，都是平的。默认规则在 2400 帧时重开一次，内存和不重开一样。
- 漏内存的片不重开时一路涨到 2.1 GB。默认规则下单页重开 3 次，锯齿在 1 GB 以内。
- 9 页并行时每页只画约 480 帧。原来每页各自 256 MB 的线谁都没碰到，9 页加起来涨了 2.1 GB。现在所有页合起来 512 MB，平分成每页 64 MB，重开 17 次，读数在 3.3 到 4.1 GB 之间来回。
- 9 页并行时 Chromium 约 3 GB，加 ffmpeg 和 Node 合计 4.2 GB。每页的内存估算（300 MB 加 24 份输出帧）在 1080p 是 0.5 GB，16 GB 机器按一半内存算能开 16 页，实际是被 CPU 核数减一卡在 9 页。

### 沙箱里的并行

Claude Code 沙箱里 Chromium 走单进程模式，每页一个浏览器。hello 先 check 再 `render --jobs 3`：3 页，逐帧哈希和正常模式相同，成片验收通过（负载 20 以上，每秒 9.5 帧）。

## DOM 文字逐帧缩放

问题：beat-title 的第一版让 DOM 字每帧改 `rotate()` 和不等比的 `scale()`，同机两次渲染 288 帧里有 9 到 14 帧哈希不同，check 没抓到。当时以为是字形缓存，rules.md 加了一条「DOM 字不许逐帧改 scale」。

复现：`test/fixtures/bad/dom-scale-drift` 是那一段的精简版（1920×1080，115 帧，三个字落下时挤扁再弹回）。在没有 `--disable-frame-rate-limit` 的启动参数下（2026-09-25，Apple M4，负载 3 到 8）：

| 做法 | 结果 |
|---|---|
| 同一页每帧 seek 后连截两张 | 三次运行分别有 7、14、8 帧两张不同，截第三张（隔 50 毫秒）和第二张相同 |
| 三次运行各自的第一张汇总哈希 | 三次三个值 |
| 三次运行各自的第二张汇总哈希 | 三次相同 |
| 单进程模式 | 同样出现 |
| 加上 `--disable-frame-rate-limit` | 八个进程同时跑（负载 21），第一张和第二张帧帧相同，八次汇总哈希相同，并和上面的「第二张」相同 |

根因：截图和合成器的重画在抢时间，不是字形缓存。Chromium 默认按 60 Hz 出帧，`Page.captureScreenshot` 拿的是 seek 之后合成器出的下一帧。字的变换一变，合成器要按新的缩放重新光栅化这层字，按 60 Hz 节拍出帧时，截图有时拿到的那一帧里这层还没画成新的，下一帧才对。哪几帧赶上取决于当时的时序，所以同一帧两次渲染可能不同。画好之后的像素本身是确定的，上表「第二张」三次相同就是证据。check 的连截两张（`late-paint`）只看抽中的 8 帧，那次没抽中出事的帧。

修法：启动参数加 `--disable-frame-rate-limit`，合成器不再等 60 Hz 节拍，截图拿到的第一帧就是画好的。`test/e2e/domScale.test.ts` 钉住两件事：逐帧连截两张相同，两次独立渲染逐帧相同。去掉这个参数，两条测试都失败。rules.md 和 SKILL.md 里那条硬规矩已删，DOM 字可以逐帧缩放和旋转。

## Windows

原生 Windows 不支持，`win32` 退 78 提示 WSL2。设 `FLIPBOOK_ALLOW_WIN32=1` 可以绕过，给 CI 用。

已经做了：

- 缓存放 `%LOCALAPPDATA%\liustack\flipbook`，没有这个变量时用 `%USERPROFILE%\AppData\Local`。
- 认出 `chrome-headless-shell-win64\chrome-headless-shell.exe`。playwright-core 没有 Windows arm64 的 headless shell。
- 缺 Chromium 时给的安装命令是 PowerShell 写法（`$env:PLAYWRIGHT_BROWSERS_PATH="..."; npx ...`）。
- 装 Chromium 的子进程带 `windowsHide`。
- CI 加 windows-latest 一列，和其他列一样跑全部测试，没有允许失败的一组。run.sh 的测试用 Git for Windows 的 sh 跑，跟 Git Bash 里一样。编码器测试冒充 ffmpeg 的是 Node 脚本。评测工作区在 Windows 上另写 `flipbook.cmd` 垫片。Windows 上跳过四条，都写了原因：编码器测试里系统杀进程的两条（Windows 没有信号，flipbook 靠 SIGKILL 认出系统杀的进程），page 里靠 chmod 造删不掉目录的两条（Windows 不按权限位管目录）。chrome://kill 那条两列都偶发过：和别的测试一起跑时，Chromium 要 5 毫秒到 16 秒才发现渲染进程没了，比 close() 等的久，现在这条先等崩溃报告再关页面。
- 第一次跑（2026-09-25，Node 22.19 和 24 各一列）：必过的一组 22 个文件全过。允许失败的一组里 corpus、doctor、references、render 四个文件也过了，Windows 上能渲出片子。没过的是 encode（sh 冒充的 ffmpeg、`/bin/sleep`、`pgrep` 在 Windows 上起不来）、launcher（run.sh 在 Git Bash 里调不起假的 flipbook、npx、bunx）、eval（评测脚本的 sh 垫片）、page 里靠 chmod 做出删不掉的目录的两条（Windows 不认这个权限，render 和 snapshot 照常成功）。`chrome://kill` 之后 close() 没报 resource-exhausted，两列都出现过。

run.ps1 按 Windows 上启动器常踩的坑逐条查过：

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
