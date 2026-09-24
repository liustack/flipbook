# Templates

## Objects assemble a glyph

N objects fly in one after another and land on slots packed inside a digit, a letter or a Chinese character, each landing on a mark cue. The camera eases in while the finished glyph rests, then the film cuts to a title.

Sample image: `docs/samples/templates.png` in the flipbook repository and npm package. Full example with bird eggs: `examples/eggs-five/` (`five` builds a 5, `shu` builds 书).

The JavaScript snippets below run inside a 640×360 page with `<canvas id="stage">` and this timeline:

<!-- snippet-timeline -->
```json
{
    "version": 1,
    "width": 640,
    "height": 360,
    "fps": 12,
    "seed": 21,
    "bpm": 90,
    "beatsPerBar": 4,
    "scenes": [{ "id": "gather", "bars": 2 }],
    "cues": [
        { "id": "drop-01", "scene": "gather", "beat": 0, "kind": "mark" },
        { "id": "drop-02", "scene": "gather", "beat": 0.5, "kind": "mark" },
        { "id": "drop-03", "scene": "gather", "beat": 1, "kind": "mark" },
        { "id": "drop-04", "scene": "gather", "beat": 1.5, "kind": "mark" },
        { "id": "drop-05", "scene": "gather", "beat": 2, "kind": "mark" },
        { "id": "drop-06", "scene": "gather", "beat": 2.25, "kind": "mark" },
        { "id": "drop-07", "scene": "gather", "beat": 2.75, "kind": "mark" },
        { "id": "drop-08", "scene": "gather", "beat": 3, "kind": "mark" },
        { "id": "drop-09", "scene": "gather", "beat": 3.25, "kind": "mark" },
        { "id": "drop-10", "scene": "gather", "beat": 3.5, "kind": "mark" },
        { "id": "drop-11", "scene": "gather", "beat": 3.75, "kind": "mark" },
        { "id": "drop-12", "scene": "gather", "beat": 4, "kind": "mark" }
    ]
}
```

## Steps

1. In `timeline.json`, write one `mark` cue per object. Give the ids a shared prefix (`egg-01`, `egg-02` ...) and rising beats: sparse at first, closer toward the end, the last landing one or two bars before the scene ends. This prints such cues for 34 objects landing from beat 0 to beat 5.25 of scene `gather`:

   ```bash
   node -e 'const n=34,from=0,to=5.25;console.log(Array.from({length:n},(_,i)=>`{ "id": "egg-${String(i+1).padStart(2,"0")}", "scene": "gather", "beat": ${Math.round((from+(to-from)*(1-(1-i/(n-1))**1.7))*4)/4}, "kind": "mark" }`).join(",\n"))'
   ```

2. In `setup()`, in this order:
   - `markTimes(tl, 'egg-')`: the landing times, one per cue, snapped to frames.
   - `glyphMask({ text, font, box, grow })`: the glyph as a grid of inside cells, fitted to `box`.
   - `packSlots(mask, { count: times.length, seed })`: round slots of varied size that fill the glyph, each turned along its stroke.
   - `orderSlots(slots, 'random', seed)`: the landing order. Also `'reading'`, `'size'` (largest first), `'radial'` (center out).
   - `assemble({ slots, times, draw, stage, seed })`: draws every object once into a cached sprite.
3. In `seek(t)`, call `assembly.draw(ctx, t)`.
4. After the last landing, keep the picture moving (a slow scale of 1 to 1.03 around the glyph center) or mark the scene `hold`.

Without sound effects, skip the cues and use `paceTimes(tl, { count, from, to })` for the times (beats from the composition start).

## The object drawer

`draw` is `(ctx, piece) => void`, or an array of them (picked per object by seed). It runs once per object in `setup()`:

- Draw centered on `(0, 0)`, the object's length along x, filling `piece.width` by `piece.height`.
- `piece.seed` gives each object its own look: `rng(piece.seed)`.
- `piece.light` is the unit vector toward the light in the object's own coordinates. Put highlights toward it and shading away from it.
- Draw anything: fills, gradients, `stipple`, `halftone`, `pencil`, images from `assets/`.

