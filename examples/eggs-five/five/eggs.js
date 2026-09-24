// Bird eggs in the manner of an old chromolithograph plate: a mottled ground
// color, pale shell marks under the surface, dark specks and streaks in two
// inks, engraved stipple on the shaded side and a thin ink outline. A sample
// piece for assemble(), not part of the runtime.
import { mix, rgba, rng, shade, stipple } from '/__flipbook/runtime.js';

export const SHELLS = [
  { base: '#d3a15f', spot: '#7e4320', under: '#bf8b57', marks: 'freckles' },
  { base: '#e0d2a2', spot: '#2e2118', under: '#a09a86', marks: 'speckled' },
  { base: '#b4b596', spot: '#29251d', under: '#8d8d7f', marks: 'fine' },
  { base: '#a9a26a', spot: '#2a2416', under: '#7d7b67', marks: 'streaked' },
  { base: '#a9b3a1', spot: '#3d4847', under: '#8b9690', marks: 'sparse' },
  { base: '#b2a878', spot: null, under: null, marks: 'plain' },
  { base: '#9f8964', spot: '#23190f', under: '#6f6555', marks: 'mottled' },
  { base: '#c4ab9c', spot: '#5a3c37', under: '#9c8a8c', marks: 'fine' },
  { base: '#aaa692', spot: '#2b2823', under: '#84827a', marks: 'speckled' },
  { base: '#d5c59a', spot: '#3a2a1f', under: '#a2998a', marks: 'scrawl' },
  { base: '#c9b88a', spot: '#5a3f28', under: '#a58f6c', marks: 'freckles' },
  { base: '#b5bcad', spot: '#2e3736', under: '#8f9892', marks: 'speckled' },
];

// Counts are for an egg of 6000 px² and scale with the shell's area.
// [count, smallest radius, largest radius, stretch]
const MARKS = {
  plain: null,
  fine: { under: 6, dots: [260, 0.35, 1.0], blots: [6, 1.2, 2.4, 1.3], cap: 0.25 },
  speckled: { under: 10, dots: [130, 0.5, 1.5], blots: [28, 1.2, 3.2, 1.5], cap: 0.35 },
  freckles: { under: 14, dots: [70, 0.5, 1.4], blots: [45, 1.0, 3.4, 1.4], cap: 0.4, mid: 0.6 },
  streaked: { under: 10, dots: [90, 0.4, 1.2], blots: [14, 2.5, 7.5, 2.4], cap: 0.2 },
  sparse: { under: 8, dots: [24, 0.5, 1.3], blots: [9, 2.0, 5.5, 1.8], cap: 0.1 },
  mottled: { under: 18, dots: [70, 0.5, 1.5], blots: [70, 1.6, 5.0, 1.6], cap: 0.3 },
  scrawl: { under: 8, dots: [40, 0.4, 1.2], blots: [6, 1.0, 2.6, 1.4], cap: 0.5, scrawls: 9 },
};

const TAU = Math.PI * 2;

/** The egg outline: an ellipse with one blunt end, slightly irregular. */
function outline(a, b, blunt, r) {
  const k = r.range(0.08, 0.15);
  const w = [r.range(0, TAU), r.range(0, TAU)];
  const path = new Path2D();
  for (let i = 0; i < 96; i++) {
    const t = (i / 96) * TAU;
    const f = 1 + 0.012 * Math.sin(3 * t + w[0]) + 0.008 * Math.sin(5 * t + w[1]);
    const x = a * Math.cos(t) * f;
    const y = b * Math.sin(t) * (1 + k * blunt * Math.cos(t)) * f;
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();
  return path;
}

/** A ragged blot: a loop of points whose radius wanders. */
function blot(path, x, y, radius, stretch, angle, r) {
  const n = 12 + Math.floor(r.next() * 7);
  const p1 = r.range(0, TAU);
  const p2 = r.range(0, TAU);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * TAU;
    const k = 1 + 0.25 * Math.sin(2 * t + p1) + 0.15 * Math.sin(5 * t + p2) + r.range(-0.22, 0.22);
    const px = Math.cos(t) * radius * k * stretch;
    const py = Math.sin(t) * radius * k;
    if (i === 0) path.moveTo(x + px * c - py * s, y + px * s + py * c);
    else path.lineTo(x + px * c - py * s, y + px * s + py * c);
  }
  path.closePath();
}

/** A point on the shell, denser toward the blunt end when `cap` is above 0. */
function onShell(a, b, blunt, cap, r) {
  for (;;) {
    const u = r.range(-1, 1);
    const v = r.range(-1, 1);
    if (u * u + v * v > 0.94) continue;
    const toward = (u * blunt + 1) / 2;
    if (r.next() > 1 - cap + cap * toward * toward) continue;
    return [u * a, v * b];
  }
}

/**
 * Draw one egg centered on (0, 0), its length along x. `piece` comes from
 * assemble(): width and height in px, a seed, and the light direction in the
 * egg's own coordinates.
 */
