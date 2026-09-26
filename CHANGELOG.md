# Changelog

## Unreleased

### 新样例

- **`examples/riffle/`**：一本摊在桌上的手翻小本。Rijksmuseum 藏的迈布里奇奔马连拍（CC0，经 `stock fetch` 下载）由 `specimens()` 自动切成 20 格，按阅读顺序印在书页上，每格保留原片的圆角，四周留出页边。先慢慢翻两页，再越翻越快到每秒十页，马就跑起来了，最后慢下来停回第一格，出片名。书页是用旧了的廉价纸：发黄、锈斑、拇指蹭脏的角、磨圆的边，手裁的纸页参差不齐。镜头和本子按一拍二走，书页每帧都翻，所以翻页照样流畅。一共 12.5 秒。

## 0.5.6 - 2026-09-26

### 改进

- **搜索结果标出实际能下到的尺寸**：有些馆藏只给预览图，原来搜索结果写的是原图尺寸，挑了大图、下到手才发现只有 1024 像素。现在每条结果多一个 `servedEdge`，写明 `stock fetch` 实际拿到的长边：Flickr（生物多样性遗产图书馆的图版也在上面）和 rawpixel 是 1024，Pixabay 是 1280，下到的就是原图时为 `null`。`width`、`height` 仍是原图尺寸。`references/photo.md` 写明 1024 像素的图铺满 1920 的画面会发虚，大图改搜直接给原图的馆藏（Wikimedia、Met、Smithsonian、Rijksmuseum），预览图留给贴纸和小块画面。

## 0.5.5 - 2026-09-26

### 修复

- **静音配乐不再被当成合格**：timeline 要配乐，成片的音轨却是静音时（最常见的是 `audio.offset` 超过了音乐文件的长度），整合响度量不出来，原来验收就跳过了响度检查，静音成片照样交付。现在报新类型码 `audio-silent`，文件配乐时写明文件长度和 offset。坏片语料加了一条。

## 0.5.4 - 2026-09-26

### 自己写乐谱

配乐不再只有三套预设。写合成的模型按故事写一份乐谱，flipbook 照谱合成，每个音都落在 timeline 的拍子上，每条片子的曲子都可以不一样。

- **`"mode": "score"`**：乐谱写在 timeline 的 `audio.score` 里，按场景分段。每场列出每小节的和弦，各声部要么写一个伴奏型（`hold`、`pulse`、`offbeat`、`arpeggio`、`broken`、`strum`、`root`、`root-fifth`、`octaves`），要么逐小节写音符（`D5:2`、`-` 休止、`~` 连音、`D4+F4+A4` 同时发声），鼓写步进串（`"x...x..."`）。比场景短的列表从头循环。每场可设 `level`，全曲可选 `room`（`dry`、`room`、`hall`）。
- **十四种乐器**：钢琴、钢片琴、八音盒、钟琴、马林巴、尼龙弦吉他、竖琴、弦乐组、合成铺底、长笛、单簧管、拨奏低音提琴、正弦超低音和一套轻柔鼓组（kick、snare、hat、shaker、knock、clap），全部代码合成，不用采样，不加依赖。比不上实录，但够用，要真实乐器声时照旧找录音。
- **报错指到字段**：小节拍数加不齐、音超出乐器音域、单音乐器写了和弦、不认识的和弦或乐器、列表比场景长，都报 `timeline-invalid`，带 `$.audio.score.scenes.flip.play.lead[1]` 这样的路径。
- **确定性和响度不变**：同一份谱两次合成 WAV 逐字节一致，每个音的几毫秒偏移和力度起伏由 `seed` 决定。混音照旧到 -14 LUFS，真峰值不超过 -1 dBTP，音效照旧对准帧。
- **默认配乐改成手写乐谱**：`references/audio.md` 新增「写乐谱」一节，讲按情绪选调式、速度和乐器，写谱顺序，一个真跑校验的完整示例和常见报错怎么改。短而平的片子仍可用预设，用户点名曲目、要乐谱没有的乐器或真实声音很重要时找录音。
- **样片**：`examples/page-turn/` 配乐改成乐谱（竖琴分解和弦、弦乐铺底、长笛五声旋律），翻页声仍是找来的录音。

