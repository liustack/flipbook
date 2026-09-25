# Photos

Old natural history plates, specimen photos, micrographs and antique maps give a film the warmth of scanned paper that code-drawn shapes lack. flipbook finds public domain images, saves the chosen one with its license, and `photo()` cuts it from its paper and turns it into a sticker: a paper border, a slight tilt, a soft shadow and a grain over it all. The border hides rough cutout edges and makes pictures from different sources look like one scrapbook.

Full example: `examples/specimen-board/` in the flipbook repository, four public domain plates fetched with `stock fetch` and dropped onto grid paper as stickers.

## Find an image

```bash
bash <skill-dir>/scripts/run.sh stock search <dir> beetle plate
bash <skill-dir>/scripts/run.sh stock search <dir> fern herbarium --source bio_diversity
bash <skill-dir>/scripts/run.sh stock fetch <dir> openverse:<id> --as beetle
```

- Search with two to four concrete English words for the thing itself: `beetle plate`, `bird eggs chromolithograph`, `fern herbarium`, `diatoms micrograph`, `antique map`. Leave out moods, styles and quality words.
- Open `out/stock/contact-sheet.png` and choose by looking. Each result's `tile` is its place on the sheet, from 1, left to right and top to bottom. Do not take the first result without looking.
- Prefer a subject alone on plain light paper, or a file that is already transparent. A busy background cannot be cut out.
- `width` and `height` describe the original, but some collections only hand out a preview: `servedEdge` is the long edge you will actually get (1024 from Flickr, where the Biodiversity Heritage Library plates live, and from rawpixel). A 1024 px image looks soft across a 1920 px frame. For a picture shown large, search `--source wikimedia`, `met`, `smithsonian_national_museum_of_natural_history` or `rijksmuseum`, which serve the original file, and keep preview-size images for stickers and small parts of the frame.
- `--source` searches one Openverse collection: `bio_diversity` (Biodiversity Heritage Library plates), `smithsonian_national_museum_of_natural_history`, `wikimedia`, `met`, `rijksmuseum`, `wellcome_collection`, `nasa`, `phylopic` (transparent silhouettes).
- `--orientation landscape`, `portrait` or `square`, `--count` up to 20.
- With `PEXELS_API_KEY` or `PIXABAY_API_KEY` set, those two are asked first for modern photos. Without keys only Openverse is asked, and only for public domain (`cc0`, `pdm`).
- `stock fetch` saves `assets/<name>.jpg` (or `.png`, `.webp`, `.gif`) and records its source and license in `assets/SOURCES.json`. Fetching the same id under the same name again does nothing.
- When no result fits after two or three queries, leave the picture out and tell the user. Never download images by other means, from other sites, or from search result pages, and never write a source or license you did not get from `stock fetch` or the user.
- Images the user supplies go in `assets/` too, with an entry in `assets/SOURCES.json` written from what the user says: `"plate.jpg": { "source": "...", "license": "..." }`. Ask when the license is unknown.
- `stock search` and `stock fetch` need the network. Inside a sandbox, exit 78 with `stock-unreachable` means: run that one command outside the sandbox after the user approves.

## Cut out ahead of render

```bash
bash <skill-dir>/scripts/run.sh cutout <dir> assets/beetle.jpg
bash <skill-dir>/scripts/run.sh cutout <dir> assets/hand-study.jpg --ink
bash <skill-dir>/scripts/run.sh cutout <dir> assets/medusae.jpg --paper '#09330b' --threshold 52 --holes 0.02
```

- `cutout` finds every specimen on the plate, cuts each into a transparent PNG `assets/cut/<name>/<name>-01.png` (biggest first), records its source and license in `assets/SOURCES.json` and draws `out/cutout/<name>.png`, every cutout on light paper, dark ground and a checkerboard.
- Open that sheet and pick by looking: a clean cutout has no pale rim on the dark ground, no dark fringe on the light paper and no leftover ground on the checkerboard. Leave out the rest.
- In the composition, `photo('assets/cut/beetle/beetle-01.png')` takes the file's transparency as it is (`'auto'` becomes `'alpha'`) and only adds the sticker: nothing is cut while rendering.
- `--ink` is for line art (engravings, pen drawings): the paper turns transparent and the lines keep their weight. `--paper` and `--threshold` set the ground on dark plates, `--holes` clears ground enclosed by a specimen, `--gap` (default `0.012` of the long edge) joins pieces that belong together.
- `cutout-none` means no specimen stands apart: use the plate whole (see below). `cutout-clipped` warnings name specimens that were left out because their crop cut through them.

