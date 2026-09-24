---
summary: 'timeline.json v1 的字段、取值范围、换算规则和 timeline.resolved.json 的内容'
read_when:
  - 写或改 timeline.json
  - 改 src/engine/timeline.ts 的校验
---

# timeline.json v1

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
        { "id": "tap", "scene": "title", "beat": 0, "kind": "sfx", "sfx": "tap" }
    ],
    "audio": { "mode": "none" }
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
| `settleBeats` | 否 | 0 到 64 | 文字完全出来要几拍，check 和 render 在这个时刻做文字检查，缺省 0 |
| `sfx` | kind 为 sfx 时必填 | 音效名 | v0.3 起用于音效峰值对帧 |

## audio

| 字段 | 说明 |
|---|---|
| `mode` | 必填，`preset`、`file` 或 `none` |
| `preset` | mode 为 preset 时必填，预设名 |
| `key` | 调，如 `D`、`F#`、`Bbm` |
| `progression` | 和声进行编号，0 到 99 |
| `file` | mode 为 file 时必填，合成目录内的相对路径 |
| `bpmOffset` | 用户音乐第一拍的偏移秒数，0 到 60 |

- `none`：成片无声。
- `file`：用户自带音乐。render 从 `bpmOffset` 秒处截起，让第一拍落在 t = 0，不够长补静音，超长截掉，最后一秒（片长不足 4 秒时取片长四分之一）淡出，编成 AAC 48 kHz 立体声 192 kbps 放进成片。文件解析软链后必须是合成目录里的普通文件，否则报 `timeline-invalid`。ffmpeg 只按本地文件读它，格式限 wav、w64、mp3、flac、ogg、aac、mov 系（m4a、mp4）、aiff、matroska 系（mkv、webm），播放列表和 concat 这类会引用别的文件的格式不收。v0.1 不做响度归一。
- `preset`：预设配乐随 v0.3 的 `audio` 命令上线，v0.1 出无声成片并报 `audio-skipped` warning。

## 换算规则

- 每拍秒数 = 60 / `bpm`。
- 场景起点拍数 = 前面所有场景拍数之和，场景拍数 = `bars` 乘 `beatsPerBar`。
- 总帧数 = round(总拍数 乘 每拍秒数 乘 `fps`)，片长 = 总帧数 / `fps`。片长上限 180 秒。
- 第 i 帧的时间 t = i / `fps`，seek 收到的就是这个 t。
- 场景起止帧 = round(起止秒数 乘 `fps`)。
- cue 的绝对拍数 = 场景起点拍数 + `beat`，时间和帧号同上换算。
- 文字的取样时刻 = cue 时间 + `settleBeats` 拍，不超过场景结尾。

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
