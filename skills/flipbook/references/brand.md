# Brand

For a film about a product or a brand, take the name, colors, logo and type from the brand. Write them into one `brand.json`, name it in `timeline.json`, and read them in the composition with `brand()`.

Full example: `examples/brand-intro/` in the flipbook repository, a made-up stationery brand with a code-drawn SVG logo.

## Find the brand's assets first

Before writing `brand.json`, search the workspace and list what you find to the user for confirmation:

- logo files: `logo.*`, `favicon.*`, `icon.svg`, anything under `brand/`, `assets/`, `public/`, `static/`
- theme colors: CSS custom properties (`--primary`, `--brand-*`), `tailwind.config.*` colors, design token files (`tokens.json`, `*.tokens.json`), color values in the README
- font files (`.ttf`, `.otf`) and the license files next to them

When something is missing, ask the user for it. Do not make up a logo, a color or a license.

## brand.json

Put it in the composition directory or in the workspace root, then name it in `timeline.json` with a path relative to the composition directory:

- `"brand": "brand.json"` when it sits in the composition directory
- `"brand": "../brand.json"` when the composition directory sits right under the workspace root

<!-- snippet-file: brand.json -->
```json
{
    "version": 1,
    "name": "Kestrel",
    "tagline": "Paper that keeps up",
    "logo": { "file": "assets/logo.svg", "license": "owned by Kestrel, used with permission" },
    "colors": { "primary": "#c8452d", "secondary": "#2a6f97", "ink": "#2a211b", "paper": "#f3ebdd" },
    "fonts": { "title": "Noto Serif SC", "text": "LXGW WenKai" }
}
```

| Field | Required | Value |
|---|---|---|
| `version` | no | `1` |
| `name` | yes | the brand name |
| `tagline` | no | one line about it |
| `logo` | no | `{ "file", "license", "source" }`: an svg, png, jpg or webp up to 2 MB. `license` says under what terms the logo may be used, `source` where it came from |
| `colors` | yes | `primary`, and optionally `secondary`, `ink` (text), `paper` (background), each `#rgb` or `#rrggbb` |
| `fonts` | no | `title` and `text`: family names, each `"Noto Serif SC"`, `"LXGW WenKai"` or a supplied font. `files`: fonts the user supplies, see below. `title` defaults to `"Noto Serif SC"`, `text` to `title` |

- Paths are relative to `brand.json`, point to local files, and stay inside the directory that holds `brand.json`.
- Other fields are errors, so a misspelled field never passes unnoticed.
- check, snapshot and render read `brand.json` before opening the page. A problem stops them with `brand-invalid`: `detail.file` is the brand.json, `detail.path` the field.

## brand() in the composition

`await brand()` at module level or in `setup()` returns:

| Property | Value |
|---|---|
| `name`, `tagline` | from brand.json, `tagline` is null when absent |
| `colors` | `primary`, `secondary`, `ink`, `paper`, lower case, null when absent |
| `logo` | an `HTMLImageElement`, decoded, for `drawImage` or an `<img>`. Null without a logo |
| `fonts.title`, `fonts.text` | CSS font-family lists: the brand face first, then `"Noto Serif SC"` and `"LXGW WenKai"` for characters it lacks |
| `font(role, size, weight)` | a CSS font shorthand for `ctx.font` or `style.font`: `b.font('title', 96)`. `role` is `'title'` (weight 600 by default) or `'text'` (400) |
| `applyCss(element)` | sets `--brand-primary`, `--brand-secondary`, `--brand-ink`, `--brand-paper`, `--brand-title-font`, `--brand-text-font` on the element (default `<html>`) for DOM text |

The snippet below runs in a 640×360 page with `<canvas id="stage">`, the brand.json above, a logo at `assets/logo.svg` and this timeline:

<!-- snippet-file: assets/logo.svg -->
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><circle cx="120" cy="120" r="100" fill="#c8452d"/><path d="M70 150 L120 60 L170 150 Z" fill="#f3ebdd"/></svg>
```

<!-- snippet-timeline -->
```json
{
    "version": 1,
    "width": 640,
    "height": 360,
    "fps": 12,
    "seed": 8,
    "bpm": 96,
    "beatsPerBar": 4,
    "brand": "brand.json",
    "scenes": [{ "id": "main", "bars": 2 }],
    "cues": [{ "id": "name", "scene": "main", "beat": 1, "kind": "text", "text": "Kestrel", "settleBeats": 1 }]
}
```

<!-- check: pass -->
```js
import { brand, composition, cueProgress, ease, fillText, paperLayer, setupCanvas, timeline } from '/__flipbook/runtime.js';

const tl = await timeline();
const b = await brand();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);

composition({
  setup() {
    paperLayer(tl.width, tl.height, { seed: tl.seed, color: b.colors.paper });
  },
  seek(t) {
    const p = ease.outCubic(cueProgress(tl, t, 'name'));
    ctx.clearRect(0, 0, tl.width, tl.height);
    ctx.fillStyle = b.colors.primary;
    ctx.fillRect(0, 300, tl.width * (0.2 + 0.8 * p), 12);
    ctx.drawImage(b.logo, 90, 100 - p * 10, 140, 140);
    ctx.globalAlpha = p;
    ctx.fillStyle = b.colors.ink;
    ctx.font = b.font('title', 64);
    fillText(ctx, b.name, 270, 190, { id: 'name' });
    ctx.globalAlpha = 1;
  },
});
```

## Fonts the user supplies

Besides `"Noto Serif SC"` and `"LXGW WenKai"`, a film may use font files the user supplies, each with its license written down. Two ways:

1. In brand.json under `fonts.files`:

   ```json
   "fonts": {
       "title": "Kestrel Display",
       "files": [
           { "family": "Kestrel Display", "file": "fonts/KestrelDisplay-Bold.otf", "license": "OFL-1.1", "weight": 700, "source": "https://..." }
       ]
   }
   ```

   `family` is the name to use in CSS and `ctx.font`. `weight` (a number, or `"200 900"` for a variable font) and `style` (`"normal"` or `"italic"`) default to what the file says.

2. In the composition's `assets/fonts/`, with each file's license in `assets/SOURCES.json`, keyed by its path under `assets/`:

   ```json
   {
       "fonts/KestrelDisplay-Bold.otf": { "source": "https://...", "license": "OFL-1.1" }
   }
   ```

   The family is the name stored in the file.

Rules:

- `.ttf` and `.otf` only. Convert WOFF and WOFF2 back to one of them, and pick one font out of a collection (`.ttc`).
- A family may not reuse `"Noto Serif SC"`, `"LXGW WenKai"` or a CSS generic name such as `serif`. Two files may not share a family, weight and style.
- flipbook serves the files itself: write the family in CSS or `ctx.font`, never an `@font-face` or a `FontFace`.
- check verifies every character against each font's own character table. A font without Chinese needs `"Noto Serif SC"` after it in the list: `font-family: "Kestrel Display", "Noto Serif SC"`. `b.fonts.title` and `b.font()` already add it.
- A file without a license, one that is not a readable font, or a family clash stops check with `font-invalid`.
