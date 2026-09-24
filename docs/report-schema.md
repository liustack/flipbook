---
summary: 'check、snapshot、render 的 JSON 报告格式、退出码、每个类型码的含义和修法'
read_when:
  - 解析 flipbook 的输出
  - 新增或修改类型码
---

# 报告格式 flipbook.report/1

`check`、`snapshot`、`render` 无论成败都往 stdout 打一份 JSON 报告。进度和日志走 stderr。`doctor --json` 用自己的格式 `flipbook.doctor/1`（见文末）。

## 退出码

| 码 | 含义 | 该谁动手 |
|---|---|---|
| 0 | 全过 | 无 |
| 1 | 片子有问题 | agent 按 `failures` 改合成 |
| 2 | 用法错（参数、目录不存在） | agent 改命令 |
| 78 | 环境缺件（Node、ffmpeg、Chromium、字体、沙箱、系统库） | 按 stderr 里的修复命令处理机器 |

退出码 78 时 stderr 另打一份 JSON 诊断：`error`（环境类型码）、`message`、`meaning`、`fix`（能直接复制的命令或设置）、`detail`、`platform`、`node`。stdout 仍是报告，`environmentError` 字段放同一份诊断。

## 顶层字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `schema` | string | 固定 `flipbook.report/1` |
| `command` | string | `check`、`snapshot`、`render`，用法错时是 `usage` |
| `ok` | boolean | 退出码为 0 时为 true |
| `exitCode` | 0、1、2、78 | 和进程退出码一致 |
| `flipbook.version` | string | CLI 版本 |
| `environment` | object | `platform`（如 `darwin-arm64`）、`node`、`chromium`（`version`、`revision`、`launchMode`：`normal` 或 `single-process`）、`ffmpeg` |
| `composition` | object | `dir`、`hash`（合成目录哈希，`sha256:` 开头，不含 `out/` 和 `.flipbook/`）、`width`、`height`、`fps`、`frames`、`durationSec` |
| `failures` | Finding[] | 错误，任何一条都让退出码变 1 |
| `warnings` | Finding[] | 提示，不影响退出码 |
| `artifacts` | object | 产物路径：`video`、`contactSheet`、`rejectedVideo`、`zoom1` 等 |
| `attempts` | object | 重试计数，见下文 |
| `stop` | boolean | 到重试上限时为 true，agent 应停下向用户报告 |
| `stopReason` | string | `stop` 为 true 时说明卡在哪 |
| `timing` | object | `startedAt`、`durationMs` |

各命令另有一个同名字段：`check`（`seed`、抽样帧、两次 seek 的顺序、证据目录），`snapshot`（`layout`、`tiles` 每格的帧号时间和场景、`zooms`），`render`（`frames`、`fps`、`digest` 原始帧哈希汇总、`captureMs`、`encodeMs`、`verifyMs`、`totalMs`、`captureFps`、`probe`、`contactSheetTiles`）。`render` 还有 `metadata`，和写进 mp4 comment 标签的内容相同。

## 输出目录

合成目录里只有两处是 flipbook 写的：

