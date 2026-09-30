---
summary: 'story.json v2: the four slots of the story and where each lands, the stage worked out from them, the record and memory blocks, how beats are placed on the timeline, and what check and render verify against it'
read_when:
  - Writing or changing story.json
  - Changing the validation in src/engine/story.ts
---

# story.json v2

English | [中文](story-schema.zh-CN.md)

Every composition tells one story, written in story.json before the timeline. The story is one sentence in four slots: who wants what, because of what, and what they become. Each slot says where the viewer finds it: in a beat of the film, or off stage, filled in by the viewer from a written record or from their own memory. The beats tell the story in order. The story holds no times: each beat names the moment on the timeline where it starts and lasts until the next beat starts. check and render read it together with timeline.json and fail without it (`story-missing`). Each `story-invalid` in the report carries a JSON path, such as `$.beats[1].at`.

## Example

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

A story told from a written record leaves some slots to it and adds a `record` block:

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

(Only the fields that differ are shown. `leave`, `device` and `beats` are the same as above.)

## Top-level fields

| Field | Required | Value | Meaning |
|---|---|---|---|
| `version` | yes | 2 | Schema version. A version 1 file is `story-invalid` |
| `$schema` | no | a string | For editors that validate JSON against a schema. flipbook ignores its value |
| `who` | yes | a slot | Who the story is about: someone who can choose and has something to gain or lose. Not the viewer |
| `wants` | yes | a slot | What they want, or fear losing: specific enough that you can tell whether they got it |
| `because` | yes | a slot | What stands in the way, or the event that turns things |
| `becomes` | yes | a slot | What they end up with: they get it, lose it, or become something else |
| `record` | when a slot is `"record"` | a record block | The written story the viewer fills the gaps from |
| `memory` | when a slot is `"memory"` | a memory block | The detail that brings the viewer's own memory back |
| `leave` | yes | one sentence | What the viewer should feel or remember at the end |
| `device` | yes | `{ "what", "why" }`, a sentence each | The one visual device that runs through the film, and why it fits this story |
| `beats` | yes | 3 to 6 beats, in order | The story in beats. More than six is a `story-arc` warning |

