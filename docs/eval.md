---
summary: '评测怎么跑、「一次跑通」怎么判、「会动的 PPT」三条细则、超时和人工复核'
read_when:
  - 跑 B 级或 C 级评测
  - 加或改评测用例
  - 判一条评测片过没过
---

# 评测

评测测的是 agent 从一句话到 mp4 的全程：宿主（Claude Code 或 Codex）照 SKILL.md 写合成、跑 check、看联系表、渲染、交付。评测花真实额度，只在本地按需跑，不进 CI。CI 只跑 `--dry-run`。

## 跑法

```bash
pnpm build
node eval/run.mjs --dry-run                                   # 校验用例、宿主 CLI、工作区安装
node eval/run.mjs --target flagship --runs 2                  # B 级：旗舰模型，每条两次
node eval/run.mjs --target flagship --target floor --runs 3   # C 级：旗舰加最低
node eval/run.mjs --model claude-code:claude-opus-5 countdown  # 指定宿主和模型，只跑一条
```

- 目标在 `eval/models.json`：`flagship`（Claude Code 加 Opus 5.5）、`floor`（Claude Code 加 Opus 5）、`astra`（Codex 加 GPT-6 Astra，只公开数字不设线）。
- 每次每条在一个全新的临时目录里跑：把工作区的 `skills/flipbook` 拷进宿主读 skill 的目录（Claude Code 是 `.claude/skills/`，Codex 是 `.agents/skills/` 和 `.codex/skills/` 再加一份指向它的 AGENTS.md），再放一个 `flipbook` 小脚本在 PATH 最前面，指向工作区的 `dist/main.js`。启动器优先用 PATH 上兼容的 CLI，所以评测的是工作区的代码，不是 npm 上的版本。
- 提示词是用例的 `prompt` 加一句固定的无人值守说明（不要提问，没说的按默认值，做完就交付），证据里记完整提示词。
- 宿主用评测机当前用户的登录和全局配置。证据里记宿主版本，宿主版本变了单独标注，不和旧结果直接比。
- 超时：单次 30 分钟墙钟（`--timeout-min` 可改），到点杀掉宿主，这次记失败，`host.timedOut` 为 true。
- 通过的那次删掉临时工作区，没通过的保留，路径记在证据里。成片和联系表都拷到 `eval/results/<日期>/films/`。

## 证据

`eval/results/<日期>/<用例>--<目标>--run<N>.json`，每次每条一份（目录不入库）：

| 字段 | 内容 |
|---|---|
| `prompt`、`target`、`run` | 完整提示词、宿主和模型、第几次 |
| `flipbook` | 版本、提交号、工作区是否有未提交改动 |
| `hostVersion`、`node`、`ffmpeg` | 环境 |
| `host` | 退出码、是否超时、耗时、宿主报的花费和用量、stdout 和 stderr 末尾 |
| `compositions[]` | 工作区里找到的每个合成：`video` 和 sha256、`contactSheet`、`frameDigest`（原始帧哈希汇总）、`probe`（时长、尺寸、帧数、音轨）、agent 最后一次的 check、snapshot、render 报告、`attempts`、评测器在副本上独立重跑的 check |
| `verdict` | `oneShot`、没过的原因、留给人工复核的字段 |

## 「一次跑通」怎么判

自动判定，下面全部满足才算一次跑通：

1. 宿主在超时内正常结束，退出码 0。
2. 工作区里恰好一个合成目录，`out/video.mp4` 存在。
3. agent 最后一次 render 报告 `ok: true`，check 和 render 报告里都没有 `stop: true`。
4. 评测器把合成拷到新目录独立跑 check，退出码 0。
5. 成片时长落在用例的 `durationSec` 区间里，尺寸对，用例要求的文字都出现在 index.html 或 timeline.json 里，要求配乐的成片有音轨。
6. 人没有改过任何文件。评测器全程无人值守，这条自动满足。

自动判过之后人工过一遍联系表和成片：自动判过但人看是坏的，记为「静默坏片」，填进证据的 `verdict.humanReview.silentBadFilm`，并把这种坏法做成一条坏片语料加进 `test/fixtures/bad/` 再修 flipbook。

## 「会动的 PPT」细则

三条里占两条就算「会动的 PPT」：

1. **画面主体只有文字和方块**：除了文字，画面里只有矩形、圆角矩形、直线这类几何块，没有插画、图表、物件、图示或角色。纸纹和颗粒不算主体。
2. **每场只有入场，没有持续运动**：每个场景里元素到位以后，到场景结束前不再动。只看场景后半段的抽帧，除了纸纹颗粒，画面基本一样就算中。
3. **镜头不动超过全片一半**：没有推拉、摇移、缩放、视差或整体构图变化的时间加起来超过片长一半。

盲看规则：隐去模型、宿主和版本，打乱顺序，只看成片和联系表，一条一条填三格再下结论，结果填进 `verdict.humanReview.movingSlides`。

## 门槛

门槛按 design.md 第 10 节：B 级每个 0.x 次版本，旗舰模型乘 10 条乘 1 次，出片数不低于上一版减 1 条，静默坏片为零，会动的 PPT 不超过 2 条。v0.1 用 5 条用例乘 2 次，至少 6 次一次跑通，报实际数字。C 级在 1.0、大版本和支持模型换代时跑。

## 用例

`eval/cases/<id>/case.json`：

| 字段 | 内容 |
|---|---|
| `id`、`title` | 和目录名相同的 id，中文标题 |
| `prompt` | 用户的一句话 |
| `workspace` | 可选，评测开始前放进工作区的文件。`{ "generator": "clicks", "bpm", "offsetSec", "seconds" }` 用 ffmpeg 生成节拍音 |
| `expect.durationSec` | 允许的时长区间 `[最短, 最长]` |
| `expect.width`、`expect.height` | 画幅 |
| `expect.textInSource` | 必须出现在合成源码里的文字 |
| `expect.audio` | `none` 或 `file` |
| `expect.notes` | 给人工复核看的重点 |

v0.1 的 5 条：新年倒计时（大字数字和定格）、四城人口柱状图（数据图表）、确定性渲染科普（概念图示）、书摘短片（逐字出现）、跟着用户音乐打点（自带音乐和拍点）。都用中文，不依赖 v0.2 的纸感材质。
