---
summary: 'story.json v1: the fields, how beats are placed on the timeline, and what check and render verify against it'
read_when:
  - Writing or changing story.json
  - Changing the validation in src/engine/story.ts
---

# story.json v1

English | [中文](story-schema.zh-CN.md)

Every composition tells one story, written in story.json before the timeline. The story holds no times: each beat names the moment on the timeline where it starts and lasts until the next beat starts. check and render read it together with timeline.json and fail without it (`story-missing`). Each `story-invalid` in the report carries a JSON path, such as `$.beats[1].at`.

## Example

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

## Top-level fields

| Field | Required | Value | Meaning |
|---|---|---|---|
| `version` | yes | 1 | Schema version |
| `$schema` | no | any string | For editors that validate JSON against a schema. flipbook ignores it |
| `idea` | yes | one sentence | Who or what, meets what, becomes what |
| `leave` | yes | one sentence | What the viewer should feel or remember at the end |
| `subject` | yes | a short phrase | The one thing that changes over the film |
| `device` | yes | `{ "what", "why" }`, a sentence each | The one visual device that runs through the film, and why it fits this story |
| `beats` | yes | 3 to 6 beats, in order | The story in beats. More than six is a `story-arc` warning |

A field not listed here is `story-invalid`. Every sentence (`idea`, `leave`, `subject`, `device.what`, `device.why`, `change.from`, `change.to`) is a non-empty string of at most 300 characters.

## beats[]

| Field | Required | Value | Meaning |
|---|---|---|---|
| `id` | yes | 1 to 64 ASCII letters, digits, `-` or `_`, starting with a letter or digit, unique | Names the beat in reports and in `callback` |
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
| `story-invalid` | A field is missing, unknown or out of range. `at` names no scene or a beat past the scene. `sound` names no sfx cue or one outside the beat. `callback` names no earlier beat. More than one `hold` |
| `story-coverage` | The first beat does not start at the first beat of the first scene, a beat does not start after the one before it, or a beat covers no frame once its times are rounded to frames |
| `story-arc` | The first beat is not `opening`, the last is not `resolution`, or no `turn` lies between them. Warning: more than six beats |
| `story-text` | A beat's `text` differs from the text cues that start inside it |
| `story-text-fast` (warning) | A beat's words take longer to read than the beat lasts: above 7 reading units a second, where a CJK character is 1 unit and a word in a spaced script is 2 |
| `story-static-beat` (warning) | Outside a `hold` beat, the beat's first and last frames differ in less than 0.2% of their pixels: the change the story promises does not show. Both frames are compared as gray copies scaled to fit 320×180 with the stage's proportions kept, and a pixel counts as changed when its gray level moves by more than 16. check compares the two frames on the page, render on the finished video |

Only the structure is checked. Whether the idea is worth a film, whether the device means something and whether each beat's picture shows its `change` are for the agent to judge on the contact sheet and for the person asking to decide.

## Placement

- A beat's start beat = its scene's start beat + `beat` (0 for a scene id). Its end = the next beat's start, or the end of the film for the last beat.
- Its seconds and frames convert like a cue's: `startFrame` and `endFrame` = round(seconds times `fps`). Its frames are `startFrame` up to, not including, `endFrame`.
- The beats follow each other with no gap and no overlap, so every frame of the film belongs to exactly one beat. Each beat must hold at least one frame.

The placed beats are in `.flipbook/timeline.resolved.json` under `story`, and in the object the page gets from `timeline()` (see docs/timeline-schema.md).