## 0.5.3 - 2026-09-26

### 找现成的声音

三套合成预设和四个内置音效撑不起所有故事：翻书就该有真的翻页声，讲巴赫就该有巴赫。agent 自己从 Openverse 找公有领域的音效和曲子，下到合成目录，timeline 里直接用。

- **`stock search --audio`**：只问 Openverse 的音频库，只要 cc0 和 pdm。短音效多来自 Freesound 的 CC0 录音，整首曲子来自 Wikimedia Commons。`--length` 按时长档筛（`shortest` 30 秒以内到 `long` 10 分钟以上），`--source` 限定馆藏。模型听不了声音，结果带时长、标题、标签、来源，照这些挑。Openverse 的音频搜索要每个词都命中，所以用一到三个词。
- **`stock fetch openverse-audio:<id>`**：按文件内容认 mp3、ogg、flac、wav，ffprobe 读得了才存，原样存成 `assets/<name>.<ext>`，不转 WAV（整首转出来要大十倍，渲染时反正统一成 48 kHz 立体声）。来源和许可写进 `assets/SOURCES.json`，和图片同一个文件。下载沿用只走 HTTPS、逐跳核对、拒内网的防护。
- **音效用文件**：sfx cue 写 `file` 代替 `sfx`，文件里最响的那一下对准 cue 那一帧，音量缩到和内置音效差不多。和合成的音效叠成一条轨混音、对帧验收。只用文件音效时不开浏览器合成。
- **文件配乐**：`audio.mode: "file"` 加 `offset`（从文件第几秒开始用，给不跟节拍走的曲子）、`fadeIn`、`fadeOut`。`bpmOffset` 照旧给用户自带、跟着节拍走的歌，两者只能写一个。
- **许可（会拦下旧合成）**：timeline 用到的每个音频文件都要在 `assets/SOURCES.json` 里有来源和许可，否则 check 和 render 报新类型码 `audio-unlicensed`。原来用 `mode: "file"` 却没写这条的合成要补上。
- **样片**：`examples/page-turn/` 的翻页声和八音盒旋律换成 Freesound 上的 CC0 录音，画面不变。
- **skill**：`references/audio.md` 写清什么时候用预设、什么时候找录音，怎么搜、怎么挑、文件音效怎么对帧，片段真跑 check。SKILL.md 加 `stock search --audio`，声音和图片一样只经 `stock fetch` 或用户提供。

## 0.5.2 - 2026-09-26

### 定格手感

照官方发布片的做法，让画面有定格动画的手感：东西停一拍再换，整张纸在两拍之间轻轻挪一下，快速掠过的东西带动态模糊。

- **`boil`**：每拍给一个带种子的小偏移和小转角，同一拍内不变，下一拍跳到新位置。整张画面用它一起抖，像翻拍台上的纸每拍一格都被碰了一下。画面里的东西不要各自抖，否则彼此错动看着像在震。
- **`motionBlur`**：把一段绘制在快门时间里取好几个时刻，叠起来取平均（默认 8 个时刻、半帧快门），结果每次一样。只包快速移动的东西，每个时刻都要画一遍。
- **`fall`**：花瓣、落叶、纸屑脱落飘下：先加速，再左右摆着往下飘，摆到两头慢、中间快，一边转一边翻面（按 `flip` 缩放宽度，接近 0 时是侧着的），给了 `floor` 就落地放平。风大、下落慢时就是被吹着横飘过画面。只由时间和种子决定。
- 这几样配合已有的 `onTwos` 用：镜头和纸走一拍二，需要顺的部分（比如翻页）照样每帧都动。

## 0.5.1 - 2026-09-26

### 以图为底和找图

公有领域的博物图鉴、标本照、古地图能当画面底子：agent 自己搜图、看缩略图挑、下到合成目录，运行时把图抠出来做成纸贴纸。

