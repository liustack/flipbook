// Eggs fly in one by one, each landing on a mark cue, and pack into a glyph
// on beige paper. The camera eases in while the glyph rests, then the film
// cuts to a serif title.
import {
  assemble,
  composition,
  cueProgress,
  ease,
  glyphMask,
  grainLayer,
  markTimes,
  orderSlots,
  PAPER,
  packSlots,
  paperLayer,
  progress,
  rand,
  setupCanvas,
  timeline,
} from '/__flipbook/runtime.js';
import { drawEgg } from './eggs.js';

/**
 * config: { glyph, font, grow, box: { x, y, width, height } }. The glyph takes
 * one egg per mark cue whose id starts with "egg-".
 */
export async function film(config) {
  const tl = await timeline();
  const W = tl.width;
  const H = tl.height;
  const ctx = setupCanvas(document.getElementById('eggs'), W, H);
  const title = document.getElementById('title');
  const gather = tl.scenes[0];
  const times = markTimes(tl, 'egg-');
  const last = times[times.length - 1];
  let eggs;
  let center;

  composition({
    setup() {
      paperLayer(W, H, { seed: tl.seed, color: PAPER.beige });
      const mask = glyphMask({
        text: config.glyph,
        font: config.font,
        grow: config.grow,
        box: config.box,
      });
      const packed = packSlots(mask, { count: times.length, seed: tl.seed });
      const slots = orderSlots(packed, 'random', tl.seed);
      center = [config.box.x + config.box.width / 2, config.box.y + config.box.height / 2];
      eggs = assemble({
        slots,
        times,
        draw: drawEgg,
        stage: { width: W, height: H },
        seed: tl.seed,
        size: (slot, i) => {
          const length = slot.r * 2.2;
          return { width: length, height: length / (1.18 + rand(tl.seed, 'aspect', i) * 0.2) };
        },
        flight: 0.6,
        from: 'outside',
        shadow: { blur: 2.5, offset: [1.5, 2.5], opacity: 0.3 },
      });
      grainLayer(W, H, { seed: tl.seed, amount: 0.7 });
    },
    seek(t) {
      ctx.clearRect(0, 0, W, H);
      if (t < gather.end) {
        const push = 1 + 0.03 * ease.inOutSine(progress(t, last - 0.4, gather.end));
        ctx.save();
        ctx.translate(center[0], center[1]);
        ctx.scale(push, push);
        ctx.translate(-center[0], -center[1]);
        eggs.draw(ctx, t);
        ctx.restore();
        title.style.opacity = '0';
        return;
      }
      const p = ease.outCubic(cueProgress(tl, t, 'title'));
      title.style.opacity = String(p);
      title.style.transform = `translateY(${(1 - p) * 14}px)`;
    },
  });
}
