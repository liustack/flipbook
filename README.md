<h1 align="center">flipbook</h1>

<p align="center"><b>Your coding agent turns an idea into a short animated film that tells a story, checked before you see it.</b></p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="INSTALL.md">Install</a> ·
  <a href="skills/flipbook/references/rules.md">Composition rules</a> ·
  <a href="skills/flipbook/references/troubleshooting.md">Troubleshooting</a> ·
  <a href="SECURITY.md">Security</a>
</p>

<p align="center">
  <a href="https://x.com/liustack"><img src="https://img.shields.io/badge/follow-%40liustack-black?style=flat-square&logo=x&logoColor=white" alt="Follow @liustack on X"></a>
  <a href="https://www.npmjs.com/package/@liustack/flipbook"><img src="https://img.shields.io/npm/v/@liustack/flipbook?style=flat-square&label=npm&color=cb3837" alt="npm"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/@liustack/flipbook?style=flat-square" alt="Node.js"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/Not%20backed%20by-Y%20Combinator-FF6600?style=flat-square&logo=ycombinator&logoColor=white" alt="Not backed by Y Combinator">
  <img src="https://img.shields.io/badge/users-unknown-lightgrey?style=flat-square" alt="Users unknown">
</p>

https://github.com/user-attachments/assets/60d42983-127c-48f8-90ed-102034ec5a94

<p align="center"><sub>A flip book of Muybridge's 1878 Horse in Motion: the pages riffle faster and faster until the horse runs, then settle on the standing mare. 12.5 s, preset music.</sub></p>

<table>
<tr>
<td colspan="2" valign="top">

https://github.com/user-attachments/assets/4720fa7b-ec6e-4c25-b361-1ca15e2cc42e

<sub>Claude Opus 5.5 made this from one prompt: a paper boat sails through sun, rain and snow. First try, 6.7 minutes, $1.48. 25 s, preset music.</sub>

</td>
</tr>
<tr>
<td colspan="2" valign="top">

https://github.com/user-attachments/assets/5ee87eff-1436-473b-b31a-81c74769659d

<sub>Also from one prompt: a butterfly's life on paper, egg, caterpillar, chrysalis and butterfly, each stage with its title. First try, 13.5 minutes, $2.78. 30 s, preset music.</sub>

</td>
</tr>
</table>

<p align="center"><sub>Every video plays in place. All three are flipbook renders: the paper boat and the butterfly come from eval runs where the model worked alone from one prompt.</sub></p>

flipbook is an agent skill for short animated films that tell a story. Your agent writes the story first, one idea in three to six beats, then a timeline counted in beats and one HTML composition. The skill renders it frame by frame into an MP4 with music and checks the video against the story before you get it. Paper is the house look: cut paper, pencil, prints. A film about a product works the same way, one idea with the product moving the story.

It is for anyone who wants short animations from AI: intros, data animations, concept explainers, book quotes, clips cut to music.

It fixes three things that go wrong with AI-written web animation: every recording comes out different, Chinese characters drop out, and a blank video gets reported as a success.

> 0.x, so interfaces may change. The default look is paper: a paper ground with grain, handmade materials such as pencil hatching and halftone, handwriting drawn on canvas, and templates that build a glyph out of objects. The default sound is a score the agent writes for each film, played by synthesized instruments (piano, strings, flute, music box and more), plus four sound effects, normalized to -14 LUFS. Three quick presets (pluck, marimba, soft pad) are there for plain clips. You can go silent or bring your own music. Chinese text renders with no missing glyphs.

## Characters and looks

A story needs someone to follow. There are three ways to make one, and they all move on the beat:

- **Cut-paper puppets drawn in code.** `puppet()` hangs paper parts on bones. The walk keeps the planted foot on the ground, and hands and faces swap on cue.
- **Puppets from a parts sheet.** Draw the parts on one sheet, or have an image model draw them. `flipbook puppet` finds the joints and rigs them: woodcut, gouache, crayon.
- **Frame-by-frame sprites.** A sheet of whole drawings, from an image model, a game asset pack or your own hand. `flipbook sprite` cuts it and lines the drawings up on the feet. In a walk it follows the planted foot and holds it still, and warns when it cannot. Packed game sheets are cut by their grid.

Paper is the house look, and two more sit beside it. **Riso**: two or three spot inks, overprinted, a little off register, tints printed as grain or halftone dots. **Pixel**: a small grid of cells in a few colors, blown up by a whole number, with a pixel font for the words. On macOS 14 or newer, a photo with a real background can be cut into a paper sticker too, with the Vision framework that comes with the system.

<table>
<tr>
<td valign="top">

