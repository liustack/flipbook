# 参与 flipbook

先说规矩：**flipbook 不接受 pull request**。它由一个人维护，每一行代码都由作者审过并负责。

两种真正有用的参与方式：

- **[开 issue](https://github.com/liustack/flipbook/issues)**。bug、想法、看不懂的报错、写错的文档都可以。issue 模板会告诉你该附什么。
- **fork 它**。MIT 许可，你的副本完全归你，改名、改造、发布都不需要许可。

下面是给 fork 用户的开发说明。

## 范围

flipbook 只做一件事：把模型写的 HTML 合成逐帧确定性地渲染成 mp4，并在交付前自动验收。

不做：3D 角色、真实素材剪辑、生成式图像或视频当画面主体、实时录屏、TTS 旁白、Remotion 和 HyperFrames 底座、p5.js、机器学习抠图、节拍检测、Windows 原生支持、`preview` 命令。

## 开发

```bash
pnpm install
pnpm lint        # Biome
pnpm typecheck   # tsc --noEmit
pnpm test        # 单元和快的引擎测试，会先 build，一分钟内
pnpm test:e2e    # 整条合成过 CLI：坏片语料、reference 片段、样例渲染、两次渲染比哈希
pnpm build       # tsup，产出 dist/main.js 和 dist/runtime/
```

要求 Node 22.19 起、ffmpeg（含 libx264）。首次运行 check 或 render 会把 Chromium headless shell 和字体装进用户缓存。

## 测试

- 测试放 `test/`，要把整个合成目录送进 check、snapshot 或 render 的放 `test/e2e/`。坏片语料放 `test/fixtures/bad/<类型>/`，每类坏法至少一条，必须被拦下。
- 新行为或修 bug 的提交带上测试。
- 单元测试不联网。用到浏览器的测试把 fixture 复制到临时目录再跑，不往仓库里写 `.flipbook/` 和 `out/`。

## 提交

- [Conventional Commits](https://www.conventionalcommits.org)：`type(scope): 祈使句摘要`，不超过 72 个字符，末尾不加句号。
- 一个提交只做一件事，每个提交之后仍能构建和测试。重构、格式化不和行为变更混在一起。
- 缩进 4 空格，由 Biome 管。
