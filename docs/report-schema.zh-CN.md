---
summary: 'check、snapshot、render 的 JSON 报告格式、退出码、每个类型码的含义和修法'
read_when:
  - 解析 flipbook 的输出
  - 新增或修改类型码
---

# 报告格式 flipbook.report/1

[English](report-schema.md) | 中文

`check`、`snapshot`、`render`、`audio` 无论成败都往 stdout 打一份 JSON 报告。进度和日志走 stderr。`doctor --json` 用自己的格式 `flipbook.doctor/1`（见文末）。

## 退出码

| 码 | 含义 | 该谁动手 |
|---|---|---|
| 0 | 全过 | 无 |
| 1 | 片子有问题 | agent 按 `failures` 改合成 |
| 2 | 用法错（参数、目录不存在） | agent 改命令 |
| 78 | 环境缺件（Node、ffmpeg、Chromium、字体、沙箱、系统库） | 按 stderr 里的修复命令处理机器 |

退出码 78 时 stderr 另打一份 JSON 诊断：`error`（环境类型码）、`message`、`meaning`、`fix`（能直接复制的命令或设置）、`detail`、`platform`、`node`。stdout 仍是报告，`environmentError` 字段放同一份诊断。

`sandbox-blocked` 和 `tmp-unwritable` 的 `detail.signature` 是命中沙箱识别表的哪一行（`tmp-unwritable` 对应 `temp-dir`，`sandbox-blocked` 对应 `linux-socket-filter`、`mach-port`、`operation-not-permitted`，见 [platform.zh-CN.md](platform.zh-CN.md)），下载被拒的 `chromium-install-failed` 带 `detail.signature: "network-blocked"`。这几个和 `cache-unwritable` 都带 `detail.host`：`claude-code`、`codex` 或 `null`，按宿主设的环境变量认。

## 顶层字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `schema` | string | 固定 `flipbook.report/1` |
| `command` | string | `check`、`snapshot`、`render`、`audio`，用法错时是 `usage` |
| `ok` | boolean | 退出码为 0 时为 true |
| `exitCode` | 0、1、2、78 | 和进程退出码一致 |
| `flipbook.version` | string | CLI 版本 |
| `environment` | object | `platform`（如 `darwin-arm64`）、`node`、`chromium`（`version`、`revision`、`launchMode`：`normal` 或 `single-process`）、`ffmpeg` |
| `composition` | object | `dir`、`hash`（合成目录哈希，`sha256:` 开头，不含 `out/` 和 `.flipbook/`）、`width`、`height`（舞台的 CSS 像素，给了 `--size` 时是换过的尺寸）、`fps`、`frames`、`durationSec` |
| `failures` | Finding[] | 错误，任何一条都让退出码变 1 |
| `warnings` | Finding[] | 提示，不影响退出码 |
| `artifacts` | object | 产物路径：`video`、`contactSheet`、`rejectedVideo`、`zoom1` 等，`report` 是这份报告存盘的路径 |
| `reportSaveError` | string | 报告没能存盘时才有，写明原因（没有合成目录、写入被拒或失败），这时 stdout 上的就是唯一一份 |
| `attempts` | object | 重试计数，见下文 |
| `stop` | boolean | 到重试上限时为 true，agent 应停下向用户报告 |
| `stopReason` | string | `stop` 为 true 时说明卡在哪 |
| `timing` | object | `startedAt`、`durationMs` |

各命令另有一个同名字段：`check`（`seed`、抽样帧、两次 seek 的顺序、证据目录、`contrastSkipped` 没量对比度的 canvas 字，`determinism` 是确定性三项各自的结果，见「并行渲染」一节），`snapshot`（`layout`、`tiles` 每格的帧号时间和场景、`zooms`），`render`（`frames`、`fps`、`digest` 原始帧哈希汇总、`captureMs`、`encodeMs`、`verifyMs`、`totalMs`、`captureFps`、`probe`、`audio`、`contactSheetTiles`、`output`、`parallel`、`pages`、`recycle`，后四个见「画幅和分辨率」「并行渲染」两节），`audio`（见「音频」一节）。`render` 还有 `metadata`，和写进 mp4 comment 标签的内容相同，其中 `stage` 是舞台尺寸（如 `1080x1920`），`scale` 是 `--scale`。

### 画幅和分辨率

