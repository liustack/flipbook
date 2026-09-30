# flipbook（给 AI agent 的项目说明）

## 目标

flipbook 是一个做讲故事的动画短片的 agent skill。渲染器是 skill 背后的 `flipbook` 命令（npm 包 `@liustack/flipbook`），由 skill 的启动器按钉死版本拉取，不单独当产品介绍。模型先写故事 `story.json`，再写 `timeline.json` 和一个 HTML 合成文件，flipbook 逐帧确定性地渲染成 mp4，交付前拿故事和成片自动验收。纸感是前期的主皮，不是唯一的皮，故事和角色的接口不绑皮。产品宣传片只做讲故事的那种。

## 范围

不加：

- 3D 角色、真实素材剪辑、视频模型出画面、渲染时逐帧生成图、实时录屏。生成的静态图可以当素材（角色部件、背景、道具），和找来的图同等对待，来源、工具、提示词记进 `assets/SOURCES.json`
- TTS 旁白、节拍检测、随包带或另外下载的机器学习模型。系统自带的能力可以用：`cutout --subject` 在 macOS 14 以上经 osascript 调系统的 Vision 抠照片主体，只在准备素材时跑，抠好的 PNG 入库，渲染和 check 不调它
- Remotion 或 HyperFrames 当底座、p5.js
- Windows 原生支持（`win32` 退 78，提示用 WSL2。`FLIPBOOK_ALLOW_WIN32=1` 只给 CI 用）
- 预览（`preview` 命令和双击打开的预览都不做，0.x 看画面靠 `snapshot`）

## 技术路线

- **一个仓库两份发布物**（对外仍是一个 skill）：npm 包（`dist/main.js` 是 Node CLI，`dist/runtime/runtime.js` 和 `audio.js` 是浏览器端 ESM）和 `skills/flipbook/`（只有 SKILL.md、references、启动器，没有代码）。启动器按 PATH、npx、bunx 的顺序找钉死版本的 CLI。
- **合成协议 v1**：页面暴露 `window.__flipbook = { protocol: 1, ready, seek(t) }`。时间只来自 `timeline.json`，Node 先校验并换算成 `.flipbook/timeline.resolved.json`。
- **加载**：Playwright `context.route` 挂假源 `http://flipbook.local/`，从合成目录回文件，`/__flipbook/` 下由 CLI 提供运行时库、字体和换算后的 timeline。非本源请求拦下记进报告。
- **时间**：init script 接管 Date、performance.now、rAF、定时器、Math.random 和 crypto 随机。每帧推进虚拟时钟、调 seek、把 CSS 和 SMIL 动画钉到当前时刻，再用 CDP 截 PNG。
- **浏览器**：playwright-core 精确钉版本，Chromium headless shell 装在 flipbook 自己的缓存（`PLAYWRIGHT_BROWSERS_PATH`），启动参数固定。撞到沙箱特征就改用 `--single-process --no-zygote`，这个模式下每个页面独占一个浏览器。
- **像素分析**：不用图像库，ffmpeg 解码缩放成 gray 或 rgb24 原始字节，在 Node 里算。
- **输出**：stdout 只放 JSON 报告（`docs/report-schema.md`），进度走 stderr。退出码 0、1、2、78。

## 目录