| 路径 | 谁写 | 内容 |
|---|---|---|
| `out/video.mp4`、`out/contact-sheet.png` | render | 通过验收的成片和成片联系表。没通过时不动 `out/` |
| `out/snapshot/contact-sheet.png`、`out/snapshot/zoom-f<帧号>.png` | snapshot | 预检联系表和局部放大图 |
| `.flipbook/rejected/` | render | 没通过验收的成片和联系表，`artifacts.rejectedVideo` 指向它 |
| `.flipbook/evidence/<命令>/` | check、render | 证据图，每次运行前清空 |
| `.flipbook/timeline.resolved.json` | 全部 | 换算后的 timeline |
| `.flipbook/frame-hashes.json` | render | 每帧原始截图的 sha256 和汇总 |
| `.flipbook/attempts.json` | check、render | 重试计数 |
| `.flipbook/reports/<命令>.json` | check、snapshot、render | 这条命令最近一次的报告，和 stdout 上的相同 |
| `.flipbook/tmp/` | render | 渲染中间件，结束后删掉 |
| `.flipbook/render.lock` | render | 同一目录同时只跑一个 render，另一个报 `render-busy` 退 1，不计入重试次数 |

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
| `timeline-missing` | 全部 | 目录里没有 timeline.json | 按 docs/timeline-schema.md 写 |
| `timeline-invalid` | 全部 | timeline.json 不合 v1 schema，`detail.path` 给出 JSON 路径 | 改 `detail.path` 指的字段 |
| `protocol-missing` | 全部 | 页面没定义 `window.__flipbook` | 调运行时库的 `composition({ seek })` |
| `protocol-mismatch` | 全部 | `window.__flipbook.protocol` 不是 1 | 设成 1 |
| `ready-timeout` | 全部 | `ready` 60 秒内没结束（从开始加载页面算） | ready 里不等定时器和 rAF |
| `ready-failed` | 全部 | `ready` 被拒，常见是字体或图片加载失败 | 按 message 修 |
| `seek-timeout` | 全部 | 单次 seek 超过 10 秒（`--seek-timeout` 可改） | seek 里不等 rAF、定时器和事件 |
| `seek-failed` | 全部 | seek 抛错 | 按 message 修 |
| `page-error` | 全部 | 页面有未捕获的异常 | 按 message 修 |
| `console-error` | 全部 | 页面往控制台打了错误 | 按 message 修 |
| `resource-failed` | 全部 | 请求的文件在合成目录里不存在 | 补文件或改路径，图片放 assets/ |
| `external-request` | 全部 | 页面想联网，已拦下 | 文件拷进 assets/ 用相对路径 |
| `path-escape` | 全部 | 请求的路径解析后落在合成目录外，已拒绝 | 所有文件放合成目录内 |
| `static-forbidden` | check | 源码里有禁用写法，只报 warning | 换成 t 的纯函数写法 |
| `seek-order-dependent` | check | 同一个 t 换个 seek 顺序画面就变，有跨帧状态 | 去掉帧间累积的状态，全部由 t 算出 |
| `clock-dependent` | check | 换虚拟时钟起点画面就变，读了 Date 或 performance.now | 只用 seek 传进来的 t |
| `random-dependent` | check | 换随机底层种子画面就变，用了 Math.random 或 crypto | 用运行时库的 `rng` 或 `rand` |
| `late-paint` | check | 同一个 t 不重新 seek 连截两张不一样，有迟到的绘制 | seek 里画完，图片解码放 ready |
| `blank-frame` | check、render | 画面是一整块纯色：缩到 320×180 灰度后，偏离中位灰度超过 16 灰阶的像素不到 0.05%。check 里全部抽样帧都空才是 error，部分空报 warning。render 里连续 1.5 秒以上才是 error | 查 seek 在这些时刻有没有画 |
| `paper-only` | check、render | 画面和只开纸底层的基线一样：缩到 320×180 灰度后，和最近一张基线相差超过 16 灰阶的像素不到 0.05%。check 和 render 的判定规则同 `blank-frame`。render 每秒截一张基线 | 查内容层是否因报错没画 |
| `missing-glyph` | check、render | 文字里有 flipbook 字体都没有的字，`detail.chars` 列出 | 换掉这些字 |
| `font-fallback` | check、render | 文字用了系统字体而不是 flipbook 字体 | font-family 用 "Noto Serif SC" 或 "LXGW WenKai" |
| `text-offstage` | check | 文字完全出来的时刻（cue 的 settle 时刻），有一行越过画面边缘。每一行用 `Range.getClientRects` 取框，已含 transform | 把字挪进画面或缩小，故意出画的字加 `data-flipbook-allow-overflow` |
| `text-safe-area` | check | 同一时刻，有一行落进画面外沿 5% 的边距里，只报 warning | 离四边至少留宽高的 5%，或加 `data-flipbook-allow-overflow` |
| `low-contrast` | check | 同一时刻，文字和背后画面的对比度低于 3:1（大字标准），只报 warning。量法：同一帧截两张，第二张把 DOM 文字设成透明，变了的像素就是字形，字色取变化最大的三成像素在第一张里的均值，背景取同一批像素在第二张里的均值，按 WCAG 相对亮度算比值。Canvas 里画的字不量 | 加深或调亮文字或背景，或在字下垫一块实色底 |
| `stage-size` | check | html 或 body 的布局尺寸比 timeline 的宽高大，只报 warning。被 `overflow: hidden` 裁掉的出画内容不算 | 舞台按 timeline 尺寸写，隐藏溢出 |
| `freeze` | render | 没声明 hold 的场景里画面 1.5 秒以上不动：成片缩到 320×180、高斯模糊（sigma 1.5）后用 ffmpeg freezedetect（`n=-60dB`）判定，只算落在没声明 hold 的场景里的部分 | 让画面动起来，或给场景加 `"hold": true` |
| `glitch` | render | 成片均匀抽 8 帧解码，和截图原帧在 480×270 上比 PSNR，低于 30 dB 就报。送帧管道断了也报这个码 | 重渲一次，还出现就带 JSON 报 issue |
| `frame-count` | render | 成片帧数和 timeline 不符 | 重渲一次，还出现就带 JSON 报 issue |
| `duration-mismatch` | render | 成片时长和 timeline 不符（容差一帧）。用了自带音乐时，音轨时长和画面差超过一帧和一个 AAC 包（1024 个采样）中较大者也报这个码，没有音轨也报 | 重渲一次，还出现就带 JSON 报 issue |
| `color-tags` | render | 成片不是 yuv420p 或缺 bt709 色彩标记 | 带 JSON 报 issue |
| `audio-skipped` | render | timeline 用了 `audio.mode: "preset"`，预设配乐 v0.3 才有，成片无声，只报 warning | 改成 `{ "mode": "none" }`，或用 `"file"` 放自带音乐 |
| `render-busy` | render | 同一合成目录有另一个 render 在跑，不计入重试次数 | 等它结束 |
| `internal-error` | 全部 | flipbook 自己出错 | 别改合成，带 JSON 报 issue |