## photo() in the composition

Await `photo()` at module level or in `setup()`, never in `seek()`: the cutout, border and shadow are prepared once, then `draw()` only places the finished sticker.

The snippet below runs in a 640×360 page with `<canvas id="stage">`, a scanned plate at `assets/egg-plate.svg` and this timeline:

<!-- snippet-file: assets/egg-plate.svg -->
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#efe6d2"/><circle cx="30" cy="30" r="2" fill="#8a7a60"/><ellipse cx="200" cy="150" rx="70" ry="92" fill="#b9c7b0"/><ellipse cx="180" cy="120" rx="22" ry="16" fill="#e8eee2"/><circle cx="220" cy="190" r="8" fill="#4a3a2a"/><circle cx="170" cy="200" r="5" fill="#4a3a2a"/><circle cx="235" cy="120" r="6" fill="#4a3a2a"/></svg>
```

<!-- snippet-timeline -->
```json
{
    "version": 1,
    "width": 640,
    "height": 360,
    "fps": 12,
    "seed": 11,
    "bpm": 96,
    "beatsPerBar": 4,
    "scenes": [{ "id": "main", "bars": 1 }],
    "cues": [{ "id": "drop", "scene": "main", "beat": 0, "kind": "mark" }]
}
```

<!-- check: pass -->
```js
import { composition, cueProgress, ease, paperLayer, photo, PAPER, setupCanvas, timeline } from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
const egg = await photo('assets/egg-plate.svg', { size: 200 });

