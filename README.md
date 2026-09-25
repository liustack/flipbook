<h1 align="center">flipbook</h1>

<p align="center"><b>Your coding agent turns one sentence into an MP4 animation, checked before you see it.</b></p>

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

https://github.com/user-attachments/assets/d0358eec-777e-4237-9695-e70ff8a7905d

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

https://github.com/user-attachments/assets/9016d9cb-d2dc-4fa3-84aa-f36801ead9e9

<sub>Bird eggs land one by one and build a 5. 8 s, silent.</sub>

</td>
</tr>
</table>

<p align="center"><sub>Every video plays in place. All of them are flipbook renders: the paper boat comes from an eval run, the others from the examples in this repository.</sub></p>

flipbook is an agent skill. Your agent writes one HTML composition and a timeline counted in beats, the skill renders it frame by frame into an MP4 with music, and checks the video before you get it.

It is for anyone who wants short animations from AI: intros, data animations, concept explainers, book quotes, clips cut to music.

It fixes three things that go wrong with AI-written web animation: every recording comes out different, Chinese characters drop out, and a blank video gets reported as a success.

> 0.x, so interfaces may change. The default look is paper: a paper ground with grain, handmade materials such as pencil hatching and halftone, handwriting drawn on canvas, and templates that build a glyph out of objects. The default sound is a score the agent writes for each film, played by synthesized instruments (piano, strings, flute, music box and more), plus four sound effects, normalized to -14 LUFS. Three quick presets (pluck, marimba, soft pad) are there for plain clips. You can go silent or bring your own music. Chinese text renders with no missing glyphs.

## Install

Hand this line to your agent:

```text
Install flipbook following https://github.com/liustack/flipbook/blob/v0.5.3/INSTALL.md, render the hello example, and tell me the result.
```

Or install the skill yourself. For Claude Code:

```bash
npx -y skills add liustack/flipbook#v0.5.3 --skill flipbook --global --agent claude-code -y
```

For Codex:

```bash
npx -y skills add liustack/flipbook#v0.5.3 --skill flipbook --global --agent codex -y
```

You need Node 22.19 or newer and ffmpeg with libx264 (`brew install ffmpeg` on macOS, `sudo apt-get install -y ffmpeg` on Debian and Ubuntu). The first check or render downloads a pinned Chromium (about 95 MB) and two Chinese fonts (about 50 MB) into your user cache. To skip the npx download on every run, install the skill's renderer globally: `npm install -g @liustack/flipbook@0.5.3`.

## One sentence to a video

You say:

```text
Make a 15-second New Year countdown: count from 10 down to 0 with the numbers hitting the beat, then show "Happy New Year 2027".
```

The agent follows the skill's six steps: settle the spec, write `timeline.json` (scenes and text placed on beats), write `index.html`, run `check` and `snapshot` and fix things until the contact sheet looks right, run `render`, then look at the final contact sheet and deliver:

```bash
bash ~/.claude/skills/flipbook/scripts/run.sh check countdown
bash ~/.claude/skills/flipbook/scripts/run.sh snapshot countdown
bash ~/.claude/skills/flipbook/scripts/run.sh render countdown
# countdown/out/video.mp4 and countdown/out/contact-sheet.png
```

Each command prints a JSON report to stdout. Every failure in it names a code, the second, the frame, the element, an evidence image and the fix. When the same kind of problem keeps failing, flipbook tells the agent to stop and hand you the contact sheet and the report, instead of burning through your quota.

## What the checks catch

| Stage | What it checks |
|---|---|
| check | timeline fields (errors point to the JSON path), forbidden code patterns and actual calls to forbidden clock and random functions, console errors, missing files, network requests, reads outside the directory, ready and seek timeouts, whether a frame changes when frames are visited in another order, whether it changes under another clock or random seed, late paints, blank frames and frames with nothing but paper, missing glyphs and fallback to system fonts, text off the frame or in the safe margin, text contrast |
| render | frame count and duration, runs of blank or paper-only frames, freezes in scenes not marked as holds, PSNR between the encoded video and the captured frames, yuv420p and bt709 color tags, audio duration, loudness and true peak, whether each sound effect lands on its frame |

Render twice on the same machine with the same version and the raw frames match hash for hash.

## Eval

Before the 0.3 release, Claude Code with Claude Opus 5.5 ran 8 prompts once each, unattended. All 8 were one-shot passes: from one sentence to a video that passed acceptance, with nobody stepping in. A run took 1.9 to 13.5 minutes and cost $0.65 to $2.78. Illustrated stories (a seed growing into a tree, the life of a butterfly) took 2 to 3 times the time and money of text and data videos. A person then went through every video and found none broken in a way the checks missed. Cases, judging rules and per-case numbers are in [docs/eval.md](docs/eval.md).

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
| Resources | 1080p rendering needs at least 2 GB of memory and 128 processes. With less it exits 78 with `resource-exhausted` |
| Model | Needs Claude Opus 5 or a model in its class, in a host that can read images (the agent reviews contact sheets). Gates are set on Claude Opus 5.5 and Claude Opus 5. Published eval numbers so far are for Opus 5.5 |

What each platform was tested on, the sandbox settings and the memory a container needs: [Platform](docs/platform.md).

## What it does not do

- **3D characters.** Nothing with rigged models, skeletons or motion capture.
- **Editing real footage.** It does not cut video you shot. That is a job for a video editor or ffmpeg.
- **Generated images or video as the main picture.** What moves on screen is drawn by code.
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
| [Composition rules](skills/flipbook/references/rules.md) | Writing index.html |
| [Timeline](skills/flipbook/references/timeline.md) | Writing timeline.json and hitting a target duration |
| [Music and sound effects](skills/flipbook/references/audio.md) | Picking a preset, setting dynamics, placing effects, using your own music |
| [Paper](skills/flipbook/references/paper.md), [materials](skills/flipbook/references/materials.md), [canvas text](skills/flipbook/references/text.md), [templates](skills/flipbook/references/templates.md) | Using the parts of the paper look. Sample sheets are in [docs/samples](docs/samples) |
| [Photos](skills/flipbook/references/photo.md) | Finding public domain plates, specimen photos and maps, and turning them into paper stickers |
| [Troubleshooting](skills/flipbook/references/troubleshooting.md) | Looking up what a code means and how to fix it |
| [Report format](docs/report-schema.md) | Parsing the JSON report, its thresholds and the output directory |
| [timeline.json format](docs/timeline-schema.md) | Looking up every timeline field, its allowed values and how beats become frames |
| [Platform](docs/platform.md) | Checking the support matrix, sandbox errors and settings, container limits, GPU findings |
| [Eval](docs/eval.md) | Running the eval, judging it, reading the results |

## Contributing

Pull requests are not accepted. Issues and forks are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md). Report security problems privately, see [SECURITY.md](SECURITY.md).

## License

MIT. Licenses for third-party code, dependencies and fonts are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
