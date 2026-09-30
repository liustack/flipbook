---
summary: 'story.json v2：故事的四格和各自落在哪、从四格推出的舞台、record 和 memory 块、节拍怎么放到时间轴上、check 和 render 拿它核对什么'
read_when:
  - 写或改 story.json
  - 改 src/engine/story.ts 里的校验
---

# story.json v2

[English](story-schema.md) | 中文

每个合成讲一个故事，在写 timeline 之前写进 story.json。故事是一句话，分四格：谁想要什么，因为什么事，最后变成了什么。每一格写明观众在哪里找到它：在片子的某一拍里，或者在台下，由观众从有记载的故事或自己的记忆里补上。节拍按顺序把故事讲出来。故事里不写时间：每个节拍写明它从时间轴上哪一刻开始，一直持续到下一拍开始。check 和 render 把它和 timeline.json 放在一起读，没有它就失败（`story-missing`）。报告里每条 `story-invalid` 带一个 JSON 路径，比如 `$.beats[1].at`。

## 示例

```json
{
    "version": 2,
    "who": { "what": "a paper boat", "where": { "beat": "calm", "via": ["picture"] } },
    "wants": { "what": "to reach the far shore", "where": { "beat": "calm", "via": ["picture", "words"] } },
    "because": { "what": "the rain soaks it and the snow buries it", "where": { "beat": "soak", "via": ["picture", "sound"] } },
    "becomes": { "what": "it shakes the snow off and rides high again", "where": { "beat": "lift", "via": ["picture", "words"] } },
    "leave": "Small things make it through",
    "device": {
        "what": "the boat stays on one line while the weather changes behind it",
        "why": "the eye stays on the boat, the world is what changes"
    },
    "beats": [
        { "id": "calm", "role": "opening", "at": "sun", "change": { "from": "the boat drifts in sun", "to": "clouds gather" }, "text": ["到对岸去"] },
        { "id": "soak", "role": "turn", "at": "rain", "change": { "from": "the first drop hits", "to": "the boat sags" }, "sound": "drop" },
        { "id": "cold", "role": "build", "at": "snow", "change": { "from": "rain turns to snow", "to": "snow covers the boat" } },
        { "id": "lift", "role": "resolution", "at": { "scene": "snow", "beat": 4 }, "change": { "from": "a hand brushes the snow off", "to": "the boat floats again" }, "text": ["撑过去"], "callback": "calm" }
    ]
}
```

从有记载的故事讲的片子，把一些格留给记载，另加一个 `record` 块：

```json
{
    "version": 2,
    "who": { "what": "Joseph Marie Jacquard", "where": "record" },
    "wants": { "what": "to weave patterns too fine to set by hand", "where": { "beat": "silk", "via": ["picture"] } },
    "because": { "what": "he sets the loom with punched cards", "where": { "beat": "cards", "via": ["picture"] } },
    "becomes": { "what": "the holes later become programs", "where": { "beat": "code", "via": ["picture", "words"] } },
    "record": {
        "story": "Jacquard's loom read a chain of punched cards to lift each thread, and the idea of a pattern stored as holes led to the punched cards of early computers",
        "sources": ["https://en.wikipedia.org/wiki/Jacquard_machine"],
        "key": "Jacquard loom",
        "materials": { "assets/jacquard-portrait.jpg": "the portrait woven in silk from 24,000 cards, what the cards could do" }
    }
}
```

（只列出不同的字段，`leave`、`device` 和 `beats` 同上。）

## 顶层字段

| 字段 | 必填 | 取值 | 含义 |
|---|---|---|---|
| `version` | 是 | 2 | 格式版本。版本 1 的文件是 `story-invalid` |
| `$schema` | 否 | 字符串 | 给按 schema 校验 JSON 的编辑器用，flipbook 不读它的值 |
| `who` | 是 | 一格 | 故事的主体：会选择、结果对它有得失的那个谁。不是观众 |
| `wants` | 是 | 一格 | 它想要什么，或怕失去什么：具体到能判断得到没有 |
| `because` | 是 | 一格 | 挡在中间的阻碍，或让事情转向的那件事 |
| `becomes` | 是 | 一格 | 最后变成了什么：得到、失去，或变成另一种样子 |
| `record` | 有格是 `"record"` 时 | record 块 | 观众拿来补空白的那个有记载的故事 |
| `memory` | 有格是 `"memory"` 时 | memory 块 | 唤起观众自己记忆的那个细节 |
| `leave` | 是 | 一句话 | 结尾观众该感到或记住什么 |
| `device` | 是 | `{ "what", "why" }`，各一句 | 贯穿全片的一个视觉装置，以及它为什么适合这个故事 |
| `beats` | 是 | 3 到 6 个节拍，按顺序 | 按节拍讲的故事。超过六个是 `story-arc` warning |

不在表里的字段是 `story-invalid`。每一句（每格的 `what`、`leave`、`device.what`、`device.why`、`change.from`、`change.to`、`record.story`、`record.key`、`record.materials` 的每一条、`memory.detail`）都是非空字符串，最多 300 个字符，按 Unicode 字符数算（一个 emoji 算一个）。

## 四格

`who`、`wants`、`because`、`becomes` 每一格都是 `{ "what", "where" }`：

| 字段 | 取值 | 含义 |
|---|---|---|
| `what` | 一句话 | 这一格填的是什么 |
| `where` | `{ "beat": id, "via": [...] }`、`"record"` 或 `"memory"` | 观众在哪里找到它 |