- **`stock search`**：按 Pexels、Pixabay、Openverse 的顺序找，前两家配了 `PEXELS_API_KEY`、`PIXABAY_API_KEY` 才问，Openverse 不要 key，只要 cc0 和 pdm。`--source` 限定 Openverse 的一个馆藏（`bio_diversity`、`wikimedia`、`met` 等），`--provider` 只问一家。缩略图拼成 `out/stock/contact-sheet.png`，每条结果带 `tile` 序号，让模型看图挑，不自动取第一条。
- **`stock fetch`**：选中的图存成 `assets/<name>.<ext>`，来源、许可、作者写进 `assets/SOURCES.json`，和品牌字体用同一个文件，原有条目保留。同名同图再下直接跳过，长边超过 3200 像素的图和 TIFF 用 ffmpeg 缩小或转换。
- **下载防护**：只走 HTTPS，逐跳核对重定向，拒回环、内网、链路本地等地址，连接钉在核对过的地址上。代理工具 fake-IP 模式用的 198.18.0.0/15 放行。key 不进报告、消息和 SOURCES.json。
- **`photo()`**：透明图直接用，浅色纸底图按和纸色的距离抠，只去掉连到画面边缘的纸，主体里的浅色保留，碎点和图注按面积丢掉。默认做成贴纸：按透明度外扩的纸色粗边、带种子的微倾、柔和投影、纸纹。`crop` 从一整张图版里取一个标本，`size` 是抠出主体的长边，`draw()` 的 `lift` 让影子随抬起变远变淡。全部在 setup 里算一次，同一张图每次像素一样，不加依赖。
- **`flipbook cutout`**：渲染之前把一张图版上的标本都抠成透明 PNG，存到 `assets/cut/<名字>/`，大的在前，裁剪框切到的不收。每个抠图在 `assets/SOURCES.json` 里沿用图版的来源和许可，旁边一份 `cutout.json` 记它来自哪个框。`out/cutout/<名字>.png` 把每个抠图分别放在浅纸、深底、棋盘格上，先看再用。合成里直接 `photo()` 加载抠好的 PNG，渲染时不再现抠，每个并行页面也不再各算一遍。`--ink` 线稿模式，`--paper`、`--threshold`、`--holes`、`--gap` 对付深底图版。分不开的图版报 `cutout-none`，不给假结果。新增类型码 `cutout-invalid`、`cutout-none`、`cutout-clipped`（警告）。
- **抠得更干净**：纸色不再当成一个颜色，分格跟着扫描件上发黄、发暗的纸走（`flatten`，默认开）。柔边的透明度按「纸色到旁边主体色」那条线量，再把纸色从边缘像素里减掉，换到别的底上不带一圈旧纸的浅边。新增 `cutout: 'ink'`，铜版画、钢笔画这类线稿按亮度变成透明的墨，排线保留，灰色半透明，不再碎成网。
- **一张图版上有好几个标本**：`specimens()` 按底色把图版上每个独立的东西找出来，返回留了余量的裁剪框，大的在前，不用再目测裁剪。`photo()` 加 `keep: 'largest'`（只留最大一块，丢掉跟进来的邻居碎片）、`holes`（深底图版上挖掉被主体圈住的底色，比如水母触手之间的深绿），结果多了 `clipped`，列出主体碰到裁剪框的边，也就是被切了一刀。
- **类型码**：`stock-no-results`（警告）、`stock-rejected`、`asset-conflict`，环境类 `stock-key-missing`、`stock-unreachable`。
- **样片**：`examples/specimen-board/`，四张 Openverse 上的公有领域图版（生物多样性遗产图书馆的甲虫和鸟翼蝶、一张西班牙图书馆的贝壳图版）抠成贴纸，一拍落一张到格子纸上，最后出「博物笔记」。check 无警告，成片验收通过。
- **skill**：新增 `references/photo.md`（查询用两到四个具体英文词、看联系表挑、找不到就不用图并告诉用户、不从别处下图、`photo()` 的选项），片段真跑 check。SKILL.md 加 stock 命令，图片只经 `stock fetch` 或用户提供。

## 0.5.0 - 2026-09-25

### 构图模板和品牌

三个新的构图模板和品牌资产：一本书翻开进场、圆形镜筒里看图版、同一条弧线贯穿各镜，再加上 brand.json 和用户自带的字体。

