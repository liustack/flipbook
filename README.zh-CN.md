<h1 align="center">flipbook</h1>

<p align="center"><b>让 agent 把一个想法做成讲故事的动画短片，交付前先验收。</b></p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="INSTALL.zh-CN.md">安装</a> ·
  <a href="skills/flipbook/references/rules.md">合成规矩</a> ·
  <a href="skills/flipbook/references/troubleshooting.md">排错</a> ·
  <a href="SECURITY.zh-CN.md">安全</a>
</p>

<p align="center">
  <a href="https://x.com/liustack"><img src="https://img.shields.io/badge/follow-%40liustack-black?style=flat-square&logo=x&logoColor=white" alt="Follow @liustack on X"></a>
  <a href="https://www.npmjs.com/package/@liustack/flipbook"><img src="https://img.shields.io/npm/v/@liustack/flipbook?style=flat-square&label=npm&color=cb3837" alt="npm"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/@liustack/flipbook?style=flat-square" alt="Node.js"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/Not%20backed%20by-Y%20Combinator-FF6600?style=flat-square&logo=ycombinator&logoColor=white" alt="Not backed by Y Combinator">
  <img src="https://img.shields.io/badge/users-unknown-lightgrey?style=flat-square" alt="Users unknown">
</p>

https://github.com/user-attachments/assets/60d42983-127c-48f8-90ed-102034ec5a94

<p align="center"><sub>迈布里奇 1878 年《运动中的马》做成的手翻书：书页越翻越快，马跑了起来，最后停在站着的那一格。12.5 秒，预设配乐。</sub></p>

<table>
<tr>
<td colspan="2" valign="top">

https://github.com/user-attachments/assets/4720fa7b-ec6e-4c25-b361-1ca15e2cc42e

<sub>Claude Opus 5.5 从一句话做出来：一只纸船依次驶过晴天、大雨和大雪。一次跑通，6.7 分钟，1.48 美元。25 秒，预设配乐。</sub>

</td>
</tr>
<tr>
<td colspan="2" valign="top">

https://github.com/user-attachments/assets/5ee87eff-1436-473b-b31a-81c74769659d

<sub>也是一句话做出来的：纸感插画讲一只蝴蝶的一生，卵、毛毛虫、蛹、破茧成蝶，每个阶段配一个小标题。一次跑通，13.5 分钟，2.78 美元。30 秒，预设配乐。</sub>

</td>
</tr>
</table>

<p align="center"><sub>每条视频都能直接播放，全部由 flipbook 渲染：纸船和蝴蝶来自评测，模型只拿到一句话，独自做完。</sub></p>

flipbook 是一个做讲故事的动画短片的 agent skill。agent 先写故事，一个想法分成三到六拍，再写按拍计时的时间轴和一个 HTML 合成文件。skill 逐帧渲染成带配乐的 mp4，交付前拿故事核对一遍成片。默认是纸感：剪纸、铅笔、版画。产品片也这么做：一个想法，产品推动故事。

给想用 AI 做短动画的人：片头、数据动画、概念讲解、书摘、跟着音乐打点的短片。

解决 AI 写的网页动画常出的三件事：录出来每次不一样，中文缺字，成片空白也报成功。

> 0.x 阶段，接口可能变。默认是纸感画面（纸底和颗粒、铅笔排线半调等手作材质、画布上的手写字、物件拼字形模板）加 agent 为每条片子写的乐谱配乐（钢琴、弦乐、长笛、八音盒等合成乐器演奏，另有拨弦、马林巴、软铺底三套快捷预设，四种音效，响度统一到 -14 LUFS），也可以换成无声或自己的音乐，中文不缺字。

## 角色和几套皮

故事得有个让人跟着看的角色。有三种做法，都跟着拍子动：

- **代码画的剪纸纸偶**：`puppet()` 把纸做的部件挂在骨骼上，走路时支撑脚踩在地上不滑，手势和表情按节拍换。
- **部件图装的纸偶**：把部件画在一张图上，自己画或者让生图模型画。`flipbook puppet` 找出关节装好：木刻、水粉、蜡笔都行。
- **逐帧精灵**：一张表上画好整张的动作，来自生图模型、游戏素材包或者你自己的手。`flipbook sprite` 切开、按脚底对齐，走路时跟着支撑脚让它不动，跟不上时会提醒。排得很紧的游戏素材表按格子切。

纸感是主皮，旁边还有两套。**孔版**：两三种专色叠印，版有点错位，浅色调印成颗粒或网点。**像素**：一小片格子，几种颜色，整数倍放大，字用像素字体。在 macOS 14 或更新的系统上，背景是真实场景的照片也能用系统自带的 Vision 抠成纸贴纸。

<table>
<tr>
<td valign="top">

https://github.com/user-attachments/assets/f942b13d-683a-459b-9f4c-b2b1a6454716

