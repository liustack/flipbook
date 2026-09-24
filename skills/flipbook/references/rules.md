# Composition rules

A composition is a directory with `index.html`, `timeline.json` and optionally `assets/`. flipbook opens the page at `http://flipbook.local/index.html`, calls `seek(t)` for every frame and screenshots the result. The picture at time `t` must depend on `t` and nothing else.

Every snippet in this file runs through `flipbook check` in CI. JavaScript snippets run inside a 640×360 page with `<canvas id="stage">` and this timeline:

<!-- snippet-timeline -->
```json
{
    "version": 1,
    "width": 640,
    "height": 360,
    "fps": 12,
    "seed": 42,
    "bpm": 120,
    "beatsPerBar": 4,
    "scenes": [
        { "id": "intro", "bars": 1 },
        { "id": "main", "bars": 1 }
    ],
    "cues": [
        { "id": "title", "scene": "main", "beat": 0, "kind": "text", "text": "你好，flipbook", "settleBeats": 1 }
    ]
}
```

## The contract

The page defines `window.__flipbook = { protocol: 1, ready, seek(t) }`. Use `composition()` from the runtime, which builds it:

- `ready` loads every font, decodes every `<img>`, then runs your `setup()`.
- `seek(t)` receives seconds (`frame / fps`). It may be `async`, must finish within 10 seconds and must not wait for `requestAnimationFrame`, timers or events.

<!-- check: pass -->
```js
import { composition, timeline, setupCanvas, ease, progress } from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);

composition({
  seek(t) {
    const p = ease.inOutCubic(progress(t, 0, tl.durationSec));
    ctx.clearRect(0, 0, tl.width, tl.height);
    ctx.fillStyle = '#c8452d';
    ctx.fillRect(40 + p * (tl.width - 160), tl.height / 2 - 40, 80, 80);
  },
});
```

The runtime is an ES module at `/__flipbook/runtime.js`. Import it from a `<script type="module">`. It exists only while flipbook runs the page, so there is no double-click preview: look at frames with `flipbook snapshot`.

## Stage and layers

- Size `html` and `body` to the timeline `width` and `height` in CSS pixels, with `overflow: hidden`.
- Three layers, bottom to top: a paper layer (background, texture), the content (canvas drawing, DOM text, SVG), a grain layer. Mark the paper and grain layers with `data-flipbook-layer="paper"`. check and render hide everything else to capture a paper-only baseline and to catch frames where the content never drew.
- Draw anything that does not change (paper, grain, a background illustration) once in `setup()` with `staticLayer()` and blit it. Redraw only what moves in `seek()`.

<!-- check: pass -->
```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 640px; height: 360px; overflow: hidden; background: #f4efe4; }
  .layer { position: absolute; left: 0; top: 0; }
  #title { position: absolute; left: 0; right: 0; top: 130px; margin: 0; text-align: center;
           font: 600 48px/1.2 "Noto Serif SC"; color: #2b2622; }
</style>
</head>
<body>
<canvas id="paper" class="layer" data-flipbook-layer="paper"></canvas>
<canvas id="ink" class="layer"></canvas>
<h1 id="title">你好，flipbook</h1>
<canvas id="grain" class="layer" data-flipbook-layer="paper"></canvas>
<script type="module">
import { composition, timeline, setupCanvas, staticLayer, rng, cueProgress, ease } from '/__flipbook/runtime.js';

const tl = await timeline();
const W = tl.width;
const H = tl.height;
const ink = setupCanvas(document.getElementById('ink'), W, H);
const title = document.getElementById('title');

composition({
  setup() {
    const paper = staticLayer(W, H, (ctx) => {
      ctx.fillStyle = '#f4efe4';
      ctx.fillRect(0, 0, W, H);
    });
    paper.blit(setupCanvas(document.getElementById('paper'), W, H));
    const r = rng(tl.seed);
    const grain = staticLayer(W, H, (ctx) => {
      for (let i = 0; i < 2000; i++) {
        ctx.fillStyle = `rgba(60, 40, 20, ${r.range(0.03, 0.08)})`;
        ctx.fillRect(r.range(0, W), r.range(0, H), 1, 1);
      }
    });
    grain.blit(setupCanvas(document.getElementById('grain'), W, H));
  },
  seek(t) {
    ink.clearRect(0, 0, W, H);
    ink.fillStyle = '#2a6f97';
    ink.beginPath();
    ink.arc(80 + t * 120, 280, 24, 0, Math.PI * 2);
    ink.fill();
    title.style.opacity = String(ease.outCubic(cueProgress(tl, t, 'title')));
  },
});
</script>
</body>
</html>
```

