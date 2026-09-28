# Story

Every film tells one story. Write it as `story.json` before the timeline: the story decides the scenes, the device, what moves and how long each part takes. check and render read it next to `timeline.json` and fail without it.

## Five things to settle

| Field | Write | A paper boat, for example |
|---|---|---|
| `idea` | one sentence: who or what, meets what, becomes what | A paper boat soaks through in the rain, and a child's hand lifts it out of the snow |
| `leave` | one sentence: what the viewer feels or remembers at the end | Small things make it through |
| `subject` | the one thing that changes over the film | the paper boat |
| `device` | `what`: the one visual device that runs through the film. `why`: why it fits this story | The boat stays on one line while the weather changes behind it, so the eye stays on the boat and the world is what changes |
| `beats` | 3 to 6 beats, in order | below |

A film of 10 to 60 seconds holds one idea. Two ideas make two weak films: pick one.

## Find the turn

A story runs: once upon a time, every day, but one day, because of that, until finally. The beat roles follow it:

| Role | The part it plays |
|---|---|
| `opening` | once upon a time, every day: the world as it is |
| `turn` | but one day: something goes wrong or changes course |
| `build` | because of that: what follows from the turn |
| `resolution` | until finally: the new state, often an answer to the opening |

The first beat is `opening`, the last is `resolution`, and at least one `turn` lies between. Parts that sit side by side (sun, then rain, then snow) are a list, not a story, and check refuses them with `story-arc`. Ask what goes wrong, what is at stake, what the subject loses or wins.

A film about a product or a brand works the same way. The product is what moves the story, not its hero: show what it lets someone do, in one idea. Don't parade its features one after another.

## Write the beats

Each beat is `{ id, role, at, change }`, plus `text`, `sound`, `callback` or `hold` when needed.

- `at` is where the beat starts: a scene id (the scene's first beat) or `{ "scene": id, "beat": n }` for a moment inside a scene, counted like a cue's `beat`. A beat lasts until the next one starts and must hold at least one frame. The first beat starts at the first scene.
- `change` is `{ "from", "to" }`: what the picture shows as the beat starts and as it ends. Write things you will draw, not feelings. The change must be on screen: check compares each beat's first and last frame and warns with `story-static-beat` when they look the same.
- `text` lists the words on screen in that beat, exactly as its text cues show them, in order. Words carry only what the picture cannot. When a beat's words take longer to read than the beat lasts, check warns with `story-text-fast`.
- `sound` names the sfx cue that marks the beat. `callback` names an earlier beat this one answers: an ending that returns to the opening. `hold: true` marks the one beat that stands still on purpose, at most one.
- No times in the story: bars and beats live in the timeline only.

## Order of work

1. Write `story.json`.
2. When the user is there, show them the idea, what it leaves, the subject, the device and the beats in one message, and go on once they agree. When they said to just make it, go on with your own.
3. Write `timeline.json`: a scene or two per beat, text and sfx cues where the beats need them.
4. Write `index.html`. Run `check`: `story-coverage`, `story-arc`, `story-text` and `story-invalid` name the field to fix.
5. Before delivery, read the contact sheet against the story: does each beat's first and last frame show its `change`? Retell the film from the pictures alone. If the retelling misses the turn, the film misses it too.

Change the story only when the user changes it. Once the timeline is written, the timeline and the video are what count.

## Example

<!-- snippet-timeline -->
```json
{
    "version": 1,
    "width": 640,
    "height": 360,
    "fps": 12,
    "seed": 11,
    "bpm": 120,
    "beatsPerBar": 4,
    "scenes": [
        { "id": "sun", "bars": 2 },
        { "id": "rain", "bars": 1 },
        { "id": "snow", "bars": 3 }
    ],
    "cues": [
        { "id": "drop", "scene": "rain", "beat": 0, "kind": "sfx", "sfx": "drop" },
        { "id": "end", "scene": "snow", "beat": 6, "kind": "text", "text": "撑过去", "settleBeats": 1 }
    ]
}
```

<!-- snippet-file: story.json -->
```json
{
    "version": 1,
    "idea": "A paper boat soaks through in the rain, and a hand lifts it out of the snow",
    "leave": "Small things make it through",
    "subject": "the paper boat",
    "device": {
        "what": "the boat stays on one line while the weather changes behind it",
        "why": "the eye stays on the boat, the world is what changes"
    },
    "beats": [
        { "id": "calm", "role": "opening", "at": "sun", "change": { "from": "the boat drifts under a clear sky", "to": "the sky greys over" } },
        { "id": "soak", "role": "turn", "at": "rain", "change": { "from": "the first drops fall", "to": "the boat sits low in the water" }, "sound": "drop" },
        { "id": "cold", "role": "build", "at": "snow", "change": { "from": "rain turns to snow", "to": "snow piles on the boat" } },
        { "id": "lift", "role": "resolution", "at": { "scene": "snow", "beat": 4 }, "change": { "from": "the snow slides off", "to": "the boat rides high again" }, "text": ["撑过去"], "callback": "calm" }
    ]
}
```

<!-- check: pass -->
```js
import { composition, cueProgress, ease, progress, rand, setupCanvas, timeline } from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
const [sun, rain, snow] = tl.scenes;
const lift = tl.story.beats[3];
const words = Object.assign(document.createElement('p'), { textContent: '撑过去' });
words.style.cssText = 'position:absolute;left:0;right:0;top:40px;margin:0;text-align:center;font:600 44px "Noto Serif SC";color:#2b2622';
document.body.append(words);

composition({
  seek(t) {
    const grey = progress(t, sun.start + 1, sun.end);
    const sink = ease.inOutSine(progress(t, rain.start, rain.end)) * (1 - ease.outBack(progress(t, lift.start, lift.start + 1.2)));
    const pile = progress(t, snow.start, lift.start) * (1 - progress(t, lift.start, lift.start + 0.6));
    ctx.fillStyle = `rgb(${214 - 90 * grey}, ${226 - 80 * grey}, ${236 - 60 * grey})`;
    ctx.fillRect(0, 0, tl.width, tl.height);
    ctx.fillStyle = '#6f8aa0';
    ctx.fillRect(0, 250, tl.width, 110);
    for (let i = 0; i < 40 && t >= rain.start; i++) {
      const x = rand(tl.seed, 'x', i) * tl.width;
      const y = ((rand(tl.seed, 'y', i) * 250 + t * (t < snow.start ? 400 : 60)) % 250);
      ctx.fillStyle = t < snow.start ? '#3d5566' : '#ffffff';
      ctx.fillRect(x, y, t < snow.start ? 2 : 5, t < snow.start ? 10 : 5);
    }
    const x = 120 + t * 30;
    const y = 232 + 26 * sink;
    ctx.fillStyle = '#f4efe4';
    ctx.beginPath();
    ctx.moveTo(x - 50, y); ctx.lineTo(x + 50, y); ctx.lineTo(x + 30, y + 22); ctx.lineTo(x - 30, y + 22);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 46, y - 22 * pile, 92, 22 * pile);
    words.style.opacity = String(cueProgress(tl, t, 'end'));
  },
});
```