- **手翻书 `pageTurn`**：页角卷起的曲面用分条的仿射变换和渐变画出来，翻过去的纸背透出这一页的镜像残影，下面那页的阴影随纸翻起的高度变深变浅。翻页时刻用 `beatTimes` 按拍排，或用 `markTimes` 跟 mark cue。翻页时长可以比间隔长，几页同时在空中，翻快了就成动画。`spread` 让翻过的页留在书脊左边，`rigid` 让封面像硬板一样绕书脊转开，配合 `moveCamera` 推进书页，就是一本书翻开进第一场的开场。两场之间翻一页当转场也行。
- **镜筒蒙太奇 `lens`**：黑色镜筒、滚花目镜圈、窗口边缘的暗角和色边，可选刻度线。开场光圈打开，图版按拍切换，每次切换后对一下焦，最后窗口放大到铺满画面，最后一张图版成了整个画面。
- **弧线匹配剪辑 `arcCuts`**：一条弧线在每个镜头里位置不变，弧线上下每镜各画各的材质，整条片匀速推近。`accelerate` 把一场分成时长等比缩短的若干镜，每个切点对齐到帧，某一镜分不到一帧就报错。`label` 让字沿弧线排，可以逐字出现。
- **运镜 `moveCamera`**：从取景一个矩形移到取景另一个矩形，绕一个定点匀速缩放，推进和拉远走同一条路。
- **brand.json**：名字、一句话、logo、主色辅色和文字色纸色、标题和正文字体，放合成目录或工作区根，timeline.json 用 `brand` 字段指过去。check、snapshot、render 开页面前先校验：文件在本地且不出 brand.json 所在目录，logo 和字体都写了许可证，颜色格式对，字体文件读得出。出错报 `brand-invalid`，带出错字段的 JSON 路径。logo 以 data 地址内联进页面，brand.json 放在合成目录外面也能用。
- **`brand()`**：运行时把色板、解码好的 logo 图、字体族名交给合成代码。`font()` 拼好 ctx.font，品牌字体后面自动接上 flipbook 的两款字体补缺字。`applyCss()` 写 CSS 变量给 DOM 文字用。
- **自带字体**：brand.json 的 `fonts.files` 或合成目录 `assets/fonts/` 里的 .ttf、.otf，许可证写在 brand.json 或 `assets/SOURCES.json`。flipbook 读出每个字体的字符表、族名、字重和字形，按内容哈希登记，经 `/__flipbook/fonts/` 供给，页面加载前和 flipbook 自己的字体一起装好。缺字和字体回退检查按每个字体自己的字符表逐字核。缺许可证、读不出（包括指空的软链）、文件或软链解析到合成目录外面、族名和 flipbook 字体或 CSS 通用名撞了、两个文件同族同字重同字形，报 `font-invalid`。
- **样片**：`examples/page-turn/`（月相手翻书：布面精装书翻开，十二页月相按半拍翻，最后翻到苏轼的一句）、`examples/lens-montage/`（蕨叶、洋葱表皮、牛顿环、星图、玛瑙、硅藻，最后从月亮拉出到黄昏天空）、`examples/arc-cuts/`（十八个镜头十二种材质，最后「还有更多值得发现」沿弧线出来）、`examples/brand-intro/`（虚构的青柿文具，代码手写的 SVG logo，用清单字体）。都带预设配乐，check 无警告，两次渲染逐帧哈希一致。三个模板的样张由 `scripts/samples.mjs` 生成到 `docs/samples/`。
- **skill**：第一步定规格时，涉及产品或品牌先在工作区找现成的 logo、主题色变量、设计 token、README 里的色值给用户确认，找不到就问。硬规矩里的字体放开到用户带许可证的自带字体。新增 `references/brand.md`，`templates.md` 加手翻书、镜筒蒙太奇、弧线匹配剪辑和运镜各一节，片段都真跑 check。reference 片段的测试支持 `snippet-file` 标记，把 brand.json 这类附带文件一起写进合成目录。
- **评测**：新增弧线剪辑科学奇观串、翻页开场的书摘、按 brand.json 做品牌片三条用例。工作区预置文件多了 `copy` 生成器，`--dry-run` 会把每条用例的预置文件都摆一遍。

### 快和长

大片子不用干等：截帧提速、多页并行、页面定期重开、竖版和 4K、三分钟长片。实测数字见 `docs/platform.zh-CN.md` 的「渲染性能」。