## Size and resolution

Write the composition in CSS pixels equal to the timeline `width` and `height`. Create every canvas with `setupCanvas(canvas, width, height)`: it sizes the backing store for the device pixel ratio and returns a context that draws in CSS pixels, so the same code serves any output scale.

## Time comes from t and the timeline

Take every position, opacity and cut from `t` and the resolved timeline:

| Helper | Returns |
|---|---|
| `await timeline()` | seconds and frames for every scene and cue, plus `width`, `height`, `fps`, `seed`, `durationSec` |
| `sceneAt(tl, t)` | the scene playing at `t`, its `progress` (0 to 1), `local` seconds, `beat`, `localBeat` |
| `sceneProgress(tl, t, id)` | 0 before the scene, 1 after it |
| `cueProgress(tl, t, id)` | 0 at the cue, 1 once it settles (`settleBeats` later, at once when `settleBeats` is 0 or missing) |
| `transitionOut(tl, t, id, beats)` | 0 until `beats` before the scene ends, 1 at the cut |
| `ease.*`, `progress`, `lerp`, `remap`, `clamp`, `smoothstep` | easing and interpolation |
| `onTwos(t, fps)`, `onFrames(t, fps, n)` | a time that only changes every 2 (or n) frames, for a hand-drawn cadence |

<!-- check: pass -->
```js
import { composition, timeline, setupCanvas, sceneAt, lerp, ease } from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
const colors = { intro: '#c8452d', main: '#2a6f97' };

composition({
  seek(t) {
    const { scene, progress, localBeat } = sceneAt(tl, t);
    const pulse = 1 - ease.outCubic(localBeat % 1);
    const size = 60 + 30 * pulse;
    ctx.clearRect(0, 0, tl.width, tl.height);
    ctx.fillStyle = colors[scene.id];
    ctx.fillRect(lerp(60, tl.width - 60 - size, progress), tl.height / 2 - size / 2, size, size);
  },
});
```

## Forbidden

check looks for these by sampling: it draws a few frames again under a moved clock, a changed random seed and a different seek order, and it counts every call to the clock and random functions while the page runs (`forbidden-api-call`). The source scan warns about them too. Sampling can miss a case, and code in a Worker or an iframe is not counted, so follow this table even when check passes.

| Do not | Do instead |
|---|---|
| `Date.now()`, `new Date()`, `performance.now()` | `t` |
| `Math.random()`, `crypto.getRandomValues()` | `rng(seed)` or `rand(seed, ...keys)` |
| state carried between frames (`x += v`, pushing to arrays, appending DOM) | compute from `t`, or bake a table in `setup()` |
| `setTimeout`, `setInterval`, `requestAnimationFrame` | draw in `seek(t)` |
| CSS `animation`, `transition`, `@keyframes` | set styles from `t` in `seek()` |
| awaiting `requestAnimationFrame`, timers or events inside `seek()` | finish drawing before `seek()` returns |
| network requests | files in the composition directory |
| `<video>`, `<iframe>`, `loading="lazy"`, `content-visibility: auto`, OffscreenCanvas in a Worker, `desynchronized: true` | images in `assets/`, plain canvases |

Reading the clock fails check with `clock-dependent`:

<!-- check: fail clock-dependent -->
```js
import { composition, setupCanvas } from '/__flipbook/runtime.js';

const ctx = setupCanvas(document.getElementById('stage'), 640, 360);

composition({
  seek() {
    const x = (Date.now() / 5) % 560;
    ctx.clearRect(0, 0, 640, 360);
    ctx.fillStyle = '#c8452d';
    ctx.fillRect(x, 140, 80, 80);
  },
});
```

