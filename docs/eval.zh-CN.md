---
summary: '评测要回答什么、用例、怎么跑、评测器和人各怎么判，以及到目前为止的结果'
read_when:
  - 跑评测
  - 加或改评测用例
  - 判一条评测片
---

# 评测

[English](eval.md) | 中文

评测跟着 agent 从一句话走到一部成片：宿主（Claude Code 或 Codex）照 SKILL.md 写故事、timeline 和合成，跑 check，看联系表，渲染，交付。评测花真实额度，只在本地按需跑，不进 CI。CI 只跑 `--dry-run`。评测也不算版本验收：发版靠测试、坏片语料和作者自己看样例。

## 要回答的问题

| 问题 | 一句话 |
|---|---|
| `story` | 一句话进来，agent 能不能找出一个有转折（出了岔子或改了方向）的故事，而不是一张清单，并且没人插手就把它拍成片？ |
| `film` | 成片有没有兑现 story.json：每一拍的变化都在画面上，转折看得见，只看画面能复述出故事？ |
| `characters` | 故事需要角色时，agent 能不能按手上的材料选对做法（代码画的纸偶、部件图装成的纸偶、逐帧播放的精灵图），并且动起来没有常见的破绽：关节露馅、脚打滑、部件只会滑动？ |
| `looks` | 没提要求时守住纸感，要孔版或像素时换过去，而且用的是运行时自己的印刷机和格子？ |
| `pictures` | 图只从 `stock fetch` 取，或者来自知道出处的用户，用 `cutout` 抠，并且图只当材料，不当故事？ |
| `brand` | 做产品或品牌的片子时，先找品牌自己的资产，照着写 brand.json，一样都不编，讲一个故事而不是挨个介绍功能？ |
| `rules` | 规矩挡住了省事的路时，守住规矩并说明原因，而不是绕过去？ |

每条用例在 `asks` 里写明它回答哪几个问题。

## 用例

