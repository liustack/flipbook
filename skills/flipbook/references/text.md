# Text on canvas

DOM text stays the default (see `rules.md`). Use these calls for text drawn on a canvas: handwriting, words that appear one by one, text along a curve. Each call registers what it draws, so check verifies its glyphs, font, frame edges and safe area.

Sample image: `docs/samples/text.png` in the flipbook repository, https://github.com/liustack/flipbook/blob/main/docs/samples/text.png.

The JavaScript snippets below run inside a 640×360 page with `<canvas id="stage">` and this timeline:

<!-- snippet-timeline -->
```json
{
    "version": 1,
    "width": 640,
    "height": 360,
    "fps": 12,
    "seed": 4,
    "bpm": 96,
    "beatsPerBar": 4,
    "scenes": [{ "id": "main", "bars": 2 }],
    "cues": [
        { "id": "note", "scene": "main", "beat": 0, "kind": "text", "text": "一颗一颗落下来", "settleBeats": 2 },
        { "id": "motto", "scene": "main", "beat": 2, "kind": "text", "text": "There is more to discover", "settleBeats": 2 }
    ]
}
```

## Calls

| Call | Draws | Returns |
|---|---|---|
| `writeText(ctx, text, x, y, options)` | typeset text: wraps at `maxWidth`, aligns each line around `x`, `y` is the top of the block | the page box of what is visible, or `null` |
| `handText(ctx, text, x, y, options)` | `writeText` in `"LXGW WenKai"` with a hand wobble | the same |
| `textOnPath(ctx, text, path, options)` | characters turned along a polyline or a function `u => [x, y]` for u from 0 to 1 | the same |
| `typeset(ctx, text, x, y, options)` | nothing, lays out lines and words with their positions | `{ lines, words, box, size, ascent, descent }` |
| `words(text)` | nothing, splits text into the units that appear one by one | `string[]` |
| `wordReveal(p, i, n, overlap)` | nothing, the opacity of word `i` of `n` at progress `p` | 0 to 1 |

`writeText` and `handText` options:

| Option | Default | Meaning |
|---|---|---|
| `font` | `400 48px "LXGW WenKai"` | CSS font with the size in px |
| `maxWidth` | none | wrap width in px. Chinese breaks between words, an overlong word between characters |
| `lineHeight` | `1.4` | multiple of the font size |
| `align` | `left` | `left`, `center` or `right` of `x` |
| `color` | the context's `fillStyle` | |
| `progress` | `1` | 0 to 1, words appear one after another |
| `overlap` | `2` | how many words fade in at once |
| `rise` | a fifth of the font size | how far a word rises while it appears |
| `wobble` | `0`, `handText` `1` | each character shifts, turns and scales a little. Keep it between 0.5 and 1.5 |
| `seed` | `1` | |
| `id`, `allowOverflow` | | as in `fillText()` |

`textOnPath` options: `font` (default `500 48px "Noto Serif SC"`), `offset` (px along the path), `align` (`start`, `center` or `end` of the offset), `spacing` (extra px between characters), `lift` (baseline distance from the path, toward the left of its direction), `progress`, `color`, `id`, `allowOverflow`.

## Rules

- Call them in every `seek()` that shows the text. Drive `progress` from `cueProgress(tl, t, id)` so the text is complete when its cue settles.
- Fonts are `"LXGW WenKai"` (400) and `"Noto Serif SC"` (200 to 900). Write the size in px.
- Keep settled text inside the safe area, as for DOM text.

<!-- check: pass -->
```js
import {
  composition, timeline, setupCanvas, paperLayer, cueProgress,
  handText, writeText, textOnPath, arcPoints, pencil,
} from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
const arc = arcPoints(320, 470, 230, -2.45, -0.69);

composition({
  setup() {
    paperLayer(tl.width, tl.height, { seed: tl.seed });
  },
  seek(t) {
    ctx.clearRect(0, 0, tl.width, tl.height);
    ctx.fillStyle = '#2b2622';
    handText(ctx, '一颗一颗落下来', 60, 40, {
      id: 'note', font: '400 40px "LXGW WenKai"', progress: cueProgress(tl, t, 'note'),
    });
    pencil(ctx, [[60, 110], [60 + t * 60, 106]], { seed: 2 });
    textOnPath(ctx, 'There is more to discover', arc, {
      id: 'motto', font: '500 28px "Noto Serif SC"', align: 'center', offset: 230 * 0.88,
      progress: cueProgress(tl, t, 'motto'), color: '#8a3b22',
    });
    writeText(ctx, 'page 5', 580, 300, { font: '400 20px "Noto Serif SC"', align: 'right' });
  },
});
```

## Word by word in the DOM

DOM text also gets the contrast check. Split it with `words()` and fade the spans with `wordReveal()`:

<!-- check: pass -->
```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 640px; height: 360px; overflow: hidden; background: #efe5d0; }
  #line { position: absolute; left: 60px; right: 60px; top: 140px; margin: 0;
          font: 600 40px/1.3 "Noto Serif SC"; color: #2b2622; }
  #line span { display: inline-block; white-space: pre; }
  #kicker { position: absolute; left: 60px; top: 60px; margin: 0; font: 400 34px/1.2 "LXGW WenKai"; color: #8a3b22; }
</style>
</head>
<body>
<p id="line"></p>
<p id="kicker">Field notes, page five</p>
<script type="module">
import { composition, timeline, paperLayer, words, wordReveal, cueProgress, ease } from '/__flipbook/runtime.js';

const tl = await timeline();
const line = document.getElementById('line');
const spans = words('There is more to discover').map((word) => {
  const span = document.createElement('span');
  span.textContent = word;
  line.append(span);
  return span;
});

composition({
  setup() {
    paperLayer(tl.width, tl.height, { seed: tl.seed });
  },
  seek(t) {
    const p = cueProgress(tl, t, 'motto');
    spans.forEach((span, i) => {
      const a = ease.outCubic(wordReveal(p, i, spans.length));
      span.style.opacity = String(a);
      span.style.transform = `translateY(${(1 - a) * 10}px)`;
    });
  },
});
</script>
</body>
</html>
```