export function drawEgg(ctx, piece) {
  const r = rng(piece.seed);
  const shell = SHELLS[Math.floor(r.next() * SHELLS.length)];
  const a = piece.width / 2;
  const b = piece.height / 2;
  const blunt = r.next() < 0.5 ? 1 : -1;
  const egg = outline(a, b, blunt, r);
  const [lx, ly] = piece.light;
  const scale = Math.sqrt(a * b) / 44;
  const area = (Math.PI * a * b) / 6000;
  const count = (n) => Math.max(1, Math.round(n * area * 1.3));

  ctx.save();
  ctx.clip(egg);

  // Ground color, lit from the light's side, mottled.
  ctx.save();
  ctx.scale(1, b / a);
  const g = ctx.createRadialGradient(lx * a * 0.45, ly * a * 0.45, a * 0.05, lx * a * 0.1, ly * a * 0.1, a * 1.25);
  g.addColorStop(0, shade(shell.base, 0.14));
  g.addColorStop(0.55, shell.base);
  g.addColorStop(1, shade(shell.base, -0.18));
  ctx.fillStyle = g;
  ctx.fillRect(-a * 1.2, -a * 1.2, a * 2.4, a * 2.4);
  ctx.restore();
  for (const tone of [-0.09, 0.08]) {
    const clouds = new Path2D();
    for (let i = 0; i < count(26); i++) {
      const [x, y] = onShell(a, b, blunt, 0, r);
      blot(clouds, x, y, r.range(3, 9) * scale, r.range(1, 1.6), r.range(0, TAU), r);
    }
    ctx.fillStyle = rgba(shade(shell.base, tone), 0.3);
    ctx.fill(clouds);
  }

  const marks = MARKS[shell.marks];
  if (marks) {
    const lean = r.range(0, TAU);
    // Shell marks under the surface: pale and soft.
    const under = new Path2D();
    for (let i = 0; i < count(marks.under); i++) {
      const [x, y] = onShell(a, b, blunt, marks.cap, r);
      blot(under, x, y, r.range(1.6, 4.8) * scale, r.range(1, 1.8), lean + r.range(-0.6, 0.6), r);
    }
    ctx.fillStyle = rgba(shell.under, 0.5);
    ctx.fill(under);

    // Blots in two inks: the dark one and a thinner mid tone.
    const mid = mix(shell.spot, shell.base, 0.45);
    const dark = new Path2D();
    const light = new Path2D();
    const [n, lo, hi, stretch] = marks.blots;
    for (let i = 0; i < count(n); i++) {
      const [x, y] = onShell(a, b, blunt, marks.cap, r);
      const size = (lo + (hi - lo) * r.next() ** 2) * scale;
      const path = r.next() < (marks.mid ?? 0.3) ? light : dark;
      blot(path, x, y, size, r.range(1, stretch), lean + r.range(-0.5, 0.5), r);
    }
    ctx.fillStyle = rgba(mid, 0.7);
    ctx.fill(light);
    ctx.strokeStyle = rgba(shell.spot, 0.25);
    ctx.lineWidth = 0.9 * scale;
    ctx.stroke(dark);
    ctx.fillStyle = rgba(shell.spot, 0.86);
    ctx.fill(dark);

    // Fine specks.
    const dots = new Path2D();
    const [dn, dlo, dhi] = marks.dots;
    for (let i = 0; i < count(dn); i++) {
      const [x, y] = onShell(a, b, blunt, marks.cap, r);
      const size = (dlo + (dhi - dlo) * r.next() ** 2) * scale;
      dots.moveTo(x + size, y);
      dots.ellipse(x, y, size * r.range(1, 1.8), size, lean + r.range(-0.8, 0.8), 0, TAU);
    }
    ctx.fillStyle = rgba(shell.spot, 0.8);
    ctx.fill(dots);

    if (marks.scrawls) {
      const lines = new Path2D();
      for (let i = 0; i < count(marks.scrawls); i++) {
        let [x, y] = onShell(a, b, blunt, marks.cap, r);
        let heading = r.range(0, TAU);
        lines.moveTo(x, y);
        for (let k = 0; k < 8; k++) {
          heading += r.range(-1.2, 1.2);
          x += Math.cos(heading) * 2.6 * scale;
          y += Math.sin(heading) * 2.6 * scale;
          lines.lineTo(x, y);
        }
      }
      ctx.strokeStyle = rgba(shell.spot, 0.8);
      ctx.lineWidth = 0.7 * scale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(lines);
    }
  }

  // Engraved stipple on the side away from the light and along the rim.
  const box = { x: -a, y: -b * 1.2, width: a * 2, height: b * 2.4 };
  stipple(ctx, box, {
    seed: piece.seed,
    cell: 1.7,
    size: [0.3, 0.75],
    color: shade(shell.base, -0.62),
    opacity: 0.75,
    tone: (x, y) => {
      const nx = x / a;
      const ny = y / b;
      const away = -(nx * lx + ny * ly);
      const rim = Math.hypot(nx, ny);
      return Math.max(0, away - 0.1) * 0.75 + Math.max(0, rim - 0.68) * 1.6;
    },
  });
  // Printing wear: a few light flecks.
  stipple(ctx, box, {
    seed: piece.seed + 3,
    cell: 5,
    tone: 0.12,
    size: [0.25, 0.6],
    color: shade(shell.base, 0.5),
    opacity: 0.5,
  });
  ctx.restore();

  // A thin ink outline on most eggs.
  if (r.next() < 0.7) {
    ctx.strokeStyle = rgba('#231a13', r.range(0.55, 0.85));
    ctx.lineWidth = r.range(0.7, 1.1);
    ctx.stroke(egg);
  }
}