Unseeded randomness fails with `random-dependent`:

<!-- check: fail random-dependent -->
```js
import { composition, setupCanvas } from '/__flipbook/runtime.js';

const ctx = setupCanvas(document.getElementById('stage'), 640, 360);
const stars = Array.from({ length: 30 }, () => [Math.random() * 620, Math.random() * 340]);

composition({
  seek(t) {
    ctx.clearRect(0, 0, 640, 360);
    ctx.fillStyle = '#2b2622';
    for (const [x, y] of stars) ctx.fillRect(x, y + t * 5, 6, 6);
  },
});
```

The seeded version passes. `rng(seed)` gives a sequence, `rand(seed, ...keys)` gives one number from its keys:

<!-- check: pass -->
```js
import { composition, timeline, setupCanvas, rng, rand } from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
const r = rng(tl.seed);
const stars = Array.from({ length: 30 }, () => [r.range(0, 620), r.range(0, 340)]);

composition({
  seek(t) {
    ctx.clearRect(0, 0, tl.width, tl.height);
    stars.forEach(([x, y], i) => {
      const twinkle = rand(tl.seed, i, Math.floor(t * 4));
      ctx.fillStyle = `rgba(43, 38, 34, ${0.4 + 0.6 * twinkle})`;
      ctx.fillRect(x, y + t * 5, 6, 6);
    });
  },
});
```

State carried from frame to frame fails with `seek-order-dependent`, because check draws the same frames in two different orders:

<!-- check: fail seek-order-dependent -->
```js
import { composition, setupCanvas } from '/__flipbook/runtime.js';

const ctx = setupCanvas(document.getElementById('stage'), 640, 360);
let x = 0;

composition({
  seek() {
    x = (x + 23) % 560;
    ctx.clearRect(0, 0, 640, 360);
    ctx.fillStyle = '#2a6f97';
    ctx.fillRect(x, 140, 80, 80);
  },
});
```

Waiting for a frame inside `seek()` never returns under flipbook's clock and fails with `seek-timeout`:

<!-- check: fail seek-timeout -->
```js
import { composition, setupCanvas } from '/__flipbook/runtime.js';

const ctx = setupCanvas(document.getElementById('stage'), 640, 360);

composition({
  async seek(t) {
    ctx.clearRect(0, 0, 640, 360);
    ctx.fillStyle = '#2a6f97';
    ctx.fillRect(40 + t * 100, 140, 80, 80);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  },
});
```

Network requests are blocked and fail with `external-request`:

<!-- check: fail external-request -->
```js
import { composition, setupCanvas } from '/__flipbook/runtime.js';

const ctx = setupCanvas(document.getElementById('stage'), 640, 360);
const data = await fetch('https://example.com/data.json').then((r) => r.json(), () => ({ x: 40 }));

composition({
  seek(t) {
    ctx.clearRect(0, 0, 640, 360);
    ctx.fillStyle = '#2a6f97';
    ctx.fillRect(data.x + t * 100, 140, 80, 80);
  },
});
```

CSS animation renders deterministically under flipbook but still draws a warning. Drive the same style from `t` instead:

<!-- check: warn static-forbidden -->
```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 640px; height: 360px; overflow: hidden; background: #f4efe4; }
  #box { position: absolute; left: 40px; top: 140px; width: 80px; height: 80px; background: #c8452d;
         animation: slide 4s linear forwards; }
  @keyframes slide { to { transform: translateX(480px); } }
</style>
</head>
<body>
<div id="box"></div>
<script type="module">
import { composition } from '/__flipbook/runtime.js';
composition({ seek() {} });
</script>
</body>
</html>
```

## Simulations

Anything that cannot jump to a time (physics, growth, flocking) is computed once in `setup()` at a fixed step per frame and looked up in `seek()`:

<!-- check: pass -->
```js
import { composition, timeline, setupCanvas } from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
const heights = [];

composition({
  setup() {
    let y = 40;
    let v = 0;
    for (let i = 0; i < tl.frameCount; i++) {
      heights.push(y);
      v += 1200 / tl.fps;
      y += v / tl.fps;
      if (y > 300) {
        y = 300;
        v = -v * 0.75;
      }
    }
  },
  seek(t) {
    const y = heights[Math.min(heights.length - 1, Math.round(t * tl.fps))];
    ctx.clearRect(0, 0, tl.width, tl.height);
    ctx.fillStyle = '#c8452d';
    ctx.beginPath();
    ctx.arc(80 + t * 120, y, 20, 0, Math.PI * 2);
    ctx.fill();
  },
});
```

## Text

- On-screen text goes in the DOM, or on a canvas through the runtime's `fillText()` (which registers the text so check can inspect it). Text drawn any other way is not checked.
- Use only flipbook's fonts: `"Noto Serif SC"` (`FONTS.serif`, weights 200 to 900) and `"LXGW WenKai"` (`FONTS.hand`, weight 400). Both cover Chinese and Latin. Other font names fall back to system fonts and fail with `font-fallback`. Characters neither font has fail with `missing-glyph`. Canvas text is checked character by character against the families in `ctx.font`, in order: a character the named font lacks fails with `font-fallback` even when the other flipbook font has it, so list both (`"Noto Serif SC", "LXGW WenKai"`) when in doubt.
- At the moment each text cue settles, check measures every line: past the frame edge is an error (`text-offstage`), inside the outer 5% margin is a warning (`text-safe-area`), contrast below 3:1 against what is behind it is a warning (`low-contrast`). Contrast is measured for DOM text only: text drawn on a canvas is listed under `check.contrastSkipped`, so judge its contrast yourself on the contact sheet. DOM text that cannot be told apart from its background also gets `low-contrast`, with `detail.measured: false`.
- Text that bleeds off the frame on purpose carries `data-flipbook-allow-overflow` (DOM) or `allowOverflow: true` (canvas).
- Text laid out entirely off the frame counts as offstage too. Text waiting outside for a later scene stays hidden (`display: none`, `visibility: hidden` or `opacity: 0`) until it enters.

<!-- check: pass -->
```js
import { composition, timeline, setupCanvas, fillText, FONTS, cueProgress, ease } from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);

composition({
  seek(t) {
    ctx.clearRect(0, 0, tl.width, tl.height);
    ctx.fillStyle = '#2a6f97';
    ctx.fillRect(40 + t * 100, 260, 50, 50);
    ctx.globalAlpha = ease.outCubic(cueProgress(tl, t, 'title'));
    ctx.font = `600 44px "${FONTS.serif}"`;
    ctx.fillStyle = '#2b2622';
    ctx.textAlign = 'center';
    fillText(ctx, '你好，flipbook', tl.width / 2, 170, { id: 'title' });
    ctx.globalAlpha = 1;
  },
});
```

<!-- check: pass -->
```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 640px; height: 360px; overflow: hidden; background: #f4efe4; }
  #word { position: absolute; left: 420px; top: 90px; margin: 0; white-space: nowrap;
          font: 700 160px/1 "Noto Serif SC"; color: #c8452d; }
  #caption { position: absolute; left: 48px; top: 280px; margin: 0; font: 400 28px/1.2 "LXGW WenKai"; color: #2b2622; }
</style>
</head>
<body>
<p id="word" data-flipbook-allow-overflow>出画</p>
<p id="caption">这行字留在安全区里</p>
<script type="module">
import { composition, timeline } from '/__flipbook/runtime.js';

const tl = await timeline();
const word = document.getElementById('word');

composition({
  seek(t) {
    word.style.transform = `translateX(${-t * 40}px)`;
  },
});
</script>
</body>
</html>
```

## Images

Put images in `assets/` and load them by relative path (`assets/egg.png`). Record where each came from and its license in `assets/SOURCES.json`. `ready` decodes every `<img>` before the first frame. Images from the network are blocked. Inline `data:` URLs also work:

<!-- check: pass -->
```js
import { composition, timeline, setupCanvas } from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="50" fill="#2a6f97"/></svg>';
const img = new Image();
img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;

composition({
  async setup() {
    await img.decode();
  },
  seek(t) {
    ctx.clearRect(0, 0, tl.width, tl.height);
    ctx.drawImage(img, 40 + t * 110, 120);
  },
});
```
