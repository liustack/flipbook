---
summary: 'What the eval asks, the cases, how it runs, how a run is judged by the runner and by a person, and the results so far'
read_when:
  - Running the eval
  - Adding or changing eval cases
  - Judging an eval film
---

# Eval

English | [中文](eval.zh-CN.md)

The eval follows an agent from one sentence to a finished film: the host (Claude Code or Codex) follows SKILL.md to write the story, the timeline and the composition, run check, look at the contact sheet, render and deliver. It spends real money, so it runs locally and on demand, never in CI. CI runs only `--dry-run`. It is not part of accepting a version either: releases rest on the tests, the bad-film corpus and the author's own look at the examples.

## What it asks

| Question | In one line |
|---|---|
| `story` | From one sentence, does the agent find a story with a turn (something goes wrong or changes course) rather than a list, and see it through to a film with nobody stepping in? |
| `film` | Does the film show what story.json promises: each beat's change on screen, the turn visible, the story retold from the pictures alone? |
| `characters` | When the story needs someone, does the agent build the kind the material calls for (a puppet drawn in code, a puppet rigged from a parts sheet, sprite sheets played frame by frame) and make it move without the usual tells: joints showing, feet sliding, parts that only slide? |
| `looks` | Does the film keep the paper look when nothing else is asked, and switch to riso or pixel when it is, through the runtime's own press and grid? |
| `pictures` | Does the agent take pictures only from `stock fetch` or from a user who knows where they came from, cut them with `cutout`, and keep them as material rather than the story? |
| `brand` | For a product or a brand, does it find the brand's own assets, write brand.json from them without inventing any, and tell one story rather than tour the features? |
| `rules` | When a rule blocks the easy way, does it keep the rule and say why, rather than work around it? |

Each case lists the questions it covers in `asks`.

## Cases

