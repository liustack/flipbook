# 第三方声明

flipbook 以 MIT 许可发布（见 [LICENSE](LICENSE)）。下列代码、依赖和资源来自第三方，各自的许可证照录如下。

## 借用的代码

### buildwithhanif/claude-animation-skill

- 来源：https://github.com/buildwithhanif/claude-animation-skill（提交 4ddb8c8）
- 许可证：MIT，Copyright (c) 2026 Hanif (@hanifproduktif)
- 借用并改写：
  - `src/runtime/audio/voices.ts` 的 `pluck`：Karplus-Strong 拨弦来自 `scripts/music.mjs` 的 `pluck`，加了全通滤波微调音高、拨弦位置陷波、按 T60 算每周期衰减，激励噪声改成按均方根缩放再软削波。
  - `src/engine/audio.ts` 的 `mixSoundtrack`：先测响度再加增益、4 倍过采样限幅后编 AAC 的链路来自 `scripts/sound.mjs`，测量改用 ebur128，第二遍用线性增益，并按限幅后的响度再补一次。

MIT 许可证全文：

```
MIT License

Copyright (c) 2026 Hanif (@hanifproduktif)

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
- 双二阶滤波器系数（`src/runtime/audio/dsp.ts`）：按 Robert Bristow-Johnson 公开发布的 Audio EQ Cookbook 公式重写。
- 缓动公式（`src/runtime/core/ease.ts`）：按 Robert Penner 的缓动方程重写，原方程以 BSD 许可发布。

## 运行时依赖（npm 安装，不打进 dist）

| 包 | 版本 | 许可证 |
|---|---|---|
| playwright-core | 1.63.0 | Apache-2.0，Copyright (c) Microsoft Corporation |
| commander | 15.0.0 | MIT，Copyright (c) 2011 TJ Holowaychuk |

## 首次运行时下载的资源

| 资源 | 来源 | 许可证 |
|---|---|---|
| Chromium headless shell（Chrome for Testing 153.0.8010.12） | playwright-core 的安装源 | Chromium 许可（BSD-3-Clause 及其组件的许可证），安装包内附 |
| Noto Serif SC（可变字重 TTF） | google/fonts `ofl/notoserifsc` | SIL Open Font License 1.1，Copyright 2012 Google Inc. |
| 霞鹜文楷 LXGW WenKai Regular v1.522 | lxgw/LxgwWenKai 发布页 | SIL Open Font License 1.1，Copyright 2021-2026 LXGW，Copyright 2020 The Klee Project Authors |

两款字体的 OFL 全文随包提供（打进 `dist/main.js`），下载字体时写到缓存里字体文件旁边的 `OFL.txt`。字体按原文件使用，不改名、不子集化、不再分发。

## 纸感通道借用的做法

### alesha-pro/tools

- 来源：https://github.com/alesha-pro/tools ，`skills/hand-drawn-canvas-animation/assets/materials.js` 和 `assets/core.js`
- 许可证：MIT，Copyright (c) 2026 Alexey Fateev
- 借用的做法：`formHatch` 用网格格子的哈希决定每一笔在不在、落在哪、多长，不依赖随机数的调用顺序，所以同一笔在每一帧都在原地。`src/runtime/materials.ts` 的 `hatch`、`crossHatch`、`stipple` 按这个做法重写：改成 TypeScript 和整数哈希，笔画中心按格子定，分粗细两档，裁剪时算上笔画的弯曲。`dotScreen` 在旋转网屏上逐点铺的做法用在 `halftone` 的色调场分支。

### IshaanKalra2103/creative-skills（riso-rooms）

- 来源：https://github.com/IshaanKalra2103/creative-skills ，`skills/riso-rooms/template/index.html`
- 许可证：MIT，Copyright (c) 2026 Ishaan Kalra
- 借用的做法：每种墨、每档色调先画一块半调小图块并缓存，用 `createPattern` 加旋转变换铺满，色调不到一半时画变大的网点，超过一半时在实底上挖变小的孔。`src/runtime/materials.ts` 的 `halftone` 在色调为常数时照此实现，改成 32 档色调，按颜色、网距、档位缓存。

以上两个项目的 MIT 许可证全文：

```
MIT License

Copyright (c) 2026 Alexey Fateev

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

```
MIT License

Copyright (c) 2026 Ishaan Kalra

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

- 欧氏距离变换（`src/runtime/templates/assemble.ts` 的 `distanceField`）：按 Felzenszwalb 和 Huttenlocher 的论文《Distance Transforms of Sampled Functions》自行实现。

## 尚未借用

design 里列出的 HyperFrames（Apache-2.0）的代码还没有搬进来。搬进来时在这里登记来源、许可证和改动。
