# flipbook

**让 agent 从一句话做出一条验收过的 mp4 动画。**

flipbook 是一个 agent skill 加一个命令行工具。你对 Claude Code 说「做一段 15 秒的新年倒计时」，agent 写一个 HTML 合成文件和一份节拍时间轴，flipbook 在无头 Chromium 里逐帧确定性地渲染成 mp4，交付前自动查空白、定格、花屏、缺字、文字出画和不确定的画面，查不过就告诉 agent 哪一秒、哪个元素、怎么改。

给想用 AI 做短动画的人：片头、数据动画、概念讲解、书摘、跟着音乐打点的短片。解决的是 AI 写的网页动画「录出来每次不一样、中文缺字、成片空白也报成功」这几件事。

> 0.x 阶段，接口可能变。当前版本 0.1.0：无声或带自己音乐的 mp4，中文不缺字。纸感材质、构图模板、配乐合成在后面的版本。

## 安装

把这句话交给你的 agent：

```text
按 https://github.com/liustack/flipbook/blob/v0.1.0/INSTALL.md 安装 flipbook，装完渲一遍 hello 例子，告诉我结果。
```

或者自己装 skill：

```bash
npx -y skills add liustack/flipbook#v0.1.0 --skill flipbook --global
```

需要 Node 22.19 起和带 libx264 的 ffmpeg（macOS `brew install ffmpeg`，Debian 和 Ubuntu `sudo apt-get install -y ffmpeg`）。第一次 check 或 render 会下载钉死版本的 Chromium（约 95 MB）和两款中文字体（约 50 MB）到用户缓存目录。想省掉每次 npx 的下载，可以全局装 CLI：`npm install -g @liustack/flipbook@0.1.0`。

## 一句话出片

你说：

```text
做一段 15 秒的新年倒计时动画：从 10 倒数到 0，数字要有节奏感，最后出现「2027 新年快乐」。
```

agent 照 skill 走六步：定规格，写 `timeline.json`（按拍写分场和文字），写 `index.html`，跑 `check` 和 `snapshot` 看联系表改到通过，跑 `render`，看成片联系表后交付：

```bash
bash ~/.claude/skills/flipbook/scripts/run.sh check countdown
bash ~/.claude/skills/flipbook/scripts/run.sh snapshot countdown
bash ~/.claude/skills/flipbook/scripts/run.sh render countdown
# countdown/out/video.mp4 和 countdown/out/contact-sheet.png
```

每条命令往 stdout 打一份 JSON 报告，失败的每一条都带类型码、时间点、帧号、元素、证据图和改法。同一类问题连续改不好，CLI 会让 agent 停下来把联系表和报告交给你，不会一直烧额度。

## 验收会拦什么

| 阶段 | 查什么 |
|---|---|
| check | timeline 字段（报错带 JSON 路径）、禁用写法、控制台报错、资源缺失、联网请求、越界读文件、ready 和 seek 超时、换 seek 顺序画面变不变、换时钟和随机种子画面变不变、迟到的绘制、空白和只剩纸底、缺字和系统字体回退、文字出画和安全区、文字对比度 |
| render | 帧数和时长、连续空白或只剩纸底、没声明 hold 的定格、成片和原帧的 PSNR、yuv420p 和 bt709 色彩标记、配乐音轨时长 |

同一台机器、同一个版本渲两次，原始帧逐帧哈希一致。

## 支持

| 项 | 状态 |
|---|---|
| macOS arm64 | 支持，已实测 |
| Linux x64（Ubuntu 22.04、24.04，Debian 12） | 支持 |
| macOS Intel、Linux arm64 | 尽力而为 |
| Windows | 在 WSL2 里用，原生不支持 |
| Claude Code | 已实测，沙箱内能跑（首次下载需要在沙箱外跑一次） |
| Codex | 还没测 |
| 模型 | 门槛按旗舰 Claude Opus 5.5 和最低 Claude Opus 5 设，评测数字随 v0.1 评测公布 |

## 文档

| 文档 | 什么时候看 |
|---|---|
| [INSTALL.md](INSTALL.md) | 安装，写给 agent 的步骤 |
| [skills/flipbook/SKILL.md](skills/flipbook/SKILL.md) | agent 做片的流程和硬规矩 |
| [合成规矩](skills/flipbook/references/rules.md) | 写 index.html |
| [时间轴](skills/flipbook/references/timeline.md) | 写 timeline.json，凑片长 |
| [排错](skills/flipbook/references/troubleshooting.md) | 每个类型码的含义和改法 |
| [报告格式](docs/report-schema.md) | 解析 JSON 报告、判定阈值、输出目录 |
| [评测](docs/eval.md) | 评测怎么跑、怎么判 |

## 参与

不接受 pull request，欢迎开 issue，也欢迎 fork，见 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请私下报告，见 [SECURITY.md](SECURITY.md)。

## 许可

MIT。第三方代码、依赖和字体的许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