`where` 三选一：

- `{ "beat": id, "via": [...] }`：在台上，落在 `beats` 里的这一拍。`via` 列出它经哪几条通道到达观众，每条最多一次：`"picture"`（画面）、`"words"`（这一拍的上屏字）、`"sound"`（这一拍的音效）。几格可以落在同一拍。
- `"record"`：在台下，观众从有记载的故事（历史、典故）里补：知道的人想起来，不知道的人拿片尾的线索查得到。
- `"memory"`：在台下，观众从自己的经历里补。

## 舞台

舞台不单写：check 从四格推出来，写进换算后的故事的 `stage`。

| 舞台 | 四格 | 块 |
|---|---|---|
| `onstage` | 四格都落在拍里 | 不写 `record`，也不写 `memory` |
| `record` | 至少一格是 `"record"`，没有 `"memory"` | 写 `record`，不写 `memory` |
| `memory` | 至少一格是 `"memory"`，没有 `"record"`，至少一格落在拍里 | 写 `memory`，不写 `record` |

一条片子要么从记载讲，要么从记忆讲，不混用。写了块却没有格留给它，或者有格留在台下却没写对应的块，都是 `story-invalid`。

## record

| 字段 | 必填 | 取值 | 含义 |
|---|---|---|---|
| `story` | 是 | 一句话 | 这个真实故事的简述 |
| `sources` | 是 | 非空字符串数组 | 它记在哪里：书、档案、链接 |
| `key` | 是 | 一句话 | 能搜的线索：人名、年份、器物名。最后一拍的字里必须有它 |
| `materials` | 是 | 对象：资产路径（`assets/...`）对应一句话 | `assets/SOURCES.json` 里的每一份素材，以及它是故事的哪一部分 |

## memory

| 字段 | 必填 | 取值 | 含义 |
|---|---|---|---|
| `detail` | 是 | 一句话 | 具体到让观众认出「我也经历过」的细节：泡在水缸里的西瓜，而不是「夏天」 |

## beats[]

| 字段 | 必填 | 取值 | 含义 |
|---|---|---|---|
| `id` | 是 | 1 到 64 个 ASCII 字母、数字、`-` 或 `_`，以字母或数字开头，不重复 | 报告、`callback` 和格的 `where` 里用它指这一拍 |
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
| `story-invalid` | 字段缺了、不认识或超出范围，或者文件是版本 1。某格的 `where.beat` 指的拍不存在，或者 `via` 为空、有重复、写了别的通道。四格里 `"record"` 和 `"memory"` 混用，两个块都写了，有格留给它却缺了块，写了块却没有格留给它，或者四格全留给记忆。`at` 指的场不存在，或者拍数超出这一场。`sound` 指的不是 sfx cue，或者不在这一拍里响。`callback` 指的不是前面的拍。`hold` 超过一个 |
| `story-slot` | 台上的某一格在它那一拍里没有落点：走 `words` 而那一拍没有 `text`，走 `sound` 而那一拍没有 `sound`，或者只走 `picture` 而那一拍是 `hold` 拍。`detail` 给出哪一格、哪一拍和 `via` |
| `story-coverage` | 第一拍不是从第一场的第一拍开始，某一拍没有比上一拍晚开始，或者某一拍换算成帧之后一帧都没有 |
| `story-arc` | 第一拍不是 `opening`，最后一拍不是 `resolution`，或者中间没有 `turn`。warning：超过六拍 |
| `story-text` | 某拍的 `text` 和开始时刻落在这一拍里的 text cue 对不上 |
| `story-text-fast`（warning） | 某拍的字比这一拍的时长读得久：每秒超过 7 个阅读单位，一个汉字（含日文、韩文字符）算 1，一个用空格分词的文字里的词算 2 |
| `story-ending-short`（warning） | 故事落定后片子停得太快。有文字 cue 时：最后一条出齐后不到 2 秒就结束。没有时：最后一拍不到 2.5 秒。两个下限都最多取片长的 15%，很短的片子要求相应放低 |
| `story-static-beat`（warning） | 没标 `hold` 的拍，首尾两帧只有不到 0.2% 的像素不同，故事说的变化没画出来。两帧都缩成灰度图再比：保持画幅比例，缩到和 320×180 差不多的像素总量，两边取偶数（竖屏是 180×320，方形是 240×240），灰度变化超过 16 的像素才算变了。check 在页面上比这两帧，render 在成片上比 |

机器只能查到每一格都有一个落点。落点上的画面、字和声音有没有真的呈现那一格，装置有没有意义，每拍的画面有没有画出它的 `change`，交给 agent 看联系表判断，由提需求的人决定。

## 怎么放到时间轴上

- 一拍的开始拍数 = 它所在场的开始拍数 + `beat`（写场 id 时是 0）。结束 = 下一拍的开始，最后一拍到片尾。
- 秒和帧的换算和 cue 一样：`startFrame`、`endFrame` = round(秒数乘 `fps`)。这一拍的帧是从 `startFrame` 到 `endFrame`，不含 `endFrame`。
- 节拍首尾相接，不留缝也不重叠，片子的每一帧恰好属于一拍。每拍至少要有一帧。

放好的节拍、四格、`stage`、`record` 和 `memory`（没写是 null）、`leave` 和 `device` 写在 `.flipbook/timeline.resolved.json` 的 `story` 里，页面从 `timeline()` 拿到的对象里也有（见 docs/timeline-schema.zh-CN.md）。