A field not listed here is `story-invalid`. Every sentence (each slot's `what`, `leave`, `device.what`, `device.why`, `change.from`, `change.to`, `record.story`, `record.key`, each line of `record.materials`, `memory.detail`) is a non-empty string of at most 300 characters, counted as Unicode characters (an emoji is one).

## Slots

Each of `who`, `wants`, `because` and `becomes` is `{ "what", "where" }`:

| Field | Value | Meaning |
|---|---|---|
| `what` | one sentence | What fills the slot |
| `where` | `{ "beat": id, "via": [...] }`, `"record"` or `"memory"` | Where the viewer finds it |

`where` is one of:

- `{ "beat": id, "via": [...] }`: on stage, in that beat of `beats`. `via` lists how it reaches the viewer, each at most once: `"picture"`, `"words"` (the beat's words on screen), `"sound"` (the beat's sound effect). Several slots may land in the same beat.
- `"record"`: off stage. The viewer fills it in from a written story (history, a known tale): those who know it recall it, those who don't can look it up from the clue the film ends on.
- `"memory"`: off stage. The viewer fills it in from their own life.

## Stage

The stage is not written down: check works it out from the slots and puts it in the resolved story as `stage`.

| Stage | Slots | Block |
|---|---|---|
| `onstage` | all four in beats | neither `record` nor `memory` |
| `record` | at least one `"record"`, none `"memory"` | `record`, no `memory` |
| `memory` | at least one `"memory"`, none `"record"`, at least one in a beat | `memory`, no `record` |

A film is told from a record or from memory, not both. A block without a slot left to it, or a slot left off stage without its block, is `story-invalid`.

## record

| Field | Required | Value | Meaning |
|---|---|---|---|
| `story` | yes | one sentence | The real story, in short |
| `sources` | yes | a non-empty array of strings | Where it is written: a book, an archive, a link |
| `key` | yes | one sentence | The clue to search for: a name, a year, an object. The last beat's words must contain it |
| `materials` | yes | an object: an asset path (`assets/...`) to one sentence | Every file in `assets/SOURCES.json` and which part of the story it is |

## memory

| Field | Required | Value | Meaning |
|---|---|---|---|
| `detail` | yes | one sentence | The concrete detail that makes a viewer think "I've been there": a watermelon cooling in a water barrel, not "summer" |

## beats[]

| Field | Required | Value | Meaning |
|---|---|---|---|
| `id` | yes | 1 to 64 ASCII letters, digits, `-` or `_`, starting with a letter or digit, unique | Names the beat in reports, in `callback` and in a slot's `where` |
| `role` | yes | `opening`, `turn`, `build`, `resolution` | What the beat does in the story |
| `at` | yes | a scene id, or `{ "scene": id, "beat": n }` | Where the beat starts. A scene id means the scene's first beat. `beat` counts from the start of that scene, like a cue's `beat`: at least 0 and below the scene's beats, fractions allowed |
| `change` | yes | `{ "from", "to" }`, a sentence each | What the picture shows as the beat starts and as it ends |
| `text` | when text cues fall in the beat | array of strings | The words on screen in this beat: the `text` of every text cue that starts inside it, in time order, exactly |
| `sound` | no | an sfx cue id | The sound that marks this beat. It must play inside the beat |
| `callback` | no | an earlier beat's id | This beat answers that one: a return, a rhyme, a payoff |
| `hold` | no | `true` or `false` | `true`: this beat stands still on purpose. At most one beat in the story |

## What check and render verify

| Code | When |
|---|---|
| `story-missing` | No story.json |
| `story-invalid` | A field is missing, unknown or out of range, or the file is version 1. A slot's `where.beat` names no beat, or `via` is empty, repeats a channel or names another. The slots mix `"record"` and `"memory"`, both blocks are present, a block is missing for the slots left to it or present with no slot left to it, or all four slots are left to memory. `at` names no scene or a beat past the scene. `sound` names no sfx cue or one outside the beat. `callback` names no earlier beat. More than one `hold` |
| `story-slot` | A slot on stage has nothing to land on in its beat: it goes through `words` and the beat has no `text`, through `sound` and the beat has no `sound`, or through `picture` alone and the beat is the `hold` beat. `detail` names the slot, the beat and `via` |
| `story-record` | Only for a story told from a record. A file in `assets/SOURCES.json` has no line in `record.materials` (a file cut from another by `cutout`, `puppet` or `sprite` names its original in `cutFrom` and counts as placed when the original has a line), `record.materials` names a file `assets/SOURCES.json` has no entry for, or no line of the last beat's `text` contains `record.key` |
| `story-coverage` | The first beat does not start at the first beat of the first scene, a beat does not start after the one before it, or a beat covers no frame once its times are rounded to frames |
| `story-arc` | The first beat is not `opening`, the last is not `resolution`, or no `turn` lies between them. Warning: more than six beats |
| `story-text` | A beat's `text` differs from the text cues that start inside it |
| `story-text-fast` (warning) | A beat's words take longer to read than the beat lasts: above 7 reading units a second, where a CJK character is 1 unit and a word in a spaced script is 2 |
| `story-ending-short` (warning) | The film stops too soon after its story lands. With text cues: the last one settles less than 2 s before the end. Without: the last beat lasts less than 2.5 s. Either floor is capped at 15% of the film's length, so a very short film asks for less |
| `story-static-beat` (warning) | Outside a `hold` beat, the beat's first and last frames differ in less than 0.2% of their pixels: the change the story promises does not show. Both frames are compared as gray copies scaled, with the stage's proportions kept, to about as many pixels as 320×180 (both sides even: 180×320 for a portrait stage, 240×240 for a square one), and a pixel counts as changed when its gray level moves by more than 16. check compares the two frames on the page, render on the finished video |

A machine can only check that every slot has somewhere to land. Whether the picture, words and sound at that place really carry the slot, whether the device means something and whether each beat's picture shows its `change` are for the agent to judge on the contact sheet and for the person asking to decide.

## Placement

- A beat's start beat = its scene's start beat + `beat` (0 for a scene id). Its end = the next beat's start, or the end of the film for the last beat.
- Its seconds and frames convert like a cue's: `startFrame` and `endFrame` = round(seconds times `fps`). Its frames are `startFrame` up to, not including, `endFrame`.
- The beats follow each other with no gap and no overlap, so every frame of the film belongs to exactly one beat. Each beat must hold at least one frame.

The placed beats, the four slots, `stage`, `record` and `memory` (null when absent), `leave` and `device` are in `.flipbook/timeline.resolved.json` under `story`, and in the object the page gets from `timeline()` (see docs/timeline-schema.md).