<sub>生图模型出的木刻部件图装成的邮差纸偶。风把信吹走，他一路追到邮筒。约 17 秒。</sub>

</td>
<td valign="top">

https://github.com/user-attachments/assets/d9371fc1-27c8-4752-b725-7462784b5c25

<sub>两张生成的精灵表做的邮差走过一排暗着的窗。一扇窗亮了，窗里的孩子挥手，他也挥手。12 秒。</sub>

</td>
</tr>
<tr>
<td colspan="2" valign="top">

https://github.com/user-attachments/assets/a4ac0370-f154-453a-8777-16283a554194

<sub>像素小机器人给土包浇了三天水，第四天早上冒出了芽。12 秒。</sub>

</td>
</tr>
</table>

## 安装

把这句话交给你的 agent：

```text
按 https://github.com/liustack/flipbook/blob/v0.8.0/INSTALL.zh-CN.md 安装 flipbook，装完渲一遍 hello 例子，告诉我结果。
```

或者自己装 skill。Claude Code：

```bash
npx -y skills add liustack/flipbook#v0.8.0 --skill flipbook --global --agent claude-code -y
```

Codex：

```bash
npx -y skills add liustack/flipbook#v0.8.0 --skill flipbook --global --agent codex -y
```

需要 Node 22.19 起和带 libx264 的 ffmpeg（macOS `brew install ffmpeg`，Debian 和 Ubuntu `sudo apt-get install -y ffmpeg`）。第一次 check 或 render 会下载钉死版本的 Chromium（约 95 MB）和三款字体（两款中文字体和一款像素字体，约 55 MB）到用户缓存目录。想省掉每次 npx 的下载，可以全局装 skill 的渲染器：`npm install -g @liustack/flipbook@0.8.0`。

## 从一个想法到一条片

你说：

```text
做一段 20 秒的纸感动画：暴风雨吹灭了灯塔的灯，一只小船借着孩子手里的灯笼找到了回家的路。
```

agent 照 skill 的步骤走：先写 `story.json`（想法、转折、三到六拍）给你看，定规格，写 `timeline.json`（每拍一两场），写 `index.html`，跑 `check` 和 `snapshot` 看联系表改到通过，跑 `render`，拿成片联系表对照故事看一遍后交付：

```bash
bash ~/.claude/skills/flipbook/scripts/run.sh check lighthouse
bash ~/.claude/skills/flipbook/scripts/run.sh snapshot lighthouse
bash ~/.claude/skills/flipbook/scripts/run.sh render lighthouse
# lighthouse/out/video.mp4 和 lighthouse/out/contact-sheet.png
```

每条命令往 stdout 打一份 JSON 报告，失败的每一条都带类型码和改法，再按问题带上时间点、帧号、元素或证据图。timeline.json、story.json、sprite.json 里某个字段校验不过时给出它的路径，文件本身不是合法 JSON 时路径是根 `$`。同一类问题连续改不好，flipbook 会让 agent 停下来把联系表和报告交给你，不会一直烧额度。

## 验收会拦什么

| 阶段 | 查什么 |
|---|---|
| 故事（check 和 render） | 节拍按顺序铺满整条片不留缝，故事有开场、转折和收束，每拍列出它的上屏字并且留够读的时间，每拍的画面从第一帧到最后一帧有变化 |
| check | timeline 字段（报错带 JSON 路径）、禁用写法和对禁用时钟、随机函数的实际调用、控制台报错、资源缺失、联网请求、越界读文件、ready 和 seek 超时、换 seek 顺序画面变不变、换时钟和随机种子画面变不变、迟到的绘制、空白和只剩纸底、缺字和系统字体回退、文字出画和安全区、文字对比度 |
| render | 帧数和时长、连续空白或只剩纸底、没声明 hold 的定格、成片和原帧的 PSNR、yuv420p 和 bt709 色彩标记、音轨时长、响度和真峰值、每个音效是否落在它的帧上 |

同一台机器、同一个版本渲两次，原始帧逐帧哈希一致。

## 评测

0.3 发版前，Claude Code 加 Claude Opus 5.5 无人值守跑了 8 条提示词，各跑一次，8 条全部一次跑通：从一句话到验收通过的成片，中间没人插手。单条耗时 1.9 到 13.5 分钟，花费 0.65 到 2.78 美元。插画故事类（种子长成树、蝴蝶的一生）的耗时和花费是文字和数据类的 2 到 3 倍。之后人工看过每一条成片，没有验收漏掉的坏片。用例、判法和逐条数字见 [docs/eval.zh-CN.md](docs/eval.zh-CN.md)。

## 支持

