# Riso

A risograph print is pulled from one drum per ink: two or three bright spot inks, flat shapes, a third color wherever two inks cross, tints as dots or grain, ink that lies a little unevenly, and drums that never quite line up. `riso()` prints a picture that way, every frame.

Sample image: `docs/samples/riso.png` in the flipbook repository, https://github.com/liustack/flipbook/blob/main/docs/samples/riso.png. Left to right: two inks overprinting, a two-ink drawing out of register, and the three screens.

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

## The press

`riso(width, height, options)` builds a press once, outside `seek()`. `press.print(ctx, draw, { t })` pulls one print onto `ctx`: it clears a plate per ink, calls `draw(plates)` with one context per ink, then lays each ink down over what is on `ctx` by multiplying.

- **On a plate, only how opaque a mark is counts**: an opaque mark is solid ink, `globalAlpha = 0.4` or an `rgba` gradient is a tint. Draw in any color.
- **Paper**: draw it on the paper layer (`paperLayer()`, or a canvas marked `data-flipbook-layer="paper"`) and give the canvas you print on `mix-blend-mode: multiply`, so the inks multiply with the paper too. Never draw the paper on a plate.
- **Printed on twos**: pass `t: onTwos(time, tl.fps)`. Each drawing then takes the ink its own way and the drums wander a little, like a flipbook of real prints.

| Option | Meaning | Default |
|---|---|---|
| `inks` | ink name to color, or to `{ color, screen, cell, angle }`, in printing order | required |
| `screen` | how tints print: `'grain'` (fine random grain), `'halftone'` (dots on a turned grid), `'solid'` (as drawn) | `'grain'` |
| `cell`, `angle` | halftone dot pitch in CSS px, screen angle in degrees | 5, then 15, 75, 45, 0 by ink |
| `coverage` | the most ink a solid lays down: the paper always shows through a little | 0.85 |
| `misregister` | how far each drum sits off true, CSS px, fixed for the film | 2.5 |
| `jitter` | how far each drum wanders from one drawing to the next, CSS px | 0.8 |
| `mottle` | how unevenly the ink lies, 0 to 1 | 0.5 |
| `seed` | picks the misregistration, the jitter and the mottle | 1 |

`press.offset(ink, t)` tells where a drum sits at t, for lining something else up with it. The press rounds it to whole device pixels when it lays the plate down, so dots and grain stay sharp.

## Inks

`RISO_INKS` holds the standard riso inks as the riso community lists them: `black`, `burgundy`, `blue`, `green`, `mediumBlue`, `brightRed`, `purple`, `teal`, `red`, `brown`, `yellow`, `orange`, `fluorescentPink`, `lightGray`, `cornflower`, `violet`. Real inks are rice based and slightly transparent, so the colors are close, not exact.

- Two or three inks. Plan the picture around where they cross: `fluorescentPink` over `blue` prints a deep purple, `yellow` over `blue` a green, `yellow` over `fluorescentPink` a red orange.
- Print the lightest ink first, and draw a shape in the one ink whose crossing color you want, not in a mixed color.
- Light paper: cream or off white. On dark paper the inks vanish.
- Dark line work in `blue`, `black` or `mediumBlue`, fills in the light inks. Out of register, the fill slipping out of its lines is the look.

## Words

Put titles in the DOM, in an ink color, with `mix-blend-mode: multiply`: they print over the picture like one more ink and stay checkable text.

## Example

<!-- check: pass -->
```js
import { composition, ease, onTwos, paperLayer, progress, riso, RISO_INKS, setupCanvas, timeline } from '/__flipbook/runtime.js';

const tl = await timeline();
const stage = document.getElementById('stage');
stage.style.mixBlendMode = 'multiply';
const ctx = setupCanvas(stage, tl.width, tl.height);
const press = riso(tl.width, tl.height, {
  seed: tl.seed,
  inks: {
    yellow: RISO_INKS.yellow,
    pink: RISO_INKS.fluorescentPink,
    blue: { color: RISO_INKS.blue, screen: 'halftone' },
  },
});

composition({
  setup() {
    paperLayer(tl.width, tl.height, { seed: tl.seed, color: '#f3eee3' });
  },
  seek(time) {
    const t = onTwos(time, tl.fps);
    const rise = ease.outCubic(progress(t, 0, tl.durationSec * 0.7));
    ctx.clearRect(0, 0, tl.width, tl.height);
    press.print(ctx, (p) => {
      // The sun rises pink through a yellow sky tint, behind blue hills.
      p.yellow.globalAlpha = 0.35;
      p.yellow.fillRect(0, 0, tl.width, 250);
      p.pink.beginPath();
      p.pink.arc(320, 290 - 150 * rise, 80, 0, Math.PI * 2);
      p.pink.fill();
      p.blue.beginPath();
      p.blue.moveTo(0, 360);
      p.blue.quadraticCurveTo(160, 190, 330, 260);
      p.blue.quadraticCurveTo(480, 200, 640, 250);
      p.blue.lineTo(640, 360);
      p.blue.closePath();
      p.blue.fill();
    }, { t });
  },
});
```