https://github.com/user-attachments/assets/f942b13d-683a-459b-9f4c-b2b1a6454716

<sub>A woodcut postman rigged from a generated parts sheet. The wind takes his letter and he chases it to the post box. About 17 s.</sub>

</td>
<td valign="top">

https://github.com/user-attachments/assets/d9371fc1-27c8-4752-b725-7462784b5c25

<sub>A sprite postman from two generated sheets walks past dark windows. One lights up, a child waves, and he waves back. 12 s.</sub>

</td>
</tr>
<tr>
<td colspan="2" valign="top">

https://github.com/user-attachments/assets/a4ac0370-f154-453a-8777-16283a554194

<sub>A pixel robot waters a mound for three days. On the fourth morning a sprout comes up. 12 s.</sub>

</td>
</tr>
</table>

## Install

Hand this line to your agent:

```text
Install flipbook following https://github.com/liustack/flipbook/blob/v0.8.4/INSTALL.md, render the hello example, and tell me the result.
```

Or install the skill yourself. For Claude Code:

```bash
npx -y skills add liustack/flipbook#v0.8.4 --skill flipbook --global --agent claude-code -y
```

For Codex:

```bash
npx -y skills add liustack/flipbook#v0.8.4 --skill flipbook --global --agent codex -y
```

You need Node 22.19 or newer and ffmpeg with libx264 (`brew install ffmpeg` on macOS, `sudo apt-get install -y ffmpeg` on Debian and Ubuntu). The first check or render downloads a pinned Chromium (about 95 MB) and three fonts, two Chinese and one pixel font (about 55 MB), into your user cache. To skip the npx download on every run, install the skill's renderer globally: `npm install -g @liustack/flipbook@0.8.4`.

## From an idea to a film

You say:

```text
Make a 20-second paper animation: a storm puts out the lighthouse lamp, and a small boat finds its way home by a child's lantern.
```

The agent follows the skill's steps: write `story.json` (the idea, the turn, three to six beats) and show it to you, settle the spec, write `timeline.json` (a scene or two per beat), write `index.html`, run `check` and `snapshot` and fix things until the contact sheet looks right, run `render`, then read the final contact sheet against the story and deliver:

```bash
bash ~/.claude/skills/flipbook/scripts/run.sh check lighthouse
bash ~/.claude/skills/flipbook/scripts/run.sh snapshot lighthouse
bash ~/.claude/skills/flipbook/scripts/run.sh render lighthouse
# lighthouse/out/video.mp4 and lighthouse/out/contact-sheet.png
```

Each command prints a JSON report to stdout. Every failure in it names a code and the fix and, depending on the problem, the second, the frame, the element or an evidence image. A field of timeline.json, story.json or sprite.json that fails its check is named by its path, and a file that is not valid JSON by the root, `$`. When the same kind of problem keeps failing, flipbook tells the agent to stop and hand you the contact sheet and the report, instead of burning through your quota.

## What the checks catch

| Stage | What it checks |
|---|---|
| story (check and render) | the beats follow the film in order with no gap, the story has an opening, a turn and a resolution, each beat lists the words it puts on screen and leaves time to read them, and each beat's picture changes from its first frame to its last |
| check | timeline fields (errors point to the JSON path), forbidden code patterns and actual calls to forbidden clock and random functions, console errors, missing files, network requests, reads outside the directory, ready and seek timeouts, whether a frame changes when frames are visited in another order, whether it changes under another clock or random seed, late paints, blank frames and frames with nothing but paper, missing glyphs and fallback to system fonts, text off the frame or in the safe margin, text contrast |
| render | frame count and duration, runs of blank or paper-only frames, freezes in scenes not marked as holds, PSNR between the encoded video and the captured frames, yuv420p and bt709 color tags, audio duration, loudness and true peak, whether each sound effect lands on its frame |

Render twice on the same machine with the same version and the raw frames match hash for hash.

## Eval

Before the 0.3 release, Claude Code with Claude Opus 5.5 ran 8 prompts once each, unattended. All 8 were one-shot passes: from one sentence to a video that passed acceptance, with nobody stepping in. A run took 1.9 to 13.5 minutes and cost $0.65 to $2.78. Illustrated stories (a seed growing into a tree, the life of a butterfly) took 2 to 3 times the time and money of text and data videos. A person then went through every video and found none broken in a way the checks missed. Those cases were written for short animation in general and have since been retired: the eval now has ten new cases built around stories, characters and looks, not run yet. The new cases, how a run is judged and the old numbers are in [docs/eval.md](docs/eval.md).

## Support