- **截帧提速**：启动参数加 `--disable-frame-rate-limit`，截图不再等 60 Hz 的合成节拍。hello 这类简单画面单页截帧快一倍，带纹理纸底的快一成多。截图格式试了 WebP 无损、JPEG、屏幕推流和并行页面，WebP 无损慢九倍，JPEG 质量 100 也只有 48 到 49 dB，其余没有更快，保持 PNG。
- **30 秒 1080p 一分钟内出片**：30 秒纯纸底片 30 到 36 秒，带纹理纸底的开多页 57 到 67 秒，都算达到一分钟的目标。这组数字是在机器负载 5 到 19 的高负载下测的（同机还有别的测试和渲染在跑），空闲的机器更快。
- **多页并行**：check 的确定性三项通过后，render 按 CPU 核数减一开浏览器，最多 6 个，每个一页，谁空下来谁接下一帧，帧按顺序送进同一个 ffmpeg，逐帧哈希和单页相同。页数再按内存和片长封顶，`--jobs` 可改。确定性三项是换顺序 seek、换时钟和随机种子、seek 后连截两张，结果记在 check 报告的 `check.determinism`。最近一次 check 这三项没全过、之后改过文件（包括合成目录外面的 brand.json 和它指的 logo、字体）、或画幅和缩放和那次 check 不同，就只用一页，`render.parallel.reason` 写明原因。check 因为别的问题没过（比如文字出画）不影响并行。
- **页面定期重开**：一页默认最多画 2400 帧（1920×1080，像素越多越早，最少 600 帧），JS 堆或 DOM 涨过线也提前重开，线是所有页合起来 512 MB 堆、4 万个节点，平分给同时在画的页，每页至少 64 MB、5000 个节点（所以 `--jobs` 大于 8 时合计会超过这个数）。`--recycle <帧数>` 改成固定间隔，`--recycle 0` 不重开。三分钟片的内存全程不涨。
- **画幅和分辨率**：`check`、`render` 和 `snapshot` 加 `--size`（竖版的文字出画和安全区在渲染前就能查），收 `9:16`、`1:1`、`4:5` 这类比例（保留短边）或 `1080x1920` 这样的像素。`check` 和 `render` 加 `--scale`，`--scale 2` 把 1920×1080 渲成 3840×2160，要并行出 4K 就先用同样的 `--scale` check 一遍，canvas 按 dpr 建底层像素，截图拿设备像素。顺手修了 `snapshot --zoom` 截过一次之后页面的 `screen` 变成 800×600 的问题。hello、eggs-five 和 beat-title 改成按舞台宽高排版，能直接出竖版，1920×1080 下的帧和改之前一样。beat-title 竖版时卡片变高，三个词竖着排。check 和成片验收里空白、只剩纸底、定格、花屏这几项的分析图按实际画幅缩放（竖版是 180×320），不再压成 16:9。
- **长片样例**：新增 `examples/long-scroll`，三分钟纸面一直往上滚，发版门禁里整条过 check 和成片验收。
- **DOM 文字逐帧缩放的漂移**：macOS 上两次渲染有十来帧不一致，根因是 60 Hz 限帧下截图抢在合成器按新缩放重画之前，不是字形缓存，上面的启动参数修好了，`dom-scale-drift` 语料钉住。Linux 和 Windows 上加了这个参数仍有帧不一致，所以「DOM 字不许逐帧改 scale」的硬规矩保留。
- **报告**：`check` 多了 `determinism`，`snapshot` 每格多了截图的 `sha256`，另有汇总的 `digest`，`render` 多了 `output`、`parallel`、`pages`、`recycle`，mp4 标签多了 `stage` 和 `scale`。
- **成片验收只解码一遍**：空白和只剩纸底、定格、花屏抽帧三项原来各自把视频从头解码一遍，现在共用一个 ffmpeg 进程分三路。三分钟 1080p 片在 M4 上验收解码从 7.4 秒降到 4.5 秒，CPU 时间从 46 秒降到 19 秒。
- **待办**：Linux 和 Windows 上 DOM 文字逐帧缩放漂移的根因还没查。

### 修复