`render` 和 `snapshot` 的 `--size` 换掉 timeline 的 `width`、`height`：`9:16`、`1:1`、`4:5` 这类比例保留原来的短边（1920×1080 换成 1080×1920、1080×1080、1080×1350），`1080x1920` 这样的写法直接给像素。两条边都要是偶数，宽 16 到 7680，高 16 到 4320，不合要求退 2。合成从 `timeline()` 读到的是换过的尺寸。

`render` 的 `--scale` 是每个 CSS 像素出几个像素（Chromium 的 deviceScaleFactor），1 到 4，`--scale 2` 把 1920×1080 渲成 3840×2160。输出两边要是偶数整数，且不超过 7680×4320。页面的 `devicePixelRatio` 跟着变，`setupCanvas` 按它建 canvas 的底层像素。

| 字段 | 含义 |
|---|---|
| `render.output` | 成片的 `width`、`height` 和 `scale` |

### 并行渲染

render 同时开几个浏览器，每个一页，谁空下来谁接下一帧，帧按顺序送进同一个 ffmpeg。每帧只由 t 决定，所以哪一页画哪一帧不改变像素，逐帧哈希和单页一致。

| 字段 | 含义 |
|---|---|
| `render.parallel.jobs` | 实际用了几页 |
| `render.parallel.requested` | `--jobs` 的值，没给是 `auto` |
| `render.parallel.planned` | 取下一行四个上限里最小的那个，或 `--jobs` 的值（`--jobs` 不受 `max` 限制） |
| `render.parallel.limits` | `cpu` 是 CPU 核数减一，`memory` 是机器内存的一半除以每页的估算（300 MB 加 24 份输出帧大小），`frames` 是每 48 帧一页，`max` 是自动页数的封顶 6 |
| `render.parallel.reason` | 本该多页却只用了一页时的原因 |
| `render.pages.opened` | 整个渲染开过几个页面，每页的第一个也算 |
| `render.pages.recycled` | 重开了几次，按原因分：`frames` 到了帧数，`heap` JS 堆涨多了，`nodes` DOM 节点涨多了 |
| `render.recycle` | 这次的重开规则：`everyFrames` 一页最多画几帧（`null` 是不按帧数重开），`watchMemory` 是否看内存 |

每一页画到一定帧数就关掉重开，长片的内存不跟着帧数涨。默认帧数按输出大小定：1920×1080 一页 2400 帧，像素越多越早重开，最少 600 帧。另外每 48 帧读一次这一页的 JS 堆和 DOM 节点数，第一次读数当基线，涨过线（先做一次完整垃圾回收再确认）就提前重开。线是所有页合起来 512 MB 堆、4 万个节点，平分给同时在画的页，每页至少 64 MB、5000 个节点，所以页数多时内存合计也不超过这个数。`--recycle <帧数>` 改成固定帧数且不看内存，`--recycle 0` 一直用同一页。重开不改变像素，理由和并行相同。

多页的前提是这个合成最近一次 check 的确定性三项都过了：读 `.flipbook/reports/check.json`，合成文件哈希、flipbook 版本、Chromium 构建号都要和这次 render 相同，`check.determinism` 里 `seekOrder`（换一个顺序 seek）、`perturbation`（换时钟和随机种子）、`latePaint`（seek 后连截两张）都是 `pass`。每项的值是 `pass`、`fail` 或 `skipped`（check 没跑到这一项就停了）。check 因为别的问题没退 0（比如文字出画）不影响多页。否则只用一页，`reason` 是 `no check report for this composition`、`the saved check report is not valid JSON`、`the last check ran on other files`、`the last check ran on another flipbook version`、`the last check ran on another Chromium`、`the last check failed the determinism checks: ` 加没过的几项，或 `the last check did not finish the determinism checks`。直接调 `runCheck` 不存报告，要并行得自己 `saveReport`。

## 输出目录

合成目录里只有 `out/` 和 `.flipbook/` 两处是 flipbook 写的。写入前逐级核对路径：这两处或它们下面任何一级是软链，命令一开始就报 `unsafe-output` 退 1，什么都不写、不删。文件先写到同目录的新文件名再改名替换，不会顺着已有的软链或硬链写到外面：

