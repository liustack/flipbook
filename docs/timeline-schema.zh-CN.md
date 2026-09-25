---
summary: 'timeline.json v1 的字段、取值范围、换算规则和 timeline.resolved.json 的内容'
read_when:
  - 写或改 timeline.json
  - 改 src/engine/timeline.ts 的校验
---

# timeline.json v1

[English](timeline-schema.md) | 中文

timeline.json 是画面和声音唯一的时间来源。时间一律用拍写，CLI 换算成秒和帧后写进 `.flipbook/timeline.resolved.json`，再交给页面和 ffmpeg。校验出错时报告里每条 `timeline-invalid` 都带 JSON 路径（如 `$.scenes[1].bars`）。

## 例子

```json
{
    "version": 1,
    "width": 1920,
    "height": 1080,
    "fps": 24,
    "seed": 20260925,
    "bpm": 96,
    "beatsPerBar": 4,
    "scenes": [
        { "id": "intro", "bars": 1 },
        { "id": "title", "bars": 1, "hold": true }
    ],
    "cues": [
        { "id": "zh", "scene": "intro", "beat": 1, "kind": "text", "text": "你好，翻页书", "settleBeats": 1 },
        { "id": "tap", "scene": "title", "beat": 0, "kind": "sfx", "sfx": "drop" }
    ],
    "audio": { "mode": "preset", "preset": "pluck", "key": "D", "dynamics": { "intro": "soft" } }
}
```

## 顶层字段

| 字段 | 必填 | 取值 | 说明 |
|---|---|---|---|
| `version` | 是 | `1` | schema 版本 |
| `width` | 是 | 16 到 7680 的偶数 | 舞台宽，CSS 像素 |
| `height` | 是 | 16 到 4320 的偶数 | 舞台高，CSS 像素 |
| `fps` | 是 | 1 到 60 的整数 | 帧率 |
| `seed` | 是 | 0 到 4294967295 的整数 | 片子的随机种子，运行时库的 `rng`、`rand` 用它 |
| `bpm` | 是 | 30 到 300 | 每分钟拍数 |
| `beatsPerBar` | 是 | 1 到 16 的整数 | 每小节拍数 |
| `scenes` | 是 | 至少一个 | 分场，按顺序首尾相接 |
| `cues` | 否 | | 文字、音效和标记 |
| `audio` | 否 | | 配乐设置，缺省等于 `{ "mode": "none" }` |
| `brand` | 否 | 以 `.json` 结尾的相对路径，从合成目录算起 | 这条片子用的 brand.json，放合成目录写 `"brand.json"`，放工作区根写 `"../brand.json"`。字段和校验见 skill 的 references/brand.md，文件不存在或不合规时报 `brand-invalid` |
| `$schema` | 否 | 字符串 | 编辑器提示用，不参与校验 |

其他字段一律报错，免得拼错的字段被静默忽略。

## scenes[]

| 字段 | 必填 | 取值 | 说明 |
|---|---|---|---|
| `id` | 是 | 字母、数字、`-`、`_`，不超过 64 个字符，不重复 | |
| `bars` | 是 | 大于 0 | 小节数，`bars` 乘 `beatsPerBar` 必须是整数拍 |
| `hold` | 否 | true 或 false | true 时这一场不做定格检测 |

## cues[]

| 字段 | 必填 | 取值 | 说明 |
|---|---|---|---|
| `id` | 是 | 同 scene id 规则，不重复 | |
| `scene` | 是 | 某个 scene 的 id | |
| `beat` | 是 | 0 到该场拍数（不含） | 从场景开头算的拍数，可以是小数 |
| `kind` | 是 | `text`、`sfx`、`mark` | |
| `text` | kind 为 text 时必填 | 非空字符串 | 上屏文字，check 用它核对字形覆盖 |
| `settleBeats` | 否 | 0 到 64 | 文字完全出来要几拍，check 和 render 在这个时刻做文字检查，缺省 0（在 cue 时刻就完全出来）。文字 cue 必须在本场结束前出完 |
| `sfx` | kind 为 sfx 且没给 `file` 时必填 | `paper`、`drop`、`ding`、`sweep` | 内置音效，峰值对准 cue 所在的帧，见 audio 一节 |
| `file` | 只用于 kind 为 sfx，代替 `sfx` | 合成目录内的相对路径，如 `assets/page-turn.mp3` | 合成目录里的音效文件，一般是 `stock fetch` 存下的。文件里最响的采样对准 cue 所在的帧。`assets/SOURCES.json` 里要有它的来源和许可，否则报 `audio-unlicensed`。`sfx` 和 `file` 都给报 `timeline-invalid` |

