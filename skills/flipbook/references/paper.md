# Paper

The paper skin is the default look: warm stock under the picture and a grain overlay over it, both drawn once in `setup()`.

Sample image: `docs/samples/paper.png` in the flipbook repository, https://github.com/liustack/flipbook/blob/main/docs/samples/paper.png.

The JavaScript snippets below run inside a 640×360 page with `<canvas id="stage">` and this timeline:

<!-- snippet-timeline -->
```json
{
    "version": 1,
    "width": 640,
    "height": 360,
    "fps": 12,
    "seed": 5,
    "bpm": 120,
    "beatsPerBar": 4,
    "scenes": [{ "id": "main", "bars": 2 }]
}
```

## Two layers

- `paperLayer(width, height, options)` puts a canvas marked `data-flipbook-layer="paper"` first in `<body>` and draws the stock on it.
- `grainLayer(width, height, options)` puts a transparent canvas, marked the same way, last in `<body>`. Its tooth and dust lie over everything.
- Call both in `setup()`, `grainLayer` after every content element exists. Give content elements no `z-index`, so the grain stays on top.
- Never redraw them in `seek()`.

<!-- check: pass -->
```js
import { composition, timeline, setupCanvas, paperLayer, grainLayer, PAPER, ease, progress } from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);

composition({
  setup() {
    paperLayer(tl.width, tl.height, { seed: tl.seed, color: PAPER.beige });
    grainLayer(tl.width, tl.height, { seed: tl.seed });
  },
  seek(t) {
    const p = ease.inOutSine(progress(t, 0, tl.durationSec));
    ctx.clearRect(0, 0, tl.width, tl.height);
    ctx.fillStyle = '#2b2622';
    ctx.beginPath();
    ctx.ellipse(120 + p * 400, 180, 60, 46, -0.3, 0, Math.PI * 2);
    ctx.fill();
  },
});
```

## Stock

Options of `paperLayer` and `drawPaper`:

| Option | Default | Meaning |
|---|---|---|
| `color` | `PAPER.beige` | base color, `#rrggbb` |
| `seed` | `1` | same seed, same stock |
| `mottle` | `1` | soft clouds of lighter and darker stock, 0 to 2 |
| `fibers` | `1` | short pale fibers, 0 to 3 |
| `specks` | `1` | light and dark specks, 0 to 3 |
| `grain` | `1` | fine tooth, 0 to 3 |
| `grid` | none | `true`, or `{ spacing, major, color, opacity, width, x, y }` for grid paper |
| `vignette` | `0` | darker corners, 0 to 1 |

| Preset | Color | Use for |
|---|---|---|
| `PAPER.cream` | `#efe5d0` | anything with a lot of text |
| `PAPER.ivory` | `#f5f0e5` | a light, almost white page |
| `PAPER.beige` | `#cfbd9f` | the default, museum plates, specimens, archive scans |
| `PAPER.sage` | `#b9bca3` | botanical subjects |
| `PAPER.clay` | `#b86b4e` | a strong ground, with light grid lines or light type |

Grid paper:

<!-- check: pass -->
```js
import { composition, timeline, setupCanvas, paperLayer, grainLayer, PAPER, pencil, ellipsePoints } from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);

composition({
  setup() {
    paperLayer(tl.width, tl.height, {
      seed: tl.seed,
      color: PAPER.clay,
      grid: { spacing: 24, major: 4, color: '#f6ead8', opacity: 0.35 },
    });
    grainLayer(tl.width, tl.height, { seed: tl.seed });
  },
  seek(t) {
    ctx.clearRect(0, 0, tl.width, tl.height);
    pencil(ctx, ellipsePoints(320, 180, 110 + t * 10, 80, t * 0.2), { closed: true, color: '#fbf4e8', width: 2.4 });
  },
});
```

## Grain overlay

Options of `grainLayer` and `drawGrain`:

| Option | Default | Meaning |
|---|---|---|
| `seed` | `1` | |
| `amount` | `1` | tooth over everything below, 0 to 3 |
| `dust` | `1` | light and dark dust, 0 to 3 |
| `vignette` | `0` | darker corners over the whole picture, 0 to 1 |
| `ink` | `#3a2a18` | tint of the dark grain and the vignette |

## Stock inside your own canvas

`drawPaper(ctx, width, height, options)` fills `(0, 0, width, height)` under the context's transform and nothing outside it. `drawGrain` does the same for the overlay. Use them with `staticLayer()` for a card or panel that moves:

<!-- check: pass -->
```js
import { composition, timeline, setupCanvas, paperLayer, staticLayer, drawPaper, PAPER, lerp, ease, progress } from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
let card;

composition({
  setup() {
    paperLayer(tl.width, tl.height, { seed: tl.seed });
    card = staticLayer(200, 140, (c) => drawPaper(c, 200, 140, { seed: 2, color: PAPER.sage, vignette: 0.5 }));
  },
  seek(t) {
    const p = ease.outCubic(progress(t, 0, tl.durationSec));
    ctx.clearRect(0, 0, tl.width, tl.height);
    ctx.save();
    ctx.translate(lerp(60, 380, p), 110);
    ctx.rotate(lerp(-0.2, 0.05, p));
    ctx.shadowColor = 'rgba(40, 28, 16, 0.3)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 4;
    card.blit(ctx);
    ctx.restore();
  },
});
```

## Speed

Fine texture slows capture. `grain: 0` on the stock together with `amount: 0` on the overlay renders about twice as fast. Use them when a long film renders too slowly and the tooth can go.