| 路径 | 谁写 | 内容 |
|---|---|---|
| `out/video.mp4`、`out/contact-sheet.png` | render | 通过验收的成片和成片联系表。没通过时不动 `out/` |
| `out/snapshot/contact-sheet.png`、`out/snapshot/zoom-f<帧号>.png` | snapshot | 预检联系表和局部放大图 |
| `.flipbook/rejected/` | render | 没通过验收的成片和联系表，`artifacts.rejectedVideo` 指向它 |
| `.flipbook/evidence/<命令>/` | check、render | 证据图，每次运行前清空 |
| `.flipbook/timeline.resolved.json` | 全部 | 换算后的 timeline |
| `.flipbook/frame-hashes.json` | render | 每帧原始截图的 sha256 和汇总 |
| `.flipbook/attempts.json` | check、render | 重试计数 |
| `.flipbook/reports/<命令>.json` | check、snapshot、audio、render | 这条命令最近一次的报告，和 stdout 上的相同。退 78、`unsafe-output`、`internal-error` 的运行也存，路径在 `artifacts.report` |
| `.flipbook/tmp/` | render | 渲染中间件，结束后删掉 |
| `.flipbook/render.lock` | render | 同一目录同时只跑一个 render（同一进程重入也算），另一个报 `render-busy` 退 1，不计入重试次数。锁用 O_EXCL 建，内容是 pid 和随机令牌。持有进程已退出，或锁里没有可读的持有者且建了超过 10 秒，才算过期被接管。释放时只删令牌仍是自己的锁 |
| `.flipbook/audio/` | audio、render | 合成的 `music.wav`、`sfx.wav`，`score.json`（和弦、强弱、音效位置），`audio.json`（各轨哈希、峰值、音效实际峰值位置）。audio 命令也拿 `render.lock` |

## Finding

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | string | 类型码，见下表 |
| `severity` | `error` 或 `warning` | |
| `message` | string | 出了什么事 |
| `time` | number | 第几秒，可缺 |
| `frame` | number | 帧号，可缺 |
| `element` | string | CSS 选择器、`文件:行号` 或 `scene <id>`，可缺 |
| `evidence` | string[] | 证据图路径，可缺 |
| `fix` | string | 怎么改 |
| `detail` | object | 附加数据，如 `path`、`chars`、`frames` |

## 类型码：合成问题（退出码 1）

