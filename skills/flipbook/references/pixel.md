# Pixel

The pixel skin draws on a small grid of cells, a few colors, and blows the grid up by a whole number onto the stage. Every cell lands as one solid block of a palette color: hard edges, no blur, nothing in between. Characters are drawings of cells, changed frame by frame. Faces and hands are a few cells, so they never look wrong.

Sample image: `docs/samples/pixel.png` in the flipbook repository, https://github.com/liustack/flipbook/blob/main/docs/samples/pixel.png.

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

## The grid

`pixel(width, height, { palette, cols, rows })` builds a grid for a width by height stage, once, outside `seek()`. Each frame, `clear()` it, draw, and `present(ctx)` it onto the stage canvas.

- **Size**: `cols` cells across (default 320), `rows` from the stage's shape. 320 by 180 on a 1920 by 1080 stage is 6 device px a cell. Smaller grids (160 by 90, 128 by 72) look chunkier and are easier to draw well.
- **Palette**: 2 to 64 colors, as `#rrggbb`. The first is the ground: the margin when the grid does not fill the stage exactly, and any cell left empty. Pick 8 to 24 colors: a dark, a light, two or three tones of each main color.
- **Fit**: every cell needs at least one device pixel, so a grid larger than the stage is refused. Pick `cols` so the cells are a few px each.
- **Snapping**: `present()` moves every cell to its nearest palette color, the first of two at the same distance. A cell less than half opaque becomes the ground, one at least half opaque takes its own color's nearest, without mixing in what lies under it. A smooth path or a transparent fill on `g.ctx` is snapped too, but its edges come out ragged: draw with the helpers below, or with `fillRect` on whole cells.

| Helper | Draws |
|---|---|
| `g.clear(color)` | every cell, default the ground |
| `g.rect(x, y, w, h, color)` | a block |
| `g.dot(x, y, color)` | one cell |
| `g.line(x0, y0, x1, y1, color)` | a one-cell line, both ends included |
| `g.circle(cx, cy, r, color)`, `g.disc(cx, cy, r, color)` | a ring, a filled disc |
| `g.draw(art, x, y, { flip })` | a drawing from `pixelArt()`, top left on cell (x, y) |
| `g.text(text, x, y, color, { font, align, id, allowOverflow, scale })` | words, the top of the line on row y, see Words |

`color` is a palette index (0 is the ground) or a `#rrggbb` color from the palette. Every coordinate is rounded to a whole cell.

## Drawings

`pixelArt(rows, keys)` makes a drawing from rows of characters: each character is a key into `keys`, a color, and `.` is empty. Write characters and props this way: they stay the same drawing in every frame, and a change is a new drawing.

```js
const cat = pixelArt([
  '.k...k.',
  '.kk.kk.',
  'kkkkkkk',
  'kwkkkwk',
  'kkkpkkk',
  '.kkkkk.',
], { k: '#1b1b2e', w: '#f2e8cf', p: '#e0584f' });
```

- A character is 12 to 32 cells tall on a 320 grid. Eyes are one or two cells, a mouth one row or none.
- Moves are a few drawings, swapped: breathing is two, a walk four to eight, a blink one. Give them to `sprite()` as frames with `art.frame()` (anchored at the middle of the bottom row) and play them from `sprite(clips).draw(g.ctx, x, y, { clip, t })` with x and y rounded.
- Sheets from elsewhere (a CC0 game asset pack, an image model) are cut with `flipbook sprite`, see `references/characters.md`.

## Moving

- Everything sits on whole cells: move by cells, never by a fraction. Easing is fine as long as the result is rounded.
- Nothing turns or scales. A turn is a drawing of the thing turned.
- On twos or threes: `onTwos(time, tl.fps)`, so the picture changes a few times a second, like a game.
- A camera move is whole cells too, each parallax layer rounded on its own.

## Words

Put words on the grid with `g.text()`, never in the DOM over the stage: DOM text is smooth-edged, its pixels are not the grid's, and a fade leaves colors outside the palette. `g.text` draws the letters in `font` with the size in cells and inks every cell the letters cover at least half of in one color. When the grid is presented it registers the whole line for check, which verifies its glyphs, its font and its place in the frame. Check does not measure the contrast of words on a canvas: pick the ink yourself and look at the contact sheet.

- It returns the cells it inked, or null when the letters are too thin to ink a single cell: set them larger.
- Words that would run off the grid throw an error, since the grid cuts them: move them in, shorten them or set them smaller. Pass `allowOverflow: true` only for words sliding in or out on purpose.

- The default font is the pixel font `"Fusion Pixel 12px Prop zh-Hans"` (`FONTS.pixel`: Chinese, Latin, Japanese and Korean) at 12 cells. It is drawn on a 12 px grid, so each of its pixels lands on one cell and no stroke is lost. For bigger words keep it at 12 and pass `scale: 2` or `3`: each pixel of the letters becomes a block of cells, the same letters bigger. Setting the font at 24 or 36 draws the letters again at that size, which adds a pixel here and there. The other flipbook fonts work from about 14 cells up (`400 16px "LXGW WenKai"`): smaller, a Chinese character loses strokes.
- Show and hide words a whole character or a whole line at a time (one more character each beat, or on at a cue), not by fading.
- Keep the text on the ground or a flat color from the palette, and pick an ink from the palette that stands out against it.

## Example

<!-- check: pass -->
```js
import { composition, ease, onTwos, pixel, pixelArt, progress, setupCanvas, sprite, timeline } from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
const INK = { k: '#1b1b2e', w: '#f2e8cf', r: '#e0584f', b: '#4f8fba', g: '#6aa84f' };
const g = pixel(tl.width, tl.height, { cols: 160, palette: ['#f2e8cf', '#1b1b2e', '#e0584f', '#4f8fba', '#6aa84f', '#c9b98f'] });
const hop = (lift) => pixelArt([
  ...Array(lift).fill('......'),
  '..rr..',
  '.rwwr.',
  '.rkwr.',
  'rrrrrr',
  '.r..r.',
  ...Array(2 - lift).fill('......'),
], INK);
const bird = sprite({ hop: { frames: [hop(0).frame(), hop(2).frame(), hop(1).frame()], fps: 6, loop: true } });

composition({
  seek(time) {
    const t = onTwos(time, tl.fps);
    g.clear();
    g.rect(0, 70, 160, 20, 5);
    g.disc(130, 22, 9, 2);
    for (let x = 0; x < 160; x += 12) g.line(x, 70, x + 6, 66, 4);
    const x = Math.round(20 + 100 * ease.inOutCubic(progress(t, 0.3, tl.durationSec - 0.5)));
    bird.draw(g.ctx, x, 70, { clip: 'hop', t });
    g.text('早安', 8, 6, 1);
    g.present(ctx);
  },
});
```
