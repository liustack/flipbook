# timeline.json v1

`timeline.json` is the only source of time for picture and sound. Write everything in beats. flipbook converts beats to seconds and frames, writes the result to `.flipbook/timeline.resolved.json`, and hands it to the page through `await timeline()`.

The JavaScript snippets in this file run through `flipbook check` in CI against this timeline:

<!-- snippet-timeline -->
```json
{
    "version": 1,
    "width": 640,
    "height": 360,
    "fps": 12,
    "seed": 7,
    "bpm": 96,
    "beatsPerBar": 4,
    "scenes": [
        { "id": "question", "bars": 1 },
        { "id": "answer", "bars": 1, "hold": true }
    ],
    "cues": [
        { "id": "ask", "scene": "question", "beat": 0, "kind": "text", "text": "为什么是纸？", "settleBeats": 2 },
        { "id": "reply", "scene": "answer", "beat": 1, "kind": "text", "text": "因为它会翻页", "settleBeats": 1 },
        { "id": "cut", "scene": "answer", "beat": 0, "kind": "mark" }
    ],
    "audio": { "mode": "none" }
}
```

## Fields

| Field | Required | Values | Meaning |
|---|---|---|---|
| `version` | yes | `1` | schema version |
| `width`, `height` | yes | even integers, 16 to 7680 and 16 to 4320 | stage size in CSS pixels, also the video size |
| `fps` | yes | integer 1 to 60 | frame rate |
| `seed` | yes | integer 0 to 4294967295 | seed for `rng` and `rand` |
| `bpm` | yes | 30 to 300 | tempo |
| `beatsPerBar` | yes | integer 1 to 16 | beats per bar |
| `scenes` | yes | at least one | scenes play in order, back to back |
| `cues` | no | | text, sound effect and marker events |
| `audio` | no | | soundtrack, default `{ "mode": "none" }` |

Any other field is an error, so a typo never passes silently.

`scenes[]`:

| Field | Required | Values | Meaning |
|---|---|---|---|
| `id` | yes | letters, digits, `-`, `_`, unique | |
| `bars` | yes | greater than 0, `bars × beatsPerBar` must be whole beats | length |
| `hold` | no | `true` | allows the picture to stand still for more than 1.5 s in this scene |

`cues[]`:

| Field | Required | Values | Meaning |
|---|---|---|---|
| `id` | yes | like scene ids, unique | |
| `scene` | yes | a scene id | |
| `beat` | yes | 0 up to the scene's beat count (exclusive), decimals allowed | when, counted from the scene start |
| `kind` | yes | `text`, `sfx`, `mark` | |
| `text` | for `text` | the on-screen text | check verifies every character has a glyph |
| `settleBeats` | no | 0 to 64 | beats until the text is fully in, default 0 |
| `sfx` | for `sfx` | effect name | sound effects arrive in v0.3 |

`audio`:

| Mode | What render does |
|---|---|
| `none` | a silent video |
| `file` | the user's music at `file` (a regular file inside the composition: wav, mp3, flac, ogg, aac, m4a, aiff or webm, not a playlist), cut so the first beat at `bpmOffset` seconds lands on t = 0, padded or trimmed to the video length, faded out over the last second, encoded as AAC |
| `preset` | reserved for v0.3, v0.1 renders silent and warns `audio-skipped` |

## From beats to seconds and frames

- seconds per beat = 60 / `bpm`
- scene length in beats = `bars × beatsPerBar`, scenes start where the previous one ends
- total frames = round(total beats × seconds per beat × `fps`), duration = frames / `fps`
- frame `i` is drawn at t = i / `fps`
- a cue's time = (scene start beat + `beat`) × seconds per beat
- a text cue settles at its time + `settleBeats` beats, clipped to the scene end

## Hitting a requested duration

The duration comes out of bpm and bars. When the user asks for "about 30 seconds":