- **自己崩溃的页面不再漏报**：close() 探测页面 1 秒没回应时，再等最多 3 秒的崩溃报告。装了 systemd-coredump 的 Linux 上，Chromium 要等 core dump 处理完才知道渲染进程崩了（GitHub 的 Ubuntu runner 上 0.3 到 1.5 秒），原来这时页面已经关了，`page-error` 就丢了。
- **Windows 上的测试全部要过**：CI 的 windows-latest 列不再有允许失败的一组。编码器测试冒充 ffmpeg 的改成 Node 脚本，run.sh 的测试用 Git for Windows 的 sh 跑，评测工作区在 Windows 上另写 `flipbook.cmd` 垫片。靠信号认出系统杀进程的两条和靠 chmod 造删不掉目录的两条在 Windows 上跳过。chrome://kill 那条先等 Chromium 报出崩溃再关页面，机器忙时这个报告最晚 16 秒才到。原生 Windows 仍不支持。
- **macOS CI 偶发 seek-timeout**：vitest 进程数改成 CPU 数减 1，最少 1，最多 4。3 核的 macOS runner 上原来 4 个进程各开 Chromium，一帧 seek 能等过 10 秒。
- **Dependabot 更新 npm 依赖失败**：本地 pnpm 和 Dependabot 用同一个 3 天发布冷静期（`pnpm-workspace.yaml` 的 `minimumReleaseAge`，`dependabot.yml` 的 `cooldown`），锁文件里不再有发布不满 3 天的版本，Dependabot 不再报 `ERR_PNPM_NO_MATURE_MATCHING_VERSION`。
- **Windows 上几个进程同时首次下载字体不再失败**：先装好的进程已经打开了字体文件，Windows 不让后到的进程改名覆盖它，原来这个错误被当成下载失败，换镜像重下一遍后报 `font-download-failed`。现在改名失败时，如果正式文件已经在而且大小对，就用它。改名挪到了换下载地址的循环外面，别的原因的改名失败照原样报出来，不再算成网络问题。
- **doctor 认出 Codex 装的 skill**：`~/.agents/skills` 下的副本原来报成 pi/opencode 的，`skills add --agent codex` 装的就落在这里，Codex 也从这里加载，现在报成 `codex / pi / opencode`。

### 文档

- **英文 README 当默认**：README.md 改成英文，开头是发版渲出的四条样片联系表，点开播放 mp4。补上评测数字和「它不做什么」。中文版挪到 README.zh-CN.md，两边章节一一对应。
- **文档成对**：`docs/report-schema.md`、`docs/timeline-schema.md`、`docs/eval.md`、`docs/platform.md` 改成英文，中文原文改名成同名 `.zh-CN.md`。新增中文版 INSTALL.zh-CN.md。SECURITY.md 和 CONTRIBUTING.md 也改成英文，中文版是同名 `.zh-CN.md`。
- **装 skill 一条命令跑完**：`skills add` 带上 `--agent claude-code -y`，另给 Codex 一行 `--agent codex -y`，装的时候不再停下来问。Codex 这条装到 `~/.agents/skills/flipbook`。
- **沙箱说明**：首次下载被沙箱挡住时点一次允许就行，之后全在沙箱里跑，不用改设置也不用重启。INSTALL 里的放行设置改成可选，给连这一次确认都不想看到的人。Linux 上的 Codex 要加 `network_access = true`，`read-only` 模式要换成 `workspace-write`。
- **评测结果**：`docs/eval.md` 记下两轮 B 级评测的逐条耗时和花费。0.3.0 发版前 8 条全部一次跑通，单条 1.9 到 13.5 分钟、0.65 到 2.78 美元。
- **发版盖版本号**：清单加上两份中文版、`docs/` 下的文档和样片墙的 Release 附件地址。

## 0.3.0 - 2026-09-25

0.1 到 0.3 的范围合并首发，0.1.0 和 0.2.0 不单独发布。

### 出片

一句话做出一条无声或带自己音乐的 mp4，中文不缺字，交付前自动验收。