| 项 | 状态 |
|---|---|
| macOS arm64 | 支持。本机直跑、Claude Code 沙箱、Codex 沙箱都实测过 |
| Linux x64（Ubuntu 22.04、24.04，Debian 12） | 支持。CI 按 INSTALL.md 从头装到渲出 hello |
| Linux arm64 | 尽力而为。Ubuntu 24.04 arm64 容器里测过受限容器和两家宿主的 Linux 沙箱 |
| macOS x64（Intel） | 尽力而为，没测 |
| Windows | 不支持，在 WSL2 里用。原生 Windows 退 78 |
| Claude Code | 沙箱里能跑。首次 check 或 render 要下载 Chromium 和字体，agent 会请你在确认框里点一次允许，之后全在沙箱里跑，不用改设置，也不用重启 |
| Codex | macOS 的 `workspace-write` 同上。Linux 要在 Codex 配置里加一行 `network_access = true`，因为 Codex 的沙箱把 Chromium 启动要用的 socket 调用挡了。`read-only` 模式不让写文件，用 `workspace-write` |
| 照片抠图 | `cutout --subject` 要 macOS 14 或更新，用的是系统自带的 Vision 框架。`cutout` 的其他用法和其余功能都按上面几行的平台支持 |
| 资源 | 1080p 渲染至少 2 GB 内存、128 个进程，不够时退 78 `resource-exhausted` |
| 模型 | 需要 Claude Opus 5 以上或同级模型，宿主要能读图（agent 要看联系表）。门槛按 Claude Opus 5.5 和 Claude Opus 5 设，目前公布的评测数字是 Opus 5.5 的 |

每个平台实测了什么、沙箱怎么放行、容器至少要多少内存，见 [平台](docs/platform.zh-CN.md)。

## 它不做什么

- **3D 角色**：要三维模型、动捕的那种不做。角色是平面的：代码画的或部件图装的剪纸纸偶，还有逐帧精灵。
- **剪真实素材**：你拍的视频它不剪，那是剪辑软件和 ffmpeg 的活。
- **视频模型出的画面**：画面的运动由代码逐帧画出来。静态图（包括生成的图）可以当素材，比如角色部件、背景、道具，来源记进 `assets/SOURCES.json`。
- **旁白**：暂时没有 TTS 旁白，只有配乐和音效。
- **节拍检测**：用自己的音乐时，bpm 和第一拍在第几秒由你给。
- **原生 Windows**：在 WSL2 里用。
- **跨机器逐帧一致**：同一台机器、同一个版本逐帧哈希一致，换机器或系统，画面可能有细微差别。
- **审美**：验收拦的是坏帧，拦不住难看。agent 交付前会看联系表，最后拍板的是你。

## 文档

| 文档 | 什么时候看 |
|---|---|
| [INSTALL.zh-CN.md](INSTALL.zh-CN.md) | 安装，写给 agent 的步骤 |
| [skills/flipbook/SKILL.md](skills/flipbook/SKILL.md) | agent 做片的流程和硬规矩 |
| [故事](skills/flipbook/references/story.md) | 写 story.json：想法、转折、节拍 |
| [story.json v1](docs/story-schema.zh-CN.md) | 故事的字段，check 拿它核对什么 |
| [合成规矩](skills/flipbook/references/rules.md) | 写 index.html |
| [时间轴](skills/flipbook/references/timeline.md) | 写 timeline.json，凑片长 |
| [配乐和音效](skills/flipbook/references/audio.md) | 挑预设、调和强弱，放音效，用自己的音乐 |
| [纸](skills/flipbook/references/paper.md)、[材质](skills/flipbook/references/materials.md)、[画布文字](skills/flipbook/references/text.md)、[构图模板](skills/flipbook/references/templates.md) | 纸感画面的各个部件，样张在 [docs/samples](docs/samples) |
| [角色](skills/flipbook/references/characters.md) | 做角色：代码画的纸偶、部件图装的纸偶、逐帧精灵 |
| [孔版](skills/flipbook/references/riso.md)、[像素](skills/flipbook/references/pixel.md) | 用孔版或像素的画面 |
| [图片](skills/flipbook/references/photo.md) | 找公有领域的图鉴、标本照和古地图，抠成纸贴纸，也包括背景是真实场景的照片 |
| [排错](skills/flipbook/references/troubleshooting.md) | 每个类型码的含义和改法 |
| [报告格式](docs/report-schema.zh-CN.md) | 解析 JSON 报告、判定阈值、输出目录 |
| [timeline.json 格式](docs/timeline-schema.zh-CN.md) | timeline 的每个字段、取值范围、拍怎么换算成帧 |
| [平台](docs/platform.zh-CN.md) | 支持矩阵、沙箱报错和放行办法、容器限制、GPU 结论 |
| [评测](docs/eval.zh-CN.md) | 评测怎么跑、怎么判、结果 |

skill 和 reference 写给 agent 看，只有英文。

## 参与

不接受 pull request，欢迎开 issue，也欢迎 fork，见 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)。安全问题请私下报告，见 [SECURITY.zh-CN.md](SECURITY.zh-CN.md)。

## 许可

MIT。第三方代码、依赖和字体的许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
