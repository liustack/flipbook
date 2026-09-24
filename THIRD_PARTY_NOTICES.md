# 第三方声明

flipbook 以 MIT 许可发布（见 [LICENSE](LICENSE)）。下列代码、依赖和资源来自第三方或作者的其他项目，各自的许可证照录如下。

## 借用的代码

### liustack/modlens

- 来源：https://github.com/liustack/modlens
- 许可证：MIT，Copyright (c) 2026 Leon Liu (liustack)
- 借用并改写的文件：
  - `skills/flipbook/scripts/run.sh`、`run.ps1`：来自 `skills/modlens/scripts/run.sh`、`run.ps1`，改了包名、命令名和钉死版本，去掉了原生制品占位。
  - `scripts/stamp.mjs`、`scripts/stamp.test.mjs`：来自同名文件，目标文件换成 flipbook 的启动器和文档，加了 `skills add` 标签检查和 `npx`、`bunx` 未钉版本检查。
  - `scripts/release.mjs`：来自同名文件，加了 THIRD_PARTY_NOTICES 检查和首个版本的处理。
  - `src/skillPin.ts`、`test/skillPin.test.ts`：来自 `src/skillPin.ts` 和同名测试，宿主目录表去掉了 dsh。
  - `.github/workflows/ci.yml`、`release.yml`、`dependabot.yml`、issue 和 PR 模板、`biome.json`、`CONTRIBUTING.md`、`SECURITY.md` 的结构。

### liustack/pagepress

- 来源：https://github.com/liustack/pagepress
- 许可证：MIT，Copyright (c) 2026 Leon Liu (liustack)
- 借用的做法：`src/update.ts` 的 `resolvePlaywrightCliPath`（用已安装的 Playwright 包自带的 CLI 装浏览器）改写进 `src/engine/browser.ts`，`src/renderer.ts` 的 `context.route` 管网络和 `try/finally` 关浏览器用在 `src/engine/page.ts` 和各命令里。

以上两个项目的 MIT 许可证全文：

```
MIT License

Copyright (c) 2026 Leon Liu (liustack)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 算法

- mulberry32 伪随机数（`src/engine/host.ts`、`src/runtime/core/random.ts`、`src/cli/check.ts`）：Tommy Ettinger 发布到公有领域。
- FNV-1a 哈希和 MurmurHash3 的 fmix32 收尾常数（`src/runtime/core/random.ts`）：公有领域。
- 缓动公式（`src/runtime/core/ease.ts`）：按 Robert Penner 的缓动方程重写，原方程以 BSD 许可发布。

## 运行时依赖（npm 安装，不打进 dist）

| 包 | 版本 | 许可证 |
|---|---|---|
| playwright-core | 1.63.0 | Apache-2.0，Copyright (c) Microsoft Corporation |
| commander | ^15.0.0 | MIT，Copyright (c) 2011 TJ Holowaychuk |

## 首次运行时下载的资源

| 资源 | 来源 | 许可证 |
|---|---|---|
| Chromium headless shell（Chrome for Testing 153.0.8010.12） | playwright-core 的安装源 | Chromium 许可（BSD-3-Clause 及其组件的许可证），安装包内附 |
| Noto Serif SC（可变字重 TTF） | google/fonts `ofl/notoserifsc` | SIL Open Font License 1.1，Copyright 2012 Google Inc. |
| 霞鹜文楷 LXGW WenKai Regular v1.522 | lxgw/LxgwWenKai 发布页 | SIL Open Font License 1.1，Copyright 2021-2026 LXGW，Copyright 2020 The Klee Project Authors |

两款字体的 OFL 全文随包提供（打进 `dist/main.js`），下载字体时写到缓存里字体文件旁边的 `OFL.txt`。字体按原文件使用，不改名、不子集化、不再分发。

## 尚未借用

design 里列出的 alesha、hanif（MIT）和 HyperFrames（Apache-2.0）的代码在 M0 还没有搬进来。搬进来时在这里登记来源、许可证和改动。