| 类型码 | 谁报 | 含义 | 修法 |
|---|---|---|---|
| `index-missing` | 全部 | 目录里没有 index.html | 建 index.html |
| `timeline-missing` | 全部 | 目录里没有 timeline.json | 按 docs/timeline-schema.zh-CN.md 写 |
| `timeline-invalid` | 全部 | timeline.json 不合 v1 schema，`detail.path` 给出 JSON 路径 | 改 `detail.path` 指的字段 |
| `brand-invalid` | 全部 | timeline.json 的 `brand` 指的 brand.json 不存在、不是合法 JSON 或不合 brand schema，或者它写的 logo 和字体文件不在 brand.json 所在目录里、不是本地文件、没写许可证、不是能用的 .ttf 或 .otf。`detail.file` 是 brand.json 的路径，`detail.path` 是出错字段的 JSON 路径 | 按 message 改 `detail.path` 指的字段，见 references/brand.md |
| `font-invalid` | 全部 | assets/fonts/ 里的字体文件没在 assets/SOURCES.json 写许可证、读不出（不是 .ttf 或 .otf、是字体集或 WOFF、没有 Unicode 字符表）、没有字体族名、字体族名和 flipbook 字体或 CSS 通用名撞了，或者两个文件是同一字体族同一字重同一字形。`detail.file` 是出错的文件 | 按 message 补许可证、换文件或改名 |
| `protocol-missing` | 全部 | 页面没定义 `window.__flipbook`，或读它时抛错 | 调运行时库的 `composition({ seek })` |
| `protocol-mismatch` | 全部 | `window.__flipbook.protocol` 不是 1 | 设成 1 |
| `ready-timeout` | 全部 | `ready` 60 秒内没结束（从开始加载页面算）。读 `window.__flipbook` 时页面不再应答（脚本或 getter 里死循环）也算在这 60 秒里，超时报这个码并关掉页面 | ready 里不等定时器和 rAF |
| `ready-failed` | 全部 | `ready` 被拒，常见是字体或图片加载失败 | 按 message 修 |
| `seek-timeout` | 全部 | 单次 seek 超过 10 秒（`--seek-timeout` 可改） | seek 里不等 rAF、定时器和事件 |
| `seek-failed` | 全部 | seek 抛错 | 按 message 修 |
| `page-error` | 全部 | 页面有未捕获的异常 | 按 message 修 |
| `console-error` | 全部 | 页面往控制台打了错误 | 按 message 修 |
| `resource-failed` | 全部 | 请求的文件在合成目录里不存在 | 补文件或改路径，图片放 assets/ |
| `external-request` | 全部 | 页面想联网，已拦下。HTTP 请求和 WebSocket 在 Playwright 这层拦，`detail.url` 是目标地址。WebRTC 和 WebTransport 在页面里直接报错，`detail.url` 是 `webrtc:<构造函数名>` 或 `webtransport:<地址>` | 文件拷进 assets/ 用相对路径 |
| `path-escape` | 全部 | 请求的路径解析后落在合成目录外，已拒绝 | 所有文件放合成目录内 |
| `unsafe-output` | check、snapshot、audio、render | `.flipbook/` 或 `out/` 里有软链，或该是目录的地方是文件，这次什么都没写。`detail.paths` 列出这些路径 | 删掉这些路径（软链只删链接本身），再跑一次 |
| `static-forbidden` | check | 源码里有禁用写法，只报 warning | 换成 t 的纯函数写法 |
| `seek-order-dependent` | check | 同一个 t 换个 seek 顺序画面就变，有跨帧状态 | 去掉帧间累积的状态，全部由 t 算出 |
| `clock-dependent` | check | 换虚拟时钟起点画面就变，读了 Date 或 performance.now。只抽三帧比，没变不代表没读时钟 | 只用 seek 传进来的 t |
| `random-dependent` | check | 换随机底层种子画面就变，用了 Math.random 或 crypto | 用运行时库的 `rng` 或 `rand` |
| `forbidden-api-call` | check | 页面调用了规矩禁用的时钟或随机函数，按函数各报一条，`detail.api` 是函数名，`detail.count` 是次数，`element` 是第一次调用的 `文件:行号`。计数覆盖基准页从加载到最后一次 seek 的全过程，被数的有 `Date.now()`、`new Date()`、`Date()`、`performance.now()`、`performance.timeOrigin`、`document.timeline.currentTime`、不带日期的 `Intl.DateTimeFormat`、`Temporal.Now.*`、`Math.random()`、`crypto.getRandomValues()`、`crypto.randomUUID()`。这些调用拿到的仍是虚拟时钟和固定种子的值，所以画面不一定变，但一律报错。Worker 和 iframe 里的调用数不到 | 换成 seek 传进来的 t，随机数用 `rng` 或 `rand` |
| `late-paint` | check | 同一个 t 不重新 seek 连截两张不一样，有迟到的绘制 | seek 里画完，图片解码放 ready |
| `blank-frame` | check、render | 画面是一整块纯色：缩到 320×180 灰度后，偏离中位灰度超过 16 灰阶的像素不到 0.05%。check 里全部抽样帧都空才是 error，部分空报 warning。render 里连续 1.5 秒以上才是 error | 查 seek 在这些时刻有没有画 |
| `paper-only` | check、render | 画面和只开纸底层的基线一样：缩到 320×180 灰度后，和最近一张基线相差超过 16 灰阶的像素不到 0.05%。check 和 render 的判定规则同 `blank-frame`。render 每秒截一张基线。render 里空白帧和只剩纸底的帧合起来按「没有内容」连续计时，两类交替出现也不会被切断，类型码取两类里帧数多的那个，`detail` 里有 `blankFrames` 和 `paperFrames` | 查内容层是否因报错没画 |
| `missing-glyph` | check、render | 文字里有 flipbook 字体和这条片子自带的字体都没有的字，`detail.chars` 列出 | 换掉这些字 |
| `font-fallback` | check、render | 文字用了系统字体而不是 flipbook 字体或自带字体。自带字体指 brand.json 的 `fonts.files` 和 assets/fonts/ 里写了许可证的字体，按它们各自的码位表核。DOM 字看 Chromium 实际用的字体。Canvas 字按 `ctx.font` 的字体链逐字核：某个字在找到含它的 flipbook 字体或自带字体之前先碰到别的字体名（系统字体或 `serif` 这类通用名），或者整条链都不含它，就报，`detail.chars` 列出这些字 | font-family 用 "Noto Serif SC"、"LXGW WenKai" 或自带字体，自带字体缺字时在它后面接 "Noto Serif SC" |
| `text-offstage` | check | 文字完全出来的时刻（cue 的 settle 时刻），有一行越过画面边缘。每一行用 `Range.getClientRects` 取框，已含 transform。整段落在画面外的字也报，只有 `display: none`、`visibility: hidden` 或 `opacity: 0` 的字不算。运行时 `fillText` 登记的 canvas 字，框是字形四个角经画布当前变换（含旋转、倾斜、翻转）和 `maxWidth` 压缩后的包围框，再按画布的布局尺寸换成页面像素。画布元素自己的 CSS 旋转不计入 | 把字挪进画面或缩小，故意出画的字加 `data-flipbook-allow-overflow` |
| `text-safe-area` | check | 同一时刻，有一行落进画面外沿 5% 的边距里，只报 warning | 离四边至少留宽高的 5%，或加 `data-flipbook-allow-overflow` |
| `low-contrast` | check | 同一时刻，文字和背后画面的对比度低于 3:1（大字标准），只报 warning。量法：同一帧截两张，第二张把 DOM 文字设成透明，变了的像素就是字形，字色取变化最大的三成像素在第一张里的均值，背景取同一批像素在第二张里的均值，按 WCAG 相对亮度算比值，`detail.measured` 为 true。字和背后分不开时（藏起来前后变化超过 6 个色阶的像素不到 12 个，多半是同色字）也报这个 warning，`detail.measured` 为 false。Canvas 里画的字不量，列在 `check.contrastSkipped` 里（`frame`、`element`、`reason`） | 加深或调亮文字或背景，或在字下垫一块实色底 |
| `stage-size` | check | html 或 body 的布局尺寸比 timeline 的宽高大，只报 warning。被 `overflow: hidden` 裁掉的出画内容不算 | 舞台按 timeline 尺寸写，隐藏溢出 |
| `freeze` | render | 没声明 hold 的场景里画面 1.5 秒以上不动：成片缩到 320×180、高斯模糊（sigma 1.5）后用 ffmpeg freezedetect（`n=-60dB`）判定，只算落在没声明 hold 的场景里的部分。相邻的非 hold 场景连起来算，场景边界不切断定格，跨了几场时 `element` 是 `scenes <id>, <id>` | 让画面动起来，或给场景加 `"hold": true` |
| `glitch` | render | 成片均匀抽 8 帧解码，和截图原帧在 480×270 上比 PSNR，低于 30 dB 就报，证据是最差那一帧的截图原帧和成片解码帧（`glitch-f<帧号>-captured.png`、`-decoded.png`）。送帧管道断了也报这个码 | 重渲一次，还出现就带 JSON 报 issue |
| `frame-count` | render | 成片帧数和 timeline 不符 | 重渲一次，还出现就带 JSON 报 issue |
| `duration-mismatch` | render | 成片时长和 timeline 不符（容差一帧）。有音轨时，音轨时长和画面差超过一帧和一个 AAC 包（1024 个采样）中较大者也报这个码 | 重渲一次，还出现就带 JSON 报 issue |
| `color-tags` | render | 成片不是 yuv420p 或缺 bt709 色彩标记 | 带 JSON 报 issue |
| `audio-skipped` | audio | `audio` 命令没东西可合成：`audio.mode` 不是 `preset`，也没有 sfx cue，只报 warning | 片子本来就不要合成的声音时不用改，要配乐就写 `"mode": "preset"` |
| `audio-missing` | render | timeline 要声音（`preset`、`file` 或有 sfx cue），成片却没有音轨 | 重渲一次，还出现就带 JSON 报 issue |
| `audio-loudness` | render | 有配乐的音轨整合响度不在 -14 LUFS 上下 1 LU 内 | 重渲一次，还出现就带 JSON 报 issue。自带音乐先确认 `bpmOffset` 之后不是静音 |
| `audio-peak` | render | 音轨真峰值高于 -1 dBTP | 重渲一次，还出现就带 JSON 报 issue |
| `audio-cue-offset` | render | 某个音效的峰值离它的 cue 帧超过一帧，或在音轨里找不到，`element` 是 `cue <id>` | sfx cue 之间至少隔 1/8 拍。隔开了还报就重渲一次，再出现带 JSON 报 issue |
| `render-busy` | render | 同一合成目录有另一个 render 在跑，不计入重试次数 | 等它结束 |
| `internal-error` | 全部 | flipbook 自己出错 | 别改合成，带 JSON 报 issue |

