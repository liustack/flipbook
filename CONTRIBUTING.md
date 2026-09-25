# Contributing to flipbook

English | [中文](CONTRIBUTING.zh-CN.md)

The rule first: **flipbook does not accept pull requests**. One person maintains it, and the author has reviewed and answers for every line of code.

Two ways to take part that really help:

- **[Open an issue](https://github.com/liustack/flipbook/issues)**. Bugs, ideas, error messages you cannot make sense of, docs that are wrong: all welcome. The issue template tells you what to attach.
- **Fork it**. It is MIT licensed. Your copy is entirely yours, and renaming, reworking or publishing it needs nobody's permission.

The rest of this page is development notes for people working on a fork.

## Scope

flipbook does one thing: render an HTML composition written by a model into an MP4, frame by frame and deterministically, and check the video automatically before it is delivered.

Out of scope: 3D characters, editing real footage, generated images or video as the main picture, live screen recording, TTS voice-over, Remotion or HyperFrames as the base, p5.js, machine-learning matting, beat detection, native Windows support, a `preview` command.

## Development

```bash
pnpm install
pnpm lint        # Biome
pnpm typecheck   # tsc --noEmit
pnpm test        # unit and quick engine tests, builds first, under a minute
pnpm test:e2e    # whole compositions through the CLI: bad-film corpus, reference snippets, example renders, two-render hash comparisons
pnpm build       # tsup, writes dist/main.js and dist/runtime/
```

Needs Node 22.19 or newer and ffmpeg with libx264. The first check or render installs the Chromium headless shell and the fonts into the user cache.

## Tests

- Tests live in `test/`. Tests that send a whole composition directory through check, snapshot or render live in `test/e2e/`. The bad-film corpus lives in `test/fixtures/bad/<kind>/`, with at least one film for every kind of breakage, and every one must be caught.
- A commit with new behavior or a bug fix comes with a test.
- Unit tests do not go online. Tests that use the browser copy their fixture into a temp directory first, and never write `.flipbook/` or `out/` into the repository.

## Commits

- [Conventional Commits](https://www.conventionalcommits.org): `type(scope): imperative summary`, at most 72 characters, no trailing period.
- One commit does one thing, and the project still builds and passes its tests after every commit. Refactoring and formatting never mix with behavior changes.
- 4-space indentation, managed by Biome.
