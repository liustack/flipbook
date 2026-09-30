// Seven plates for the eyepiece, each drawn once into a square sprite: a fern
// frond, onion-skin cells, Newton's rings, a star chart, an agate slice, a
// diatom, and the dusk sky with the moon that the lens pulls out to.
import { clamp, fbm2, hatch, noise2, rand, rng, staticLayer, stipple } from '/__flipbook/runtime.js';

const TAU = Math.PI * 2;
const INK = '#2a2520';

function fern(c, S, seed) {
  c.fillStyle = '#efe6cf';
  c.fillRect(0, 0, S, S);
  const p0 = [S * 0.3, S * 1.02];
  const p1 = [S * 0.28, S * 0.45];
  const p2 = [S * 0.74, S * 0.04];
  const at = (u) => [
    (1 - u) ** 2 * p0[0] + 2 * (1 - u) * u * p1[0] + u * u * p2[0],
    (1 - u) ** 2 * p0[1] + 2 * (1 - u) * u * p1[1] + u * u * p2[1],
  ];
  const r = rng(seed);
  for (let k = 0; k < 36; k++) {
    const u = 0.04 + (k / 36) * 0.92;
    const [x, y] = at(u);
    const [x2, y2] = at(u + 0.01);
    const along = Math.atan2(y2 - y, x2 - x);
    const side = k % 2 ? 1 : -1;
    const length = S * (0.3 * (1 - u) ** 0.8 + 0.035);
    const width = length * 0.2;
    const angle = along + side * (1.05 + r.range(-0.08, 0.08));
    c.save();
    c.translate(x, y);
    c.rotate(angle);
    const leaf = new Path2D();
    const lobes = 7;
    leaf.moveTo(0, 0);
    for (let i = 0; i <= 40; i++) {
      const s = i / 40;
      const w = width * Math.sin(Math.PI * s) ** 0.7 * (0.8 + 0.2 * Math.abs(Math.sin(s * Math.PI * lobes)));
      leaf.lineTo(s * length, -w);
    }
    for (let i = 40; i >= 0; i--) {
      const s = i / 40;
      const w = width * Math.sin(Math.PI * s) ** 0.7 * (0.8 + 0.2 * Math.abs(Math.sin(s * Math.PI * lobes)));
      leaf.lineTo(s * length, w);
    }
    leaf.closePath();
    c.fillStyle = k % 3 ? '#7d9453' : '#72894a';
    c.fill(leaf);
    hatch(c, { x: 0, y: 0, width: length, height: width }, {
      clip: leaf, seed: seed + k, spacing: 4, length: 9, angle: 0.9, tone: 0.55, color: '#34401f', opacity: 0.6,
    });
    c.strokeStyle = '#2f3a22';
    c.lineWidth = 1.2;
    c.stroke(leaf);
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(length * 0.92, 0);
    c.stroke();
    c.restore();
  }
  c.strokeStyle = '#3d4a28';
  c.lineWidth = 5;
  c.beginPath();
  for (let i = 0; i <= 60; i++) {
    const [x, y] = at(i / 60);
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.stroke();
}

function cells(c, S, seed) {
  c.fillStyle = '#dfe6c9';
  c.fillRect(0, 0, S, S);
  const rowH = S / 9;
  for (let row = -1; row < 10; row++) {
    let x = -rand(seed, 'shift', row) * S * 0.2;
    let col = 0;
    while (x < S) {
      const w = S * (0.16 + rand(seed, row, col) * 0.12);
      const y = row * rowH + Math.sin((x / S) * TAU + row) * 6;
      const cell = new Path2D();
      cell.roundRect(x + 3, y + 3, w - 6, rowH - 6, 10);
      const g = c.createLinearGradient(x, y, x, y + rowH);
      g.addColorStop(0, '#eef2dc');
      g.addColorStop(1, '#cfdcae');
      c.fillStyle = g;
      c.fill(cell);
      c.strokeStyle = '#5a7340';
      c.lineWidth = 2.2;
      c.stroke(cell);
      const nx = x + w * (0.3 + rand(seed, 'nx', row, col) * 0.4);
      const ny = y + rowH * (0.35 + rand(seed, 'ny', row, col) * 0.3);
      const nucleus = new Path2D();
      nucleus.ellipse(nx, ny, rowH * 0.13, rowH * 0.1, rand(seed, 'na', row, col) * 3, 0, TAU);
      c.fillStyle = '#b7c28f';
      c.fill(nucleus);
      stipple(c, { x: nx - rowH * 0.15, y: ny - rowH * 0.15, width: rowH * 0.3, height: rowH * 0.3 }, {
        clip: nucleus, seed: seed + row * 31 + col, cell: 2, tone: 0.6, color: '#3c4a26', opacity: 0.8,
      });
      c.strokeStyle = '#4c5f33';
      c.lineWidth = 1.2;
      c.stroke(nucleus);
      x += w;
      col++;
    }
  }
}

function rings(c, S) {
  c.fillStyle = '#070605';
  c.fillRect(0, 0, S, S);
  const cx = S / 2;
  const cy = S / 2;
  for (let r = S * 0.46; r > 0; r -= 1.5) {
    const phase = Math.cos((r * r) / (S * 5.2));
    const envelope = Math.exp(-((r / (S * 0.36)) ** 4));
    const v = clamp(0.5 + 0.5 * phase) * envelope;
    c.fillStyle = `rgb(${Math.round(40 + 200 * v)}, ${Math.round(22 + 140 * v)}, ${Math.round(4 + 30 * v)})`;
    c.beginPath();
    c.arc(cx, cy, r, 0, TAU);
    c.fill();
  }
}

function stars(c, S, seed) {
  c.fillStyle = '#16233f';
  c.fillRect(0, 0, S, S);
  const cx = S / 2;
  const cy = S * 0.55;
  c.strokeStyle = 'rgba(160, 180, 220, 0.35)';
  c.lineWidth = 1.2;
  for (let r = 70; r < S; r += 70) {
    c.beginPath();
    c.arc(cx, cy, r, 0, TAU);
    c.stroke();
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * 70, cy + Math.sin(a) * 70);
    c.lineTo(cx + Math.cos(a) * S, cy + Math.sin(a) * S);
    c.stroke();
  }
  const r = rng(seed);
  const list = [];
  for (let i = 0; i < 520; i++) {
    const x = r.range(0, S);
    const y = r.range(0, S);
    const size = r.next() ** 6 * 4 + 0.6;
    list.push([x, y, size]);
    c.fillStyle = '#f3ead2';
    c.beginPath();
    c.arc(x, y, size, 0, TAU);
    c.fill();
  }
  const bright = list.filter((s) => s[2] > 2).slice(0, 18);
  c.strokeStyle = 'rgba(210, 176, 106, 0.85)';
  c.lineWidth = 1.6;
  for (let g = 0; g + 3 < bright.length; g += 5) {
    c.beginPath();
    bright.slice(g, g + 5).forEach(([x, y], i) => (i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)));
    c.stroke();
  }
  for (const [x, y, size] of bright) {
    c.beginPath();
    c.arc(x, y, size + 6, 0, TAU);
    c.stroke();
  }
}