1. Pick a bpm for the mood: calm 72 to 90, steady 96 to 110, lively 120 to 140. With the user's own music, use its bpm.
2. total bars = round(seconds × bpm / (60 × beatsPerBar)).
3. Split the bars over the scenes. Give each scene at least one bar.
4. Accept the result when it is within 5% of the request. Otherwise try the neighbouring bpm values.

In 4/4 one bar lasts:

| bpm | one bar | 30 s is |
|---|---|---|
| 60 | 4.0 s | 7.5 bars, use 8 bars (32 s) or bpm 64 |
| 72 | 3.33 s | 9 bars |
| 80 | 3.0 s | 10 bars |
| 90 | 2.67 s | 11.25 bars, use 11 bars (29.3 s) |
| 96 | 2.5 s | 12 bars |
| 100 | 2.4 s | 12.5 bars, use 12 or 13 (28.8 s or 31.2 s) |
| 120 | 2.0 s | 15 bars |

A 30-second film at 96 bpm with an intro, three points and an ending:

<!-- check: timeline -->
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
        { "id": "intro", "bars": 2 },
        { "id": "point-1", "bars": 3 },
        { "id": "point-2", "bars": 3 },
        { "id": "point-3", "bars": 2 },
        { "id": "ending", "bars": 2, "hold": true }
    ],
    "cues": [
        { "id": "title", "scene": "intro", "beat": 1, "kind": "text", "text": "三件事", "settleBeats": 2 },
        { "id": "one", "scene": "point-1", "beat": 0, "kind": "text", "text": "第一，画面只看 t", "settleBeats": 2 },
        { "id": "two", "scene": "point-2", "beat": 0, "kind": "text", "text": "第二，时间都写成拍", "settleBeats": 2 },
        { "id": "three", "scene": "point-3", "beat": 0, "kind": "text", "text": "第三，交付前先验收", "settleBeats": 2 },
        { "id": "bye", "scene": "ending", "beat": 0, "kind": "text", "text": "谢谢观看", "settleBeats": 1 }
    ],
    "audio": { "mode": "none" }
}
```

With the user's music (100 bpm, first beat 0.42 s into the file):

<!-- check: timeline -->
```json
{
    "version": 1,
    "width": 1920,
    "height": 1080,
    "fps": 24,
    "seed": 1,
    "bpm": 100,
    "beatsPerBar": 4,
    "scenes": [
        { "id": "verse", "bars": 6 },
        { "id": "chorus", "bars": 6 }
    ],
    "audio": { "mode": "file", "file": "assets/music.mp3", "bpmOffset": 0.42 }
}
```

## hold

render reports `freeze` when the picture stops changing for more than 1.5 seconds. Set `"hold": true` on a scene that is meant to stand still, such as an end card. Scenes without `hold` need something moving.

## settleBeats

check inspects text (glyphs, fonts, frame edges, safe area, contrast) at the moment each text cue settles. Make the text fully visible by then and drive its entrance from the same numbers with `cueProgress`, which runs from 0 at the cue to 1 after `settleBeats`:

<!-- check: pass -->
```js
import { composition, timeline, setupCanvas, cueProgress, sceneAt, ease, FONTS } from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
const ask = document.createElement('p');
const reply = document.createElement('p');
for (const [el, top] of [[ask, 90], [reply, 190]]) {
  el.style.cssText = `position:absolute;left:0;right:0;top:${top}px;margin:0;text-align:center;` +
    `font:600 44px/1.2 "${FONTS.serif}";color:#2b2622;opacity:0`;
  document.body.append(el);
}
ask.textContent = '为什么是纸？';
reply.textContent = '因为它会翻页';

composition({
  seek(t) {
    for (const [el, id] of [[ask, 'ask'], [reply, 'reply']]) {
      const p = ease.outCubic(cueProgress(tl, t, id));
      el.style.opacity = String(p);
      el.style.transform = `translateY(${(1 - p) * 24}px)`;
    }
    const { beat } = sceneAt(tl, t);
    ctx.clearRect(0, 0, tl.width, tl.height);
    ctx.fillStyle = '#c8452d';
    ctx.fillRect(40 + (beat % 4) * 30, 300, 24, 24);
  },
});
```
