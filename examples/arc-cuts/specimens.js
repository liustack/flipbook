// Twelve materials for the arc match cut. Each has what lies above the arc,
// what lies below it, an optional rim along the arc, and an ink color for the
// words that ride on it. Textures are drawn once into sprites in setup.
import { clamp, fbm2, hatch, noise2, rand, rng, staticLayer, stipple } from '/__flipbook/runtime.js';

const TAU = Math.PI * 2;

function fill(c, color, W, H) {
  c.fillStyle = color;
  c.fillRect(-W, -H, W * 3, H * 3);
}

/** A radial gradient around the arc's circle, stops given as [px from the arc (+ outward), color]. */
function around(c, arc, stops, W, H) {
  const inner = Math.min(...stops.map((s) => s[0]));
  const outer = Math.max(...stops.map((s) => s[0]));
  const g = c.createRadialGradient(arc.cx, arc.cy, arc.r + inner, arc.cx, arc.cy, arc.r + outer);
  for (const [at, color] of stops) g.addColorStop((at - inner) / (outer - inner), color);
  c.fillStyle = g;
  c.fillRect(-W, -H, W * 3, H * 3);
}

/** Concentric bands inside the arc, `widths` in px from the rim inward. */
function bands(c, arc, widths, colors) {
  let r = arc.r;
  widths.forEach((w, i) => {
    c.fillStyle = colors[i % colors.length];
    c.beginPath();
    c.arc(arc.cx, arc.cy, Math.max(1, r), 0, TAU);
    c.fill();
    r -= w;
  });
}

