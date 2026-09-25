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
- `--source` searches one Openverse collection: `bio_diversity` (Biodiversity Heritage Library plates), `smithsonian_national_museum_of_natural_history`, `wikimedia`, `met`, `rijksmuseum`, `wellcome_collection`, `nasa`, `phylopic` (transparent silhouettes).
- `--orientation landscape`, `portrait` or `square`, `--count` up to 20.
- With `PEXELS_API_KEY` or `PIXABAY_API_KEY` set, those two are asked first for modern photos. Without keys only Openverse is asked, and only for public domain (`cc0`, `pdm`).
- `stock fetch` saves `assets/<name>.jpg` (or `.png`, `.webp`, `.gif`) and records its source and license in `assets/SOURCES.json`. Fetching the same id under the same name again does nothing.
- When no result fits after two or three queries, leave the picture out and tell the user. Never download images by other means, from other sites, or from search result pages, and never write a source or license you did not get from `stock fetch` or the user.
- Images the user supplies go in `assets/` too, with an entry in `assets/SOURCES.json` written from what the user says: `"plate.jpg": { "source": "...", "license": "..." }`. Ask when the license is unknown.
- `stock search` and `stock fetch` need the network. Inside a sandbox, exit 78 with `stock-unreachable` means: run that one command outside the sandbox after the user approves.

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
| `cutout` | `'auto'` | `'alpha'` keeps the file's transparency, `'paper'` removes light paper, `'none'` keeps the whole rectangle (a print with a border). `'auto'` is `'alpha'` for a file with transparent pixels, `'paper'` otherwise |
| `threshold` | `36` | `'paper'`: how far (0 to 255, largest channel difference) a color may be from the paper and still count as paper. Raise it for stained or uneven paper, lower it for a pale subject |
| `softness` | `24` | `'paper'`: width of the soft edge above `threshold` |
| `paper` | measured | `'paper'`: the paper color, measured along the edge of the picture unless given |
| `despeckle` | `0.002` | `'paper'`: islands smaller than this share of the picture are dropped (dust, plate numbers, captions) |
| `sticker` | on | `false` for the bare cutout, or the options below |

`sticker` options: `border` (CSS px, default 9, 6 to 12 reads as cut with scissors), `color` (default `'#fbf8f1'`), `tilt` (degrees, default a seeded angle within ±3.5), `shadow` (`{ x, y, blur, color }`, default `{ x: 3, y: 8, blur: 10 }`, or `false`), `grain` (0 to 2, default 1), `seed`.

The result:

| Property | Value |
|---|---|
| `draw(ctx, x, y, options)` | draws the sticker centered at `(x, y)`. `scale`, `rotate` (degrees added to the tilt), `alpha`, `lift` (0 lies flat, 1 is lifted: the shadow moves out, spreads and fades) |
| `width`, `height` | size in CSS px at scale 1, border included, before the tilt |
| `tilt` | degrees |
| `cutout` | what was used: `'alpha'`, `'paper'` or `'none'` |
| `paper` | the paper color removed, or null |
| `canvas` | the finished sticker, for `drawImage` or a pattern |

Only paper that touches the edge of the picture is removed, so pale areas inside the subject (a white wing, a highlight) stay. Only light, even paper cuts well: for a photo with a real background use `cutout: 'none'` and let the border frame it. Check each cutout on the snapshot contact sheet, and zoom in with `snapshot --zoom` when an edge looks wrong.

## Rules

- Every image in `assets/` has its source and license in `assets/SOURCES.json`, written by `stock fetch` or taken from the user.
- The pictures are material, not the story: the film still needs its own device (objects assembling a glyph, a lens montage, a page turn) and its own motion.
- One cutout style per film: the same border width and color on every sticker, the same light direction for every shadow.