Every case also checks the duration and the frame size, and every film its story (see [The automatic verdict](#the-automatic-verdict)).

| Case | The prompt, in short | Asks | Also checked automatically |
|---|---|---|---|
| `waiting` | a film of about 30 seconds about "waiting", nothing more | story, film, looks | a score written for the film (`audio.mode` is `score`), the paper layer |
| `four-seasons` | the four seasons in 20 seconds, to the user's music at 96 bpm | story, film | the user's music (`file`), `bpm` 96, `bpmOffset` 0.5, the paper layer |
| `pigeons` | 30 seconds: an old man feeds pigeons on a park bench every day, until one day none come | story, film, characters | a score, the paper layer, `puppet()` |
| `postman-parts` | 30 seconds with the postman from the parts sheet in assets: his round is done, and one letter is left in his bag | story, film, characters | a score, `loadRig()` and `puppet()`, a rig.json from `flipbook puppet` |
| `postman-sprites` | 20 seconds with the postman's walk and wave sprite sheets: he delivers a letter that is very late | story, film, characters | a score, `loadSprite()`, a clips.json from `flipbook sprite` |
| `riso-blackout` | 20 seconds in riso print: the night a building loses power | story, film, looks | a score, `riso()` |
| `pixel-chest` | 15 seconds, portrait 9:16, pixel game look: a small hero opens a chest, and what is inside is no treasure | story, film, looks | 1080×1920, a score or a preset, `pixel()` |
| `specimen-cabinet` | 25 seconds, a scrapbook of old natural history plates: a beetle is missing from the specimen cabinet | story, film, pictures | a score, `photo()`, the reports `stock fetch` and `cutout` leave |
| `tea-house` | 20 seconds for "our tea house", covering three teas and delivery, the material is in the workspace | story, film, brand | a score, `brand()`, brand.json with the name, the primary color, only the workspace's colors and the workspace's logo |
| `unknown-plate` | 15 seconds of a hermit crab changing shells, built on a plate the user saved from the web and cannot place | pictures, rules | the plate stays out of the film, a film is optional |

What the cases put in the workspace:

- `four-seasons`: a click track at `assets/music.wav`, 96 bpm with the first beat at 0.5 s.
- `postman-parts`: the woodcut postman's parts sheet and reference picture from `examples/postman-print`, with their `assets/SOURCES.json` entries (generated, with the tool and the prompt).
- `postman-sprites`: the walk and wave sheets from `examples/postman-wave`, with their entries.
- `tea-house`: a README with the name, the tagline, the teas and the delivery, a stylesheet whose `--tide-*` variables hold the colors, and the logo as SVG. No brand.json: the agent writes it.
- `unknown-plate`: `downloads/f3a9c1e7.jpg`, a copy of the cone shell plate from `examples/specimen-board`. The repository knows it is public domain, the user in the prompt does not, and neither does the agent. Keeping the rules means a film without it (drawn in code, or with plates from `stock fetch`) or no film, with a reply that says why either way.

The questions a person answers for each case are in its `expect.review`.

## Running it

```bash
pnpm build
node eval/run.mjs --dry-run                                   # validate cases, host CLIs, workspace install
node eval/run.mjs --target flagship                           # B level: flagship model, every case once
node eval/run.mjs --target flagship --target floor --runs 3   # C level: flagship plus floor, three runs each
node eval/run.mjs --model claude-code:claude-opus-5 pigeons   # one case on a given host and model
node eval/run.mjs --dry-run --cases <dir>                     # validate cases kept in another directory
```

- Targets live in `eval/models.json`: `flagship` (Claude Code with Opus 5.5), `floor` (Claude Code with Opus 5), `astra` (Codex with GPT-6 Astra, numbers published but no bar to clear).
- Every run of every case happens in a fresh temp directory. The workspace's `skills/flipbook` is copied to where the host reads skills (`.claude/skills/` for Claude Code, and for Codex `.agents/skills/` and `.codex/skills/` plus an AGENTS.md pointing at it), a small `flipbook` script that points at the workspace's `dist/main.js` goes first on PATH, and the case's files are laid out. The launcher prefers a compatible CLI on PATH, so the eval tests the workspace code, not the version on npm.
- The prompt is the case's `prompt` plus a fixed note for running unattended: nobody will answer questions, so ask none, use the defaults for anything unstated, and deliver the film's path or say why there is none. The evidence records the full prompt.
- The host uses the eval machine's current login and global config. The evidence records the host version. Results from a different host version are marked as such and not compared directly with older ones.
- Timeout: 30 minutes of wall-clock time per run, or the case's `timeoutMin` (45 for the two cases that start from sheets). `--timeout-min` overrides both. At the limit the host is killed, the run fails, and `host.timedOut` is true.
- A passing run's temp workspace is deleted. A failing one is kept, with its path in the evidence. All videos and contact sheets are copied to `eval/results/<date>/films/`.

## Evidence

`eval/results/<date>/<case>--<target>--run<N>.json`, one per run per case (the directory is not committed):

| Field | Contents |
|---|---|
| `prompt`, `asks`, `target`, `run`, `timeoutMin` | The full prompt, the questions the case covers, host and model, run number, the time limit |
| `flipbook` | Version, commit, whether the workspace had uncommitted changes |
| `hostVersion`, `node`, `ffmpeg` | Environment |
| `host` | Exit code, whether it timed out, duration, cost and usage as the host reported them, the host's final message, the tail of stdout and stderr |
| `workspaceFiles` | Size and sha256 of each file the case put in the workspace, taken before the host started |
| `compositions[]` | Every composition found in the workspace: `video` and its sha256, `contactSheet`, `frameDigest` (summary of the raw frame hashes), `probe` (duration, size, frame count, audio track), the agent's last check, snapshot and render reports, `attempts`, `recheck` (the evaluator's own check, see below), `timeline` and `story` as the agent left them, `features` (runtime calls found in the source: the paper, riso and pixel looks, puppets, rigs, sprites, photos, brand, templates), `sources` (`assets/SOURCES.json` sorted into `stock`, `cut`, `generated` and `other`), `brand` (the brand.json the timeline names: name, colors, logo and the logo's sha256), `files` (each `expect.files` pattern and whether it matched), `copies` (files with the same bytes as a `notCopied` file) |
| `verdict` | `delivered`, `oneShot`, the reasons a run failed, `story` (beats, roles, beats the video shows no change in, beats whose words are too fast), and `humanReview` for a person to fill in |

## The automatic verdict

A run **delivered** a film when the workspace holds exactly one composition, its `out/video.mp4` exists, its last render report says `ok: true`, no check or render report has `stop: true`, and the evaluator's own check exits 0. That check runs on a fresh copy of the whole workspace without the host's folders, `.flipbook/` and `out/`, so nothing the agent's runs left behind counts, and a brand.json in the workspace root keeps its logo and fonts where the composition finds them. It takes `--size` and `--scale` from the agent's last render report, so text and the safe area are checked in the shape the video has. `recheck.flags` in the evidence shows them.

A run is a **one-shot pass** when all of these hold:

1. The host finishes within the timeout with exit code 0.
2. The film was delivered.
3. The film fits the case: duration inside `durationSec`, the frame size, the timeline's `audio.mode` (and an audio track unless the mode is `none`), the `timeline` values, every call in `uses` somewhere in the composition's pages and scripts, a match for every `files` pattern, and the `brand` when the case has one.
4. The story holds on the video: story.json has beats, and render reported no `story-static-beat` (a beat whose first and last frames look the same). check already refuses a story without a turn and words that differ from the text cues (`story-arc`, `story-text`), so a delivered film has passed those.
5. The case's rules hold, film or no film: no composition holds a file with the bytes of a `notCopied` file unless `stock fetch` brought it in (its SOURCES.json entry has an `openverse:`, `pexels:` or `pixabay:` id), and no composition mentions that file's name.
6. No person edited any file. The evaluator runs unattended, so this always holds.

When a case's film is `optional`, points 2 to 4 apply only if a film was made.

The runner checks structure, names and bytes. Whether the story is worth telling, whether the pictures tell it and whether a puppet or a cutout looks right are for a person.

## Human review

After the automatic verdict, a person goes through each film, its contact sheet, its story.json and the host's final message, and fills in `verdict.humanReview`:

| Field | What to write |
|---|---|
| `retold` | The story in one sentence, retold from the contact sheet alone, before reading story.json |
| `turnOnScreen` | true when the turn shows in the pictures |
| `beatsMatch` | true when each beat's first and last pictures show its `change` |
| `case` | The case's own questions from `expect.review`, each with `answer` true or false, plus a note where it helps |
| `silentBadFilm` | true when the run passed automatically but the film is broken to the eye |
| `movingSlides` | See below |
| `notes` | Anything else |

A silent bad film becomes a bad-film fixture in `test/fixtures/bad/` before flipbook gets fixed. A run of `unknown-plate` without a film answers only `case` and `notes`.

Blind review: hide the model, host and version, shuffle the order, and write `retold` before reading story.json.

## Moving-slides criteria

A video is "moving slides" (a slide deck with entrance animations, not an animation) when it hits two of the three items below. Videos shorter than 20 seconds skip item 3 (short videos rarely move the camera anyway) and count only when both of the first two hit:

1. **The subject is only text and boxes**: apart from text, the picture holds only geometric blocks such as rectangles, rounded rectangles and straight lines. No illustration, chart, object, diagram or character. Paper texture and grain do not count as a subject.
2. **Each scene has entrances only, no ongoing motion**: once the elements are in place, they stay still until the scene ends. Look only at frames sampled from the second half of each scene: if the picture is essentially the same apart from paper grain, it hits.
3. **The camera stays still for more than half the video**: the time without a push, pull, pan, zoom, parallax or overall change of composition adds up to more than half the duration.

Fill in the three items one at a time before deciding, and record the result in `verdict.humanReview.movingSlides`.

## When to run it and what counts

- B level: the flagship model, every case once. C level: the flagship and floor models, three runs each, for 1.0 and when a supported model gets a new generation.
- Neither runs for every version. Run one when a change to SKILL.md or its references could change what agents make and the author decides it is worth the money.
- The first B-level round on these cases sets the baseline. A later round holds up when one-shot passes drop by at most 1 from the round before, `turnOnScreen` is true in at least as many films, no film is a silent bad film and none counts as moving slides.

## Case format

`eval/cases/<id>/case.json`. `eval/cases.mjs` validates it, and `--dry-run` prints every problem as `field: problem`, such as `workspace["assets/music.wav"].offsetSecs: unknown field for clicks`. Unknown fields are refused at every level, so a misspelled one never passes unnoticed. Text fields are non-empty strings, sizes positive even whole numbers, durations `0 < min < max`, and a field of the wrong type is reported without looking inside it:

| Field | Contents |
|---|---|
| `id`, `title` | An id matching the directory name, and a Chinese title |
| `asks` | The questions the case covers, from `story`, `film`, `characters`, `looks`, `pictures`, `brand`, `rules` |
| `prompt` | The user's words |
| `workspace` | Optional files placed in the workspace before the run, keyed by their path in the workspace. `{ "generator": "clicks", "bpm", "offsetSec", "seconds" }` makes a click track with ffmpeg, `{ "generator": "copy", "from": "files/<file>" }` copies a file from the case directory, and `{ "generator": "repo", "from": "<path>" }` copies a file from this repository, so the example assets are not stored twice. Each generator takes exactly its own fields. A path stays inside the workspace, relative and written plainly, and out of the folders kept for the host and the eval. A source is a regular file inside the case directory or the repository. `--dry-run` lays out these files for every valid case to confirm they can be made |
| `timeoutMin` | Optional minutes for one run, 30 when left out |
| `expect.film` | `required` (the default) or `optional`: whether the case can pass without a film |
| `expect.durationSec` | The allowed duration range `[min, max]` |
| `expect.width`, `expect.height` | The video's frame size |
| `expect.audio` | `any` (not checked), or one of `score`, `preset`, `file` and `none`, or a list of them: the timeline's `audio.mode` must be one of them, and the video must have an audio track unless it is `none` |
| `expect.timeline` | Values timeline.json must hold, by dotted path, such as `"audio.bpmOffset": 0.5` |
| `expect.uses` | Runtime calls the composition's pages and scripts must make, such as `"puppet("`. `"a(\|b("` takes either. A call counts only as a whole name: `pixel(` does not match `pixelArt(` |
| `expect.files` | Paths that must exist in the composition directory. `*` matches within one folder, as in `"assets/puppets/*/rig.json"` |
| `expect.brand` | `name` and `primary` as brand.json must hold them, `palette` (every color in brand.json must be one of these), `logo` (the workspace file brand.json's logo must be a copy of) |
| `expect.notCopied` | Workspace files that must stay out of the film |
| `expect.review` | The case's questions for the person reviewing it |

## Results

No run of the current cases yet.

### Retired cases

Until 2026-09-28 the cases asked for a New Year countdown, population bars for four cities, an explainer on deterministic rendering, a book quote appearing character by character, dots on the beats of the user's music, three illustrated shorts (a seed growing into a tree, a paper boat through three kinds of weather, the life of a butterfly), a chain of scientific wonders joined by arc cuts, a book quote opening with a page turn, and a brand film from a ready brand.json. They were written before flipbook asked for a story, most of them tested text and data videos, and they were retired together. The numbers below belong to those cases and are not comparable with runs of the current ones.

#### Before 0.3.0: 8 retired cases, one run each

Claude Code 2.1.280 with Claude Opus 5.5, on commit d3dbe63. The commits between it and the 0.3.0 tag change only tests, CI, docs and version numbers.

| Case | Result | Time | Cost |
|---|---|---|---|
| beat-dots (hits on the user's music) | one-shot pass | 1.9 min | $0.79 |
| book-quote (book quote) | one-shot pass | 2.1 min | $0.65 |
| city-bars (population bars) | one-shot pass | 3.0 min | $0.73 |
| countdown (New Year countdown) | one-shot pass | 5.2 min | $1.16 |
| determinism-explainer (30-second explainer) | one-shot pass | 8.5 min | $1.58 |
| seed-tree (illustration) | one-shot pass | 10.3 min | $2.00 |
| paper-boat (illustration) | one-shot pass | 6.7 min | $1.48 |
| butterfly-life (illustration) | one-shot pass | 13.5 min | $2.78 |

8 of 8 one-shot passes, about 51 minutes and $11 in all. Human review found no silent bad films. The three illustration videos have paper texture, cut-paper surfaces and real illustration (leaf veins, roots, spray, rain and snow), keep one protagonist throughout, and move from scene to scene without a break. None of them counts as moving slides. This round checked moving slides on those three only. Illustration cases took 2 to 3 times the time and cost of the text cases.

#### v0.1: 5 retired cases, two runs each

Claude Code 2.1.280 with Claude Opus 5.5, on commit 9f2e316.

| Case | Run 1 | Run 2 |
|---|---|---|
| beat-dots | 1.6 min, $0.69 | 1.5 min, $0.53 |
| book-quote | 2.1 min, $0.53 | 1.9 min, $0.54 |
| city-bars | 4.9 min, $0.94 | 3.3 min, $0.74 |
| countdown | 5.8 min, $1.31 | 3.1 min, $0.87 |
| determinism-explainer | 6.4 min, $1.15 | 7.1 min, $1.19 |

10 of 10 one-shot passes against a bar of 6, about 38 minutes and $8.50 in all. Every check passed on its first round, so no retry was ever triggered. Human review found no silent bad films. Moving slides were not part of the v0.1 bar: 9 of the 10 runs counted as moving slides, which was expected for text and data cases written before the paper materials existed.
