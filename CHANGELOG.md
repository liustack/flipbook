# Changelog

## 0.1.0 - 2026-09-25

第一个能用的版本：一句话做出一条无声或带自己音乐的 mp4，中文不缺字，交付前自动验收。

- **一个 CLI 四条命令**：`doctor` 离线自检，`check` 预检合成，`snapshot` 出联系表，`render` 渲染并验收。每条命令往 stdout 打带版本号的 JSON 报告（`flipbook.report/1`），最近一次报告另存到 `.flipbook/reports/`。退出码 0 全过，1 片子有问题，2 用法错，78 环境缺件。
- **确定性逐帧渲染**：页面经假源 `http://flipbook.local/` 加载，虚拟时钟接管 Date、performance.now、rAF、定时器和随机数，逐帧 seek 再用 CDP 截 PNG，管道送 ffmpeg 编成 libx264 yuv420p，显式 bt709。同机同版本两次渲染原始帧逐帧哈希一致。
- **check 在渲染前拦住坏片**：timeline 校验报 JSON 路径，静态扫描禁用写法，乱序 seek、换时钟、换随机种子、连截两张，空白和只剩纸底对纸底基线，缺字查码位表加 Chromium 实际用的字体，文字在 settle 时刻查出画、安全区和按像素量的对比度。
- **成片验收**：帧数时长、连续空白或只剩纸底、没声明 hold 的定格、解码帧和原帧的 PSNR、色彩标记、配乐音轨时长。没过验收的成片放 `.flipbook/rejected/`，不进 `out/`。
- **自带音乐**：timeline 里 `audio.mode` 写 `file`，render 按第一拍偏移截好、补齐或截到片长、结尾淡出，编成 AAC 放进成片。
- **浏览器端运行时库**：带种子随机、噪声、缓动、timeline 读取、场景和 cue 辅助、一拍两帧、静态层缓存、内容层开关、canvas 文字登记。
- **沙箱里能跑**：Claude Code 沙箱挡住 Chromium 多进程启动时，自动改用单进程模式，帧和正常模式一致。首次下载 Chromium 和字体需要在沙箱外跑一次。
- **skill**：SKILL.md 写六步流程、默认值、硬规矩、重试上限，三篇 reference（合成规矩、时间轴、排错），reference 里的代码片段在 CI 里真跑 check。启动器按 PATH、npx、bunx 找钉死版本的 CLI，0.x 期间只认同 major.minor。
- **维护工具**：`doctor --prune` 清旧缓存，`scripts/rebaseline.mjs` 比较两个版本的逐帧 PSNR，`eval/run.mjs` 跑提示词乘模型的评测并留证据。