- **一个 CLI 四条命令**：`doctor` 离线自检，`check` 预检合成，`snapshot` 出联系表，`render` 渲染并验收。每条命令往 stdout 打带版本号的 JSON 报告（`flipbook.report/1`），最近一次报告另存到 `.flipbook/reports/`。退出码 0 全过，1 片子有问题，2 用法错，78 环境缺件。
- **确定性逐帧渲染**：页面经假源 `http://flipbook.local/` 加载，虚拟时钟接管 Date、performance.now、rAF、定时器和随机数，逐帧 seek 再用 CDP 截 PNG，管道送 ffmpeg 编成 libx264 yuv420p，显式 bt709。同机同版本两次渲染原始帧逐帧哈希一致。
- **check 在渲染前拦住坏片**：timeline 校验报 JSON 路径，静态扫描禁用写法，乱序 seek、换时钟、换随机种子、连截两张，空白和只剩纸底对纸底基线，缺字查码位表加 Chromium 实际用的字体，文字在 settle 时刻查出画、安全区和按像素量的对比度。
- **成片验收**：帧数时长、连续空白或只剩纸底、没声明 hold 的定格、解码帧和原帧的 PSNR、色彩标记、配乐音轨时长。没过验收的成片放 `.flipbook/rejected/`，不进 `out/`。
- **自带音乐**：timeline 里 `audio.mode` 写 `file`，render 按第一拍偏移截好、补齐或截到片长、结尾淡出，编成 AAC 放进成片。
- **浏览器端运行时库**：带种子随机、噪声、缓动、timeline 读取、场景和 cue 辅助、一拍两帧、静态层缓存、内容层开关、canvas 文字登记。
- **沙箱里能跑**：Claude Code 沙箱挡住 Chromium 多进程启动时，自动改用单进程模式，帧和正常模式一致。首次下载 Chromium 和字体需要在沙箱外跑一次。
- **skill**：SKILL.md 写六步流程、默认值、硬规矩、重试上限，三篇 reference（合成规矩、时间轴、排错），reference 里的代码片段在 CI 里真跑 check。启动器按 PATH、npx、bunx 找钉死版本的 CLI，0.x 期间只认同 major.minor。
- **维护工具**：`doctor --prune` 清旧缓存，`scripts/rebaseline.mjs` 比较两个版本的逐帧 PSNR，`eval/run.mjs` 跑提示词乘模型的评测并留证据。

### 纸感

默认皮肤和第一个构图模板：纸、手作材质、画布上的手写字、物件拼字形，附一条鸟蛋样片。

- **纸**：`paperLayer()` 画纸底（纸色、云状深浅、纤维、斑点、纸齿，可选格子纸和暗角），`grainLayer()` 在最上层盖一层纸齿和灰尘。两层都标 `data-flipbook-layer="paper"`，在 setup 里只画一次。`PAPER` 给五种纸色，默认米褐 `PAPER.beige`。
- **材质**：`pencil` 铅笔线、`hatch` 排线、`crossHatch` 交叉排线、`halftone` 半调网点、`stipple` 点刻、`tornPaper` 撕纸边。同样的参数画出同样的像素，每一笔按网格位置定，不随调用顺序变。1080p 下 3000 笔排线一帧只要几毫秒。
- **画布文字**：`writeText` 排版（按词换行、对齐、逐词出现），`handText` 用霞鹜文楷加一点手抖，`textOnPath` 沿路径排字。画出来的字都向 check 登记文字框，缺字、字体回退、出画和安全区照常检查。`words()` 和 `wordReveal()` 也能给 DOM 文字做逐词出现。
- **物件拼字形**：`glyphMask` 把数字或汉字变成网格，`packSlots` 在字形里铺大小不一的槽位并顺着笔画转向，`assemble` 让物件按 mark cue 一个个飞进来落位，带缓动、轻微旋转、落地后的摇晃和收紧的投影。每个物件在 setup 里画一次，缓存成贴图。
- **样片 `examples/eggs-five/`**：米褐纸上，鸟蛋拼成「5」和「书」两版，各 8 秒，分别以衬线字「flipbook」和「手翻书」收尾，每颗蛋落位对一个 mark cue，以后可以直接挂音效。鸟蛋是样例代码，不进运行时库。
- **reference**：新增 paper、materials、text、templates 四篇，片段在 CI 里真跑 check。样张由 `scripts/samples.mjs` 生成到 `docs/samples/`，只在仓库里，不进 npm 包。
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
- **沙箱识别表**：Chromium 起不来时按实测的报错分行处理。macOS 上撞到 mach port 照旧改用单进程重试，Claude Code 和 Codex 的沙箱里都能起。Codex 的 Linux 沙箱不联网时拒绝 socket 调用、临时目录写不进，这两种单进程也没用，直接退 78 并给出对应宿主的放行办法，临时目录写不进单独报 `tmp-unwritable`。报告多了 `detail.signature` 和 `detail.host`。
- **首次下载被沙箱拦**：认出没网络和代理拒绝，提示在沙箱外跑一次或打开网络。SKILL.md 和 INSTALL.md 写上 Codex 的放行设置和 Claude Code 要放行的下载域名。
- **资源不够时退 78**：渲染中途 Chromium 渲染进程被系统杀掉、浏览器整个退出、ffmpeg 被 SIGKILL，都报 `resource-exhausted`，不再报成 `page-error` 或 `glitch`。页面自己崩溃照旧是 `page-error`。
- **为 Windows 铺路**：缓存放 `%LOCALAPPDATA%\liustack\flipbook`，认出 win64 的 headless shell，设 `FLIPBOOK_ALLOW_WIN32=1` 可以绕过 `win32` 的退 78。run.ps1 在 Windows PowerShell 5.1 下保住 CLI 的退出码和 UTF-8 输出。CI 加 windows-latest 一列。原生 Windows 仍不支持。
- **发版盖日期**：`scripts/release.mjs` 发版时把 CHANGELOG 的 `## Unreleased` 改成 `## 版本号 - 当天日期`，没有 Unreleased 时给该版本的标题盖当天日期。两者都有时拒绝发版。
- **平台文档**：新增 `docs/platform.md`，写支持矩阵、沙箱特征、受限容器的实测结果和 GPU 结论（2D 合成继续用软件光栅）。