## Options

| Call | Option (default) | Meaning |
|---|---|---|
| `glyphMask` | `font` (`900 100px "Noto Serif SC"`) | a flipbook font, the size is ignored |
| | `grow` (0) | px added around every stroke, round corners |
| | `cell` (4) | sampling pitch in px |
| `packSlots` | `count` | slots to pack |
| | `minRadius`, `maxRadius` | fixed sizes, default sized so `count` slots fill the glyph |
| | `gap` (8% of the mean radius) | room between objects |
| | `wander` (0.35) | radians the angle strays from the stroke direction |
| `assemble` | `size` (length 2.2 r, width 1.7 r) | `(slot, i) => ({ width, height })` |
| | `flight` (0.6) | seconds from entering the frame to landing |
| | `from` (`'outside'`) | `'outside'` flies in from past the nearest frame edge, `'above'` drops from the top, or `(slot, i) => [x, y]` |
| | `spin` (0.7), `bow` (0.12), `settle` (0.05) | turn during the flight, sideways curve of the path, rocking after landing |
| | `ease` (`ease.outCubic`) | the flight's easing |
| | `shadow` (`{ blur: 3, offset: [2, 3], opacity: 0.35 }`) | a soft shadow that tightens on landing, `false` for none |
| | `light` (`[-0.55, -0.83]`) | direction toward the light on the stage |

`assembly.at(t)` returns each object's `{ index, x, y, angle, scale, lift, landed }` for custom drawing. `assembly.landed(t)` counts the landed objects.

## Sizes that read

For a glyph about 900 px tall on a 1920x1080 stage:

| Glyph | `count` | `grow` | Font |
|---|---|---|---|
| a digit or a Latin letter | 30 to 40 | 30 to 40 | `"LXGW WenKai"` 400 or `"Noto Serif SC"` 900 |
| a Chinese character | 60 to 90 | 12 to 20 | `"LXGW WenKai"` 400 |

Scale `grow` with the glyph height. Look at the finished glyph on the snapshot contact sheet. When it does not read, raise `count` and lower `grow` first.

<!-- check: pass -->
```js
import {
  composition, timeline, setupCanvas, paperLayer, markTimes, glyphMask, packSlots,
  orderSlots, assemble, stipple, rng, shade, ease, progress,
} from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
const times = markTimes(tl, 'drop-');
const box = { x: 220, y: 20, width: 200, height: 320 };
const colors = ['#b9b99a', '#d3a15f', '#a9b3a1', '#e0d2a2'];
let pebbles;

function pebble(c, piece) {
  const r = rng(piece.seed);
  const base = colors[Math.floor(r.next() * colors.length)];
  const shape = new Path2D();
  shape.ellipse(0, 0, piece.width / 2, piece.height / 2, 0, 0, Math.PI * 2);
  c.fillStyle = base;
  c.fill(shape);
  const [lx, ly] = piece.light;
  stipple(c, { x: -piece.width / 2, y: -piece.height / 2, width: piece.width, height: piece.height }, {
    clip: shape, seed: piece.seed, cell: 2, color: shade(base, -0.6),
    tone: (x, y) => 0.15 - ((x * lx + y * ly) / piece.width) * 0.9,
  });
}

composition({
  setup() {
    paperLayer(tl.width, tl.height, { seed: tl.seed });
    const mask = glyphMask({ text: '5', font: '400 100px "LXGW WenKai"', box, grow: 14 });
    const slots = orderSlots(packSlots(mask, { count: times.length, seed: tl.seed }), 'random', tl.seed);
    pebbles = assemble({ slots, times, draw: pebble, stage: tl, seed: tl.seed });
  },
  seek(t) {
    const push = 1 + 0.03 * ease.inOutSine(progress(t, times[times.length - 1], tl.durationSec));
    ctx.clearRect(0, 0, tl.width, tl.height);
    ctx.save();
    ctx.translate(320, 180);
    ctx.scale(push, push);
    ctx.translate(-320, -180);
    pebbles.draw(ctx, t);
    ctx.restore();
  },
});
```