`clock-dependent` 和 `random-dependent` 各开一个新页面，把虚拟时钟起点推后约 34 小时或换掉随机底层种子，再取三帧和基准比。扰动页上出的任何问题（加载失败、协议、`seek-failed`、`seek-timeout`、`external-request`、`page-error` 等）只要基准页上没有，就照原类型码报成失败，`message` 末尾写明是在哪种扰动下出现的，`detail.perturbation` 给出扰动条件（`change` 为 `clock` 或 `random seed`，以及偏移量或种子）。

文字类检查（`missing-glyph`、`font-fallback`、`text-offstage`、`text-safe-area`、`low-contrast`）在 timeline 里每个文字 cue 的 settle 时刻取样，没有文字 cue 时取三个抽样帧。带 `data-flipbook-allow-overflow` 的元素及其子元素不做 `text-offstage` 和 `text-safe-area` 检查，运行时库 `registerText` 登记的 canvas 文字可以传 `allowOverflow: true`。

`blank-frame` 和 `paper-only` 在 check 里只看抽样帧：全部抽样帧都空才是 error，部分为空报 warning。在 render 里逐帧看，没有内容的画面（两类合起来）连续超过 1.5 秒才报 error。

音频类检查（`audio-missing`、`audio-loudness`、`audio-peak`、`audio-cue-offset`）只在 timeline 要声音时跑，量法见下面的「音频」一节。