```text
src/
  main.ts          commander 入口
  names.ts         包名、命令名、skill 名、仓库名的唯一来源
  paths.ts         包根目录和运行时文件定位
  skillPin.ts      读各宿主 skill 副本钉的版本
  cli/             doctor、check、snapshot、audio、render、stock、cutout、puppet（抠好的部件装成纸偶）、sprite（精灵图切成一段段动作）、报告和类型码
  engine/          浏览器、页面、时钟、timeline、故事（story.ts）、JSON 校验工具（schema.ts）、截帧、编码、验收、字体和自带字体（只在 zip 里发布的字体由 zip.ts 取出）、品牌资产、缓存、扫描、配乐合成和混音（含文件音效 audioFiles.ts）、图片来源核对（assetSources.ts）、照片主体（vision.ts，经 osascript 调 macOS 自带的 Vision）、抠图用的工具页、渲染进程监视
  runtime/         浏览器端运行时库（core、text、paper、materials、templates、brand、photo、puppet、rig（部件找关节、削描边、读 rig.json）、sprite（逐帧精灵）、riso（孔版印刷）、pixel（像素皮）、audio）
  stock/           找图找声音：Pexels、Pixabay、Openverse 三家的图片搜索和详情，Openverse 的音频搜索，图片和声音格式嗅探、下载防护（只走 HTTPS、拒内网地址、连接钉在核对过的地址上）
  fonts/           字体清单、码位表、OFL 全文
scripts/           发版（含 CHANGELOG 盖日期）、版本号改写、码位表生成、samples.mjs（重出 docs/samples 的样张）、rebaseline（换 Chromium 后比较两版的逐帧 PSNR）、samples-baseline.mjs（记技法样张的帧摘要）
skills/flipbook/   SKILL.md（英文）、references/（story、characters、rules、timeline、audio、paper、riso、pixel、materials、text、templates、brand、photo、troubleshooting）、scripts/run.sh 和 run.ps1
docs/              report-schema.md、timeline-schema.md、story-schema.md、platform.md（支持矩阵、沙箱特征、容器限制）、eval.md
docs/samples/      reference 引用的样张图和它们的源码（src/ 下：paper、materials、riso、text 各出一张图，arc-cuts、brand-intro、lens-montage、page-turn、pixel-sprout、postman、postman-print、specimen-board 是演示技法的完整合成，带 expected.json，story.json 是最小故事，不当故事范例），只在仓库里，不进 npm 包
examples/          讲故事的样例，暂空，以后按体裁补。样例是内容，不是测试
eval/              评测器：cases/（用例，暂空，按新的故事定义重写，dry-run 在没有用例时报 0/0 并说明）、models.json、run.mjs（跑）、cases.mjs（用例格式和校验）、judge.mjs（判）、page.mjs（从 index.html 顺着加载的脚本解析：按绑定认运行时调用，列出页面在哪里点到文件，只作给人看的证据）、shim.mjs（放在 PATH 最前面的 flipbook 小脚本，把每次运行的报告留在工作区外、评测器自己的目录，运行前钉住，运行中被改动就一份不读）、recheck.mjs（在工作区副本上独立复检）、files.mjs（共用的文件小工具，以及判定读工作区文件的唯一入口），测试是同名的 .test.mjs，证据写到 eval/results/（不入库）
test/              vitest 快档，坏片语料在 test/fixtures/bad/
test/e2e/          vitest 端到端档：坏片语料、reference 片段、docs/samples/src 下带 expected.json 的技法样张的 check 和帧摘要
```

