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

render 通过验收才把 `video.mp4` 和 `contact-sheet.png` 移进 `out/`。没通过的放 `.flipbook/rejected/`，`artifacts.rejectedVideo` 指向它。

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
| `ready-timeout` | 全部 | `ready` 超时没结束 | ready 里不等定时器和 rAF |
| `ready-failed` | 全部 | `ready` 被拒，常见是字体或图片加载失败 | 按 message 修 |
| `seek-timeout` | 全部 | 单次 seek 超过 10 秒 | seek 里不等 rAF、定时器和事件 |
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
| `blank-frame` | check、render | 画面是一整块纯色 | 查 seek 在这些时刻有没有画 |
| `paper-only` | check、render | 画面和只开纸底层的基线一样 | 查内容层是否因报错没画 |
| `missing-glyph` | check、render | 文字里有 flipbook 字体都没有的字，`detail.chars` 列出 | 换掉这些字 |
| `font-fallback` | check、render | 文字用了系统字体而不是 flipbook 字体 | font-family 用 "Noto Serif SC" 或 "LXGW WenKai" |
| `stage-size` | check | 页面内容比 timeline 的宽高大，只报 warning | 舞台按 timeline 尺寸写，隐藏溢出 |
| `freeze` | render | 没声明 hold 的场景里画面超过 1.5 秒不动 | 让画面动起来，或给场景加 `"hold": true` |
| `glitch` | render | 成片解码抽样和截图原帧差太多（PSNR 低于 30 dB），或送帧管道断了 | 重渲一次，还出现就带 JSON 报 issue |
| `frame-count` | render | 成片帧数和 timeline 不符 | 重渲一次，还出现就带 JSON 报 issue |
| `duration-mismatch` | render | 成片时长和 timeline 不符（容差一帧） | 重渲一次，还出现就带 JSON 报 issue |
| `color-tags` | render | 成片不是 yuv420p 或缺 bt709 色彩标记 | 带 JSON 报 issue |
| `audio-skipped` | render | timeline 要求配乐，这一版还不渲染声音，只报 warning | 把 audio 设成 `{ "mode": "none" }`，或成片后自己配乐 |
| `render-busy` | render | 同一合成目录有另一个 render 在跑，不计入重试次数 | 等它结束 |
| `internal-error` | 全部 | flipbook 自己出错 | 别改合成，带 JSON 报 issue |

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

`flipbook.doctor/1`：`ok`、`exitCode`（0 或 78）、`version`、`platform`、`node`、`ffmpeg`（路径、版本、`features` 各项功能是否可用）、`chromium`（`revision`、`browserVersion`、`playwrightCore`、`executable`、`installed`）、`launch`（`ok`、`mode`、`version`、`error`）、`cache`（`root`、`fonts` 每款字体在不在）、`skillInstalls`（各宿主 skill 副本钉的版本、是否比 CLI 旧）、`problems`（环境类型码加修复命令）、`warnings`。字体还没下载只报 warning，check 和 render 首次运行时会下载。