## 音频

### audio 命令

`flipbook audio <dir>` 按 timeline 合成配乐和音效，写到 `.flipbook/audio/`，报告的 `command` 是 `audio`。render 会自己调用它，单独跑是为了先听。每次都重新合成，不用缓存。

- `artifacts`：`music`（有预设配乐时）、`sfx`（有 sfx cue 时），都是 WAV 路径。
- `audio`：`mode`、`preset`、`key`、`progression`、`sampleRate`（48000）、`samples`、`durationSec`、`synthMs`，`music` 和 `sfx` 各有 `file`、`sha256`、`peakDb`，`sfx.cues[]` 每项有 `id`、`sfx`、`frame`、`target`（cue 帧在 48 kHz 上的采样位置）、`peakSample`（合成后音效轨在 cue 附近实际最大的采样位置）。
- 没东西可合成时报 `audio-skipped` warning，退 0。

### render 报告里的 audio

`render.audio` 在 timeline 不要声音时是 `null`，否则有：

| 字段 | 说明 |
|---|---|
| `codec`、`sampleRate`、`channels`、`durationSec` | 成片音轨，ffprobe 读 |
| `mode`、`preset`、`key` | 照 timeline |
| `integratedLufs`、`truePeakDbtp` | 成片音轨用 ffmpeg `ebur128`（`peak=true`）量的整合响度和真峰值。短于 0.4 秒或静音时整合响度为 `null` |
| `loudnessChecked` | 有配乐且量得出整合响度时为 true，这时才查 -14 LUFS |
| `effectsLagMs` | 音效轨在成片里整体晚了多少毫秒，找不到时为 `null` |
| `cues[]` | 每个音效：`id`、`sfx`、`frame`、`expectedSec`（帧号除以 fps）、`measuredSec`、`offsetMs`、`match` |
| `mix` | 混音参数：`musicLufs`（配乐自己的响度）、`mixLufs`（混好未增益的响度）、`sfxGainDb`、`gainDb`、`limitDb` |
| `synthMs`、`stemsReused` | 合成耗时，是否用了已有的轨 |

### 量法

- 音轨时长：和画面差的容差取一帧和一个 AAC 包（1024 / 48000 秒）中较大者，超过报 `duration-mismatch`。
- 响度：有配乐（`preset` 或 `file`）时整合响度要在 -14 LUFS 上下 1 LU 内，否则 `audio-loudness`。只有音效时不查整合响度。凡有音轨都查真峰值，高于 -1 dBTP 报 `audio-peak`。
- 音效对帧：音效轨和成片都降到 8 kHz 单声道。有配乐时先用同一条混音链单独渲一遍配乐，在成片里找它的位置和增益，减掉，剩下的基本只有音效。每个音效取峰值前 0.35 秒到峰值后 30 毫秒、再裁到九成能量的一段，一阶差分后在 ±0.25 秒内找和成片最相关的偏移，所有音效合起来找一个偏移。每个音效的实际峰值 = `peakSample` 加这个偏移，和 cue 帧的时刻差超过一帧报 `audio-cue-offset`。相关系数低于 0.12 算找不到，也报这个码。