文字类检查（`missing-glyph`、`font-fallback`、`text-offstage`、`text-safe-area`、`low-contrast`）在 timeline 里每个文字 cue 的 settle 时刻取样，没有文字 cue 时取三个抽样帧。带 `data-flipbook-allow-overflow` 的元素及其子元素不做 `text-offstage` 和 `text-safe-area` 检查，运行时库 `registerText` 登记的 canvas 文字可以传 `allowOverflow: true`。

`blank-frame` 和 `paper-only` 在 check 里只看抽样帧：全部抽样帧都空才是 error，部分为空报 warning。在 render 里逐帧看，连续超过 1.5 秒才报 error。

音画错位（`av-sync`）和响度检查随 v0.3 的 `audio` 命令一起加，接口在 `src/engine/verify.ts` 的 `verifyAudio`。

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

`doctor --prune` 先删掉缓存里这一版用不到的东西（别的 Chromium 构建、下载了一半的字体、清单里已经没有的字体），报告多一个 `pruned` 字段（`removed` 删掉的路径、`bytesFreed`）。这是 doctor 唯一会改动机器的开关，仍然不联网、不安装。

`flipbook.doctor/1`：`ok`、`exitCode`（0 或 78）、`version`、`platform`、`node`、`ffmpeg`（路径、版本、`features` 各项功能是否可用）、`chromium`（`revision`、`browserVersion`、`playwrightCore`、`executable`、`installed`）、`launch`（`ok`、`mode`、`version`、`error`）、`cache`（`root`、`fonts` 每款字体在不在）、`skillInstalls`（各宿主 skill 副本钉的版本、是否比 CLI 旧）、`problems`（环境类型码加修复命令）、`warnings`。字体还没下载只报 warning，check 和 render 首次运行时会下载。
