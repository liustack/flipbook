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
| `sfx` | when kind is sfx | `paper`, `drop`, `ding`, `sweep` | Sound effect name. Its peak lands on the cue's frame, see the audio section |

## audio

| Field | For which mode | Values | Description |
|---|---|---|---|
| `mode` | all, required | `preset`, `file`, `none` | Where the music comes from |
| `preset` | preset, required | `pluck`, `marimba`, `pad` | Preset instrument and arrangement |
| `key` | all | `A` to `G`, optionally with `#` or `b`, a trailing `m` for minor, defaults to `C` | The key of the music. The `ding` effect is pitched to its tonic too |
| `progression` | preset | integer from 0 to 5, defaults to 0 | Chord progression number, see the table below |
| `dynamics` | preset | map from scene id to `rest`, `soft`, `medium`, `full` | Dynamics per scene. Scenes left out play `medium` |
| `file` | file, required | path relative to the composition directory | The user's own music. `timeline-invalid` when the file is not inside the composition directory |
| `bpmOffset` | file | 0 to 60, defaults to 0 | The second where beat 1 falls in the user's music |

A field written under a mode that does not use it (such as `preset` with `mode: none`) is `timeline-invalid`, with the path pointing at that field.

- `none`: no music. With `sfx` cues the video carries only the effects. Without them it is silent.
- `preset`: the `audio` command synthesizes music from the preset, key, progression and per-scene dynamics. render calls it on its own.
- `file`: the user's own music, with no beat detection: the user supplies `bpm` and `bpmOffset`. After resolving symlinks the file must be a regular file inside the composition directory, otherwise `timeline-invalid`. ffmpeg reads it only as a local file, and only in these formats: wav, w64, mp3, flac, ogg, aac, the mov family (m4a, mp4), aiff, the matroska family (mkv, webm). Formats that pull in other files, such as playlists and concat, are refused.

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

### Sound effects

| `sfx` | Sound | Where the peak is |
|---|---|---|
| `paper` | A page turning: a crackle, a swish, the page landing on the beat | The page landing. The sound starts about 0.14 seconds before the peak |
| `drop` | Something light landing on paper: a low thud and a click | At the attack |
| `ding` | A small bell, pitched to the tonic of `key` | At the attack |
| `sweep` | A swelling frequency sweep that cuts off soon after its peak | About 0.32 seconds after it starts |

Each effect is synthesized on its own, its loudest sample is found, and that sample is placed at the cue frame's position at 48 kHz (frame number times 48000 divided by fps, rounded). Any part before the peak that would land before t = 0 is cut.

### Synthesis, mixing and loudness

- The `audio` command opens a blank page, loads `/__flipbook/audio.js`, synthesizes with `OfflineAudioContext`, sends the PCM back to Node in base64 chunks, and writes to `.flipbook/audio/`: `music.wav` (preset) and `sfx.wav` (with sfx cues), 48 kHz stereo 32-bit float, as long as the picture. It also writes `score.json` (chords, dynamics, effect positions) and `audio.json` (hash and peak of each track, actual peak position of each effect).
- Two syntheses on the same machine and version produce byte-identical WAVs. When the timeline, audio.js and the Chromium version are unchanged, render reuses the existing tracks.
- render mixes the music (the synthesized preset track or the user's file) with the effects using `amix` (`normalize=0`). With music, it first measures the music's own integrated loudness and puts the effect peaks 12 dB above it. Then it measures the whole mix, applies linear gain to -14 LUFS, limits to -3 dBFS with 4x oversampling, measures the limited result again and folds the difference into the gain. With only effects, it puts the peak at -4 dBFS and then limits. Finally it encodes AAC at 48 kHz stereo, 192 kbps.
- The user's file is cut from `bpmOffset` seconds so that beat 1 lands at t = 0, padded with silence when too short, cut when too long, and faded out over the last second (a quarter of the length when the video is under 4 seconds), then normalized as above.
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