## 类型码：环境缺件（退出码 78）

| 类型码 | 含义 |
|---|---|
| `platform-unsupported` | 系统不支持（Windows 请用 WSL2） |
| `node-too-old` | Node 低于 22.19 |
| `ffmpeg-missing` | PATH 上没有 ffmpeg 或 ffprobe |
| `ffmpeg-feature-missing` | ffmpeg 缺 libx264 或必需的滤镜 |
| `chromium-missing` | 钉死版本的 Chromium headless shell 没装（doctor 报，check 和 render 会自动装） |
| `chromium-install-failed` | 安装 Chromium 失败 |
| `browser-launch-failed` | Chromium 起不来 |
| `sandbox-blocked` | 宿主沙箱挡住了 Chromium，正常和单进程两种方式都起不来 |
| `tmp-unwritable` | Chromium 建不了临时目录：TMPDIR 不存在或只读（常见于只读沙箱），单进程也没用，不重试 |
| `resource-exhausted` | 系统杀掉了 flipbook 起的 Chromium 或 ffmpeg 进程，内存或进程数不够时会这样。认法：Chromium 通过 CDP `Target.targetCrashed` 报渲染进程的终止状态是 `killed`、`oom`、`failed to launch` 或 `evicted for memory`（`detail.process` 为 `renderer`，带 `status` 和 `errorCode`），或浏览器整个退出（`detail.process` 为 `browser`，单进程模式下被杀只有这一种），或 ffmpeg 等辅助进程被 SIGKILL 且不是 flipbook 自己按时限杀的（`detail.program`、`detail.signal`）。页面自己崩溃（状态 `crashed`，把 V8 堆撑爆也是这种）仍报 `page-error` |
| `linux-deps-missing` | Linux 缺 Chromium 需要的系统库 |
| `font-download-failed` | 字体下载失败或校验不过 |
| `cache-unwritable` | 缓存目录写不进（常见于沙箱内首次运行） |

## 重试计数

计数放在合成目录的 `.flipbook/attempts.json`，报告的 `attempts` 字段是它的摘要：

| 字段 | 说明 |
|---|---|
| `checkRounds` / `checkLimit` | check 跑了几轮，上限 8 |
| `renderFailures` / `renderLimit` | render 失败几次，上限 3（首次加重来 2 次） |
| `repeatedCodes` / `repeatLimit` | 每个类型码连续失败的次数，上限 3 |

任何一项到上限且这次仍失败，`stop` 为 true。render 成功一次清零全部计数。

## doctor --json

`doctor --prune` 先删掉缓存里这一版用不到的东西（别的 Chromium 构建、下载了一半的字体、清单里已经没有的字体），报告多一个 `pruned` 字段（`removed` 删掉的路径、`bytesFreed`）。除了下面说的缓存写入探测，这是 doctor 唯一会改动机器的开关，仍然不联网、不安装。

`flipbook.doctor/1`：`ok`、`exitCode`（0 或 78）、`version`、`platform`、`node`、`ffmpeg`（路径、版本、`features` 各项功能是否可用）、`chromium`（`revision`、`browserVersion`、`playwrightCore`、`executable`、`installed`）、`launch`（`ok`、`mode`、`version`、`error`）、`cache`（`root`、`exists`、`writable` 能不能写、`fonts` 每款字体在不在。能不能写靠在缓存目录或它最近的已存在父目录里建一个空文件再立刻删掉来判断，这是 doctor 唯一的写操作，写不进就报 `cache-unwritable` 退 78）、`skillInstalls`（各宿主 skill 副本钉的版本、是否比 CLI 旧）、`problems`（环境类型码加修复命令）、`fix`（所有 `problems[].fix` 按顺序去重合并，退 78 时转给用户的就是它）、`warnings`。

经 skill 启动器 `scripts/run.sh doctor` 跑时，不管带不带 `--json`，stdout 都是一个 JSON 对象：能跑 CLI 时是上面这份报告，最前面多一个 `launcher` 字段（钉死版本、找到的 flipbook、npx、bunx、node 和选中的启动方式），退出码取 CLI 的。什么都跑不了时是 `{ ok: false, exitCode: 78, error: "runtime-missing", message, fix, launcher }`，退 78。其他命令什么都跑不了时，同一份 JSON 打在 stderr 上。字体还没下载只报 warning，check 和 render 首次运行时会下载。