## audio

| 字段 | 用于哪个 mode | 取值 | 说明 |
|---|---|---|---|
| `mode` | 全部，必填 | `preset`、`score`、`file`、`none` | 配乐从哪来 |
| `preset` | preset，必填 | `pluck`、`marimba`、`pad` | 预设音色和编配 |
| `key` | 全部 | `A` 到 `G`，可带 `#` 或 `b`，末尾加 `m` 是小调，缺省 `C` | 配乐的调，`ding` 音效也按它的主音定音高。手写乐谱自己写音名和和弦名，所以 score 模式里只有 `ding` 用它 |
| `progression` | preset | 0 到 5 的整数，缺省 0 | 和声进行编号，见下表 |
| `dynamics` | preset | 场景 id 到 `rest`、`soft`、`medium`、`full` 的映射 | 每场强弱，没写的场景按 `medium` |
| `score` | score，必填 | 对象，见[手写乐谱](#手写乐谱) | 写出来的音乐：各场的声部、和弦、音符和鼓的步进 |
| `file` | file，必填 | 合成目录内的相对路径 | 来自文件的音乐：用户自带的，或 `stock fetch` 存下的。文件不在合成目录里报 `timeline-invalid`，`assets/SOURCES.json` 里没有它的来源和许可报 `audio-unlicensed` |
| `bpmOffset` | file | 0 到 60，缺省 0 | timeline 跟着这首音乐的节拍走时，它的第一拍落在第几秒 |
| `offset` | file | 0 到 3600 | 成片从文件的第几秒开始用，给 timeline 不跟节拍的音乐用。`offset` 和 `bpmOffset` 都给报 `timeline-invalid` |
| `fadeIn` | file | 0 到 30，缺省 0 | 开头淡入几秒 |
| `fadeOut` | file | 0 到 30，缺省 1（片长不足 4 秒时取片长四分之一） | 结尾淡出几秒。`fadeIn` 加 `fadeOut` 不能超过片长 |

字段写在不用它的 mode 下（比如 `mode: none` 带 `preset`）报 `timeline-invalid`，路径指到那个字段。

- `none`：没有配乐。有 `sfx` cue 时成片只带音效，没有 `sfx` cue 时是无声成片。
- `preset`：`audio` 命令按预设、调、和声进行和每场强弱合成配乐，render 自动调用。
- `score`：`audio` 命令用下面的合成乐器照谱逐音演奏。混音和响度与 preset 相同。
- `file`：来自文件的音乐，不做节拍检测。用户自带的歌由用户给 `bpm` 和 `bpmOffset`。找来的曲子 timeline 不跟它的节拍时，用 `offset` 选从哪里开始。文件解析软链后必须是合成目录里的普通文件，否则报 `timeline-invalid`。ffmpeg 只按本地文件读它，格式限 wav、w64、mp3、flac、ogg、aac、mov 系（m4a、mp4）、aiff、matroska 系（mkv、webm），播放列表和 concat 这类会引用别的文件的格式不收。

### 和声进行

一小节一个和弦，四小节一轮，按全片的小节数往下排，不随场景重来。最后一小节换成主和弦（大调 I，小调 i）收尾。

| 编号 | 大调 | 小调 |
|---|---|---|
| 0 | I V vi IV | i VI III VII |
| 1 | I vi IV V | i iv VI V |
| 2 | vi IV I V | i VII VI VII |
| 3 | I IV vi V | i VI iv V |
| 4 | IV V iii vi | VI VII i i |
| 5 | ii V I vi | i iv VII III |

### 强弱

| 值 | 效果 |
|---|---|
| `rest` | 这一场不出新音符，前面的余音自然衰减 |
| `soft` | 稀疏，只留低音和少量旋律音，力度低 |
| `medium` | 完整织体 |
| `full` | 加一层（拨弦加扫弦和摇铃，马林巴加花和铃声，铺底加脉动），力度高 |

强弱按音符的起点所在的场景算，跨场的长音保持起音时的力度。

### 手写乐谱

`audio.score` 是 agent 给这条片子写的音乐。按场景写，小节在每场里数，每一拍都落在 timeline 的拍子网格上。

```json
"audio": {
    "mode": "score",
    "key": "Dm",
    "score": {
        "room": "hall",
        "instruments": { "keys": "piano", "lead": { "instrument": "flute", "volume": 0.8 }, "low": "bass", "beat": "drums" },
        "scenes": {
            "open": { "level": "soft", "chords": ["Dm", "Bb", "F", "C"], "play": { "keys": "arpeggio", "low": "root" } },
            "flip": {
                "chords": ["Gm", "Dm", "Bb", "A7"],
                "play": {
                    "keys": "broken",
                    "low": "root-fifth",
                    "lead": ["A4 D5 F5:2", "E5:2 D5 C5", "D5:3 F5", "E5:4"],
                    "beat": { "kick": "x...x...", "shaker": "..x...x." }
                }
            }
        }
    }
}
```

| 字段 | 必填 | 取值 | 说明 |
|---|---|---|---|
| `room` | 否 | `dry`、`room`、`hall`，缺省 `room` | 混响：短而近、房间、长的大厅 |
| `instruments` | 是 | 1 到 8 个声部 | 声部名（字母开头，后接字母、数字、`-`、`_`）到乐器名，或到 `{ "instrument", "volume", "pan" }`。`volume` 0 到 2（缺省 1），`pan` -1 到 1（缺省按乐器） |
| `scenes` | 是 | 至少一个场景 id | 每场演奏什么。没写的场景不出新音，前面的音自然衰减 |
| `scenes.<id>.level` | 否 | `soft`、`medium`、`full`，缺省 `medium` | 这一场所有音的力度 |
| `scenes.<id>.chords` | 有声部用伴奏型时 | 按小节的数组 | 一项一小节，见下文 |
| `scenes.<id>.play` | 是 | 至少一个声部 | 声部名到伴奏型名字、按小节的音符数组，或（鼓）步进对象 |

**列表循环。** `chords`、音符数组、鼓的步进数组可以比这一场短，从头循环。比这一场长报 `timeline-invalid`。最后一小节不完整的场景（比如 `bars: 1.5`），最后一小节在场景结束处截断。

**和弦。** 和弦名是根音 `C` 到 `B`，可带 `#` 或 `b`，后接性质（不写、`m`、`7`、`m7`、`maj7`、`dim`、`aug`、`sus2`、`sus4`、`add9`、`6`、`m6`、`9`、`m9`），可带 `C/E` 这样的斜线低音。一小节可以是一个和弦（`"Dm"`），几个和弦平分（`"Dm G7"`），或带拍数的和弦（`"Dm:3 G7:1"`，加起来要等于一小节）。`"-"` 是没有和弦的小节，伴奏型在这里休止。

**音符。** 一小节音符是一串词。每个词是科学音名（`C4` 是中央 C，`F#3`、`Bb5`），`-` 是休止，`~` 延续前一个音（可以跨小节线），可带 `:拍数`（`D5:2`、`E5:0.5`、`G4:1/3`）。不写拍数是一拍。`D4+F4+A4` 同时发几个音（单音乐器不行）。一小节的拍数加起来必须等于 `beatsPerBar`。超出乐器音域的音报 `timeline-invalid`。

**伴奏型。** 伴奏型按一种节奏弹这一场的和弦。一小节里有几个和弦时，伴奏型在每个和弦上重新开始。

| 伴奏型 | 弹法 |
|---|---|
| `hold` | 整个和弦按住，直到换和弦 |
| `pulse` | 每拍一个和弦 |
| `offbeat` | 每拍后半拍一个和弦 |
| `arpeggio` | 和弦音八分音符上行再下行 |
| `broken` | 八分音符：低、高、中、高 |
| `strum` | 小节开头和中间各扫一次 |
| `root` | 根音（或斜线低音）按住 |
| `root-fifth` | 小节开头根音，中间五度 |
| `octaves` | 根音八分音符，高低八度交替 |

单音乐器（`flute`、`clarinet`、`bass`、`sub`）上的和弦型只弹根音。

**鼓的步进。** 鼓声部把鼓件（`kick`、`snare`、`hat`、`shaker`、`knock`、`clap`）映射到一个步进串，或一小节一个的步进串数组。`x` 击打，`X` 重音，`.` 空。串把一小节等分，所以 `"x...x..."` 在 4/4 里是八分音符格。

**乐器。** 全部代码合成，不用采样。

| 乐器 | 声音 | 音域 |
|---|---|---|
| `piano` | 柔和的钢琴，弹得越重越亮 | A0 到 C8 |
| `celesta` | 钢片琴，清亮甜美 | C4 到 C8 |
| `musicbox` | 八音盒梳齿，带慢慢的闪动 | C4 到 G7 |
| `bells` | 钟琴 | G4 到 C8 |
| `marimba` | 木琴 | A2 到 C7 |
| `pluck` | 尼龙弦吉他 | E2 到 C6 |
| `harp` | 竖琴，任它余响 | C1 到 G7 |
| `strings` | 弦乐组，慢弓和揉弦 | C2 到 C7 |
| `pad` | 柔和的合成铺底 | C2 到 C7 |
| `flute` | 长笛，带气声和颤音，单音 | C4 到 C7 |
| `clarinet` | 温暖的单簧管，单音 | D3 到 G6 |
| `bass` | 拨奏低音提琴，单音 | E1 到 C4 |
| `sub` | 正弦超低音，单音 | C1 到 G3 |
| `drums` | 轻柔的鼓组：`kick`、`snare`（鼓刷）、`hat`、`shaker`、`knock`、`clap` | |

乐谱里的错误全部是 `timeline-invalid`，带出错字段的 JSON 路径，比如拍数加不齐的小节是 `$.audio.score.scenes.flip.play.lead[1]`，不认识的和弦是 `$.audio.score.scenes.flip.chords[2]`，不认识的乐器是 `$.audio.score.instruments.lead`。

乐谱在 Node 里展开成音符（`.flipbook/audio/` 下的 `score.json` 在 `sheet` 里列出）。每个音按 `seed` 带几毫秒的时间偏移和一点力度起伏，所以同一份 timeline 每次演奏都一样。

### 音效

| `sfx` | 声音 | 峰值在哪 |
|---|---|---|
| `paper` | 翻纸：碎响、掠过、纸落下的一拍 | 纸落下那一下，起声在峰值前约 0.14 秒 |
| `drop` | 轻物落在纸上：下沉的闷响、一声咔嗒 | 起音处 |
| `ding` | 小铃，音高是 `key` 的主音 | 起音处 |
| `sweep` | 扫频的呼声，越来越响，到峰值后很快收住 | 起声后约 0.32 秒 |

每个音效单独合成，找到自己的最大采样，再把这个采样放到 cue 帧在 48 kHz 上的位置（帧号乘 48000 除以 fps 取整）。峰值前的部分落到 t = 0 之前的截掉。

带 `file` 的 sfx cue 规则相同：文件解码成 48 kHz 立体声（只按本地文件读，格式限 `mode: file` 列的那些），两个声道里最响的采样放到 cue 帧上，整体缩放到这个采样为 0.6，和内置音效差不多响。落到 t = 0 之前和超出片尾的部分截掉。ffmpeg 读不了或整段无声的文件报 `timeline-invalid`，路径指到那条 cue 的 `file`。挑或裁文件时让它要对准的那一下是全段最响的地方。

### 合成、混音和响度

- `audio` 命令开一个空白页面加载 `/__flipbook/audio.js`，用 `OfflineAudioContext` 合成，PCM 分块 base64 传回 Node，写到 `.flipbook/audio/`：`music.wav`（preset 或 score）、`sfx.wav`（有 sfx cue），48 kHz 立体声 32 位浮点，长度等于画面。另写 `score.json`（和弦、强弱、手写乐谱的音符、音效位置）和 `audio.json`（各轨哈希、峰值、每个音效实际峰值的位置）。
- 同机同版本合成两次，两个 WAV 逐字节一致。timeline、audio.js 和 Chromium 版本都没变时，render 直接用已有的轨。
- 来自文件的音效不经合成：只要有带 `file` 的 sfx cue，`audio` 命令和 render 就把这些文件叠到合成的 `sfx.wav` 上（同时有内置音效时），写成同格式的 `.flipbook/audio/effects.wav`，混音和验收都用这条轨。没有内置音效也没有合成配乐时，音频不开浏览器页面。
- render 把配乐（preset 或 score 合成的轨，或音乐文件）和音效用 `amix`（`normalize=0`）混在一起。有配乐时先量配乐自己的整合响度，把音效峰值放在它上方 12 dB。再量整体，线性增益到 -14 LUFS，4 倍过采样限幅到 -3 dBFS，然后量一遍限幅后的响度，把差值补进增益。只有音效时按峰值放到 -4 dBFS 再限幅。最后编 AAC 48 kHz 立体声 192 kbps。
- 音乐文件从 `bpmOffset`（或 `offset`）秒处截起，给 `bpmOffset` 时第一拍落在 t = 0，不够长补静音，超长截掉，开头按 `fadeIn` 秒淡入，结尾按 `fadeOut` 秒淡出（缺省最后一秒，片长不足 4 秒时取片长四分之一），然后和上面一样归一。
- 响度一律用 ffmpeg `ebur128` 量，和验收同一个表。旁白的 sidechain 压低留了接口（`MixOptions.voice`），没实现。

## 换算规则

- 每拍秒数 = 60 / `bpm`。
- 场景起点拍数 = 前面所有场景拍数之和，场景拍数 = `bars` 乘 `beatsPerBar`。
- 总帧数 = round(总拍数 乘 每拍秒数 乘 `fps`)，片长 = 总帧数 / `fps`。片长上限 180 秒。
- 第 i 帧的时间 t = i / `fps`，seek 收到的就是这个 t。
- 场景起止帧 = round(起止秒数 乘 `fps`)。
- cue 的绝对拍数 = 场景起点拍数 + `beat`，时间和帧号同上换算。
- 文字的取样帧 = cue 时间加 `settleBeats` 拍之后的第一帧，也就是 `cueProgress` 到 1 的第一帧，存在 `settleFrame`。它必须落在 cue 所在场景之内（小于该场的 `endFrame`），否则报 `timeline-invalid`，路径指向 `settleBeats`（`settleBeats` 为 0 时指向 `beat`）。不再把取样时刻截到场景结尾。

用户说「30 秒」时由 agent 选 bpm 和小节数凑近，不在 timeline 里写秒数。

## timeline.resolved.json

CLI 写出的换算结果，也是页面里 `timeline()` 拿到的对象：

| 字段 | 说明 |
|---|---|
| `version`、`protocol` | 都是 1 |
| `width`、`height`、`fps`、`seed`、`bpm`、`beatsPerBar` | 照抄 |
| `secondsPerBeat`、`totalBeats`、`durationSec`、`frameCount` | 换算结果 |
| `scenes[]` | 加上 `index`、`startBeat`、`beats`、`start`、`end`（秒）、`startFrame`、`endFrame`、`hold` |
| `cues[]` | 加上 `absBeat`、`time`、`frame`、`settleBeats`、`settleTime`、`settleFrame` |
| `audio` | 照抄，缺省 `{ "mode": "none" }` |
| `brand` | 没写 `brand` 时是 null。写了就是校验过的品牌：`name`、`tagline`（没写是 null）、`colors`（`primary`、`secondary`、`ink`、`paper`，小写，没写的是 null）、`logo`（`src` 是内联的 `data:` 地址、`type` 是 MIME 类型，没有 logo 是 null）、`fonts`（`title` 和 `text` 两个字体族名）。运行时的 `brand()` 从这里取 |
| `fonts` | 这条片子自带的字体，没有就是空数组。来自 brand.json 的 `fonts.files` 和合成目录 `assets/fonts/` 里写了许可证的 .ttf、.otf。每项有 `id`（`user-` 加文件 SHA-256 的前 16 位）、`family`、`url`（`/__flipbook/fonts/user/<哈希>.<扩展名>`）、`weight`、`style`、`source`（brand.json 或合成目录里写的路径）。页面加载前和 flipbook 自己的字体一起装好，check 的码位表和字体回退检查也认它们 |
