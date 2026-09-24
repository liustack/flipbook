# Changelog

## Unreleased

### 纸感

默认皮肤和第一个构图模板：纸、手作材质、画布上的手写字、物件拼字形，附一条鸟蛋样片。

- **纸**：`paperLayer()` 画纸底（纸色、云状深浅、纤维、斑点、纸齿，可选格子纸和暗角），`grainLayer()` 在最上层盖一层纸齿和灰尘。两层都标 `data-flipbook-layer="paper"`，在 setup 里只画一次。`PAPER` 给五种纸色。
- **材质**：`pencil` 铅笔线、`hatch` 排线、`crossHatch` 交叉排线、`halftone` 半调网点、`stipple` 点刻、`tornPaper` 撕纸边。同样的参数画出同样的像素，每一笔按网格位置定，不随调用顺序变。1080p 下 3000 笔排线一帧只要几毫秒。
- **画布文字**：`writeText` 排版（按词换行、对齐、逐词出现），`handText` 用霞鹜文楷加一点手抖，`textOnPath` 沿路径排字。画出来的字都向 check 登记文字框，缺字、字体回退、出画和安全区照常检查。`words()` 和 `wordReveal()` 也能给 DOM 文字做逐词出现。
- **物件拼字形**：`glyphMask` 把数字或汉字变成网格，`packSlots` 在字形里铺大小不一的槽位并顺着笔画转向，`assemble` 让物件按 mark cue 一个个飞进来落位，带缓动、轻微旋转、落地后的摇晃和收紧的投影。每个物件在 setup 里画一次，缓存成贴图。
- **样片 `examples/eggs-five/`**：米色纸上，鸟蛋拼成「5」和「书」两版，各 8 秒，衬线字收尾，每颗蛋落位对一个 mark cue，以后可以直接挂音效。鸟蛋是样例代码，不进运行时库。
- **reference**：新增 paper、materials、text、templates 四篇，片段在 CI 里真跑 check。样张由 `scripts/samples.mjs` 生成到 `docs/samples/`。
- 纸底有细纹理时截帧变慢，1080p 约每秒 8 到 10 帧。纸底 `grain: 0` 加颗粒层 `amount: 0` 约快一倍。

### 声音

- **默认带配乐**：`audio.mode` 写 `preset`，从拨弦（`pluck`）、马林巴（`marimba`）、软铺底（`pad`）三套预设里挑，再填调、和声进行编号和每场强弱，不写合成代码。一小节一个和弦，最后一小节回到主和弦。
- **音效**：`sfx` cue 取 `paper`（翻纸）、`drop`（落下）、`ding`（叮，按调定音高）、`sweep`（扫频），每个音效最响的那一下落在 cue 所在的帧。
- **`flipbook audio <dir>`**：在空白页面里用 OfflineAudioContext 合成，PCM 分块 base64 传回，写成 `.flipbook/audio/` 下的 WAV。同机同版本合成两次逐字节一致。render 自动调用，timeline 没变就直接用已有的轨。
- **混音和响度**：配乐和音效用 amix（`normalize=0`）混合，两遍测响度后线性增益到 -14 LUFS，4 倍过采样限幅，编成 AAC。自带音乐走同一条链，也归一到 -14 LUFS，音效叠在上面。
- **成片验收加上音频**：音效峰值离 cue 帧超过一帧报 `audio-cue-offset`，有配乐时响度不在 -14 LUFS 上下 1 LU 内报 `audio-loudness`，真峰值高于 -1 dBTP 报 `audio-peak`，要声音却没有音轨报 `audio-missing`。只有音效时不查响度，不要声音时这些都不查。
- **timeline 的 audio 定稿**：新增每场强弱 `dynamics`。`preset`、`progression`、`dynamics` 只配 `preset`，`file`、`bpmOffset` 只配 `file`，写错位置报 `timeline-invalid`。`sfx` 只收这四个音效名。
- **skill**：默认值改成有配乐，新增 `references/audio.md`，新增例子 `examples/beat-title/`。