function agate(c, S, seed) {
  const palette = ['#4a1f5c', '#7d3f91', '#b77fc6', '#e9dcef', '#6a2f7c', '#c9a2d6', '#3b1849', '#f4eef6', '#8d52a0'];
  const cx = S * 0.45;
  const cy = S * 0.55;
  const bands = 64;
  for (let k = bands; k > 0; k--) {
    const base = (k / bands) * S * 0.9;
    const band = new Path2D();
    for (let i = 0; i <= 180; i++) {
      const a = (i / 180) * TAU;
      const wobble = 1 + 0.22 * (fbm2(seed, Math.cos(a) * 1.6 + 5, Math.sin(a) * 1.6 + 5, 3) - 0.5) + 0.03 * Math.sin(a * 9 + k);
      const rr = base * wobble;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr * 0.86;
      if (i === 0) band.moveTo(x, y);
      else band.lineTo(x, y);
    }
    band.closePath();
    c.fillStyle = palette[(k * 7 + Math.floor(rand(seed, k) * 3)) % palette.length];
    c.fill(band);
  }
  const quartz = new Path2D();
  quartz.ellipse(cx, cy, S * 0.07, S * 0.055, 0.3, 0, TAU);
  c.fillStyle = '#f7f3ea';
  c.fill(quartz);
  const r = rng(seed + 2);
  c.save();
  c.clip(quartz);
  for (let i = 0; i < 40; i++) {
    c.fillStyle = `rgba(160, 140, 190, ${r.range(0.1, 0.4)})`;
    c.beginPath();
    const x = cx + r.range(-S * 0.07, S * 0.07);
    const y = cy + r.range(-S * 0.06, S * 0.06);
    c.moveTo(x, y);
    c.lineTo(x + r.range(-18, 18), y + r.range(-18, 18));
    c.lineTo(x + r.range(-18, 18), y + r.range(-18, 18));
    c.fill();
  }
  c.restore();
}