export function specimens(W, H, seed, arc) {
  const stage = { x: 0, y: 0, width: W, height: H };
  const sprite = (draw) => staticLayer(W, H, draw);
  const below = { x: -40, y: arc.apex[1] - 30, width: W + 80, height: H - arc.apex[1] + 80 };

  // Taller than the stage so the sky still has stars when the picture sinks.
  const starfield = staticLayer(W, H * 1.6, (c) => {
    const r = rng(seed);
    for (let i = 0; i < 640; i++) {
      c.fillStyle = `rgba(235, 238, 255, ${r.range(0.2, 0.9)})`;
      c.beginPath();
      c.arc(r.range(0, W), r.range(0, H * 1.4), r.next() ** 5 * 2.2 + 0.4, 0, TAU);
      c.fill();
    }
  });
  const bubbles = Array.from({ length: 46 }, (_, i) => {
    const u = rand(seed, 'bubble', i);
    const [x, y] = arc.path(u);
    return { x, y: y + 6 + rand(seed, 'depth', i) * 26, r: 3 + rand(seed, 'size', i) ** 2 * 14 };
  });
  const granules = sprite((c) => {
    stipple(c, below, {
      seed: seed + 3, cell: 5, size: [0.8, 2.6], color: '#9a3d08', opacity: 0.35,
      tone: (x, y) => clamp(0.25 + (noise2(seed, x / 18, y / 18) - 0.5) * 0.9),
    });
  });
  const crust = sprite((c) => {
    stipple(c, below, {
      seed: seed + 4, cell: 4, size: [0.7, 2.2], color: '#4a2210', opacity: 0.75,
      tone: (x, y) => clamp(0.2 + (fbm2(seed, x / 90, y / 90, 3) - 0.5) * 1.1),
    });
    stipple(c, below, { seed: seed + 5, cell: 7, size: [0.6, 1.6], color: '#f0c38a', opacity: 0.5, tone: 0.18 });
  });
  const grid = sprite((c) => {
    c.strokeStyle = 'rgba(235, 244, 255, 0.22)';
    c.lineWidth = 1.5;
    for (let x = 0; x <= W; x += 48) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, H);
      c.stroke();
    }
    for (let y = 0; y <= H; y += 48) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(W, y);
      c.stroke();
    }
    c.strokeStyle = 'rgba(245, 248, 255, 0.75)';
    c.lineWidth = 2.5;
    const r = rng(seed + 6);
    for (let i = 0; i < 14; i++) {
      const a = -Math.PI / 2 + r.range(-0.45, 0.45);
      c.beginPath();
      c.moveTo(arc.cx + Math.cos(a) * arc.r, arc.cy + Math.sin(a) * arc.r);
      c.lineTo(arc.cx + Math.cos(a) * (arc.r + 520), arc.cy + Math.sin(a) * (arc.r + 520));
      c.stroke();
    }
  });
  const veins = sprite((c) => {
    const root = [W * 0.42, H * 1.5];
    hatch(c, below, { seed: seed + 7, spacing: 6, length: 14, angle: -1.2, tone: 0.45, color: '#2f4a1c', opacity: 0.45 });
    c.strokeStyle = 'rgba(230, 240, 190, 0.75)';
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI / 2 + (i - 4) * 0.2;
      c.lineWidth = i === 4 ? 7 : 3;
      c.beginPath();
      c.moveTo(root[0], root[1]);
      c.quadraticCurveTo(
        root[0] + Math.cos(a) * 500,
        root[1] + Math.sin(a) * 500,
        root[0] + Math.cos(a) * 1400,
        root[1] + Math.sin(a) * 1400,
      );
      c.stroke();
    }
    c.strokeStyle = 'rgba(230, 240, 190, 0.35)';
    c.lineWidth = 1.5;
    const r = rng(seed + 8);
    for (let i = 0; i < 70; i++) {
      const x = r.range(0, W);
      const y = r.range(arc.apex[1], H);
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + r.range(-60, 60), y - r.range(30, 90));
      c.stroke();
    }
  });
  const pottery = sprite((c) => {
    stipple(c, below, { seed: seed + 9, cell: 4, size: [0.6, 1.8], color: '#6e2f1d', opacity: 0.5, tone: 0.3 });
  });
  const twill = sprite((c) => {
    hatch(c, stage, { seed: seed + 10, spacing: 5, length: 12, angle: -0.8, tone: 0.8, color: '#26405f', opacity: 0.7 });
    hatch(c, stage, { seed: seed + 11, spacing: 7, length: 10, angle: -0.8, tone: 0.4, color: '#9fb4cf', opacity: 0.35 });
  });
  const floral = sprite((c) => {
    const r = rng(seed + 12);
    for (let i = 0; i < 90; i++) {
      const x = r.range(-20, W + 20);
      const y = r.range(arc.apex[1] - 20, H + 20);
      const s = r.range(18, 34);
      c.fillStyle = '#6f8a4a';
      c.beginPath();
      c.ellipse(x + s * 1.1, y + s * 0.6, s * 0.9, s * 0.35, 0.5, 0, TAU);
      c.fill();
      c.fillStyle = r.next() < 0.5 ? '#e8905e' : '#f2c2a0';
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU;
        c.beginPath();
        c.arc(x + Math.cos(a) * s * 0.55, y + Math.sin(a) * s * 0.55, s * 0.45, 0, TAU);
        c.fill();
      }
      c.fillStyle = '#7a2218';
      c.beginPath();
      c.arc(x, y, s * 0.28, 0, TAU);
      c.fill();
    }
  });
  const stem = sprite((c) => {
    const step = 44;
    for (let row = 0; row * step * 0.87 < H; row++) {
      for (let col = -1; col * step < W + step; col++) {
        const x = col * step + (row % 2 ? step / 2 : 0) + (rand(seed, 'x', row, col) - 0.5) * 8;
        const y = arc.apex[1] - 20 + row * step * 0.87 + (rand(seed, 'y', row, col) - 0.5) * 8;
        const big = rand(seed, 'big', row, col) < 0.06;
        c.strokeStyle = '#2b7a74';
        c.lineWidth = 2.5;
        c.fillStyle = big ? '#0f5a57' : '#e8f1ec';
        c.beginPath();
        c.arc(x, y, big ? step * 0.62 : step * 0.44, 0, TAU);
        c.fill();
        c.stroke();
        if (big) {
          c.fillStyle = '#7fd0c4';
          for (let k = 0; k < 7; k++) {
            const a = (k / 7) * TAU;
            c.beginPath();
            c.arc(x + Math.cos(a) * 12, y + Math.sin(a) * 12, 5, 0, TAU);
            c.fill();
          }
        }
      }
    }
  });
  const ridge = sprite((c) => {
    hatch(c, below, {
      seed: seed + 13, spacing: 5, length: 26, angle: (x) => -1.3 + (noise2(seed, x / 120, 0) - 0.5) * 0.9,
      tone: (x, y) => clamp((fbm2(seed + 1, x / 110, y / 60, 3) - 0.45) * 1.8), color: '#1d1f24', opacity: 0.8,
    });
  });
  const cells = Array.from({ length: 30 }, (_, i) => {
    const [x, y] = arc.path((i + rand(seed, 'cell', i) * 0.6) / 30);
    return { x, y: y - 4, r: 14 + rand(seed, 'cr', i) * 22 };
  });

  return [
    {
      name: 'atmosphere',
      ink: '#f4efe6',
      above: (c) => {
        fill(c, '#04050a', W, H);
        c.drawImage(starfield.canvas, 0, -H * 0.6, W, H * 1.6);
      },
      below: (c, _i, info) => {
        fill(c, '#0a0d14', W, H);
        around(c, info.arc, [[-260, 'rgba(30, 60, 110, 0)'], [0, 'rgba(60, 110, 170, 0.55)']], W, H);
      },
      edge: (c, _i, info) =>
        around(c, info.arc, [
          [-24, 'rgba(255, 170, 90, 0)'],
          [0, 'rgba(255, 226, 180, 0.95)'],
          [8, 'rgba(255, 150, 70, 0.8)'],
          [34, 'rgba(90, 150, 225, 0.5)'],
          [90, 'rgba(40, 80, 160, 0.2)'],
          [200, 'rgba(20, 40, 90, 0)'],
        ], W, H),
    },
    {
      name: 'droplet',
      ink: '#f7ecd4',
      above: (c) => fill(c, '#050505', W, H),
      below: (c, _i, info) => {
        around(c, info.arc, [[-420, '#8a4d12'], [-140, '#c98a2a'], [0, '#f4c257']], W, H);
        for (const b of bubbles) {
          c.strokeStyle = 'rgba(255, 244, 214, 0.75)';
          c.lineWidth = 1.5;
          c.beginPath();
          c.arc(b.x, b.y, b.r, 0, TAU);
          c.stroke();
          c.fillStyle = 'rgba(255, 250, 235, 0.8)';
          c.beginPath();
          c.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.22, 0, TAU);
          c.fill();
        }
      },
      edge: (c, _i, info) =>
        around(c, info.arc, [[-3, 'rgba(255, 240, 200, 0)'], [0, 'rgba(255, 244, 220, 0.9)'], [4, 'rgba(255, 240, 200, 0)']], W, H),
    },
    {
      name: 'sun',
      ink: '#fff4de',
      above: (c) => fill(c, '#0b0604', W, H),
      below: (c, _i, info) => {
        around(c, info.arc, [[-500, '#d9661a'], [-160, '#f5a53a'], [0, '#ffd98a']], W, H);
        c.drawImage(granules.canvas, 0, 0, W, H);
        c.fillStyle = 'rgba(80, 30, 10, 0.8)';
        for (const [u, d, s] of [[0.36, 90, 9], [0.39, 110, 5], [0.62, 70, 7], [0.7, 150, 11]]) {
          const [x, y] = info.arc.path(u);
          c.beginPath();
          c.arc(x, y + d, s, 0, TAU);
          c.fill();
        }
      },
      edge: (c, _i, info) =>
        around(c, info.arc, [[0, 'rgba(255, 210, 130, 0.85)'], [40, 'rgba(255, 150, 60, 0.3)'], [160, 'rgba(255, 120, 40, 0)']], W, H),
    },
    {
      name: 'bread',
      ink: '#2a2520',
      above: (c) => fill(c, '#ebe7df', W, H),
      below: (c, _i, info) => {
        around(c, info.arc, [[-300, '#7a3a14'], [-60, '#a95a24'], [0, '#c27a3a']], W, H);
        c.drawImage(crust.canvas, 0, 0, W, H);
      },
      edge: (c, _i, info) =>
        around(c, info.arc, [[-6, 'rgba(255, 220, 170, 0)'], [0, 'rgba(255, 224, 180, 0.7)'], [14, 'rgba(60, 40, 20, 0.12)'], [40, 'rgba(60, 40, 20, 0)']], W, H),
    },
    {
      name: 'blueprint',
      ink: '#f5f2ea',
      above: (c) => {
        fill(c, '#2a5b8a', W, H);
        c.drawImage(grid.canvas, 0, 0, W, H);
      },
      below: (c, _i, info) => {
        fill(c, '#23507d', W, H);
        c.strokeStyle = 'rgba(240, 246, 255, 0.35)';
        c.lineWidth = 2;
        for (let k = 1; k < 14; k++) {
          c.beginPath();
          c.arc(info.arc.cx, info.arc.cy, info.arc.r - k * 34, 0, TAU);
          c.stroke();
        }
      },
      edge: (c, _i, info) => {
        c.strokeStyle = 'rgba(248, 250, 255, 0.9)';
        c.lineWidth = 3;
        c.beginPath();
        info.arc.trace(c);
        c.stroke();
      },
    },
    {
      name: 'leaf',
      ink: '#2a2520',
      above: (c) => fill(c, '#ece3cf', W, H),
      below: (c, _i, info) => {
        around(c, info.arc, [[-420, '#3f6a2a'], [-80, '#5e8c3a'], [0, '#7ea24c']], W, H);
        c.drawImage(veins.canvas, 0, 0, W, H);
      },
      edge: (c, _i, info) => {
        c.strokeStyle = '#34521f';
        c.lineWidth = 4;
        c.beginPath();
        info.arc.trace(c);
        c.stroke();
      },
    },
    {
      name: 'tissue',
      ink: '#fbe9ee',
      above: (c) => fill(c, '#0c0506', W, H),
      below: (c, _i, info) => around(c, info.arc, [[-420, '#7a1842'], [-100, '#b22d63'], [0, '#d0457a']], W, H),
      edge: (c) => {
        for (const cell of cells) {
          const g = c.createRadialGradient(cell.x - cell.r * 0.3, cell.y - cell.r * 0.3, cell.r * 0.1, cell.x, cell.y, cell.r);
          g.addColorStop(0, '#f06a55');
          g.addColorStop(0.7, '#c9322b');
          g.addColorStop(1, '#8e1c1c');
          c.fillStyle = g;
          c.beginPath();
          c.arc(cell.x, cell.y, cell.r, 0, TAU);
          c.fill();
        }
      },
    },
    {
      name: 'pottery',
      ink: '#f4e4d6',
      above: (c) => fill(c, '#1c1b1b', W, H),
      below: (c, _i, info) => {
        const { cx, cy, r } = info.arc;
        bands(c, info.arc, [18, 64, 12, 600], ['#d78a6c', '#2f3c37', '#d78a6c', '#c26b4d']);
        c.drawImage(pottery.canvas, 0, 0, W, H);
        c.strokeStyle = '#d78a6c';
        c.lineWidth = 5;
        c.beginPath();
        const step = 0.0105;
        let k = 0;
        for (let a = -Math.PI / 2 - 0.42; a < -Math.PI / 2 + 0.42; a += step, k++) {
          const rr = r - (k % 4 < 2 ? 34 : 64);
          const x = cx + Math.cos(a) * rr;
          const y = cy + Math.sin(a) * rr;
          if (k === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
          const rr2 = r - (k % 4 < 1 || k % 4 === 3 ? 34 : 64);
          c.lineTo(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2);
        }
        c.stroke();
      },
    },
    {
      name: 'agate',
      ink: '#fdf0f8',
      above: (c) => fill(c, '#8a3278', W, H),
      below: (c, _i, info) =>
        bands(
          c,
          info.arc,
          [10, 26, 8, 40, 14, 60, 10, 30, 22, 80, 12, 44, 400],
          ['#2b1a2a', '#f3e6ef', '#9b4d8b', '#e6d2e2', '#6d2a63', '#c48ab8', '#ffffff', '#b06aa0', '#f0e2ec', '#58204f', '#dcb8d4', '#7d3a72', '#f7eef4'],
        ),
    },
    {
      name: 'cloth',
      ink: '#f8eee2',
      above: (c) => {
        fill(c, '#3c5a86', W, H);
        c.drawImage(twill.canvas, 0, 0, W, H);
      },
      below: (c) => {
        fill(c, '#b8372c', W, H);
        c.drawImage(floral.canvas, 0, 0, W, H);
      },
      edge: (c, _i, info) => {
        c.strokeStyle = 'rgba(40, 14, 10, 0.5)';
        c.lineWidth = 6;
        c.beginPath();
        info.arc.trace(c);
        c.stroke();
      },
    },
    {
      name: 'stem',
      ink: '#1e2b2a',
      above: (c) => fill(c, '#e6e3dc', W, H),
      below: (c) => {
        fill(c, '#cfe2da', W, H);
        c.drawImage(stem.canvas, 0, 0, W, H);
      },
      edge: (c, _i, info) => {
        c.strokeStyle = '#1f5f5a';
        c.lineWidth = 7;
        c.beginPath();
        info.arc.trace(c);
        c.stroke();
      },
    },
    {
      name: 'ridge',
      ink: '#f6f4ef',
      above: (c) => fill(c, '#060708', W, H),
      below: (c, _i, info) => {
        around(c, info.arc, [[-400, '#8f8d88'], [-120, '#c9c6c0'], [0, '#eceae6']], W, H);
        c.drawImage(ridge.canvas, 0, 0, W, H);
      },
    },
  ];
}
