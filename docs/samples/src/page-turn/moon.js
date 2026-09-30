// The moon in the manner of an engraved astronomy plate: a stippled lit
// disc with maria and crater rims, a hatched dark side with a little
// earthshine, and the terminator for any day of the lunar month.
import { clamp, crossHatch, fbm2, rng, staticLayer, stipple } from '/__flipbook/runtime.js';

export const INK = '#2a2520';

/** Lit and dark discs, each `size` px square, drawn once. */
export function moonDiscs(size, seed) {
  const r = size / 2;
  const disc = new Path2D();
  disc.arc(r, r, r - 1, 0, Math.PI * 2);
  const maria = (x, y) => fbm2(seed, (x / size) * 3.1, (y / size) * 3.1, 4);
  const limb = (x, y) => Math.hypot(x - r, y - r) / r;

  const lit = staticLayer(size, size, (c) => {
    c.fillStyle = '#f1e8d2';
    c.fill(disc);
    stipple(c, { x: 0, y: 0, width: size, height: size }, {
      clip: disc,
      seed,
      cell: Math.max(2, size / 260),
      size: [0.35, 1.05],
      color: INK,
      opacity: 0.9,
      tone: (x, y) => clamp(0.03 + (maria(x, y) - 0.52) * 1.5 + Math.max(0, limb(x, y) - 0.72) * 1.1),
    });
    // Craters: a shaded crescent inside the rim on the side away from the light.
    const g = rng(seed + 7);
    c.save();
    c.clip(disc);
    for (let i = 0; i < 48; i++) {
      const a = g.range(0, Math.PI * 2);
      const d = Math.sqrt(g.next()) * r * 0.86;
      const cr = r * g.range(0.012, 0.055);
      const x = r + Math.cos(a) * d;
      const y = r + Math.sin(a) * d;
      const shade = new Path2D();
      shade.arc(x, y, cr, 0, Math.PI * 2);
      shade.arc(x + cr * 0.35, y + cr * 0.3, cr * 0.92, 0, Math.PI * 2);
      c.fillStyle = 'rgba(42, 37, 32, 0.3)';
      c.fill(shade, 'evenodd');
      c.lineWidth = Math.max(0.6, cr * 0.06);
      c.strokeStyle = 'rgba(42, 37, 32, 0.45)';
      c.beginPath();
      c.arc(x, y, cr, Math.PI * 0.1, Math.PI * 0.9);
      c.stroke();
    }
    c.restore();
    c.lineWidth = 1.6;
    c.strokeStyle = INK;
    c.stroke(disc);
  });

  const dark = staticLayer(size, size, (c) => {
    c.fillStyle = '#8a8a90';
    c.fill(disc);
    crossHatch(c, { x: 0, y: 0, width: size, height: size }, {
      clip: disc,
      seed: seed + 3,
      spacing: Math.max(3, size / 150),
      length: Math.max(8, size / 40),
      width: 0.8,
      color: '#2c2b33',
      opacity: 0.55,
      tone: (x, y) => clamp(0.45 + (maria(x, y) - 0.5) * 0.9 + Math.max(0, limb(x, y) - 0.6) * 0.6),
    });
    const g = c.createRadialGradient(r * 0.8, r * 0.8, r * 0.1, r, r, r);
    g.addColorStop(0, 'rgba(210, 205, 190, 0.2)');
    g.addColorStop(1, 'rgba(210, 205, 190, 0)');
    c.fillStyle = g;
    c.fill(disc);
    c.lineWidth = 1.6;
    c.strokeStyle = INK;
    c.stroke(disc);
  });
  return { lit, dark, size };
}

/** Draw the moon on day `day` of the lunar month (0 new, about 14.8 full), waxing. */
export function drawMoon(c, discs, cx, cy, radius, day) {
  const x = cx - radius;
  const y = cy - radius;
  const d = radius * 2;
  c.drawImage(discs.dark.canvas, x, y, d, d);
  const angle = (2 * Math.PI * day) / 29.53;
  const rx = radius * Math.cos(angle);
  const lit = new Path2D();
  lit.moveTo(cx, cy - radius);
  lit.arc(cx, cy, radius, -Math.PI / 2, Math.PI / 2);
  lit.ellipse(cx, cy, Math.max(0.01, Math.abs(rx)), radius, 0, Math.PI / 2, (3 * Math.PI) / 2, rx > 0);
  lit.closePath();
  c.save();
  c.clip(lit);
  c.drawImage(discs.lit.canvas, x, y, d, d);
  c.restore();
}
