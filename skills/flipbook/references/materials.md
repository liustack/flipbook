# Materials

Hand-made marks for canvas drawing: pencil lines, hatching, cross-hatching, halftone dots, stipple and torn paper.

Sample image: `docs/samples/materials.png` in the flipbook repository and npm package.

The JavaScript snippets in this file run through `flipbook check` in CI against this timeline:

<!-- snippet-timeline -->
```json
{
    "version": 1,
    "width": 640,
    "height": 360,
    "fps": 12,
    "seed": 8,
    "bpm": 120,
    "beatsPerBar": 4,
    "scenes": [{ "id": "main", "bars": 2 }]
}
```

## Rules

- Every material draws the same pixels for the same arguments. Call them straight from `seek(t)`. Change `seed` for a different mark with the same settings.
- Hatching, halftone and stipple sit on the canvas grid: over a moving box they stay on the paper while the box moves. For marks that travel with an object, draw the object once with `staticLayer()` in `setup()` and blit it each frame.
- Each call strokes or fills once, so thousands of strokes per frame are fine.
- A `Field` is a number, or a function `(x, y) => number` of canvas CSS px.
- A `box` is `{ x, y, width, height }`. A point is `[x, y]`.

## Calls

| Call | Draws | Options (default) |
|---|---|---|
| `pencil(ctx, points, options)` | a graphite line along the points | `width` 1.8, `passes` 2, `wobble` 1.2, `grain` 0.4, `opacity` 0.85, `color`, `closed`, `seed` |
| `hatch(ctx, box, options)` | short parallel strokes, returns the stroke count | `spacing` 8, `length` 16, `angle` -0.9 (Field), `tone` 0.5 (Field), `width` 1, `opacity` 0.7, `jitter` 0.6, `curve` 0.1, `color`, `clip`, `seed` |
| `crossHatch(ctx, box, options)` | hatching in layers, each layer only where the tone is darker | `layers` 2, `turn` 1.1, and every `hatch` option |
| `halftone(ctx, box, options)` | a dot screen, larger dots for darker tone | `cell` 6, `angle` 0.26, `tone` 0.4 (Field), `jitter` 0.08, `opacity` 1, `color`, `clip`, `seed` |
| `stipple(ctx, box, options)` | random dots, more and larger for darker tone | `cell` 3, `tone` 0.3 (Field), `size` [0.4, 0.9], `opacity` 0.8, `color`, `clip`, `seed` |
| `tornPaper(ctx, points or box, options)` | a paper scrap with torn edges, returns the face outline as a Path2D | `roughness` 5, `detail` 3, `fill` `#f3ecdc`, `rim` `#fbf7ee`, `rimWidth` 2.5, `shadow` 0.35, `seed` |
| `tornPath(points, options)` | a closed Path2D with a torn edge | `roughness`, `detail`, `seed` |
| `ellipsePoints(cx, cy, rx, ry, rotation, steps)` | points around an ellipse | |
| `arcPoints(cx, cy, radius, a0, a1, steps)` | points along an arc | |
| `boxPoints(box)`, `resample(points, step, closed)` | a box outline, evenly spaced points | |

`tone` 0 draws nothing and 1 draws the most. `halftone` with a constant `tone` prints from a cached screen tile. `clip` limits the marks to a path.

<!-- check: pass -->
```js
import {
  composition, timeline, setupCanvas, paperLayer,
  pencil, hatch, crossHatch, halftone, stipple, tornPaper, ellipsePoints,
} from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);

composition({
  setup() {
    paperLayer(tl.width, tl.height, { seed: tl.seed });
  },
  seek(t) {
    ctx.clearRect(0, 0, tl.width, tl.height);
    pencil(ctx, ellipsePoints(110, 90, 70, 50, t * 0.3), { closed: true, seed: 1 });
    hatch(ctx, { x: 230, y: 40, width: 170, height: 110 }, { seed: 2, tone: (x) => (x - 230) / 170 });
    crossHatch(ctx, { x: 440, y: 40, width: 170, height: 110 }, { seed: 3, layers: 3, tone: (x, y) => (y - 40) / 110 });
    halftone(ctx, { x: 40, y: 200, width: 170, height: 120 }, { color: '#b04a2e', tone: (x) => (x - 40) / 170 });
    stipple(ctx, { x: 240, y: 200, width: 170, height: 120 }, { seed: 4, tone: 0.2 + 0.1 * Math.sin(t * 2) });
    tornPaper(ctx, { x: 450, y: 205, width: 150, height: 105 }, { seed: 5, fill: '#e3d3b0' });
  },
});
```

## Shading a shape

Clip the marks to the shape and compute the tone from a light direction:

<!-- check: pass -->
```js
import { composition, timeline, setupCanvas, paperLayer, crossHatch, stipple, pencil, ellipsePoints } from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);

composition({
  setup() {
    paperLayer(tl.width, tl.height, { seed: tl.seed });
  },
  seek(t) {
    const cx = 320;
    const cy = 180;
    const r = 110;
    const light = t * 0.6;
    const lx = Math.cos(light);
    const ly = Math.sin(light);
    const ball = new Path2D();
    ball.arc(cx, cy, r, 0, Math.PI * 2);
    const tone = (x, y) => 0.5 - (((x - cx) * lx + (y - cy) * ly) / r) * 0.5;
    const box = { x: cx - r, y: cy - r, width: r * 2, height: r * 2 };
    ctx.clearRect(0, 0, tl.width, tl.height);
    crossHatch(ctx, box, { seed: 6, clip: ball, tone, spacing: 6, length: 12 });
    stipple(ctx, box, { seed: 7, clip: ball, tone: (x, y) => tone(x, y) * 0.6, cell: 2.5 });
    pencil(ctx, ellipsePoints(cx, cy, r, r), { closed: true, seed: 8 });
  },
});
```

## A textured object that moves

Draw it once, move the copy:

<!-- check: pass -->
```js
import { composition, timeline, setupCanvas, paperLayer, staticLayer, halftone, pencil, ellipsePoints, lerp, ease, progress } from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
let pebble;

composition({
  setup() {
    paperLayer(tl.width, tl.height, { seed: tl.seed });
    pebble = staticLayer(160, 120, (c) => {
      const shape = new Path2D();
      shape.ellipse(80, 60, 70, 50, 0, 0, Math.PI * 2);
      c.fillStyle = '#b9b99a';
      c.fill(shape);
      halftone(c, { x: 0, y: 0, width: 160, height: 120 }, { clip: shape, cell: 4, color: '#3a3a2e', tone: (x, y) => (x + y) / 400 });
      pencil(c, ellipsePoints(80, 60, 70, 50), { closed: true, seed: 2 });
    });
  },
  seek(t) {
    const p = ease.inOutCubic(progress(t, 0, tl.durationSec));
    ctx.clearRect(0, 0, tl.width, tl.height);
    ctx.save();
    ctx.translate(lerp(60, 420, p), 120);
    pebble.blit(ctx);
    ctx.restore();
  },
});
```
