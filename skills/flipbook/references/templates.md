# Templates

A template carries one device through a whole film. Pick at most one per film:

| Template | Use it when |
|---|---|
| [Objects assemble a glyph](#objects-assemble-a-glyph) | objects land one by one and build a digit, a letter or a Chinese character |
| [Page turn](#page-turn) | a book opens into the first scene, a page turns between two scenes, or pages flip on the beat into an animation |
| [Lens montage](#lens-montage) | plates cut on the beat inside a round eyepiece, then the window opens onto the full frame |
| [Arc match cut](#arc-match-cut) | one arc holds still while the material above and below it changes at every cut, the cuts speed up, words ride the arc |

## Objects assemble a glyph

N objects fly in one after another and land on slots packed inside a digit, a letter or a Chinese character, each landing on a mark cue. The camera eases in while the finished glyph rests, then the film cuts to a title.

Sample image: `docs/samples/templates.png` in the flipbook repository, https://github.com/liustack/flipbook/blob/main/docs/samples/templates.png. Full example with bird eggs: `examples/eggs-five/` (`five` builds a 5, `shu` builds 书).

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

### Steps

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

### The object drawer

`draw` is `(ctx, piece) => void`, or an array of them (picked per object by seed). It runs once per object in `setup()`:

- Draw centered on `(0, 0)`, the object's length along x, filling `piece.width` by `piece.height`.
- `piece.seed` gives each object its own look: `rng(piece.seed)`.
- `piece.light` is the unit vector toward the light in the object's own coordinates. Put highlights toward it and shading away from it.
- Draw anything: fills, gradients, `stipple`, `halftone`, `pencil`, images from `assets/`.

### Options

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

### Sizes that read

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

## Page turn

A page curls up from its corner, rolls over and lands on the other side of the spine. The back of the turning page shows the front through the paper, mirrored and faint. The page underneath takes a shadow that deepens as the page rises. Three uses:

- **Transition**: the page fills the stage, page 0 draws scene A, page 1 draws scene B, one turn at the cut.
- **Opening**: a book on a desk. The cover swings open as a stiff board, the camera pushes into the right-hand page until it fills the frame, and the first scene goes on full frame.
- **Flipbook**: a turn every beat or half beat, each page one drawing. Turns longer than the gap between them keep several pages in the air at once, and the drawings play as an animation.

Sample image: `docs/samples/page-turn.png` in the flipbook repository. Full example with all three uses: `examples/page-turn/`.

### Steps

1. Turn times, in seconds: `beatTimes(tl, { from, count, every })` for one turn every `every` beats from beat `from` (counted from the composition start), or `markTimes(tl, prefix)` for one turn per mark cue.
2. Build it once, at module level or in `setup()`: `pageTurn({ box, turns, front, back, ... })`. Page 0 lies on top. Turn i turns page i over, so there are `turns.length + 1` pages.
3. In `seek(t)`, call `book.draw(ctx, t)`.

### The page drawers

`front` and `back` are `(ctx, index, t) => void`:

- Draw in page units: `(0, 0)` is the page's top left and the page is `page.width` by `page.height` (the box size when `page` is not given). Give `page` the stage size when a page shows a whole scene, as in the opening.
- Paint the whole page, background first.
- Keep the transform you are given: no `setTransform` or `resetTransform`.
- A drawer runs up to three times per frame for a turning page. Draw heavy pictures once in `setup()` with `staticLayer()` and blit them.
- `back` draws a page's back as it reads once turned, left to right. Without it the back is plain `paper`.
- Canvas text from the runtime's `fillText()` in a drawer is registered with check as usual. The mirrored copy on the back is not. Settle text cues at a moment when no page is turning over that text.

<!-- check: pass -->
```js
import { beatTimes, composition, fillText, FONTS, pageTurn, setupCanvas, timeline } from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
const colors = ['#efe5d0', '#d9e2cf', '#e8d3c9', '#d6dde6'];
const book = pageTurn({
  box: { x: 0, y: 0, width: tl.width, height: tl.height },
  turns: beatTimes(tl, { from: 1, count: 3, every: 2 }),
  duration: 0.9,
  front(c, i) {
    c.fillStyle = colors[i];
    c.fillRect(0, 0, tl.width, tl.height);
    c.fillStyle = '#2b2622';
    c.font = `600 72px "${FONTS.serif}"`;
    c.textAlign = 'center';
    fillText(c, `第${i + 1}页`, tl.width / 2, 205);
  },
});

composition({
  seek(t) {
    ctx.clearRect(0, 0, tl.width, tl.height);
    book.draw(ctx, t);
  },
});
```

### Opening a book

Give the right-hand page a `box` with the stage's proportions and `page` the stage size, so page 1 draws the first scene exactly as it will look full frame. `spread: true` keeps the opened cover lying on the left, `rigid: [0]` swings the cover as a board, `back` draws the endpaper. Then push the camera with `moveCamera(ctx, stage, from, to, amount)`: at amount 1 the box fills the frame, and the next scene takes over at full size with no jump.

<!-- check: pass -->
```js
import { composition, ease, moveCamera, pageTurn, progress, setupCanvas, timeline } from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
const stage = { x: 0, y: 0, width: tl.width, height: tl.height };
const box = { x: 320, y: 101, width: 280, height: 158 };
const book = pageTurn({
  box,
  page: { width: tl.width, height: tl.height },
  turns: [0.7],
  duration: 1.2,
  rigid: [0],
  spread: true,
  front(c, i) {
    c.fillStyle = i === 0 ? '#1f3a4b' : '#f4eee0';
    c.fillRect(0, 0, tl.width, tl.height);
    c.fillStyle = i === 0 ? '#d2b06a' : '#c8452d';
    c.beginPath();
    c.arc(tl.width / 2, tl.height / 2, 90, 0, Math.PI * 2);
    c.fill();
  },
  back(c) {
    c.fillStyle = '#d9dfdf';
    c.fillRect(0, 0, tl.width, tl.height);
  },
});

composition({
  seek(t) {
    ctx.fillStyle = '#cfbd9f';
    ctx.fillRect(0, 0, tl.width, tl.height);
    ctx.save();
    moveCamera(ctx, tl, stage, box, ease.inOutCubic(progress(t, 2.5, tl.durationSec)));
    book.draw(ctx, t);
    ctx.restore();
  },
});
```

### Options

| Option (default) | Meaning |
|---|---|
| `box` | where the page lies on the stage, its left edge is the spine |
| `turns` | start of each turn in seconds, rising |
| `duration` (0.6) | seconds per turn, one number or one per turn |
| `page` (the box size) | drawing units of a page |
| `corner` (`'bottom'`) | the corner that leads, `'bottom'` or `'top'` |
| `ease` (`ease.inOutCubic`) | pace of a turn |
| `tilt` (0.45) | slant of the fold when the corner first lifts, radians |
| `curl` (0.08) | radius of the roll at mid-turn, as a share of the page height |
| `spread` (false) | turned pages stay on the left of the spine, as in an open book |
| `rigid` (none) | indexes of pages that swing as stiff boards, such as a cover |
| `paper` (`'#f5f0e5'`) | color of a plain back |
| `showThrough` (0.14) | opacity of the mirrored front on the back |
| `shadow` (0.6) | strength of the shadows, 0 to 1 |

`book.turning(t)` lists the pages in the air with their `progress`, top page first. `book.top(t)` is the page lying flat on top of the unturned stack.

## Lens montage

Plates seen through a round eyepiece: a dark surround, a knurled ring, a vignette and color fringes at the window edge, optional scale marks. The iris can open at the start. Each plate comes up on its cut and pulls into focus. At the end the window grows until it fills the frame and the last plate becomes the whole picture.

Sample image: `docs/samples/lens-montage.png` in the flipbook repository. Full example: `examples/lens-montage/`, six specimen plates and a moon that pulls out into a dusk sky.

### Steps

1. Plate times, in seconds: `beatTimes(tl, { from, count, every })` or `markTimes(tl, prefix)`.
2. Build it once: `lens({ stage: tl, times, plate, open, pullOut, ticks })`.
3. In `seek(t)`, call `view.draw(ctx, t)`.

### The plate drawer

`plate` is `(ctx, index, info) => void`. It draws in stage coordinates around the window center and the lens clips it to the window. `info` has `index`, `t`, `local` (seconds since this plate came up), `span` (seconds it stays up), `progress` (local over span), `pull` (0 before the pull-out, 1 once the window fills the frame), `center` and `radius`.

- Draw each plate once in `setup()` with `staticLayer()`. In the drawer, blit it and keep it moving: a slow push or turn from `info.progress`.
- The last plate draws the full-frame scene the window opens onto. Pull the camera back with `info.pull`: `moveCamera(ctx, tl, near, stage, info.pull)`, where `near` is a rectangle around the subject that fills the window.

<!-- check: pass -->
```js
import { beatTimes, composition, lens, setupCanvas, timeline } from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
const colors = ['#e0b04a', '#9fc5b0', '#c9d8e5', '#e9dcc3'];
const view = lens({
  stage: tl,
  times: beatTimes(tl, { from: 0, count: 4, every: 1.5 }),
  open: 0.5,
  pullOut: [4.2, tl.durationSec],
  ticks: true,
  plate(c, i, info) {
    c.fillStyle = colors[i];
    c.fillRect(0, 0, tl.width, tl.height);
    c.strokeStyle = '#2b2622';
    c.lineWidth = 3;
    for (let k = 1; k < 8; k++) {
      c.beginPath();
      c.arc(tl.width / 2, tl.height / 2, k * 18 * (1 + 0.1 * info.progress), 0, Math.PI * 2);
      c.stroke();
    }
  },
});

composition({
  seek(t) {
    ctx.clearRect(0, 0, tl.width, tl.height);
    view.draw(ctx, t);
  },
});
```

### Options

| Option (default) | Meaning |
|---|---|
| `stage` | the stage size, `tl` works |
| `times` | when each plate comes up, seconds, rising |
| `plate` | the plate drawer |
| `center` (the stage center), `radius` (36% of the shorter side) | the window |
| `open` (0) | seconds the iris takes to open from shut at `times[0]` |
| `pullOut` (none) | `[start, end]` in seconds: the window grows until it fills the frame |
| `end` (the pull-out end) | when the last plate ends, for its `progress` |
| `rim` (0.22) | ring width as a share of the radius |
| `surround` (`'#0d0c0b'`) | color around the eyepiece |
| `vignette` (0.6), `fringe` (0.4) | darkening and color fringes at the window edge, 0 to 1 |
| `ticks` (none) | `true` or `{ count: 72, major: 6, color }` for scale marks inside the rim |
| `refocus` (0.2), `blur` (6) | seconds each plate takes to come into focus after its cut, and the blur in px at the cut. `refocus: 0` cuts sharp |

`view.plateAt(t)` is the plate up at time t. `view.windowAt(t)` gives the window `center` and `radius`.

## Arc match cut

One arc stays in the same place from shot to shot while what lies above and below it changes at every cut: an atmosphere, a droplet, a crust of bread, a leaf, a slice of agate. The shots get shorter as the film goes on. The whole picture pushes in slowly across all the shots. Words sit on the arc, one per shot or a whole line at the end.

Sample image: `docs/samples/arc-cuts.png` in the flipbook repository. Full example: `examples/arc-cuts/`, eighteen shots over twelve materials.

### Steps

1. Shot times: `accelerate(tl, { scene, count, ratio })` fills a scene with `count` shots, each shorter than the one before by the same factor, the last `ratio` times as long as the first. It snaps every cut to a frame and throws when a shot would get no frame of its own. Use `from` and `to` in beats instead of `scene` for part of a scene.
2. Build it once: `arcCuts({ stage: tl, times, above, below, edge, end })`.
3. In `seek(t)`, call `cuts.draw(ctx, t)`, then `cuts.label(ctx, t, text, options)` for words.

### The shot drawers

`above`, `below` and `edge` are `(ctx, index, info) => void`. `above` is clipped to the part of the frame above the arc, `below` to the part under it, `edge` draws on top unclipped (a lit rim, a meniscus, beads sitting on the arc). Fill well past the stage edges: the push scales the picture up. `info` has `index`, `t`, `local`, `span`, `progress` and `arc`:

| `info.arc` | Meaning |
|---|---|
| `cx`, `cy`, `r` | the circle the arc belongs to. Bands parallel to the rim are circles around `(cx, cy)` with radius `r - depth` |
| `apex` | the top of the arc |
| `y(x)` | height of the arc at x |
| `path(u)` | the arc from the left frame edge (u 0) to the right one (u 1) |
| `trace(ctx)` | adds the arc to the current path, for a stroke |

`cuts.label(ctx, t, text, options)` draws text along the arc, centered on its top, and registers it with check. It takes the `textOnPath` options (`font`, `color` or the context's fill, `spacing`, `progress` for one character after another, `id`, `allowOverflow`), plus `lift` (default half the font size above the arc) and `shift` (px along the arc from its top).

<!-- check: pass -->
```js
import { accelerate, arcCuts, composition, FONTS, setupCanvas, timeline } from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
const skies = ['#0b0d12', '#ebe7df', '#2a5b8a', '#8a3278'];
const grounds = ['#d9a441', '#5e8c3a', '#23507d', '#e6d2e2'];
const inks = ['#f4efe6', '#2a2520', '#f5f2ea', '#fdf0f8'];
const cover = (c, color) => {
  c.fillStyle = color;
  c.fillRect(-tl.width, -tl.height, tl.width * 3, tl.height * 3);
};
const cuts = arcCuts({
  stage: tl,
  times: accelerate(tl, { scene: 'gather', count: 10, ratio: 0.25 }),
  end: tl.durationSec,
  above: (c, i) => cover(c, skies[i % 4]),
  below(c, i, info) {
    cover(c, grounds[i % 4]);
    c.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    for (let k = 1; k < 6; k++) {
      c.beginPath();
      c.arc(info.arc.cx, info.arc.cy, info.arc.r - k * 16, 0, Math.PI * 2);
      c.stroke();
    }
  },
});

composition({
  seek(t) {
    ctx.clearRect(0, 0, tl.width, tl.height);
    cuts.draw(ctx, t);
    const i = cuts.shotAt(t);
    ctx.fillStyle = inks[i % 4];
    cuts.label(ctx, t, ['还有', '更多', '值得', '发现'][i % 4], { font: `600 40px "${FONTS.serif}"` });
  },
});
```

### Options

| Option (default) | Meaning |
|---|---|
| `stage` | the stage size, `tl` works |
| `times` | when each shot starts, seconds, rising |
| `above`, `below`, `edge` | the shot drawers, `edge` optional |
| `end` (one more gap after the last shot) | when the last shot ends |
| `apex` (58% of the height) | height of the arc's top |
| `rise` (16% of the height) | how far the arc drops from its top to the frame edges |
| `push` (0.06) | how much the picture grows about the arc's top from the first cut to `end`, at a steady rate |

`cuts.shotAt(t)` is the shot up at time t. `cuts.arcAt(t)` is the arc in stage coordinates at time t, push included.

## Camera moves

`moveCamera(ctx, stage, from, to, amount)` multiplies the context's transform so the stage shows rectangle `from` at amount 0 and rectangle `to` at amount 1, each fitted and centered. In between it zooms at a steady rate about one fixed point, or pans when the two rectangles have the same size. Pass the stage rectangle as `from` to push in and as `to` to pull out. Wrap it in `ctx.save()` and `ctx.restore()`.
