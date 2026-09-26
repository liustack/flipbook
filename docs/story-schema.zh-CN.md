---
summary: 'story.json v1：字段、节拍怎么放到时间轴上、check 和 render 拿它核对什么'
read_when:
  - 写或改 story.json
  - 改 src/engine/story.ts 里的校验
---

# story.json v1

[English](story-schema.md) | 中文

每个合成讲一个故事，在写 timeline 之前写进 story.json。故事里不写时间：每个节拍写明它从时间轴上哪一刻开始，一直持续到下一拍开始。check 和 render 把它和 timeline.json 放在一起读，没有它就失败（`story-missing`）。报告里每条 `story-invalid` 带一个 JSON 路径，比如 `$.beats[1].at`。

## 示例

```json
{
    "version": 1,
    "idea": "A paper boat soaks through in the rain, and a child's hand lifts it out of the snow",
    "leave": "Small things make it through",
    "subject": "the paper boat",
    "device": {
        "what": "the boat stays on one line while the weather changes behind it",
        "why": "the eye stays on the boat, the world is what changes"
    },
    "beats": [
        { "id": "calm", "role": "opening", "at": "sun", "change": { "from": "the boat drifts in sun", "to": "clouds gather" } },
        { "id": "soak", "role": "turn", "at": "rain", "change": { "from": "the first drop hits", "to": "the boat sags" }, "sound": "drop" },
        { "id": "cold", "role": "build", "at": "snow", "change": { "from": "rain turns to snow", "to": "snow covers the boat" } },
        { "id": "lift", "role": "resolution", "at": { "scene": "snow", "beat": 4 }, "change": { "from": "a hand brushes the snow off", "to": "the boat floats again" }, "text": ["撑过去"], "callback": "calm" }
    ]
}
```

## 顶层字段

| 字段 | 必填 | 取值 | 含义 |
|---|---|---|---|
| `version` | 是 | 1 | 格式版本 |
| `$schema` | 否 | 任意字符串 | 给按 schema 校验 JSON 的编辑器用，flipbook 不读 |
| `idea` | 是 | 一句话 | 谁或什么，遇到什么，变成什么 |
| `leave` | 是 | 一句话 | 结尾观众该感到或记住什么 |
| `subject` | 是 | 一个短语 | 片中会变化的那个东西，只有一个 |
| `device` | 是 | `{ "what", "why" }`，各一句 | 贯穿全片的一个视觉装置，以及它为什么适合这个故事 |
| `beats` | 是 | 3 到 6 个节拍，按顺序 | 按节拍讲的故事。超过六个是 `story-arc` warning |

不在表里的字段是 `story-invalid`。每一句（`idea`、`leave`、`subject`、`device.what`、`device.why`、`change.from`、`change.to`）都是非空字符串，最多 300 个字符。

## beats[]

| 字段 | 必填 | 取值 | 含义 |
|---|---|---|---|
| `id` | 是 | 1 到 64 个 ASCII 字母、数字、`-` 或 `_`，以字母或数字开头，不重复 | 报告和 `callback` 里用它指这一拍 |
| `role` | 是 | `opening`、`turn`、`build`、`resolution` | 这一拍在故事里起什么作用：开场、转折、推进、收束 |
| `at` | 是 | 场的 id，或 `{ "scene": id, "beat": n }` | 这一拍从哪里开始。写场的 id 就是这一场的第一拍。`beat` 从这一场开头算，和 cue 的 `beat` 一样：不小于 0、小于这一场的拍数，可以带小数 |
| `change` | 是 | `{ "from", "to" }`，各一句 | 这一拍开头和结尾，画面上各是什么 |
| `text` | 有 text cue 落在这一拍时 | 字符串数组 | 这一拍的上屏字：开始时刻落在这一拍里的每个 text cue 的 `text`，按时间顺序，一字不差 |
| `sound` | 否 | 一个 sfx cue 的 id | 标志这一拍的声音，必须在这一拍里响 |
| `callback` | 否 | 前面某一拍的 id | 这一拍回应那一拍：回到原处、呼应、兑现 |
| `hold` | 否 | `true` 或 `false` | `true`：这一拍故意不动。全片最多一拍 |

## check 和 render 核对什么

| 类型码 | 什么时候报 |
|---|---|
| `story-missing` | 没有 story.json |
| `story-invalid` | 字段缺了、不认识或超出范围。`at` 指的场不存在，或者拍数超出这一场。`sound` 指的不是 sfx cue，或者不在这一拍里响。`callback` 指的不是前面的拍。`hold` 超过一个 |
| `story-coverage` | 第一拍不是从第一场的第一拍开始，某一拍没有比上一拍晚开始，或者某一拍换算成帧之后一帧都没有 |
| `story-arc` | 第一拍不是 `opening`，最后一拍不是 `resolution`，或者中间没有 `turn`。warning：超过六拍 |
| `story-text` | 某拍的 `text` 和开始时刻落在这一拍里的 text cue 对不上 |
| `story-text-fast`（warning） | 某拍的字比这一拍的时长读得久：每秒超过 7 个阅读单位，一个汉字（含日文、韩文字符）算 1，一个用空格分词的文字里的词算 2 |
| `story-static-beat`（warning） | 没标 `hold` 的拍，首尾两帧只有不到 0.2% 的像素不同，故事说的变化没画出来。两帧都缩成灰度图再比，保持画幅比例缩进 320×180 以内，灰度变化超过 16 的像素才算变了。check 在页面上比这两帧，render 在成片上比 |

只查结构。这个想法值不值得拍、装置有没有意义、每拍的画面有没有画出它的 `change`，交给 agent 看联系表判断，由提需求的人决定。

## 怎么放到时间轴上

- 一拍的开始拍数 = 它所在场的开始拍数 + `beat`（写场 id 时是 0）。结束 = 下一拍的开始，最后一拍到片尾。
- 秒和帧的换算和 cue 一样：`startFrame`、`endFrame` = round(秒数乘 `fps`)。这一拍的帧是从 `startFrame` 到 `endFrame`，不含 `endFrame`。
- 节拍首尾相接，不留缝也不重叠，片子的每一帧恰好属于一拍。每拍至少要有一帧。

放好的节拍写在 `.flipbook/timeline.resolved.json` 的 `story` 里，页面从 `timeline()` 拿到的对象里也有（见 docs/timeline-schema.zh-CN.md）。