### 平台

- **Codex 能加载这个 skill**：SKILL.md 的 `compatibility` 挪进 `metadata`，过 Codex 的 skill 校验。
- **沙箱识别表**：Chromium 起不来时按实测的报错分行处理。macOS 上撞到 mach port 照旧改用单进程重试，Claude Code 和 Codex 的沙箱里都能起。Codex 的 Linux 沙箱不联网时拒绝 socket 调用、临时目录写不进，这两种单进程也没用，直接退 78 并给出对应宿主的放行办法。报告多了 `detail.signature` 和 `detail.host`。
- **首次下载被沙箱拦**：认出没网络和代理拒绝，提示在沙箱外跑一次或打开网络。SKILL.md 和 INSTALL.md 写上 Codex 的放行设置和 Claude Code 要放行的下载域名。
- **为 Windows 铺路**：缓存放 `%LOCALAPPDATA%\liustack\flipbook`，认出 win64 的 headless shell，设 `FLIPBOOK_ALLOW_WIN32=1` 可以绕过 `win32` 的退 78。run.ps1 在 Windows PowerShell 5.1 下保住 CLI 的退出码和 UTF-8 输出。CI 加 windows-latest 一列。原生 Windows 仍不支持。
- **发版盖日期**：`scripts/release.mjs` 发版时把 CHANGELOG 的 `## Unreleased` 改成 `## 版本号 - 当天日期`，没有 Unreleased 时给该版本的标题盖当天日期。两者都有时拒绝发版。
- **平台文档**：新增 `docs/platform.md`，写支持矩阵、沙箱特征、受限容器的实测结果和 GPU 结论（2D 合成继续用软件光栅）。

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

### 修复

代码审查后的修复，都在打 0.1.0 标签之前。

- **写入不出合成目录**：`.flipbook/` 或 `out/` 里有软链时，check、snapshot、render 报 `unsafe-output`，什么都不写。所有写入先写新名字再改名到位，不跟随软链和硬链。自带音乐按真实路径核在合成目录内，ffmpeg 只按本地文件读，格式走白名单，播放列表和 concat 一律拒收。
- **render 锁**：用 O_EXCL 建，内容是 pid 和随机令牌，不再误夺刚建的锁，释放时只删自己的锁。
- **不卡住、不漏资源**：送帧和收尾都有期限，超时杀掉 ffmpeg 并等它退出。失败路径逐个回收锁、临时目录、浏览器、页面和编码器。协议探测也受 ready 期限约束，关页面最多等 10 秒。
- **check 更严**：扰动页上出的任何问题都算失败，带原类型码和扰动条件。堵住原生时钟入口，实际调用了禁用的时钟和随机函数报 `forbidden-api-call`。整段移出画面的 DOM 字也报 `text-offstage`。canvas 字按 `ctx.font` 的字体链逐字核字形，文字框按四角完整变换取包围框，并处理 `maxWidth` 压缩。量不出对比度的字报 warning，canvas 字列进 `check.contrastSkipped`。
- **timeline**：`cueProgress` 的 settle 时长和换算一致，0 拍在 cue 时刻就到 1。文字 cue 必须在本场内出完。
- **成片验收**：定格和空白按整条时间轴连续计时，不被场景边界和两类空画面的交替切碎。花屏证据复制到 evidence 目录，不再指向渲染完就删的临时目录。
- **网络**：WebSocket 拦下并记进 `external-request`，页面里禁用 WebRTC 和 WebTransport，浏览器内不解析域名。
- **启动器和 doctor**：run.sh 从第一个数字取版本，预发布版只认和钉死版本完全相同的，`doctor` 带不带 `--json` 都输出一个 JSON。缓存目录写不进时 doctor 报 `cache-unwritable` 退 78。退 78、拒写和内部错误的运行也保存报告，存不了在报告里写明。
- **其他**：commander 钉成精确版本。SECURITY.md 写明 Chromium 自身沙箱被关掉时的边界和写入范围。skill 文件里删掉给维护者看的生成和 CI 说明。