composition({
  setup() {
    paperLayer(tl.width, tl.height, { seed: tl.seed, color: PAPER.cream, grid: true });
  },
  seek(t) {
    // Dropped onto the page: lifted and larger at first, flat once it lands.
    const p = ease.outCubic(cueProgress(tl, t, 'drop', 1.5));
    ctx.clearRect(0, 0, tl.width, tl.height);
    egg.draw(ctx, tl.width / 2, tl.height / 2 - (1 - p) * 40, {
      scale: 1 + 0.15 * (1 - p),
      lift: 1 - p,
    });
  },
});
```

`photo(src, options)`:

| Option | Default | Meaning |
|---|---|---|
| `crop` | the whole file | `{ x, y, width, height }` as fractions of the file: one specimen out of a plate of several |
| `size` | its size in the file, at most 1200 | long edge of the cut subject in CSS px, border not included. Pick the size it will be drawn at, so the border keeps its width |
| `cutout` | `'auto'` | `'alpha'` keeps the file's transparency, `'paper'` removes the paper around the subject, `'ink'` turns line art (engravings, pen drawings) into transparent ink: the paper goes, lines keep their weight and a gray wash stays half through, `'none'` keeps the whole rectangle. `'auto'` is `'alpha'` for a file with transparent pixels, `'paper'` otherwise. Use `'ink'` for anything drawn in lines, never `'paper'`: a paper cutout of an engraving falls apart into its hatching |
| `threshold` | `36` | `'paper'`: how far (0 to 255, largest channel difference) a color may be from the paper and still count as paper. Raise it for stained or uneven paper, lower it for a pale subject |
| `softness` | `24` | `'paper'`: width of the soft edge above `threshold` |
| `paper` | measured | `'paper'`: the paper color, measured along the edge of the picture unless given |
| `despeckle` | `0.002` | `'paper'`: islands smaller than this share of the picture are dropped (dust, plate numbers, captions) |
| `flatten` | `true` | `'paper'` and `'ink'`: follow paper whose tone drifts across the scan (yellowing, a darker gutter, a stain) instead of one color. Soft edges are also measured against the paper under them and the paper is taken back out of them, so no pale rim of the old page travels with the sticker |
| `keep` | `'all'` | `'largest'` keeps only the biggest piece and drops parts of neighbours that came in with the crop |
| `holes` | `0` (off) | `'paper'`: also clear ground enclosed by the subject when a patch covers at least this share of it, such as dark water between a jellyfish's tentacles. Leave it off on light paper, where an enclosed pale patch is usually a highlight |
| `sticker` | on | `false` for the bare cutout, or the options below |

`sticker` options: `border` (CSS px, default 9, 6 to 12 reads as cut with scissors), `color` (default `'#fbf8f1'`), `tilt` (degrees, default a seeded angle within ±3.5), `shadow` (`{ x, y, blur, color }`, default `{ x: 3, y: 8, blur: 10 }`, or `false`), `grain` (0 to 2, default 1), `seed`.

The result:

| Property | Value |
|---|---|
| `draw(ctx, x, y, options)` | draws the sticker centered at `(x, y)`. `scale`, `rotate` (degrees added to the tilt), `alpha`, `lift` (0 lies flat, 1 is lifted: the shadow moves out, spreads and fades) |
| `width`, `height` | size in CSS px at scale 1, border included, before the tilt |
| `tilt` | degrees |
| `cutout` | what was used: `'alpha'`, `'paper'`, `'ink'` or `'none'` |
| `paper` | the paper color removed, or null |
| `canvas` | the finished sticker, for `drawImage` or a pattern |
| `clipped` | the sides of the crop the subject touches, such as `['right']`: the crop cut through it. Empty when nothing was cut. Fix a non-empty one before drawing |

Only paper that touches the edge of the picture is removed, so pale areas inside the subject (a white wing, a highlight) stay. Only light, even paper cuts well: for a photo with a real background use `cutout: 'none'` and let the border frame it. Check each cutout on the snapshot contact sheet, and zoom in with `snapshot --zoom` when an edge looks wrong.

## Specimens on one plate

Never guess a crop on a plate that holds several specimens: a guessed crop cuts through the one you want and brings in half of its neighbour, and both show as straight edges that no border hides. `specimens(src, options)` finds every separate specimen on the plate, biggest first, each with a crop that has room around it. Pass that crop to `photo()` with `keep: 'largest'`. Options: `paper` and `threshold` as in `photo()`, `minArea` (default `0.003` of the picture, smaller pieces are dust or captions), `gap` (default `0.012` of the long edge, pieces closer than this are one specimen), `margin` (default `0.015`).

<!-- check: pass -->
```js
import { composition, paperLayer, photo, PAPER, setupCanvas, specimens, timeline } from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
const [egg] = await specimens('assets/egg-plate.svg');
const cut = await photo('assets/egg-plate.svg', { crop: egg.crop, keep: 'largest', size: 200 });
if (cut.clipped.length > 0) throw new Error(`the crop cuts the egg on its ${cut.clipped.join(', ')}`);

composition({
  setup() {
    paperLayer(tl.width, tl.height, { seed: tl.seed, color: PAPER.cream });
  },
  seek() {
    ctx.clearRect(0, 0, tl.width, tl.height);
    cut.draw(ctx, tl.width / 2, tl.height / 2);
  },
});
```

It looks inside the printed field only, so the page margin, the caption and the scan's border never count, and a specimen near the edge of the field is not lost. On a dark plate (Haeckel's green or black grounds) give `paper`, and add `holes` to `photo()`, for example `{ paper: '#09330b', threshold: 52, holes: 0.02 }`.

Color alone cannot part specimens that touch: tentacles crossing a neighbour, spines radiating across the plate. When `specimens()` returns fewer specimens than the plate shows, or none, do not guess crops for them. Use the plate whole with `cutout: 'none'` and let the camera move over it (a push, a pan, a cut on the beat), or search for a plate whose specimens stand apart.

## Rules

- Every image in `assets/` has its source and license in `assets/SOURCES.json`, written by `stock fetch` or taken from the user.
- The pictures are material, not the story: the film still needs its own device (objects assembling a glyph, a lens montage, a page turn) and its own motion.
- One cutout style per film: the same border width and color on every sticker, the same light direction for every shadow.
- Fewer cutouts, cleaner ones: a whole plate moved by the camera (a slow push, a pan, a cut on the beat) often reads better than many small cutouts each moving on its own. Cut out only what has to move by itself, and look at every cutout on the contact sheet.
