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
| `sfx` | kind 为 sfx 时必填 | `paper`、`drop`、`ding`、`sweep` | 音效名，峰值对准 cue 所在的帧，见 audio 一节 |

## audio

| 字段 | 用于哪个 mode | 取值 | 说明 |
|---|---|---|---|
| `mode` | 全部，必填 | `preset`、`file`、`none` | 配乐从哪来 |
| `preset` | preset，必填 | `pluck`、`marimba`、`pad` | 预设音色和编配 |
| `key` | 全部 | `A` 到 `G`，可带 `#` 或 `b`，末尾加 `m` 是小调，缺省 `C` | 配乐的调，`ding` 音效也按它的主音定音高 |
| `progression` | preset | 0 到 5 的整数，缺省 0 | 和声进行编号，见下表 |
| `dynamics` | preset | 场景 id 到 `rest`、`soft`、`medium`、`full` 的映射 | 每场强弱，没写的场景按 `medium` |
| `file` | file，必填 | 合成目录内的相对路径 | 用户自带音乐，文件不在合成目录里时报 `timeline-invalid` |
| `bpmOffset` | file | 0 到 60，缺省 0 | 用户音乐里第一拍落在第几秒 |

字段写在不用它的 mode 下（比如 `mode: none` 带 `preset`）报 `timeline-invalid`，路径指到那个字段。

- `none`：没有配乐。有 `sfx` cue 时成片只带音效，没有 `sfx` cue 时是无声成片。
- `preset`：`audio` 命令按预设、调、和声进行和每场强弱合成配乐，render 自动调用。
- `file`：用户自带音乐，不做节拍检测，`bpm` 和 `bpmOffset` 由用户给。文件解析软链后必须是合成目录里的普通文件，否则报 `timeline-invalid`。ffmpeg 只按本地文件读它，格式限 wav、w64、mp3、flac、ogg、aac、mov 系（m4a、mp4）、aiff、matroska 系（mkv、webm），播放列表和 concat 这类会引用别的文件的格式不收。

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

### 音效

| `sfx` | 声音 | 峰值在哪 |
|---|---|---|
| `paper` | 翻纸：碎响、掠过、纸落下的一拍 | 纸落下那一下，起声在峰值前约 0.14 秒 |
| `drop` | 轻物落在纸上：下沉的闷响、一声咔嗒 | 起音处 |
| `ding` | 小铃，音高是 `key` 的主音 | 起音处 |
| `sweep` | 扫频的呼声，越来越响，到峰值后很快收住 | 起声后约 0.32 秒 |

每个音效单独合成，找到自己的最大采样，再把这个采样放到 cue 帧在 48 kHz 上的位置（帧号乘 48000 除以 fps 取整）。峰值前的部分落到 t = 0 之前的截掉。

### 合成、混音和响度

- `audio` 命令开一个空白页面加载 `/__flipbook/audio.js`，用 `OfflineAudioContext` 合成，PCM 分块 base64 传回 Node，写到 `.flipbook/audio/`：`music.wav`（preset）、`sfx.wav`（有 sfx cue），48 kHz 立体声 32 位浮点，长度等于画面。另写 `score.json`（和弦、强弱、音效位置）和 `audio.json`（各轨哈希、峰值、每个音效实际峰值的位置）。
- 同机同版本合成两次，两个 WAV 逐字节一致。timeline、audio.js 和 Chromium 版本都没变时，render 直接用已有的轨。
- render 把配乐（preset 合成的轨或用户文件）和音效用 `amix`（`normalize=0`）混在一起。有配乐时先量配乐自己的整合响度，把音效峰值放在它上方 12 dB。再量整体，线性增益到 -14 LUFS，4 倍过采样限幅到 -3 dBFS，然后量一遍限幅后的响度，把差值补进增益。只有音效时按峰值放到 -4 dBFS 再限幅。最后编 AAC 48 kHz 立体声 192 kbps。
- 用户文件从 `bpmOffset` 秒处截起，让第一拍落在 t = 0，不够长补静音，超长截掉，最后一秒（片长不足 4 秒时取片长四分之一）淡出，然后和上面一样归一。
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
