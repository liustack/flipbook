# flipbook（给 AI agent 的项目说明）

## 目标

提供 `flipbook` CLI（npm 包 `@liustack/flipbook`）和同名 agent skill：模型写一个 HTML 合成文件和一份 `timeline.json`，flipbook 逐帧确定性地渲染成 mp4，并在交付前自动验收。

## 范围

不加：

- 3D 角色、真实素材剪辑、生成式图像或视频当画面主体、实时录屏
- TTS 旁白、节拍检测、机器学习抠图
- Remotion 或 HyperFrames 当底座、p5.js
- Windows 原生支持（`win32` 退 78，提示用 WSL2。`FLIPBOOK_ALLOW_WIN32=1` 只给 CI 用）
- 预览（`preview` 命令和双击打开的预览都不做，0.x 看画面靠 `snapshot`）

## 技术路线

- **一个仓库两样产物**：npm 包（`dist/main.js` 是 Node CLI，`dist/runtime/runtime.js` 和 `audio.js` 是浏览器端 ESM）和 `skills/flipbook/`（只有 SKILL.md、references、启动器，没有代码）。启动器按 PATH、npx、bunx 的顺序找钉死版本的 CLI。
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
  cli/             doctor、check、snapshot、audio、render、报告和类型码
  engine/          浏览器、页面、时钟、timeline、截帧、编码、验收、字体和自带字体、品牌资产、缓存、扫描、配乐合成和混音、渲染进程监视
  runtime/         浏览器端运行时库（core、text、paper、materials、templates、brand、audio）
  fonts/           字体清单、码位表、OFL 全文
scripts/           发版（含 CHANGELOG 盖日期）、版本号改写、码位表生成、samples.mjs（重出 docs/samples 的样张）、rebaseline（换 Chromium 后比较两版的逐帧 PSNR）
skills/flipbook/   SKILL.md（英文）、references/（rules、timeline、audio、paper、materials、text、templates、brand、troubleshooting）、scripts/run.sh 和 run.ps1
docs/              report-schema.md、timeline-schema.md、platform.md（支持矩阵、沙箱特征、容器限制）、eval.md
docs/samples/      reference 引用的样张和它们的源码，只在仓库里，不进 npm 包
examples/          hello、eggs-five（five 和 shu 两条）、beat-title、page-turn、lens-montage、arc-cuts、brand-intro，每个例子一份源码加 expected.json，不提交 mp4
eval/              评测用例、models.json、run.mjs，证据写到 eval/results/（不入库）
test/              vitest，坏片语料在 test/fixtures/bad/
```

## 验证

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build`，全部通过才算完成。`pnpm test` 会先构建。
- 用到浏览器的测试把 fixture 复制到临时目录再跑。首次运行需要联网装 Chromium 和字体，写的是用户缓存目录。
- 坏片语料每类至少一条，新增检查时先加一条会被拦下的坏片。
- `skills/flipbook/references/` 里标了 `<!-- check: ... -->` 的代码片段由 `test/references.test.ts` 真跑 check。`troubleshooting.md` 从 `src/cli/codes.ts` 生成，改了类型码跑 `UPDATE_REFERENCES=1 pnpm test test/references.test.ts`。
- 评测花真实额度，按 docs/eval.md 本地跑，CI 只跑 `--dry-run`。
- 升级 playwright-core 后跑 `node scripts/rebaseline.mjs --old "<旧版 CLI 命令>"`，看过对比联系表再发版。
- 确定性只在同机同版本比原始帧哈希，跨机器不比。

## 文档

- `docs/` 下的文档带 `summary` 和 `read_when` 前言。
- README、INSTALL 和 `docs/` 下的文档英文为主，中文版是同名 `.zh-CN.md`，两边章节一一对应，标题下有一行语言切换。改一边就在同一个提交里改另一边。SKILL.md 和 references 只有英文。
- 报告格式、类型码、timeline 字段改了，同一个提交里改 `docs/report-schema.md` 或 `docs/timeline-schema.md` 和对应的 `.zh-CN.md`，`test/units.test.ts` 会核对两份报告格式里的类型码。
- 文档里的安装命令一律带精确版本，`scripts/stamp.test.mjs` 扫所有入库文件。

## .gitignore 必须包含

- `node_modules/`、`dist/`、`coverage/`
- `out/`、`.flipbook/`
- `rebaseline/`、`eval/results/`

## 不提作者的其他项目

文档、注释、声明、提交信息里不写作者其他项目的名字。从别处借来的经验直接写经验本身（做法、坑、规矩），不写来自哪个项目。同一作者的代码不算第三方，不进 THIRD_PARTY_NOTICES.md。

## 草稿目录

仓库草稿目录是 `.issues/<YYYY-MM-DD-主题>/`，不入库（`.git/info/exclude` 已排除）。方案、调研、评测记录、审稿意见都放这里。当前主线在 `.issues/2026-09-24-web-video-skill/`，开工依据是里面的 `design.md`。
