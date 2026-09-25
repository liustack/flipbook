---
summary: 'timeline.json v1: fields, allowed values, how beats become seconds and frames, and what timeline.resolved.json holds'
read_when:
  - Writing or changing timeline.json
  - Changing the validation in src/engine/timeline.ts
---

# timeline.json v1

English | [中文](timeline-schema.zh-CN.md)

timeline.json is the only source of time for both picture and sound. Every time is written in beats. The CLI converts them to seconds and frames, writes the result to `.flipbook/timeline.resolved.json`, and hands that to the page and to ffmpeg. When validation fails, each `timeline-invalid` in the report carries a JSON path (such as `$.scenes[1].bars`).

## Example

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

## Top-level fields

| Field | Required | Values | Description |
|---|---|---|---|
| `version` | yes | `1` | Schema version |
| `width` | yes | even number from 16 to 7680 | Stage width in CSS pixels |
| `height` | yes | even number from 16 to 4320 | Stage height in CSS pixels |
| `fps` | yes | integer from 1 to 60 | Frame rate |
| `seed` | yes | integer from 0 to 4294967295 | The video's random seed, used by the runtime's `rng` and `rand` |
| `bpm` | yes | 30 to 300 | Beats per minute |
| `beatsPerBar` | yes | integer from 1 to 16 | Beats per bar |
| `scenes` | yes | at least one | Scenes, played back to back in order |
| `cues` | no | | Text, sound effects and markers |
| `audio` | no | | Music settings. Leaving it out equals `{ "mode": "none" }` |
| `brand` | no | relative path ending in `.json`, from the composition directory | The brand.json this video uses. Write `"brand.json"` when it sits in the composition directory, `"../brand.json"` when it sits at the workspace root. Fields and validation are in the skill's references/brand.md. A missing or invalid file reports `brand-invalid` |
| `$schema` | no | string | For editor hints, not validated |

Any other field is an error, so a misspelled field is never silently ignored.

## scenes[]

| Field | Required | Values | Description |
|---|---|---|---|
| `id` | yes | letters, digits, `-`, `_`, at most 64 characters, unique | |
| `bars` | yes | greater than 0 | Number of bars. `bars` times `beatsPerBar` must be a whole number of beats |
| `hold` | no | true or false | When true, this scene skips freeze detection |

## cues[]

| Field | Required | Values | Description |
|---|---|---|---|
| `id` | yes | same rule as scene ids, unique | |
| `scene` | yes | the id of a scene | |
| `beat` | yes | from 0 up to the scene's beat count (not included) | Beats from the start of the scene, fractions allowed |
| `kind` | yes | `text`, `sfx`, `mark` | |
| `text` | when kind is text | non-empty string | The text on screen. check uses it to verify glyph coverage |
| `settleBeats` | no | 0 to 64 | How many beats until the text has fully appeared. check and render run the text checks at that moment. Defaults to 0 (fully there at the cue time). A text cue must finish appearing before its scene ends |
| `sfx` | when kind is sfx, unless `file` is given | `paper`, `drop`, `ding`, `sweep` | Built-in sound effect. Its peak lands on the cue's frame, see the audio section |
| `file` | kind sfx only, instead of `sfx` | path relative to the composition directory, such as `assets/page-turn.mp3` | A sound file from the composition, usually one `stock fetch` saved. Its loudest sample lands on the cue's frame. Needs its source and license in `assets/SOURCES.json` (`audio-unlicensed` otherwise). Giving both `sfx` and `file` is `timeline-invalid` |

## audio

