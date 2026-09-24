# Music and sound effects

flipbook synthesizes the music and the sound effects from `timeline.json`, mixes them under the picture and checks the result. You choose parameters. You never write audio code.

The JavaScript snippets below run inside a 640×360 page with `<canvas id="stage">` and this timeline:

<!-- snippet-timeline -->
```json
{
    "version": 1,
    "width": 640,
    "height": 360,
    "fps": 12,
    "seed": 9,
    "bpm": 100,
    "beatsPerBar": 4,
    "scenes": [
        { "id": "drop-in", "bars": 1 },
        { "id": "rest", "bars": 1, "hold": true }
    ],
    "cues": [
        { "id": "land", "scene": "drop-in", "beat": 2, "kind": "sfx", "sfx": "drop" },
        { "id": "bell", "scene": "rest", "beat": 0, "kind": "sfx", "sfx": "ding" }
    ],
    "audio": { "mode": "preset", "preset": "marimba", "key": "G", "dynamics": { "drop-in": "soft" } }
}
```

## Pick a mode

| The user wants | Write |
|---|---|
| music (the default) | `"audio": { "mode": "preset", "preset": "pluck" }` |
| their own track | `"audio": { "mode": "file", "file": "assets/song.mp3", "bpmOffset": 0.42 }` |
| no music | `"audio": { "mode": "none" }` |

`sfx` cues play in every mode. With `"mode": "none"` and no `sfx` cues the video is silent.

## Presets

| `preset` | Sounds like | Use for | bpm |
|---|---|---|---|
| `pluck` | fingerpicked nylon strings over a soft bass | explainers, stories, warm topics | 80 to 110 |
| `marimba` | wooden mallets in a bouncing pattern, bells on top at `full` | playful titles, lists, product tours | 100 to 130 |
| `pad` | soft held chords, a sub bass, a few bells | calm, reflective, data, serious topics | 60 to 90 |

The music follows the timeline's `bpm` and `beatsPerBar`: one chord per bar, and the last bar settles on the home chord. Pick the bpm for the picture first (see `references/timeline.md`), then the preset whose range contains it.

### key

Major keys (`C`, `D`, `F`, `G`, `Bb`) sound bright. Minor keys (`Am`, `Dm`, `Em`) sound serious or wistful. The default is `C`. The `ding` effect is tuned to the key.

### progression

| `progression` | Major key | Minor key | Feel |
|---|---|---|---|
| 0 (default) | I V vi IV | i VI III VII | open, uplifting |
| 1 | I vi IV V | i iv VI V | warm, classic |
| 2 | vi IV I V | i VII VI VII | reflective |
| 3 | I IV vi V | i VI iv V | steady |
| 4 | IV V iii vi | VI VII i i | emotional build |
| 5 | ii V I vi | i iv VII III | light, jazzy |

### dynamics

Give each scene a level. Scenes you leave out play `medium`.

| Level | Plays |
|---|---|
| `rest` | nothing new, earlier notes ring out |
| `soft` | bass and a few notes, quiet |
| `medium` | the full pattern |
| `full` | an extra layer, louder |

Start `soft`, keep the body `medium`, put `full` on the peak scene, end on `medium` or `soft`. Use `rest` for one scene at most.

<!-- check: timeline -->
```json
{
    "version": 1,
    "width": 1920,
    "height": 1080,
    "fps": 24,
    "seed": 3,
    "bpm": 72,
    "beatsPerBar": 4,
    "scenes": [
        { "id": "question", "bars": 2 },
        { "id": "data", "bars": 4 },
        { "id": "answer", "bars": 2 },
        { "id": "end", "bars": 1, "hold": true }
    ],
    "audio": {
        "mode": "preset",
        "preset": "pad",
        "key": "Am",
        "progression": 1,
        "dynamics": { "question": "soft", "answer": "full", "end": "soft" }
    }
}
```

## Sound effects

| `sfx` | Sounds like | Put it on |
|---|---|---|
| `paper` | a page turning over | a card flipping, a page turn, a scene change |
| `drop` | something light landing on paper | a word or object landing, a stamp |
| `ding` | a small bell in the key | a reveal, the final title, a right answer |
| `sweep` | a whoosh rising to its peak | a fast move, a wipe, an underline finishing |

- The loudest moment of each effect lands on its cue's frame. Make the visual hit happen on that frame: `cue(tl, id).frame / tl.fps`.
- `sweep` starts about 0.3 s before its cue and `paper` about 0.15 s before. Put the cue where the motion ends.
- Keep `sfx` cues at least 1/8 beat apart. Two or three effects per scene are plenty. Motion without a contact stays silent.

A box that lands with a squash on the `drop` cue:

<!-- check: pass -->
```js
import { composition, timeline, setupCanvas, cue, progress, ease } from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
const land = cue(tl, 'land').frame / tl.fps;
const fall = tl.secondsPerBeat;

composition({
  seek(t) {
    const y = 60 + ease.inQuad(progress(t, land - fall, land)) * 200;
    const k = Math.max(0, t - land);
    const squash = t < land ? 0 : Math.exp(-k * 8) * Math.cos(k * 30) * 0.3;
    ctx.clearRect(0, 0, tl.width, tl.height);
    ctx.save();
    ctx.translate(tl.width / 2, y + 40);
    ctx.scale(1 + squash, 1 - squash);
    ctx.fillStyle = '#c8452d';
    ctx.fillRect(-40, -80, 80, 80);
    ctx.restore();
    ctx.fillStyle = '#2b2622';
    ctx.fillRect(tl.width / 2 - 120, 300, 240, 6);
  },
});
```

## The user's own music

1. Put the file in `assets/` as wav, mp3, flac, ogg, aac, m4a, aiff or webm (not a playlist, not a link to a file outside the composition) and record its source and license in `assets/SOURCES.json`.
2. Ask the user for the song's bpm and the second where beat 1 falls. Do not guess them.
3. Set the timeline `bpm` to the song's bpm and write `"mode": "file"` with `file` and `bpmOffset`.

render starts the song at `bpmOffset`, pads or trims it to the video length, fades out the last second, brings it to -14 LUFS and mixes the `sfx` cues on top.

<!-- check: timeline -->
```json
{
    "version": 1,
    "width": 1920,
    "height": 1080,
    "fps": 24,
    "seed": 1,
    "bpm": 118,
    "beatsPerBar": 4,
    "scenes": [
        { "id": "verse", "bars": 8 },
        { "id": "chorus", "bars": 7 }
    ],
    "cues": [
        { "id": "hit", "scene": "chorus", "beat": 0, "kind": "sfx", "sfx": "sweep" }
    ],
    "audio": { "mode": "file", "file": "assets/song.mp3", "bpmOffset": 0.51 }
}
```

## Listen before rendering

```bash
bash <skill-dir>/scripts/run.sh audio <dir>
```

It writes `<dir>/.flipbook/audio/music.wav` and `sfx.wav` in a few seconds. render reuses them while the timeline is unchanged. Tell the user where they are when they want to hear the music before the video.

## Codes

| Code | Do |
|---|---|
| `audio-cue-offset` | Move `sfx` cues at least 1/8 beat apart and keep each inside its scene. If they already are, render again and report it with the JSON if it repeats. |
| `audio-loudness` | Render again. With `"mode": "file"`, check that the file is not silent after `bpmOffset`. |
| `audio-peak`, `audio-missing` | Render again, report it with the JSON if it repeats. |
| `audio-skipped` | `audio` found nothing to make. Change nothing unless the video should have music. |