## 验证

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build`，全部通过才算完成。`pnpm test` 会先构建。
- 测试分两档，CI（main 和 PR）和 `scripts/release.mjs` 的门禁都跑这两档。`scripts/release.mjs` 要求当前提交已推到 origin/main 且 CI 全绿才发版。
  - `pnpm test`（`test/`）：单元测试和拿小 fixture 跑的引擎测试，本机一分钟内，改代码时随手跑。
  - `pnpm test:e2e`（`test/e2e/`）：坏片语料过 check 和 render，reference 片段过 check，带 expected.json 的技法样张过 check 再比 snapshot 帧摘要，不渲成片，本机约两分钟。本地改了引擎、运行时库、类型码或样张，推送前跑一遍。
- 没有发版档。样例是内容，不是测试：不拿样例的完整渲染当门禁。逐帧确定性、长片的帧数、时长和内存这类问题，只放在针对它们写的引擎测试里（`test/` 和 `test/e2e/`）。
- 样张帧摘要只在记下它的那台机器上比。各样张 `expected.json` 的 `snapshot` 里记着 `machine`（平台、内核版本、CPU 型号）、`chromium` 和 `digest`，`machine` 对不上就跳过。同一版 Chromium 换一台 Mac 摘要就不同（CI 的 macOS 列和作者的 M4 全对不上），所以 CI 各列都只跑样张的 check，摘要比对在作者机器上的本地开发和发版门禁里起作用。摘要是 snapshot 那组帧（每场中间一帧加 12 个等距帧）的截图哈希汇总，由 `pnpm samples:baseline` 在作者的 Mac 上生成，系统升级后也要重出。摘要对不上时先看画面是不是有意改的，是就重出，不是就查引擎。
- 新测试按跑的内容分档：坏片语料、reference 片段、样张的 check 和摘要放 `test/e2e/`。其余放 `test/`，包括拿小 fixture 过一次 check 或 render 的引擎测试，这类单条要几秒内跑完：画面小、帧数少、期限短，别等满 60 秒的 ready 期限。
- 用到浏览器的测试把 fixture 复制到临时目录再跑。首次运行需要联网装 Chromium 和字体，写的是用户缓存目录。
- 坏片语料每类至少一条，新增检查时先加一条会被拦下的坏片。
- 每个合成（样例、样张、夹具、坏片、参考片段、测试里现写的合成）都要有 story.json。样张和不是测故事的夹具用 `test/story.ts` 生成最小的三拍故事（`node test/story.ts <目录>`，测试里调 `writeStory(dir)`）。
- `skills/flipbook/references/` 里标了 `<!-- check: ... -->` 的代码片段由 `test/e2e/references.test.ts` 真跑 check。`troubleshooting.md` 从 `src/cli/codes.ts` 生成，改了类型码跑 `UPDATE_REFERENCES=1 pnpm test test/skillText.test.ts`。
- 评测花真实额度，按 docs/eval.md 本地跑，CI 只跑 `--dry-run`。
- 升级 playwright-core 后跑 `node scripts/rebaseline.mjs --old "<旧版 CLI 命令>"`，看过对比联系表再发版。然后在作者的 Mac 上跑 `pnpm samples:baseline` 重出样张的帧摘要（写进各样张的 `expected.json`），和升级放同一个提交。改了样张的画面也跑它。
- 原始帧哈希和样张帧摘要都只在同机同版本比，跨机器不比。

## 文档

- `docs/` 下的文档带 `summary` 和 `read_when` 前言。
- README、INSTALL 和 `docs/` 下的文档英文为主，中文版是同名 `.zh-CN.md`，两边章节一一对应，标题下有一行语言切换。改一边就在同一个提交里改另一边。SKILL.md 和 references 只有英文。
- 报告格式、类型码、timeline 或 story 字段改了，同一个提交里改 `docs/report-schema.md`、`docs/timeline-schema.md` 或 `docs/story-schema.md` 和对应的 `.zh-CN.md`，`test/units.test.ts` 会核对两份报告格式里的类型码。
- 文档里的安装命令一律带精确版本，`scripts/stamp.test.mjs` 扫所有入库文件。
- README 样片墙的视频放在 GitHub 的 user-attachments 上，不跟版本走：发版不改它们，Release 还没建好时也不会裂图。只有网页编辑器上传能生成这种地址（在本仓库新建 issue 的编辑框里拖入文件，拿到地址后不提交）。地址要在 README 里单独占一行（表格单元格里前后各空一行），GitHub 才渲染成播放器，未登录也能播。写成 `<video>` 标签或放在链接文字里都不行，npm 页面上也播不了。

## .gitignore 必须包含

- `node_modules/`、`dist/`、`coverage/`
- `out/`、`.flipbook/`
- `rebaseline/`、`eval/results/`

## 不提作者的其他项目

文档、注释、声明、提交信息里不写作者其他项目的名字。从别处借来的经验直接写经验本身（做法、坑、规矩），不写来自哪个项目。同一作者的代码不算第三方，不进 THIRD_PARTY_NOTICES.md。

## 草稿目录

仓库草稿目录是 `.issues/<YYYY-MM-DD-主题>/`，不入库（`.git/info/exclude` 已排除）。方案、调研、评测记录、审稿意见都放这里。当前主线在 `.issues/2026-09-24-web-video-skill/`，开工依据是里面的 `design.md`。