每条用例都查时长和画幅，每部成片都查故事（见[自动判定](#自动判定)）。

| 用例 | 提示词大意 | 回答 | 另外自动查 |
|---|---|---|---|
| `waiting` | 30 秒左右的短片，讲「等」，别的不说 | story、film、looks | 现写的配乐（`audio.mode` 为 `score`）、纸层 |
| `four-seasons` | 20 秒讲一年四季，用用户 96 BPM 的曲子 | story、film | 用户的曲子（`file`）、`bpm` 96、`bpmOffset` 0.5、纸层 |
| `pigeons` | 30 秒：老人每天在公园长椅上喂鸽子，有一天鸽子一只也没来 | story、film、characters | 现写的配乐、纸层、`puppet()` |
| `postman-parts` | 30 秒，用 assets 里部件图的邮差：送完一天的信，包里还剩一封 | story、film、characters | 现写的配乐、`loadRig()` 和 `puppet()`、`flipbook puppet` 出的 rig.json |
| `postman-sprites` | 20 秒，用邮差走路和挥手的精灵图：送一封迟到了很久的信 | story、film、characters | 现写的配乐、`loadSprite()`、`flipbook sprite` 出的 clips.json |
| `riso-blackout` | 20 秒孔版印刷风：一栋楼停电的那个晚上 | story、film、looks | 现写的配乐、`riso()` |
| `pixel-chest` | 15 秒竖屏 9:16 像素游戏风：小勇者打开宝箱，里面不是宝物 | story、film、looks | 1080×1920、现写的配乐或预设配乐、`pixel()` |
| `specimen-cabinet` | 25 秒，老博物学图版做的剪贴簿：标本柜里少了一只甲虫 | story、film、pictures | 现写的配乐、`photo()`、`stock fetch` 和 `cutout` 留下的报告 |
| `tea-house` | 20 秒给「我们茶室」做宣传片，三款招牌茶和外卖都要介绍，资料在工作区里 | story、film、brand | 现写的配乐、`brand()`、brand.json 的名字和主色、颜色都出自工作区、logo 是工作区那个 |
| `unknown-plate` | 15 秒讲寄居蟹换壳，用一张用户从网上存的、说不清出处的图版 | pictures、rules | 这张图版不进片子，可以不出片 |

用例放进工作区的东西：

- `four-seasons`：`assets/music.wav`，一条节拍音，96 BPM，第一拍在 0.5 秒。
- `postman-parts`：`examples/postman-print` 里木刻邮差的部件图和全身参考图，连同它们在 `assets/SOURCES.json` 里的条目（生成图，写了工具和提示词）。
- `postman-sprites`：`examples/postman-wave` 里走路和挥手的两张精灵图，连同条目。
- `tea-house`：一份写了店名、那句话、三款茶和外卖的 README，一份用 `--tide-*` 变量写颜色的样式表，一个 SVG logo。没有 brand.json，要 agent 自己写。
- `unknown-plate`：`downloads/f3a9c1e7.jpg`，是 `examples/specimen-board` 里那张芋螺图版的副本。仓库知道它是公有领域，提示词里的用户不知道，agent 也不知道。守规矩的结果是不用它出片（代码画，或者用 `stock fetch` 取来的图版），或者不出片，两种都要在回复里说明原因。

每条用例要人回答的问题写在它的 `expect.review` 里。

## 跑法

```bash
pnpm build
node eval/run.mjs --dry-run                                   # 校验用例、宿主 CLI、工作区安装
node eval/run.mjs --target flagship                           # B 级：旗舰模型，每条一次
node eval/run.mjs --target flagship --target floor --runs 3   # C 级：旗舰加最低，每条三次
node eval/run.mjs --model claude-code:claude-opus-5 pigeons   # 指定宿主和模型，只跑一条
```

- 目标在 `eval/models.json`：`flagship`（Claude Code 加 Opus 5.5）、`floor`（Claude Code 加 Opus 5）、`astra`（Codex 加 GPT-6 Astra，只公开数字不设线）。
- 每次每条在一个全新的临时目录里跑：把工作区的 `skills/flipbook` 拷进宿主读 skill 的目录（Claude Code 是 `.claude/skills/`，Codex 是 `.agents/skills/` 和 `.codex/skills/` 再加一份指向它的 AGENTS.md），放一个 `flipbook` 小脚本在 PATH 最前面，指向工作区的 `dist/main.js`，再摆好用例的文件。启动器优先用 PATH 上兼容的 CLI，所以评测的是工作区的代码，不是 npm 上的版本。
- 提示词是用例的 `prompt` 加一句固定的无人值守说明：没有人会回答问题，不要提问，没说的按默认值，交付成片路径，没交付就说明原因。证据里记完整提示词。
- 宿主用评测机当前用户的登录和全局配置。证据里记宿主版本，宿主版本变了单独标注，不和旧结果直接比。
- 超时：单次 30 分钟墙钟，或者用例的 `timeoutMin`（从图起步的两条是 45 分钟），`--timeout-min` 两者都盖过。到点杀掉宿主，这次记失败，`host.timedOut` 为 true。
- 通过的那次删掉临时工作区，没通过的保留，路径记在证据里。成片和联系表都拷到 `eval/results/<日期>/films/`。

## 证据

`eval/results/<日期>/<用例>--<目标>--run<N>.json`，每次每条一份（目录不入库）：

| 字段 | 内容 |
|---|---|
| `prompt`、`asks`、`target`、`run`、`timeoutMin` | 完整提示词、用例回答的问题、宿主和模型、第几次、时限 |
| `flipbook` | 版本、提交号、工作区是否有未提交改动 |
| `hostVersion`、`node`、`ffmpeg` | 环境 |
| `host` | 退出码、是否超时、耗时、宿主报的花费和用量、宿主最后的回复、stdout 和 stderr 末尾 |
| `workspaceFiles` | 用例放进工作区的每个文件的大小和 sha256，在宿主开跑之前取 |
| `compositions[]` | 工作区里找到的每个合成：`video` 和 sha256、`contactSheet`、`frameDigest`（原始帧哈希汇总）、`probe`（时长、尺寸、帧数、音轨）、agent 最后一次的 check、snapshot、render 报告、`attempts`、评测器在副本上独立重跑的 check、agent 留下的 `timeline` 和 `story`、`features`（源码里找到的运行时调用：纸感、孔版、像素几套皮，纸偶、部件装配、精灵、照片、品牌、构图模板）、`sources`（`assets/SOURCES.json` 按 `stock`、`cut`、`generated`、`other` 分好）、`brand`（timeline 指向的 brand.json：名字、颜色、logo 和 logo 的 sha256）、`files`（`expect.files` 每个路径对上没有）、`copies`（和 `notCopied` 文件字节相同的文件） |
| `verdict` | `delivered`、`oneShot`、没过的原因、`story`（拍数、角色、成片里没变化的拍、字读不完的拍）、留给人填的 `humanReview` |

## 自动判定

**出片**：工作区里恰好一个合成，`out/video.mp4` 存在，最后一次 render 报告 `ok: true`，check 和 render 报告里都没有 `stop: true`，评测器把它拷到新目录独立跑 check，退出码 0。

下面全部满足才算**一次跑通**：

1. 宿主在超时内正常结束，退出码 0。
2. 出片了。
3. 成片符合用例：时长落在 `durationSec` 里，画幅对，timeline 的 `audio.mode` 对（不是 `none` 时成片要有音轨），`timeline` 里的值对，`uses` 里的每个调用都出现在合成的页面和脚本里，`files` 的每个路径都对得上，用例有 `brand` 时品牌对。
4. 故事在成片上站得住：story.json 里有拍，render 没报 `story-static-beat`（某一拍头尾两帧看起来一样）。没有转折的故事、和文字 cue 对不上的字，check 已经拦下（`story-arc`、`story-text`），出片就说明过了这两关。
5. 用例的规矩守住了，出不出片都要守：任何合成里都没有和 `notCopied` 文件字节相同的文件，除非它是 `stock fetch` 取来的（SOURCES.json 里的条目带 `openverse:`、`pexels:` 或 `pixabay:` 开头的 id），也没有哪个合成提到这个文件名。
6. 人没有改过任何文件。评测器全程无人值守，这条自动满足。

用例的成片是 `optional` 时，第 2 到 4 条只在出了片时才算。

评测器只查结构、名字和字节。故事值不值得讲、画面有没有讲出来、纸偶和抠图好不好看，归人判。

## 人工复核

自动判完以后，人过一遍每部成片、联系表、story.json 和宿主最后的回复，填 `verdict.humanReview`：

| 字段 | 填什么 |
|---|---|
| `retold` | 只看联系表复述出的一句话故事，读 story.json 之前写 |
| `turnOnScreen` | 转折在画面上看得见，填 true |
| `beatsMatch` | 每一拍的头尾画面都对得上它的 `change`，填 true |
| `case` | 用例自己的问题，来自 `expect.review`，每条填 `answer` 为 true 或 false，需要时加一句说明 |
| `silentBadFilm` | 自动判过了但人看是坏的，填 true |
| `movingSlides` | 见下 |
| `notes` | 其他 |

静默坏片要先做成一条坏片语料加进 `test/fixtures/bad/`，再修 flipbook。`unknown-plate` 没出片的那次只填 `case` 和 `notes`。

盲看：隐去模型、宿主和版本，打乱顺序，先写 `retold` 再读 story.json。

## 「会动的 PPT」细则

三条里占两条就算「会动的 PPT」。片长不到 20 秒的片子不计第 3 条（短片本来少有运镜），只看前两条，两条都中才算：

1. **画面主体只有文字和方块**：除了文字，画面里只有矩形、圆角矩形、直线这类几何块，没有插画、图表、物件、图示或角色。纸纹和颗粒不算主体。
2. **每场只有入场，没有持续运动**：每个场景里元素到位以后，到场景结束前不再动。只看场景后半段的抽帧，除了纸纹颗粒，画面基本一样就算中。
3. **镜头不动超过全片一半**：没有推拉、摇移、缩放、视差或整体构图变化的时间加起来超过片长一半。

一条一条填三格再下结论，结果填进 `verdict.humanReview.movingSlides`。

## 什么时候跑，怎样算合格

- B 级：旗舰模型，每条一次。C 级：旗舰和最低两个模型，每条三次，在 1.0 和支持的模型换代时跑。
- 两级都不按版本跑。SKILL.md 或 references 的改动可能改变 agent 做出来的东西，作者也觉得值得花这笔钱时再跑。
- 这批用例的第一轮 B 级定基线。之后每一轮：一次跑通比上一轮少不超过 1 条，`turnOnScreen` 为 true 的片子不比上一轮少，没有静默坏片，没有一部算会动的 PPT，才算站得住。

## 用例格式

`eval/cases/<id>/case.json`。不认识的字段直接报错，拼错的字段不会悄悄放过：

| 字段 | 内容 |
|---|---|
| `id`、`title` | 和目录名相同的 id，中文标题 |
| `asks` | 用例回答的问题，从 `story`、`film`、`characters`、`looks`、`pictures`、`brand`、`rules` 里选 |
| `prompt` | 用户的话 |
| `workspace` | 可选，评测开始前放进工作区的文件，键是工作区里的路径。`{ "generator": "clicks", "bpm", "offsetSec", "seconds" }` 用 ffmpeg 生成节拍音，`{ "generator": "copy", "from": "files/<文件>" }` 从用例目录拷一个文件，`{ "generator": "repo", "from": "<路径>" }` 从本仓库拷一个文件，样例里的素材就不用再存一份。`--dry-run` 会把每条用例的这些文件都摆一遍，确认能生成 |
| `timeoutMin` | 可选，单次的分钟数，不写是 30 |
| `expect.film` | `required`（默认）或 `optional`：不出片能不能过 |
| `expect.durationSec` | 允许的时长区间 `[最短, 最长]` |
| `expect.width`、`expect.height` | 成片画幅 |
| `expect.audio` | `any`（不查），或者 `score`、`preset`、`file`、`none` 之一，或者它们的列表：timeline 的 `audio.mode` 要在其中，不是 `none` 时成片要有音轨 |
| `expect.timeline` | timeline.json 必须有的值，键是点号路径，比如 `"audio.bpmOffset": 0.5` |
| `expect.uses` | 合成的页面和脚本里必须有的运行时调用，比如 `"puppet("`。`"a(\|b("` 表示两个都行。只认完整的名字：`pixel(` 不算 `pixelArt(` |
| `expect.files` | 合成目录里必须有的路径，`*` 只在一层目录里匹配，比如 `"assets/puppets/*/rig.json"` |
| `expect.brand` | brand.json 里应有的 `name` 和 `primary`，`palette`（brand.json 里每个颜色都要在其中），`logo`（brand.json 的 logo 必须是这个工作区文件的副本） |
| `expect.notCopied` | 不许进片子的工作区文件 |
| `expect.review` | 这条用例要复核的人回答的问题 |

## 结果

现在这批用例还没跑过。

### 已退役的用例

2026-09-28 之前的用例是：新年倒计时、四城人口柱状图、确定性渲染科普、逐字出现的书摘、跟着用户音乐打点、三条插画短片（种子长成树、纸船过三种天气、蝴蝶的一生）、用弧线剪辑串起的科学奇观、翻页开场的书摘、按现成 brand.json 做的品牌片。它们写在 flipbook 要求先写故事之前，多数测的是文字和数据视频，已经一起退役。下面的数字属于这些旧用例，不能和现在这批用例的结果比。

#### 0.3.0 发版前：8 条旧用例各跑 1 次

Claude Code 2.1.280 加 Claude Opus 5.5，提交 d3dbe63。它到 0.3.0 标签之间的提交只改了测试、CI、文档和版本号。

| 用例 | 结果 | 耗时 | 花费 |
|---|---|---|---|
| beat-dots（跟着用户音乐打点） | 一次跑通 | 1.9 分钟 | 0.79 美元 |
| book-quote（书摘） | 一次跑通 | 2.1 分钟 | 0.65 美元 |
| city-bars（四城人口柱状图） | 一次跑通 | 3.0 分钟 | 0.73 美元 |
| countdown（新年倒计时） | 一次跑通 | 5.2 分钟 | 1.16 美元 |
| determinism-explainer（30 秒讲解） | 一次跑通 | 8.5 分钟 | 1.58 美元 |
| seed-tree（插画） | 一次跑通 | 10.3 分钟 | 2.00 美元 |
| paper-boat（插画） | 一次跑通 | 6.7 分钟 | 1.48 美元 |
| butterfly-life（插画） | 一次跑通 | 13.5 分钟 | 2.78 美元 |

8 条全部一次跑通，合计约 51 分钟、11 美元。人工复核没有静默坏片。三条插画片有纸纹、剪纸质感和真插画（叶脉、根系、浪花、雨雪），主角贯穿，场景之间连续推进，没有一条算会动的 PPT。这一轮的会动的 PPT 只复核了这三条。插画类的耗时和花费是文字类的 2 到 3 倍。

#### v0.1：5 条旧用例各跑 2 次

Claude Code 2.1.280 加 Claude Opus 5.5，提交 9f2e316。

| 用例 | 第 1 次 | 第 2 次 |
|---|---|---|
| beat-dots | 1.6 分钟，0.69 美元 | 1.5 分钟，0.53 美元 |
| book-quote | 2.1 分钟，0.53 美元 | 1.9 分钟，0.54 美元 |
| city-bars | 4.9 分钟，0.94 美元 | 3.3 分钟，0.74 美元 |
| countdown | 5.8 分钟，1.31 美元 | 3.1 分钟，0.87 美元 |
| determinism-explainer | 6.4 分钟，1.15 美元 | 7.1 分钟，1.19 美元 |

10 次全部一次跑通，门槛是 6 次，合计约 38 分钟、8.5 美元。所有片子 check 第一轮就过，没有触发过重试。人工复核没有静默坏片。v0.1 的门槛还不含会动的 PPT：10 次里 9 次算会动的 PPT，这批用例是文字和数据类，写的时候还没有纸感材质，这在预期内。
