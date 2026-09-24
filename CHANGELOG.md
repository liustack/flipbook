# Changelog

## Unreleased

- **CLI 骨架**：`doctor`、`check`、`snapshot`、`render` 四个命令，stdout 输出带版本号的 JSON 报告，退出码 0、1、2、78。
- **确定性渲染**：虚拟时钟接管 Date、performance.now、rAF 和定时器，逐帧 seek 加 CDP 截图，PNG 管道喂 ffmpeg，libx264 yuv420p 显式 bt709。
- **check**：timeline 校验带 JSON 路径，静态扫描禁用写法，乱序 seek、扰动测试、迟到绘制、空白和纸底基线、缺字和字体回退。
- **成片验收**：帧数时长、空白、只剩纸底、定格、花屏、色彩标记，没过验收的成片不进 `out/`。
- **运行时库**：带种子随机、噪声、缓动、timeline 读取、场景辅助、一拍两帧、静态层缓存、内容层开关、文字登记。
- **skill 启动器**：`run.sh` 和 `run.ps1` 按 PATH、npx、bunx 顺序找 CLI，都没有就退 78。