| Field | For which mode | Values | Description |
|---|---|---|---|
| `mode` | all, required | `preset`, `score`, `file`, `none` | Where the music comes from |
| `preset` | preset, required | `pluck`, `marimba`, `pad` | Preset instrument and arrangement |
| `key` | all | `A` to `G`, optionally with `#` or `b`, a trailing `m` for minor, defaults to `C` | The key of the music. The `ding` effect is pitched to its tonic too. A written score names its own notes and chords, so there only `ding` uses it |
| `progression` | preset | integer from 0 to 5, defaults to 0 | Chord progression number, see the table below |
| `dynamics` | preset | map from scene id to `rest`, `soft`, `medium`, `full` | Dynamics per scene. Scenes left out play `medium` |
| `score` | score, required | object, see [Written score](#written-score) | The music written out: parts, chords, notes and drum steps per scene |
| `file` | file, required | path relative to the composition directory | Music from a file: the user's own or one `stock fetch` saved. `timeline-invalid` when the file is not inside the composition directory, `audio-unlicensed` when `assets/SOURCES.json` does not give its source and license |
| `bpmOffset` | file | 0 to 60, defaults to 0 | The second where beat 1 falls in the music, when the timeline follows its beat |
| `offset` | file | 0 to 3600 | The second of the file the video starts at, for music whose beat the timeline does not follow. Giving both `offset` and `bpmOffset` is `timeline-invalid` |
| `fadeIn` | file | 0 to 30, defaults to 0 | Seconds of fade in at the start |
| `fadeOut` | file | 0 to 30, defaults to 1 (a quarter of a video under 4 seconds) | Seconds of fade out at the end. `fadeIn` plus `fadeOut` may not pass the video length |

A field written under a mode that does not use it (such as `preset` with `mode: none`) is `timeline-invalid`, with the path pointing at that field.

- `none`: no music. With `sfx` cues the video carries only the effects. Without them it is silent.
- `preset`: the `audio` command synthesizes music from the preset, key, progression and per-scene dynamics. render calls it on its own.
- `score`: the `audio` command plays the written score note for note with the synthesized instruments below. Mixing and loudness are the same as for a preset.
- `file`: music from a file, with no beat detection. For the user's own song the user supplies `bpm` and `bpmOffset`. For a found piece whose beat the timeline does not follow, `offset` picks where it starts. After resolving symlinks the file must be a regular file inside the composition directory, otherwise `timeline-invalid`. ffmpeg reads it only as a local file, and only in these formats: wav, w64, mp3, flac, ogg, aac, the mov family (m4a, mp4), aiff, the matroska family (mkv, webm). Formats that pull in other files, such as playlists and concat, are refused.

### Chord progressions

One chord per bar, four bars per cycle, laid out over the bars of the whole video without restarting at scene boundaries. The last bar switches to the tonic chord (I in major, i in minor) to close.

| Number | Major | Minor |
|---|---|---|
| 0 | I V vi IV | i VI III VII |
| 1 | I vi IV V | i iv VI V |
| 2 | vi IV I V | i VII VI VII |
| 3 | I IV vi V | i VI iv V |
| 4 | IV V iii vi | VI VII i i |
| 5 | ii V I vi | i iv VII III |

### Dynamics

| Value | Effect |
|---|---|
| `rest` | No new notes in this scene. Earlier notes ring out and fade |
| `soft` | Sparse: the bass and a few melody notes, low velocity |
| `medium` | The full texture |
| `full` | One more layer (pluck adds strums and a shaker, marimba adds fills and bells, pad adds a pulse), high velocity |

Dynamics follow the scene where a note starts. A long note that crosses into the next scene keeps the velocity it started with.

### Written score

`audio.score` holds the music the agent wrote for this video. It is written per scene, so bars are counted inside each scene, and every beat lands on the timeline's beat grid.

```json
"audio": {
    "mode": "score",
    "key": "Dm",
    "score": {
        "room": "hall",
        "instruments": { "keys": "piano", "lead": { "instrument": "flute", "volume": 0.8 }, "low": "bass", "beat": "drums" },
        "scenes": {
            "open": { "level": "soft", "chords": ["Dm", "Bb", "F", "C"], "play": { "keys": "arpeggio", "low": "root" } },
            "flip": {
                "chords": ["Gm", "Dm", "Bb", "A7"],
                "play": {
                    "keys": "broken",
                    "low": "root-fifth",
                    "lead": ["A4 D5 F5:2", "E5:2 D5 C5", "D5:3 F5", "E5:4"],
                    "beat": { "kick": "x...x...", "shaker": "..x...x." }
                }
            }
        }
    }
}
```

| Field | Required | Values | Description |
|---|---|---|---|
| `room` | no | `dry`, `room`, `hall`, defaults to `room` | Reverb: short and close, a room, a long hall |
| `instruments` | yes | 1 to 8 parts | Part name (a letter, then letters, digits, `-`, `_`) to an instrument name, or to `{ "instrument", "volume", "pan" }`. `volume` is 0 to 2 (default 1), `pan` -1 to 1 (default depends on the instrument) |
| `scenes` | yes | at least one scene id | What each scene plays. A scene left out starts no new notes, earlier notes ring out |
| `scenes.<id>.level` | no | `soft`, `medium`, `full`, defaults to `medium` | Velocity of every note in the scene |
| `scenes.<id>.chords` | when a part plays a pattern | array of bars | One entry per bar, see below |
| `scenes.<id>.play` | yes | at least one part | Part name to a pattern name, an array of bars of notes, or (drums) an object of steps |

**Repeating lists.** `chords`, arrays of note bars and arrays of drum steps may be shorter than the scene: they repeat from their start. Longer than the scene is `timeline-invalid`. In a scene whose last bar is short (such as `bars: 1.5`), the last bar is cut at the end of the scene.

**Chords.** A chord symbol is a root `C` to `B` with an optional `#` or `b`, a quality (none, `m`, `7`, `m7`, `maj7`, `dim`, `aug`, `sus2`, `sus4`, `add9`, `6`, `m6`, `9`, `m9`) and an optional slash bass such as `C/E`. A bar entry is one chord (`"Dm"`), several chords sharing the bar evenly (`"Dm G7"`), or chords with lengths in beats (`"Dm:3 G7:1"`, which must add up to the bar). `"-"` is a bar without a chord, where patterns rest.

**Notes.** A bar of notes is a string of words. Each word is a note in scientific pitch (`C4` is middle C, `F#3`, `Bb5`), `-` for a rest or `~` to hold the note before it (across bar lines too), with an optional `:length` in beats (`D5:2`, `E5:0.5`, `G4:1/3`). Without a length a word lasts one beat. `D4+F4+A4` sounds several notes at once (not on single-note instruments). The lengths of a bar must add up to `beatsPerBar`. Notes outside the instrument's range are `timeline-invalid`.

**Patterns.** A pattern plays the scene's chords in a rhythm. When a bar holds more than one chord, the pattern starts over on each chord.

| Pattern | Plays |
|---|---|
| `hold` | the whole chord, held until the chord changes |
| `pulse` | the chord on every beat |
| `offbeat` | the chord on the second half of every beat |
| `arpeggio` | the chord's notes up and down in eighth notes |
| `broken` | eighth notes: low, top, middle, top |
| `strum` | the chord rolled at the start and the middle of the bar |
| `root` | the root (or slash bass), held |
| `root-fifth` | the root at the start of the bar, the fifth in the middle |
| `octaves` | the root in eighth notes, alternating octaves |

On single-note instruments (`flute`, `clarinet`, `bass`, `sub`) chord patterns play the root.

**Drum steps.** A drums part maps pieces (`kick`, `snare`, `hat`, `shaker`, `knock`, `clap`) to a step string or an array of them, one per bar. `x` is a hit, `X` an accent, `.` silence. The string divides the bar evenly: `"x...x..."` is eighth notes in 4/4.

**Instruments.** All synthesized in code, no samples.

| Instrument | Sound | Range |
|---|---|---|
| `piano` | a soft piano, brighter when played harder | A0 to C8 |
| `celesta` | small struck metal bars, clear and sweet | C4 to C8 |
| `musicbox` | a music box comb with a slow shimmer | C4 to G7 |
| `bells` | glockenspiel | G4 to C8 |
| `marimba` | wooden bars | A2 to C7 |
| `pluck` | nylon-string guitar | E2 to C6 |
| `harp` | harp, left to ring | C1 to G7 |
| `strings` | a string section, slow bow and vibrato | C2 to C7 |
| `pad` | a soft synth pad | C2 to C7 |
| `flute` | flute with breath and vibrato, one note at a time | C4 to C7 |
| `clarinet` | a warm reed, one note at a time | D3 to G6 |
| `bass` | a plucked upright bass, one note at a time | E1 to C4 |
| `sub` | a sine sub bass, one note at a time | C1 to G3 |
| `drums` | soft kit: `kick`, `snare` (brush), `hat`, `shaker`, `knock`, `clap` | |

Every error in a score is `timeline-invalid` with the JSON path of the field, such as `$.audio.score.scenes.flip.play.lead[1]` for a bar whose lengths do not add up, `$.audio.score.scenes.flip.chords[2]` for an unknown chord, or `$.audio.score.instruments.lead` for an unknown instrument.

The score is expanded into notes in Node (`score.json` under `.flipbook/audio/` lists them under `sheet`). Each note gets a few milliseconds of timing drift and a little velocity spread, seeded from `seed`, so the same timeline always plays the same way.

### Sound effects

| `sfx` | Sound | Where the peak is |
|---|---|---|
| `paper` | A page turning: a crackle, a swish, the page landing on the beat | The page landing. The sound starts about 0.14 seconds before the peak |
| `drop` | Something light landing on paper: a low thud and a click | At the attack |
| `ding` | A small bell, pitched to the tonic of `key` | At the attack |
| `sweep` | A swelling frequency sweep that cuts off soon after its peak | About 0.32 seconds after it starts |

Each effect is synthesized on its own, its loudest sample is found, and that sample is placed at the cue frame's position at 48 kHz (frame number times 48000 divided by fps, rounded). Any part before the peak that would land before t = 0 is cut.

An sfx cue with `file` follows the same rule: the file is decoded to 48 kHz stereo (read only as a local file, in the formats listed for `mode: file`), its loudest sample over both channels is placed on the cue frame, and the file is scaled so that sample sits at 0.6, about as loud as the built-in effects. The part before t = 0 and the part past the end are cut. A file that ffmpeg cannot read, or that is silent, is `timeline-invalid` with the path of that cue's `file`. Trim or pick the file so its hit is its loudest moment.

### Synthesis, mixing and loudness

- The `audio` command opens a blank page, loads `/__flipbook/audio.js`, synthesizes with `OfflineAudioContext`, sends the PCM back to Node in base64 chunks, and writes to `.flipbook/audio/`: `music.wav` (preset or score) and `sfx.wav` (with sfx cues), 48 kHz stereo 32-bit float, as long as the picture. It also writes `score.json` (chords, dynamics, the notes of a written score, effect positions) and `audio.json` (hash and peak of each track, actual peak position of each effect).
- Two syntheses on the same machine and version produce byte-identical WAVs. When the timeline, audio.js and the Chromium version are unchanged, render reuses the existing tracks.
- Effects from files are not synthesized: with any sfx cue that has `file`, the `audio` command and render lay the files over the synthesized `sfx.wav` (when there are built-in effects too) into `.flipbook/audio/effects.wav`, the same format, and mix and check that track instead. Without built-in effects or synthesized music no browser page is opened for audio.
- render mixes the music (the synthesized preset or score track, or a music file) with the effects using `amix` (`normalize=0`). With music, it first measures the music's own integrated loudness and puts the effect peaks 12 dB above it. Then it measures the whole mix, applies linear gain to -14 LUFS, limits to -3 dBFS with 4x oversampling, measures the limited result again and folds the difference into the gain. With only effects, it puts the peak at -4 dBFS and then limits. Finally it encodes AAC at 48 kHz stereo, 192 kbps.
- The music file is cut from `bpmOffset` (or `offset`) seconds, so that with `bpmOffset` beat 1 lands at t = 0, padded with silence when too short, cut when too long, faded in over `fadeIn` seconds and out over `fadeOut` seconds (by default the last second, a quarter of the length when the video is under 4 seconds), then normalized as above.
- Loudness is always measured with ffmpeg `ebur128`, the same meter acceptance uses. Ducking the music under voice-over has an interface (`MixOptions.voice`) but is not implemented.

## Conversion rules

- Seconds per beat = 60 / `bpm`.
- A scene's start beat = the sum of the beats of every scene before it. A scene's beats = `bars` times `beatsPerBar`.
- Total frames = round(total beats times seconds per beat times `fps`). Duration = total frames / `fps`. Duration is capped at 180 seconds.
- Frame i has time t = i / `fps`. That t is what seek receives.
- A scene's start and end frames = round(start and end seconds times `fps`).
- A cue's absolute beat = the scene's start beat + `beat`. Its time and frame convert the same way.
- A text cue's sampling frame = the first frame after the cue time plus `settleBeats` beats, which is the first frame where `cueProgress` reaches 1, stored as `settleFrame`. It must fall inside the cue's scene (below that scene's `endFrame`), otherwise `timeline-invalid`, with the path at `settleBeats` (or at `beat` when `settleBeats` is 0). The sampling time is never clamped to the end of the scene.

When the user asks for "30 seconds", the agent picks a bpm and a bar count that come close. Seconds are never written into the timeline.

## timeline.resolved.json

What the CLI writes after conversion, and the object the page gets from `timeline()`:

| Field | Description |
|---|---|
| `version`, `protocol` | Both 1 |
| `width`, `height`, `fps`, `seed`, `bpm`, `beatsPerBar` | Copied as is |
| `secondsPerBeat`, `totalBeats`, `durationSec`, `frameCount` | Converted values |
| `scenes[]` | Adds `index`, `startBeat`, `beats`, `start`, `end` (seconds), `startFrame`, `endFrame`, `hold` |
| `cues[]` | Adds `absBeat`, `time`, `frame`, `settleBeats`, `settleTime`, `settleFrame` |
| `audio` | Copied as is, `{ "mode": "none" }` when left out |
| `brand` | null when `brand` is not set. Otherwise the validated brand: `name`, `tagline` (null when not set), `colors` (`primary`, `secondary`, `ink`, `paper`, lowercase, null when not set), `logo` (`src` is an inline `data:` URL and `type` its MIME type, null without a logo), `fonts` (the `title` and `text` family names). The runtime's `brand()` reads from here |
| `fonts` | The fonts bundled with this video, an empty array when there are none. They come from brand.json's `fonts.files` and the licensed .ttf and .otf files in the composition's `assets/fonts/`. Each entry has `id` (`user-` plus the first 16 hex digits of the file's SHA-256), `family`, `url` (`/__flipbook/fonts/user/<hash>.<ext>`), `weight`, `style` and `source` (the path as written in brand.json or relative to the composition directory). They load together with flipbook's own fonts before the page loads, and check's code point tables and font fallback check accept them |