function diatom(c, S, seed) {
  c.fillStyle = '#0c1115';
  c.fillRect(0, 0, S, S);
  const cx = S / 2;
  const cy = S / 2;
  const R = S * 0.36;
  const glow = c.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.05);
  glow.addColorStop(0, '#29434a');
  glow.addColorStop(0.8, '#1b2e33');
  glow.addColorStop(1, 'rgba(12, 17, 21, 0)');
  c.fillStyle = glow;
  c.beginPath();
  c.arc(cx, cy, R * 1.05, 0, TAU);
  c.fill();
  const ribs = 48;
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * TAU;
    c.strokeStyle = 'rgba(214, 236, 230, 0.55)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * R * 0.2, cy + Math.sin(a) * R * 0.2);
    c.lineTo(cx + Math.cos(a) * R * 0.97, cy + Math.sin(a) * R * 0.97);
    c.stroke();
    for (let k = 0; k < 14; k++) {
      const rr = R * (0.26 + k * 0.05);
      const b = a + (0.5 / ribs) * TAU;
      c.fillStyle = `rgba(232, 214, 160, ${0.35 + 0.4 * noise2(seed, k, i)})`;
      c.beginPath();
      c.arc(cx + Math.cos(b) * rr, cy + Math.sin(b) * rr, 1.5 + k * 0.28, 0, TAU);
      c.fill();
    }
  }
  c.strokeStyle = 'rgba(240, 248, 244, 0.85)';
  c.lineWidth = 4;
  c.beginPath();
  c.arc(cx, cy, R, 0, TAU);
  c.stroke();
  c.lineWidth = 2;
  c.beginPath();
  c.arc(cx, cy, R * 0.2, 0, TAU);
  c.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    c.fillStyle = 'rgba(232, 214, 160, 0.8)';
    c.beginPath();
    c.arc(cx + Math.cos(a) * R * 0.11, cy + Math.sin(a) * R * 0.11, 5, 0, TAU);
    c.fill();
  }
}

/** The six close-up plates as square sprites of side `size`. */
export function plateSprites(size, seed) {
  return [fern, cells, rings, stars, agate, diatom].map((draw, i) =>
    staticLayer(size, size, (c) => draw(c, size, seed + i * 17)),
  );
}

/** The engraved moon for the sky, a square sprite of side `size`. */
export function moonSprite(size, seed) {
  return staticLayer(size, size, (c) => {
    const r = size / 2;
    const disc = new Path2D();
    disc.arc(r, r, r - 1, 0, TAU);
    c.fillStyle = '#f3ecd9';
    c.fill(disc);
    stipple(c, { x: 0, y: 0, width: size, height: size }, {
      clip: disc,
      seed,
      cell: Math.max(2, size / 240),
      size: [0.4, 1.1],
      color: '#4a4550',
      opacity: 0.85,
      tone: (x, y) =>
        clamp(0.03 + (fbm2(seed, (x / size) * 3, (y / size) * 3) - 0.52) * 1.5 + Math.max(0, Math.hypot(x - r, y - r) / r - 0.75)),
    });
  });
}

/** Long streaks of dusk cloud, lit from below, across a stage-sized sprite. */
export function cloudSprite(width, height, seed) {
  return staticLayer(width, height, (c) => {
    const r = rng(seed);
    for (let i = 0; i < 26; i++) {
      const y = height * (0.5 + 0.42 * r.next() ** 0.8);
      const x = r.range(-200, width + 200);
      const w = r.range(260, 900) * (0.6 + (y / height) * 0.6);
      const h = r.range(14, 42);
      const warm = (y / height - 0.5) / 0.45;
      c.save();
      c.filter = `blur(${(6 + h * 0.3).toFixed(1)}px)`;
      const g = c.createLinearGradient(0, y - h, 0, y + h);
      g.addColorStop(0, `rgba(${Math.round(120 + 90 * warm)}, ${Math.round(110 + 40 * warm)}, ${Math.round(150 - 20 * warm)}, 0.55)`);
      g.addColorStop(1, `rgba(255, ${Math.round(190 + 20 * warm)}, ${Math.round(160 + 20 * warm)}, 0.8)`);
      c.fillStyle = g;
      c.beginPath();
      c.ellipse(x, y, w / 2, h, r.range(-0.02, 0.02), 0, TAU);
      c.fill();
      c.restore();
    }
  });
}

export { INK };