### 修复

代码审查后的修复，都在首发之前。

- **写入不出合成目录**：`.flipbook/` 或 `out/` 里有软链时，check、snapshot、render 报 `unsafe-output`，什么都不写。所有写入先写新名字再改名到位，不跟随软链和硬链。自带音乐按真实路径核在合成目录内，ffmpeg 只按本地文件读，格式走白名单，播放列表和 concat 一律拒收。
- **render 锁**：用 O_EXCL 建，内容是 pid 和随机令牌，不再误夺刚建的锁，释放时只删自己的锁。
- **不卡住、不漏资源**：送帧和收尾都有期限，超时杀掉 ffmpeg 并等它退出。失败路径逐个回收锁、临时目录、浏览器、页面和编码器。协议探测也受 ready 期限约束，关页面最多等 10 秒。
- **check 更严**：扰动页上出的任何问题都算失败，带原类型码和扰动条件。堵住原生时钟入口，实际调用了禁用的时钟和随机函数报 `forbidden-api-call`。整段移出画面的 DOM 字也报 `text-offstage`。canvas 字按 `ctx.font` 的字体链逐字核字形，文字框按四角完整变换取包围框，并处理 `maxWidth` 压缩。量不出对比度的字报 warning，canvas 字列进 `check.contrastSkipped`。
- **timeline**：`cueProgress` 的 settle 时长和换算一致，0 拍在 cue 时刻就到 1。文字 cue 必须在本场内出完。
- **成片验收**：定格和空白按整条时间轴连续计时，不被场景边界和两类空画面的交替切碎。花屏证据复制到 evidence 目录，不再指向渲染完就删的临时目录。
- **网络**：WebSocket 拦下并记进 `external-request`，页面里禁用 WebRTC 和 WebTransport，浏览器内不解析域名。
- **启动器和 doctor**：run.sh 从第一个数字取版本，预发布版只认和钉死版本完全相同的，`doctor` 带不带 `--json` 都输出一个 JSON。缓存目录写不进时 doctor 报 `cache-unwritable` 退 78。退 78、拒写和内部错误的运行也保存报告，存不了在报告里写明。
- **其他**：commander 钉成精确版本。SECURITY.md 写明 Chromium 自身沙箱被关掉时的边界和写入范围。skill 文件里删掉给维护者看的生成和 CI 说明。
