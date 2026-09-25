---
summary: 'How the eval runs, how a one-shot pass is judged, the moving-slides criteria, timeouts and human review'
read_when:
  - Running a B-level or C-level eval
  - Adding or changing eval cases
  - Judging whether an eval video passed
---

# Eval

English | [中文](eval.zh-CN.md)

The eval covers an agent's whole path from one sentence to an mp4: the host (Claude Code or Codex) follows SKILL.md to write the composition, run check, look at the contact sheet, render and deliver. It spends real money, so it runs locally on demand and never in CI. CI runs only `--dry-run`.

## Running it

```bash
pnpm build
node eval/run.mjs --dry-run                                   # validate cases, host CLIs, workspace install
node eval/run.mjs --target flagship --runs 2                  # B level: flagship model, two runs per case
node eval/run.mjs --target flagship --target floor --runs 3   # C level: flagship plus floor
node eval/run.mjs --model claude-code:claude-opus-5 countdown  # one case on a given host and model
```

- Targets live in `eval/models.json`: `flagship` (Claude Code with Opus 5.5), `floor` (Claude Code with Opus 5), `astra` (Codex with GPT-6 Astra, numbers published but no gate).
- Every run of every case happens in a fresh temp directory. The workspace's `skills/flipbook` is copied to where the host reads skills (`.claude/skills/` for Claude Code, and for Codex `.agents/skills/` and `.codex/skills/` plus an AGENTS.md pointing at it), and a small `flipbook` script that points at the workspace's `dist/main.js` goes first on PATH. The launcher prefers a compatible CLI on PATH, so the eval tests the workspace code, not the version on npm.
- The prompt is the case's `prompt` plus a fixed note for running unattended (ask no questions, use the defaults for anything unstated, deliver when done). The evidence records the full prompt.
- The host uses the eval machine's current login and global config. The evidence records the host version. Results from a different host version are marked as such and not compared directly with older ones.
- Timeout: 30 minutes of wall-clock time per run (change it with `--timeout-min`). At the limit the host is killed, the run counts as failed, and `host.timedOut` is true.
- A passing run's temp workspace is deleted. A failing one is kept, with its path in the evidence. All videos and contact sheets are copied to `eval/results/<date>/films/`.

## Evidence

`eval/results/<date>/<case>--<target>--run<N>.json`, one per run per case (the directory is not committed):

| Field | Contents |
|---|---|
| `prompt`, `target`, `run` | The full prompt, host and model, run number |
| `flipbook` | Version, commit, whether the workspace had uncommitted changes |
| `hostVersion`, `node`, `ffmpeg` | Environment |
| `host` | Exit code, whether it timed out, duration, cost and usage as the host reported them, the tail of stdout and stderr |
| `compositions[]` | Every composition found in the workspace: `video` and its sha256, `contactSheet`, `frameDigest` (summary of the raw frame hashes), `probe` (duration, size, frame count, audio track), the agent's last check, snapshot and render reports, `attempts`, and the check the evaluator reran on its own copy |
| `verdict` | `oneShot`, the reasons a run failed, the fields left for human review |

## How a one-shot pass is judged

Automatically. A run is a one-shot pass only when all of these hold:

1. The host finishes within the timeout with exit code 0.
2. The workspace holds exactly one composition directory, and `out/video.mp4` exists.
3. The agent's last render report says `ok: true`, and no check or render report has `stop: true`.
4. The evaluator copies the composition to a new directory and runs check on it independently, with exit code 0.
5. The video's duration falls inside the case's `durationSec` range, the size is right, and every text the case requires appears in index.html or timeline.json. When the case asks for preset music or the user's own music, the timeline's `audio.mode` matches and the video has an audio track.
6. No person edited any file. The evaluator runs unattended, so this always holds.

After the automatic verdict, a person goes through the contact sheets and videos. A run that passed automatically but looks broken to a person is a silent bad film. It goes into the evidence's `verdict.humanReview.silentBadFilm`, and that kind of breakage becomes a bad-film fixture in `test/fixtures/bad/` before flipbook gets fixed.

## Moving-slides criteria

A video is "moving slides" (a slide deck with entrance animations, not an animation) when it hits two of the three items below. Videos shorter than 20 seconds skip item 3 (short videos rarely move the camera anyway) and count only when both of the first two hit:

1. **The subject is only text and boxes**: apart from text, the picture holds only geometric blocks such as rectangles, rounded rectangles and straight lines. No illustration, chart, object, diagram or character. Paper texture and grain do not count as a subject.
2. **Each scene has entrances only, no ongoing motion**: once the elements are in place, they stay still until the scene ends. Look only at frames sampled from the second half of each scene: if the picture is essentially the same apart from paper grain, it hits.
3. **The camera stays still for more than half the video**: the time without a push, pull, pan, zoom, parallax or overall change of composition adds up to more than half the duration.

Blind review: hide the model, host and version, shuffle the order, look only at the videos and contact sheets, fill in the three items one at a time before deciding, and record the result in `verdict.humanReview.movingSlides`.

## Gates

B level, for every 0.x minor version: the flagship model on 10 cases, one run each. Delivered videos must not drop by more than 1 from the previous version, silent bad films must be zero, and moving slides must be at most 2. v0.1 used 5 cases with 2 runs each, needed at least 6 one-shot passes, and reports the actual number. C level runs for 1.0, for major versions and when a supported model gets a new generation.

## Cases

`eval/cases/<id>/case.json`:

| Field | Contents |
|---|---|
| `id`, `title` | An id matching the directory name, and a Chinese title |
| `prompt` | The user's one sentence |
| `workspace` | Optional files placed in the workspace before the run. `{ "generator": "clicks", "bpm", "offsetSec", "seconds" }` generates a click track with ffmpeg |
| `expect.durationSec` | The allowed duration range `[min, max]` |
| `expect.width`, `expect.height` | Frame size |
| `expect.textInSource` | Text that must appear in the composition source |
| `expect.audio` | `none` (sound not checked), `preset` (the timeline uses preset music and the video has an audio track) or `file` (the timeline uses the user's music and the video has an audio track) |
| `expect.notes` | What human review should look at |

The 5 cases from v0.1: a New Year countdown (big numbers and a hold), population bars for four cities (a data chart), an explainer on deterministic rendering (a concept diagram), a book quote (text appearing character by character), and hits on the user's own music (bring-your-own music and beat points). All in Chinese, none relying on the paper materials.

The 3 illustration and story cases added once the paper look and music shipped: a seed growing into a tree (20 seconds, continuous growth), a paper boat through three kinds of weather (25 seconds, scene changes), the life of a butterfly (30 seconds, four stages with small titles). All require the paper look and preset music, and no voice-over.