| Item | Status |
|---|---|
| macOS arm64 | Supported. Tested directly, in the Claude Code sandbox and in the Codex sandbox |
| Linux x64 (Ubuntu 22.04 and 24.04, Debian 12) | Supported. CI installs from scratch following INSTALL.md and renders hello |
| Linux arm64 | Best effort. Tested in an Ubuntu 24.04 arm64 container, under restricted container limits and both hosts' Linux sandboxes |
| macOS x64 (Intel) | Best effort, untested |
| Windows | Not supported, use WSL2. Native Windows exits 78 |
| Claude Code | Runs inside the sandbox. The first run downloads Chromium and fonts and asks you once to allow it. Everything after that runs inside the sandbox, with no settings to change and no restart |
| Codex | macOS `workspace-write`: same as Claude Code. On Linux, add `network_access = true` to the Codex config, because Codex's sandbox blocks the socket calls Chromium needs to start. `read-only` mode cannot write files: use `workspace-write` |
| Photo cutouts | `cutout --subject` needs macOS 14 or newer, as it uses the system's Vision framework. The rest of `cutout`, and everything else, follows the platform rows above |
| Resources | 1080p rendering needs at least 2 GB of memory and 128 processes. With less it exits 78 with `resource-exhausted` |
| Model | Needs Claude Opus 5 or a model in its class, in a host that can read images (the agent reviews contact sheets). Gates are set on Claude Opus 5.5 and Claude Opus 5. Published eval numbers so far are for Opus 5.5 |

What each platform was tested on, the sandbox settings and the memory a container needs: [Platform](docs/platform.md).

## What it does not do

- **3D characters.** Nothing with 3D models or motion capture. Characters are flat: cut-out puppets, drawn in code or rigged from a parts sheet, and frame-by-frame sprites.
- **Editing real footage.** It does not cut video you shot. That is a job for a video editor or ffmpeg.
- **Video from video models.** Motion is drawn by code, frame by frame. Still images, generated ones included, can be material: a character's parts, a backdrop, a prop, with their source written down in `assets/SOURCES.json`.
- **Voice-over.** No text-to-speech narration yet, only music and sound effects.
- **Beat detection.** With your own music, you give the bpm and the second where beat 1 falls.
- **Native Windows.** Run it inside WSL2.
- **Identical frames across machines.** Frames match hash for hash on the same machine and version. Another machine or system can differ slightly.
- **Taste.** The checks catch broken frames, not ugly ones. The agent looks at the contact sheet before it delivers, and you have the last word.

## Documentation

| Doc | Read it when |
|---|---|
| [INSTALL.md](INSTALL.md) | Installing, step by step (written for an agent) |
| [skills/flipbook/SKILL.md](skills/flipbook/SKILL.md) | Seeing how the agent makes a video and which rules it must keep |
| [Story](skills/flipbook/references/story.md) | Writing story.json: the idea, the turn, the beats |
| [story.json v1](docs/story-schema.md) | The story's fields and what check verifies against it |
| [Composition rules](skills/flipbook/references/rules.md) | Writing index.html |
| [Timeline](skills/flipbook/references/timeline.md) | Writing timeline.json and hitting a target duration |
| [Music and sound effects](skills/flipbook/references/audio.md) | Picking a preset, setting dynamics, placing effects, using your own music |
| [Paper](skills/flipbook/references/paper.md), [materials](skills/flipbook/references/materials.md), [canvas text](skills/flipbook/references/text.md), [templates](skills/flipbook/references/templates.md) | Using the parts of the paper look. Sample sheets are in [docs/samples](docs/samples) |
| [Characters](skills/flipbook/references/characters.md) | Making a character: puppets in code, puppets from a parts sheet, frame-by-frame sprites |
| [Riso](skills/flipbook/references/riso.md), [pixel](skills/flipbook/references/pixel.md) | Using the riso look or the pixel look |
| [Photos](skills/flipbook/references/photo.md) | Finding public domain plates, specimen photos and maps, and turning them into paper stickers, photos with a real background included |
| [Troubleshooting](skills/flipbook/references/troubleshooting.md) | Looking up what a code means and how to fix it |
| [Report format](docs/report-schema.md) | Parsing the JSON report, its thresholds and the output directory |
| [timeline.json format](docs/timeline-schema.md) | Looking up every timeline field, its allowed values and how beats become frames |
| [Platform](docs/platform.md) | Checking the support matrix, sandbox errors and settings, container limits, GPU findings |
| [Eval](docs/eval.md) | Running the eval, judging it, reading the results |

## Contributing

Pull requests are not accepted. Issues and forks are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md). Report security problems privately, see [SECURITY.md](SECURITY.md).

## License

MIT. Licenses for third-party code, dependencies and fonts are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
