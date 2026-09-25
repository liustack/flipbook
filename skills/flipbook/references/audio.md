# Music and sound effects

flipbook synthesizes the music (a score you write or a preset) and the sound effects from `timeline.json`, or plays recordings found with `stock search --audio`, mixes them under the picture and checks the result. You choose parameters and files. You never write audio code.

The JavaScript snippets below run inside a 640×360 page with `<canvas id="stage">`, a page turn fetched as `assets/page-turn.wav`, this `assets/SOURCES.json`:

<!-- snippet-file: assets/SOURCES.json -->
```json
{
    "page-turn.wav": {
        "source": "https://freesound.org/people/davidbain/sounds/136778",
        "license": "cc0",
        "id": "openverse-audio:ae81dc37-a10f-46f3-8619-9af22a898885",
        "title": "Page Turn",
        "creator": "davidbain"
    }
}
```

and this timeline:

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
        { "id": "bell", "scene": "rest", "beat": 0, "kind": "sfx", "sfx": "ding" },
        { "id": "turn", "scene": "rest", "beat": 2, "kind": "sfx", "file": "assets/page-turn.wav" }
    ],
    "audio": { "mode": "preset", "preset": "marimba", "key": "G", "dynamics": { "drop-in": "soft" } }
}
```

## Pick a mode

| The user wants | Write |
|---|---|
| music (the default) | a score written for this story: `"audio": { "mode": "score", "score": { ... } }`, see [Write your own score](#write-your-own-score) |
| quick, plain background music | `"audio": { "mode": "preset", "preset": "pluck" }` |
| a real recording: a cello, a choir, a named piece | `"audio": { "mode": "file", "file": "assets/minuet.ogg", "offset": 4, "fadeIn": 1, "fadeOut": 3 }` |
| their own track | `"audio": { "mode": "file", "file": "assets/song.mp3", "bpmOffset": 0.42 }` |
| no music | `"audio": { "mode": "none" }` |

`sfx` cues play in every mode. With `"mode": "none"` and no `sfx` cues the video is silent.

## Score, preset or found sound

Write a score unless something below applies. A score follows the timeline's bpm and scenes, so every film gets its own tune and its phrases land on the cuts. It needs no license.

Use a preset when the clip is short and plain, or the user just wants some background music: presets need no writing and fit any length.

Find a recording with `stock search --audio` when:

- the user names a recorded piece or performance, or an instrument the score does not have: a Bach prelude as played, a Satie piano piece, a cello, a choir, an organ
- the picture shows an action whose real sound matters: a page turning, a pencil scribbling, a typewriter, a stamp, rain on a window

Mixing is fine: a score or a preset with found effects, or found music with the built-in effects. Found music does not follow the timeline's bpm, so cuts do not land on its beats. Pick the bpm for the picture as usual.

## Write your own score

With `"mode": "score"` you write the music and flipbook plays it note for note with synthesized instruments. Every note sits on the timeline's beat grid, so a phrase that ends on beat 0 of a scene ends exactly when that scene cuts in.

### Choose the mood first

| Mood | Key | bpm | Instruments and patterns |
|---|---|---|---|
| warm, hopeful | major: `C`, `F`, `G` | 84 to 100 | `piano` `arpeggio`, `strings` `hold`, `flute` melody, `bass` `root` |
| playful, light | major: `F`, `D`, `Bb` | 108 to 128 | `marimba` `broken`, `pluck` `offbeat`, `bass` `root-fifth`, `drums` kick, clap, shaker, a few `celesta` notes on top |
| sad, nostalgic | minor: `Dm`, `Am`, `Em` | 60 to 76 | two `piano` parts (`root` and `arpeggio`), `strings` `hold`, `clarinet` melody, room `hall` |
| mysterious, night | minor: `Em`, `Bm`, `F#m` | 64 to 80 | `musicbox` or `celesta` melody, `pad` `hold`, `harp` `arpeggio`, `sub` `root` |
| ancient, poetic | minor or major | 60 to 84 | `harp` or `pluck` `broken`, `flute` melody on the five notes 1 2 3 5 6 of the major key (in D: D E F# A B), `strings` `hold` |
| building, triumphant | minor turning major | 96 to 120 | `strings` `pulse`, `piano` `octaves` in the bass, `drums` kick on every beat in the last scene, level `full` |
| clean product tour | major | 110 to 124 | `pluck` `offbeat`, `bass` `octaves`, `bells` accents, `drums` kick and hat |

Keep one mood per film and move it with `level` and with parts entering and leaving: start with two parts, add the melody on the second scene, add drums at the peak, drop back to two parts at the end.

### Shape

```json
"audio": {
    "mode": "score",
    "key": "G",
    "score": {
        "room": "room",
        "instruments": { "keys": "piano", "lead": "flute", "low": "bass", "beat": "drums" },
        "scenes": {
            "<scene id>": {
                "level": "soft",
                "chords": ["G", "D/F#", "Em", "C"],
                "play": {
                    "keys": "arpeggio",
                    "low": "root",
                    "lead": ["D5 G5 B5:2", "A5:1.5 G5:0.5 F#5:2"],
                    "beat": { "kick": "x...x...", "shaker": ".x.x.x.x" }
                }
            }
        }
    }
}
```

- `instruments` names up to 8 parts and gives each an instrument, or `{ "instrument": "flute", "volume": 0.8, "pan": 0.2 }` (volume 0 to 2, pan -1 to 1). The same instrument can play two parts, such as a piano's left and right hand.
- `scenes` gives each scene its music. A scene you leave out starts no new notes. `level` is `soft`, `medium` (default) or `full`.
- `chords` has one entry per bar: `"Dm"`, `"Dm G7"` (two chords sharing the bar), `"Dm:3 G7:1"` (lengths in beats) or `"-"` (no chord). Symbols: a root `C` to `B` with `#` or `b`, then nothing, `m`, `7`, `m7`, `maj7`, `dim`, `aug`, `sus2`, `sus4`, `add9`, `6`, `m6`, `9` or `m9`, and an optional slash bass such as `C/E`.
- `play` gives each part one of three things:
  - a pattern name, which plays the scene's chords: `hold`, `pulse` (every beat), `offbeat` (every half beat after the beat), `arpeggio` (eighths up and down), `broken` (eighths low, top, middle, top), `strum` (start and middle of the bar), `root`, `root-fifth`, `octaves`. On `flute`, `clarinet`, `bass` and `sub` the chord patterns play the root.
  - an array of bars of notes: words like `D5` (C4 is middle C), `F#4:0.5`, `Bb4:1.5`, `G4:1/3`, `-:2` (rest), `~` (hold the note before, also across the bar line) and `D4+F4+A4` (several notes at once). A word without `:length` lasts one beat. The lengths in a bar add up to `beatsPerBar`.
  - for `drums`, pieces to step strings: `kick`, `snare`, `hat`, `shaker`, `knock`, `clap`, with `x` hit, `X` accent, `.` silent. `"x...x..."` is eighths in 4/4.
- Lists shorter than the scene repeat: four chords cover an eight-bar scene, one drum string covers every bar.

| Instrument | Sounds like | Range |
|---|---|---|
| `piano` | a soft piano | A0 to C8 |
| `celesta` | small sweet bells | C4 to C8 |
| `musicbox` | a music box | C4 to G7 |
| `bells` | glockenspiel | G4 to C8 |
| `marimba` | wooden mallets | A2 to C7 |
| `pluck` | nylon guitar | E2 to C6 |
| `harp` | harp | C1 to G7 |
| `strings` | a string section, slow bow | C2 to C7 |
| `pad` | a soft synth pad | C2 to C7 |
| `flute` | flute, one note at a time | C4 to C7 |
| `clarinet` | clarinet, one note at a time | D3 to G6 |
| `bass` | plucked upright bass, one note at a time | E1 to C4 |
| `sub` | deep sine bass, one note at a time | C1 to G3 |
| `drums` | a soft kit | |

### Write it in this order

1. Fix the bpm and the scene bars for the picture first (`references/timeline.md`). The score never changes the length.
2. Chords for each scene. Four-bar loops are fine. End the last scene on the home chord (`G` in G, `Dm` in Dm).
3. One accompaniment pattern and one bass part.
4. The melody, only where it earns attention. Put a chord note on beat 1 of each bar, move mostly by step, leave a rest before a new phrase, and let the last note of the film be the home note, held for the whole bar. Keep a flute mostly between G4 and E6, a clarinet between D4 and C6.
5. `level` per scene and drums only where the film peaks.
6. Run check. Every mistake comes back as `timeline-invalid` with the JSON path of the field.

A seed that grows into a tree, 92 bpm in G major:

<!-- check: timeline -->
```json
{
    "version": 1,
    "width": 1920,
    "height": 1080,
    "fps": 24,
    "seed": 12,
    "bpm": 92,
    "beatsPerBar": 4,
    "scenes": [
        { "id": "seed", "bars": 2 },
        { "id": "rain", "bars": 2 },
        { "id": "grow", "bars": 4 },
        { "id": "tree", "bars": 2, "hold": true }
    ],
    "cues": [
        { "id": "bloom", "scene": "tree", "beat": 0, "kind": "sfx", "sfx": "ding" }
    ],
    "audio": {
        "mode": "score",
        "key": "G",
        "score": {
            "room": "room",
            "instruments": {
                "keys": "piano",
                "bed": "strings",
                "lead": "flute",
                "low": "bass",
                "beat": "drums"
            },
            "scenes": {
                "seed": {
                    "level": "soft",
                    "chords": ["G", "Em"],
                    "play": { "keys": "arpeggio", "bed": "hold" }
                },
                "rain": {
                    "level": "soft",
                    "chords": ["C", "D"],
                    "play": { "keys": "arpeggio", "bed": "hold", "lead": ["-:2 B4 D5", "A4:4"] }
                },
                "grow": {
                    "level": "full",
                    "chords": ["G", "D/F#", "Em", "C"],
                    "play": {
                        "keys": "broken",
                        "bed": "hold",
                        "low": "root",
                        "lead": ["D5 G5 B5:2", "A5:1.5 G5:0.5 F#5:2", "E5 G5 B5 A5", "G5:3 E5"],
                        "beat": { "kick": "x...x...", "shaker": ".x.x.x.x" }
                    }
                },
                "tree": {
                    "level": "soft",
                    "chords": ["Am7 D", "G"],
                    "play": {
                        "keys": "hold",
                        "bed": "hold",
                        "low": "root",
                        "lead": ["C5 B4 A4 F#4", "G4:4"]
                    }
                }
            }
        }
    }
}
```

### When check rejects it

| The message says | Do |
|---|---|
| `adds up to 3.5 beats, bars in scene "x" hold 4` | Fix that bar's lengths. Count the words without `:length` as 1 |
| `has 6 bars, scene "x" has 4` | Cut the list to the scene's bars, or give the scene more bars |
| `is outside the flute's range C4 to C7` | Move the note an octave, or give the part another instrument |
| `plays one note at a time` | Take out the `+`, or play the chord on `piano`, `harp` or `strings` |
| `plays the "arpeggio" pattern, which needs "chords"` | Add `chords` to that scene |
| `names no part in audio.score.instruments` | Declare the part under `instruments`, or fix the spelling |
| `"~" holds the note before it, but nothing sounds before it` | Start the scene's first bar with a note or a rest |

Listen to it with the `audio` command below before rendering when the user wants to hear the music first.

## Find sounds

```bash
bash <skill-dir>/scripts/run.sh stock search <dir> page turn --audio --length shortest
bash <skill-dir>/scripts/run.sh stock search <dir> bach prelude --audio --source wikimedia_audio
bash <skill-dir>/scripts/run.sh stock search <dir> cello suite --audio --length short
bash <skill-dir>/scripts/run.sh stock fetch <dir> openverse-audio:<id> --as page-turn
```

Full example: `examples/page-turn/` in the flipbook repository, a found page turn on both page cues over a written score.

- Search with one to three concrete English words for the sound itself: `page turn`, `pencil scribble`, `typewriter`, `stamp`, `rain`, `minuet`, `cello suite`, `bach prelude`, `gymnopedie`. Every word must match, so start short and add a word only to narrow down. Leave out moods and quality words.
- `--audio` asks Openverse only, for public domain (`cc0`, `pdm`) only. Short effects mostly come from Freesound's CC0 recordings (`--source freesound`), whole recorded pieces from Wikimedia Commons (`--source wikimedia_audio`).
- `--length shortest` is under 30 s (effects), `short` 30 s to 2 min, `medium` 2 to 10 min, `long` over 10 min. `--count` up to 20.
- You cannot listen, so pick by what each result says. For an effect: a title naming one action ("Page Turn", not "Page turns and book close/open") and `durationSec` under about 3 s. For music: `durationSec` at least the video length plus the `offset` you plan, a title naming the piece or instrument, and no tags such as `creepy`, `horror` or `glitch` unless the film wants them.
- `stock fetch` saves `assets/<name>.mp3` (or `.ogg`, `.flac`, `.wav`, whatever the file is) as it came and records its source and license in `assets/SOURCES.json`. Its report gives `durationSec`.
- When nothing fits after two or three queries, write a score or use a built-in effect and tell the user. Never download sounds by other means or from other sites, and never write a source or license you did not get from `stock fetch` or the user.
- Every audio file the timeline names needs its source and license in `assets/SOURCES.json`, otherwise check and render fail with `audio-unlicensed`.

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

### Effects from files

Write `file` instead of `sfx`: `{ "id": "turn", "scene": "rest", "beat": 2, "kind": "sfx", "file": "assets/page-turn.wav" }`. The file's loudest moment lands on the cue's frame and it is scaled to about the loudness of the built-in effects. What comes before that moment plays before the cue.

- Use a short one-shot file: one page turn, one stamp. In a file with several hits only the loudest one lands on the cue.
- The same file can play on several cues.
- Put the cue where the motion ends, as with `paper`: a page turn peaks when the page lands.

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

## Music from a file

A recording from `stock fetch`: write `"mode": "file"` with `file`, and optionally `offset` (the second of the file the video starts at, to skip a slow intro), `fadeIn` and `fadeOut` in seconds (by default no fade in and a one-second fade out). Choose a file at least as long as the video plus `offset`: a shorter one ends in silence.

<!-- check: timeline -->
```json
{
    "version": 1,
    "width": 1920,
    "height": 1080,
    "fps": 24,
    "seed": 5,
    "bpm": 80,
    "beatsPerBar": 4,
    "scenes": [
        { "id": "open", "bars": 4 },
        { "id": "turns", "bars": 6 },
        { "id": "end", "bars": 2, "hold": true }
    ],
    "cues": [
        { "id": "first-page", "scene": "turns", "beat": 1, "kind": "sfx", "file": "assets/page-turn.mp3" },
        { "id": "second-page", "scene": "turns", "beat": 13, "kind": "sfx", "file": "assets/page-turn.mp3" }
    ],
    "audio": { "mode": "file", "file": "assets/minuet.ogg", "offset": 4, "fadeIn": 1, "fadeOut": 3 }
}
```

The user's own song:

1. Put the file in `assets/` as wav, mp3, flac, ogg, aac, m4a, aiff or webm (not a playlist, not a link to a file outside the composition) and record its source and license in `assets/SOURCES.json` from what the user says. Ask when the license is unknown.
2. Ask the user for the song's bpm and the second where beat 1 falls. Do not guess them.
3. Set the timeline `bpm` to the song's bpm and write `"mode": "file"` with `file` and `bpmOffset` instead of `offset`.

render starts the file at `bpmOffset` or `offset`, pads or trims it to the video length, fades it, brings it to -14 LUFS and mixes the `sfx` cues on top.

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

It writes `<dir>/.flipbook/audio/music.wav` and `sfx.wav` in a few seconds, and `effects.wav` (the effects with the files laid in) when a cue plays a file. render reuses them while the timeline is unchanged. Tell the user where they are when they want to hear the music before the video.

## Codes

| Code | Do |
|---|---|
| `audio-cue-offset` | Move `sfx` cues at least 1/8 beat apart and keep each inside its scene. If they already are, render again and report it with the JSON if it repeats. |
| `audio-loudness` | Render again. With `"mode": "file"`, check that the file is not silent after `bpmOffset` or `offset`. |
| `audio-unlicensed` | Fetch the sound with `stock fetch`, which records its source and license, or write them in `assets/SOURCES.json` from what the user says. |
| `audio-peak`, `audio-missing` | Render again, report it with the JSON if it repeats. |
| `audio-skipped` | `audio` found nothing to make. Change nothing unless the video should have music. |
