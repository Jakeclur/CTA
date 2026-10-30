// Procedural textures drawn on canvases at start-up, so the game needs no image files.
import * as THREE from 'three';
import { makeRng } from './utils.js';

let maxAniso = 4;
export function setMaxAnisotropy(a) {
  maxAniso = a;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

function toTexture(c, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.needsUpdate = true;
  return t;
}

function noise(ctx, w, h, rng, amount, alpha = 0.08, size = 2) {
  for (let i = 0; i < amount; i++) {
    const v = Math.floor(rng() * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.fillRect(rng() * w, rng() * h, size, size);
  }
}

// ---------------------------------------------------------------- building facades
// Each facade texture covers 4 bays x 4 floors (14m x 14m of wall).
// Walls are drawn light so per-building vertex colours can tint them.
// A matching roughness map keeps glass shiny and walls matte.

const FACADE_STYLES = ['glass', 'office', 'brick', 'stucco', 'house'];

export function makeFacades() {
  const out = {};
  FACADE_STYLES.forEach((style, i) => {
    out[style] = drawFacade(style, makeRng(100 + i));
  });
  return out;
}

function drawFacade(style, rng) {
  const S = 512;
  const cell = S / 4;
  const [c, g] = canvas(S, S);
  const [rc, r] = canvas(S, S);
  r.fillStyle = '#e0e0e0';
  r.fillRect(0, 0, S, S);
  // relief: bright = stands out, dark = set back (window recesses, mortar joints)
  const [hc, hg] = canvas(S, S);
  hg.fillStyle = '#969696';
  hg.fillRect(0, 0, S, S);
  const raise = (x, y, w, h, v = 210) => {
    hg.fillStyle = `rgb(${v},${v},${v})`;
    hg.fillRect(x, y, w, h);
  };
  // night lights: a quarter-size map of which windows glow after dark
  const [ec, e] = canvas(S / 2, S / 2);
  e.fillStyle = '#000';
  e.fillRect(0, 0, S / 2, S / 2);
  e.scale(0.5, 0.5);
  const WARM = ['#ffcf7a', '#ffe2a8', '#fff0cf', '#ffd08a', '#cfe2ff'];
  const lit = (x, y, w, h) => {
    // wide window bands are split into rooms that are lit separately
    const room = w > 120 ? 64 : w;
    for (let rx = x; rx < x + w - 1; rx += room) {
      if (rng() > 0.42) continue;
      // a lit room: brighter under the ceiling light, furniture in silhouette,
      // sometimes half-closed blinds or the blue flicker of a television
      const rw = Math.min(room, x + w - rx) - 2;
      const tv = rng() < 0.12;
      const base = tv ? '#7fa6e0' : WARM[Math.floor(rng() * WARM.length)];
      e.globalAlpha = 0.5 + rng() * 0.5;
      const grad = e.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, base);
      grad.addColorStop(1, 'rgba(60,40,20,1)');
      e.fillStyle = grad;
      e.fillRect(rx + 1, y + 1, rw, h - 2);
      e.fillStyle = 'rgba(20,14,8,0.85)';
      const pieces = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < pieces; k++) {
        const fw = rw * (0.15 + rng() * 0.3);
        const fh = h * (0.18 + rng() * 0.35);
        e.fillRect(rx + 1 + rng() * (rw - fw), y + h - 1 - fh, fw, fh);
      }
      if (rng() < 0.3) {
        e.fillStyle = 'rgba(0,0,0,0.5)';
        const drop = h * (0.2 + rng() * 0.5);
        for (let by = y + 1; by < y + drop; by += 5) e.fillRect(rx + 1, by, rw, 2);
      }
    }
    e.globalAlpha = 1;
  };

  const glass = (x, y, w, h, tone = rng()) => {
    lit(x, y, w, h);
    const grad = g.createLinearGradient(x, y, x, y + h);
    const top = 70 + tone * 50;
    grad.addColorStop(0, `rgb(${top * 0.75},${top * 0.95},${top * 1.15})`);
    grad.addColorStop(1, `rgb(${top * 0.35},${top * 0.45},${top * 0.6})`);
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
    // diagonal sky reflection streak
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.beginPath();
    g.moveTo(x + w * 0.2, y);
    g.lineTo(x + w * 0.45, y);
    g.lineTo(x + w * 0.1, y + h);
    g.lineTo(x - w * 0.15, y + h);
    g.fill();
    r.fillStyle = '#2a2a2a';
    r.fillRect(x, y, w, h);
    raise(x - 3, y - 3, w + 6, h + 6, 200); // frame
    raise(x, y, w, h, 40); // recessed pane
  };

  const curtain = (x, y, w, h) => {
    if (rng() < 0.35) {
      const shades = ['#d8cbb0', '#c9c2b8', '#9fa9b3', '#e6dcc8'];
      g.fillStyle = shades[Math.floor(rng() * shades.length)];
      g.globalAlpha = 0.85;
      g.fillRect(x, y, w, h * (0.25 + rng() * 0.6));
      g.globalAlpha = 1;
    }
  };

  if (style === 'glass') {
    g.fillStyle = '#c8cdd2';
    g.fillRect(0, 0, S, S);
    for (let fy = 0; fy < 4; fy++) {
      for (let bx = 0; bx < 8; bx++) {
        const x = bx * (S / 8);
        const y = fy * cell;
        glass(x + 3, y + 3, S / 8 - 6, cell - 20, 0.4 + rng() * 0.35);
      }
      g.fillStyle = '#9aa3ab';
      g.fillRect(0, fy * cell + cell - 17, S, 14);
      raise(0, fy * cell + cell - 17, S, 14, 170);
    }
  } else if (style === 'office') {
    g.fillStyle = '#dcd8d0';
    g.fillRect(0, 0, S, S);
    noise(g, S, S, rng, 3000, 0.05);
    for (let fy = 0; fy < 4; fy++) {
      const y = fy * cell + 22;
      glass(0, y, S, 72, 0.5);
      g.fillStyle = '#6f757a';
      for (let x = 0; x < S; x += 32) {
        g.fillRect(x, y, 4, 72);
        raise(x, y, 4, 72, 235);
      }
      g.fillStyle = '#bdb8ae';
      g.fillRect(0, y + 72, S, 6);
      raise(0, y + 72, S, 6, 240);
    }
  } else if (style === 'brick') {
    g.fillStyle = '#c9bfb4';
    g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(90,70,60,0.18)';
    g.lineWidth = 1;
    for (let y = 0; y < S; y += 8) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(S, y);
      g.stroke();
      raise(0, y, S, 1.5, 70);
      for (let x = (y / 8) % 2 ? 0 : 8; x < S; x += 16) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + 8);
        g.stroke();
        raise(x, y, 1.5, 8, 70);
      }
    }
    noise(g, S, S, rng, 4000, 0.06);
    for (let fy = 0; fy < 4; fy++) {
      for (let bx = 0; bx < 4; bx++) {
        const x = bx * cell + 34;
        const y = fy * cell + 26;
        g.fillStyle = '#efeae2';
        g.fillRect(x - 6, y - 6, 72, 92);
        raise(x - 6, y - 6, 72, 92, 185);
        glass(x, y, 60, 76);
        curtain(x, y, 60, 76);
        g.fillStyle = '#f4f0ea';
        g.fillRect(x + 28, y, 4, 76);
        g.fillRect(x - 8, y + 80, 76, 8);
        raise(x - 8, y + 80, 76, 8, 250); // sill
      }
    }
  } else if (style === 'stucco') {
    g.fillStyle = '#f2ede4';
    g.fillRect(0, 0, S, S);
    noise(g, S, S, rng, 5000, 0.04, 3);
    const shutters = ['#3d7a74', '#2f5d87', '#a3533f', '#5b6f3a', '#7b5a8c'];
    const shutter = shutters[Math.floor(rng() * shutters.length)];
    for (let fy = 0; fy < 4; fy++) {
      const balcony = rng() < 0.5;
      for (let bx = 0; bx < 4; bx++) {
        const x = bx * cell + 40;
        const y = fy * cell + 22;
        glass(x, y, 48, balcony ? 96 : 74);
        curtain(x, y, 48, 74);
        g.fillStyle = shutter;
        g.fillRect(x - 16, y, 14, balcony ? 96 : 74);
        g.fillRect(x + 50, y, 14, balcony ? 96 : 74);
        for (const sx of [x - 16, x + 50]) for (let k = 0; k < (balcony ? 96 : 74); k += 6) raise(sx, y + k, 14, 3, 190); // louvres
        if (balcony) {
          g.fillStyle = 'rgba(40,40,40,0.85)';
          g.fillRect(x - 22, y + 62, 92, 4);
          for (let i = 0; i < 12; i++) g.fillRect(x - 22 + i * 8, y + 62, 2, 34);
          g.fillRect(x - 22, y + 96, 92, 4);
        } else {
          g.fillStyle = '#e2dccf';
          g.fillRect(x - 6, y + 76, 60, 6);
          raise(x - 6, y + 76, 60, 6, 245);
        }
      }
    }
  } else if (style === 'house') {
    g.fillStyle = '#f4f1ea';
    g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(0,0,0,0.08)';
    for (let y = 0; y < S; y += 10) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(S, y);
      g.stroke();
      // weatherboards: each board thicker at the bottom
      const grad = hg.createLinearGradient(0, y, 0, y + 10);
      grad.addColorStop(0, '#707070');
      grad.addColorStop(1, '#c0c0c0');
      hg.fillStyle = grad;
      hg.fillRect(0, y, S, 10);
    }
    for (let fy = 0; fy < 4; fy++) {
      for (let bx = 0; bx < 4; bx++) {
        if (rng() < 0.3) continue;
        const x = bx * cell + 30;
        const y = fy * cell + 30;
        g.fillStyle = '#ffffff';
        g.fillRect(x - 5, y - 5, 78, 72);
        glass(x, y, 68, 62);
        curtain(x, y, 68, 62);
        g.fillStyle = '#ffffff';
        g.fillRect(x + 32, y, 4, 62);
        g.fillRect(x, y + 29, 68, 4);
      }
    }
  }

  const map = toTexture(c);
  const roughnessMap = toTexture(rc, { srgb: false });
  const emissiveMap = toTexture(ec);
  const normalMap = heightToNormal(hc, 5);
  return { map, roughnessMap, emissiveMap, normalMap };
}

// Shop fronts: 2 shops per 14 m tile, one storey (4.5 m) high. Stone piers,
// aluminium-framed display windows with lit interiors behind reflective glass,
// glass doors and a fascia band. Only the fascia takes the shop's colour (the
// mask texture says where); everything else keeps its real materials.
export function makeStorefront() {
  const W = 1024;
  const H = 320;
  const rng = makeRng(7);
  const [c, g] = canvas(W, H);
  const [rc, r] = canvas(W, H);
  const [mc, m] = canvas(W, H);
  const [ec, e] = canvas(W, H);
  const [hc, hg] = canvas(W, H);
  const fill = (ctx, style, x, y, w, h) => {
    ctx.fillStyle = style;
    ctx.fillRect(x, y, w, h);
  };
  fill(m, '#000', 0, 0, W, H);
  fill(e, '#000', 0, 0, W, H);
  fill(hg, '#808080', 0, 0, W, H);
  fill(r, '#c8c8c8', 0, 0, W, H);
  // stone base colour everywhere, then the parts on top
  const stone = fbm(rng, 6, 4);
  paint(g, W, H, (u, v) => {
    const k = 196 + (stone(u, v) - 0.5) * 30 + (rng() - 0.5) * 14;
    return [k, k - 4, k - 12];
  });
  const KINDS = ['fashion', 'cafe', 'grocery', 'tech'];
  for (let s = 0; s < 2; s++) {
    const x0 = s * 512;
    const kind = KINDS[Math.floor(rng() * KINDS.length)];
    // fascia: tinted, with a darker shadow line under it
    fill(g, '#e9e6e0', x0 + 30, 8, 452, 56);
    fill(m, '#fff', x0 + 30, 8, 452, 56);
    fill(g, 'rgba(0,0,0,0.35)', x0 + 30, 64, 452, 4);
    fill(hg, '#c8c8c8', x0 + 30, 8, 452, 56);
    fill(e, 'rgba(255,240,220,0.18)', x0 + 30, 8, 452, 56);
    // stone pier joints
    for (let y = 72; y < 300; y += 36) {
      for (const px of [x0, x0 + 488]) {
        fill(g, 'rgba(90,85,78,0.5)', px, y, 24, 2);
        fill(hg, '#505050', px, y, 24, 2);
      }
    }
    // display window and door openings
    const win = { x: x0 + 34, y: 74, w: 300, h: 214 };
    const door = { x: x0 + 350, y: 92, w: 122, h: 206 };
    for (const o of [win, door]) {
      interior(g, e, rng, o.x, o.y, o.w, o.h, kind);
      // reflection: a sky gradient and diagonal streaks over the interior
      const grad = g.createLinearGradient(o.x, o.y, o.x, o.y + o.h);
      grad.addColorStop(0, 'rgba(190,210,230,0.45)');
      grad.addColorStop(0.5, 'rgba(120,140,160,0.18)');
      grad.addColorStop(1, 'rgba(40,45,50,0.25)');
      g.fillStyle = grad;
      g.fillRect(o.x, o.y, o.w, o.h);
      g.fillStyle = 'rgba(255,255,255,0.09)';
      g.beginPath();
      g.moveTo(o.x + o.w * 0.15, o.y);
      g.lineTo(o.x + o.w * 0.4, o.y);
      g.lineTo(o.x + o.w * 0.12, o.y + o.h);
      g.lineTo(o.x - o.w * 0.12, o.y + o.h);
      g.fill();
      fill(r, '#141414', o.x, o.y, o.w, o.h);
      fill(hg, '#303030', o.x, o.y, o.w, o.h);
      // aluminium frame
      g.strokeStyle = '#8e959b';
      g.lineWidth = 7;
      g.strokeRect(o.x, o.y, o.w, o.h);
      hg.strokeStyle = '#e0e0e0';
      hg.lineWidth = 7;
      hg.strokeRect(o.x, o.y, o.w, o.h);
      r.strokeStyle = '#606060';
      r.lineWidth = 7;
      r.strokeRect(o.x, o.y, o.w, o.h);
    }
    // window mullion and transom
    fill(g, '#8e959b', win.x + win.w / 2 - 3, win.y, 6, win.h);
    fill(hg, '#e0e0e0', win.x + win.w / 2 - 3, win.y, 6, win.h);
    fill(g, '#8e959b', door.x, door.y + 40, door.w, 6);
    // door: glass with a long pull handle
    fill(g, '#b8bec4', door.x + door.w - 26, door.y + 90, 6, 70);
    fill(hg, '#ffffff', door.x + door.w - 26, door.y + 90, 6, 70);
    fill(r, '#303030', door.x + door.w - 26, door.y + 90, 6, 70);
    // dark granite stall riser under the window and a step at the door
    fill(g, '#2c2b2a', win.x - 4, win.y + win.h + 2, win.w + 8, 30);
    fill(hg, '#a0a0a0', win.x - 4, win.y + win.h + 2, win.w + 8, 30);
    fill(r, '#606060', win.x - 4, win.y + win.h + 2, win.w + 8, 30);
    fill(g, '#5d5a55', door.x - 6, H - 22, door.w + 12, 22);
  }
  fill(g, 'rgba(0,0,0,0.4)', 0, H - 6, W, 6); // grime line at the pavement
  return {
    map: toTexture(c),
    roughnessMap: toTexture(rc, { srgb: false }),
    tintMask: toTexture(mc, { srgb: false }),
    emissiveMap: toTexture(ec),
    normalMap: heightToNormal(hc, 4),
  };
}

// What you see through a shop window: a lit back wall, ceiling lights, and
// goods that depend on the kind of shop.
function interior(g, e, rng, x, y, w, h, kind) {
  const wall = { fashion: '#efe6dc', cafe: '#d9b48a', grocery: '#eef1e8', tech: '#dfe5ec' }[kind];
  const grad = g.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, wall);
  grad.addColorStop(0.75, '#8c8172');
  grad.addColorStop(1, '#4a4239');
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
  // ceiling light strips
  for (let lx = x + 20; lx < x + w - 20; lx += 60) {
    g.fillStyle = '#fffdf2';
    g.fillRect(lx, y + 8, 34, 4);
    e.fillStyle = '#ffffff';
    e.fillRect(lx - 4, y + 6, 42, 8);
  }
  const col = () => `hsl(${Math.floor(rng() * 360)},${40 + rng() * 40}%,${35 + rng() * 30}%)`;
  if (kind === 'fashion') {
    // clothes rails and two mannequins
    for (const ry of [y + h * 0.35, y + h * 0.6]) {
      g.fillStyle = '#6b6b6b';
      g.fillRect(x + 10, ry, w - 20, 2);
      for (let k = x + 14; k < x + w - 20; k += 9) {
        g.fillStyle = col();
        g.fillRect(k, ry + 2, 7, 26 + rng() * 14);
      }
    }
    for (const mx of [x + w * 0.3, x + w * 0.7]) {
      g.fillStyle = '#f1ece6';
      g.beginPath();
      g.arc(mx, y + h * 0.42, 7, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = col();
      g.fillRect(mx - 12, y + h * 0.46, 24, 44);
      g.fillStyle = '#3a3a3a';
      g.fillRect(mx - 9, y + h * 0.46 + 44, 18, 40);
    }
  } else if (kind === 'cafe') {
    // counter with a coffee machine, tables and pendant lamps
    g.fillStyle = '#5a3b26';
    g.fillRect(x + w * 0.55, y + h * 0.55, w * 0.42, h * 0.2);
    g.fillStyle = '#b0b4b8';
    g.fillRect(x + w * 0.7, y + h * 0.43, 30, 26);
    for (let k = 0; k < 3; k++) {
      const tx = x + 20 + k * 50;
      g.fillStyle = '#3d2a1d';
      g.fillRect(tx, y + h * 0.66, 36, 5);
      g.fillRect(tx + 16, y + h * 0.66, 4, 30);
      g.fillStyle = '#ffe3a3';
      g.beginPath();
      g.arc(tx + 18, y + h * 0.3, 8, 0, Math.PI);
      g.fill();
    }
  } else if (kind === 'grocery') {
    for (let sy = y + h * 0.25; sy < y + h * 0.78; sy += h * 0.13) {
      g.fillStyle = '#9a9a96';
      g.fillRect(x + 6, sy + 18, w - 12, 3);
      for (let k = x + 8; k < x + w - 12; k += 7 + rng() * 5) {
        g.fillStyle = col();
        g.fillRect(k, sy + 18 - (8 + rng() * 10), 6, 8 + rng() * 10);
      }
    }
  } else {
    // tech: display tables with glowing screens
    techScreens(g, e, x, y, w, h);
  }
  // at night the interior itself glows: copy it, dimmed towards the floor
  e.save();
  e.globalAlpha = 0.85;
  e.drawImage(g.canvas, x, y, w, h, x, y, w, h);
  e.restore();
  const shade = e.createLinearGradient(x, y, x, y + h);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.55)');
  e.fillStyle = shade;
  e.fillRect(x, y, w, h);
  for (let lx = x + 20; lx < x + w - 20; lx += 60) {
    e.fillStyle = '#ffffff';
    e.fillRect(lx - 4, y + 6, 42, 8);
  }
}

function techScreens(g, e, x, y, w, h) {
  for (let k = 0; k < 4; k++) {
    const tx = x + 14 + k * (w / 4);
    g.fillStyle = '#d8d8d8';
    g.fillRect(tx, y + h * 0.62, w / 4 - 20, 6);
    g.fillStyle = '#7fb8ec';
    g.fillRect(tx + 6, y + h * 0.5, w / 4 - 32, 20);
  }
}

// ---------------------------------------------------------------- surface detail helpers

// Tileable value noise in [0, 1]: `period` cells across the texture.
function tileNoise(rng, period) {
  const v = new Float32Array(period * period).map(() => rng());
  return (u, w) => {
    const x = u * period;
    const y = w * period;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (i, j) => v[(((j % period) + period) % period) * period + (((i % period) + period) % period)];
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}

function fbm(rng, base, octaves) {
  const layers = [];
  for (let o = 0; o < octaves; o++) layers.push(tileNoise(rng, base << o));
  return (u, w) => {
    let s = 0;
    let a = 0.5;
    let n = 0;
    for (const f of layers) {
      s += f(u, w) * a;
      n += a;
      a *= 0.5;
    }
    return s / n;
  };
}

// Fills a canvas pixel by pixel: fn(u, v) returns [r, g, b] (0-255).
function paint(ctx, w, h, fn) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x / w, y / h, x, y);
      const i = (y * w + x) * 4;
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
}

// Turns a greyscale height canvas (bright = raised) into a tangent-space normal map.
function heightToNormal(hc, strength = 2) {
  const w = hc.width;
  const h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const H = (x, y) => src[((((y % h) + h) % h) * w + (((x % w) + w) % w)) * 4] / 255;
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      d[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      d[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      d[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return toTexture(c, { srgb: false });
}

// A wandering crack drawn on several canvases at once.
function crack(ctxs, rng, x, y, len, width) {
  let a = rng() * Math.PI * 2;
  const pts = [[x, y]];
  for (let k = 0; k < len; k++) {
    a += (rng() - 0.5) * 1.1;
    x += Math.cos(a) * 9;
    y += Math.sin(a) * 9;
    pts.push([x, y]);
    if (rng() < 0.12 && len > 4) crack(ctxs, rng, x, y, Math.floor(len / 3), width * 0.7);
  }
  for (const [g, style] of ctxs) {
    g.strokeStyle = style;
    g.lineWidth = width;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts) g.lineTo(p[0], p[1]);
    g.stroke();
  }
}

// ---------------------------------------------------------------- ground surfaces

// Road asphalt: aggregate grain, tonal blotches, tyre-polished bands, sealed
// cracks, patch repairs and oil stains. 1024 px covers 8 m.
export function makeAsphalt() {
  const S = 1024;
  const rng = makeRng(11);
  const [c, g] = canvas(S, S);
  const [hc, h] = canvas(S, S);
  const [rc, r] = canvas(S, S);
  const big = fbm(rng, 3, 4);
  const fine = fbm(rng, 64, 3);
  paint(g, S, S, (u, v) => {
    const t = big(u, v);
    const f = fine(u, v);
    const speck = rng();
    let k = 78 + (t - 0.5) * 26 + (f - 0.5) * 30;
    if (speck > 0.985) k += 40 + rng() * 40; // light stones in the mix
    else if (speck < 0.02) k -= 22;
    return [k * 1.03, k, k * 0.95];
  });
  paint(h, S, S, (u, v) => {
    const k = 128 + (fine(u, v) - 0.5) * 120 + (rng() - 0.5) * 50;
    return [k, k, k];
  });
  paint(r, S, S, (u, v) => {
    const k = 225 - big(u, v) * 30;
    return [k, k, k];
  });
  // patch repairs: darker, smoother rectangles with sealed edges
  for (let i = 0; i < 4; i++) {
    const w = 120 + rng() * 260;
    const hh = 80 + rng() * 180;
    const x = rng() * S;
    const y = rng() * S;
    g.fillStyle = `rgba(30,29,28,${0.1 + rng() * 0.1})`;
    g.fillRect(x, y, w, hh);
    g.strokeStyle = 'rgba(20,20,20,0.35)';
    g.lineWidth = 3;
    g.strokeRect(x, y, w, hh);
    h.fillStyle = 'rgba(150,150,150,0.5)';
    h.fillRect(x, y, w, hh);
    r.fillStyle = 'rgba(200,200,200,0.6)';
    r.fillRect(x, y, w, hh);
  }
  // cracks, filled with dark sealant
  for (let i = 0; i < 9; i++) {
    crack([[g, 'rgba(14,14,15,0.75)'], [h, 'rgba(20,20,20,0.9)'], [r, 'rgba(150,150,150,0.9)']], rng, rng() * S, rng() * S, 8 + Math.floor(rng() * 14), 2 + rng() * 2.5);
  }
  // oil drips and tyre marks: darker and glossier
  for (let i = 0; i < 26; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const rad = 10 + rng() * 45;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, `rgba(10,10,12,${0.25 + rng() * 0.3})`);
    grad.addColorStop(1, 'rgba(10,10,12,0)');
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    const rg = r.createRadialGradient(x, y, 0, x, y, rad);
    rg.addColorStop(0, 'rgba(90,90,90,0.7)');
    rg.addColorStop(1, 'rgba(90,90,90,0)');
    r.fillStyle = rg;
    r.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return { map: toTexture(c), normalMap: heightToNormal(hc, 3), roughnessMap: toTexture(rc, { srgb: false }) };
}

// Worn road paint: mostly bright, with scuffed patches where the asphalt shows
// through. UVs are in metres.
export function makeWornPaint() {
  const S = 512;
  const rng = makeRng(21);
  const [c, g] = canvas(S, S);
  const n = fbm(rng, 6, 4);
  paint(g, S, S, (u, v) => {
    const t = n(u, v);
    const wear = Math.min(1, Math.max(0, (t - 0.52) * 5));
    let k = 245 - wear * 150 - rng() * 25;
    if (rng() < 0.03) k -= 70; // grit
    return [k, k, k];
  });
  return toTexture(c);
}

// Pavement slabs (1 m), each a slightly different tone, with chips, joints and stains.
export function makePaving() {
  const S = 512;
  const rng = makeRng(12);
  const [c, g] = canvas(S, S);
  const [hc, h] = canvas(S, S);
  const n = fbm(rng, 8, 4);
  const cell = S / 4;
  const tones = [];
  for (let i = 0; i < 16; i++) tones.push(172 + rng() * 26);
  paint(g, S, S, (u, v, x, y) => {
    const t = tones[Math.floor(y / cell) * 4 + Math.floor(x / cell)];
    const k = t + (n(u, v) - 0.5) * 22 + (rng() - 0.5) * 18;
    return [k, k - 3, k - 9];
  });
  paint(h, S, S, () => {
    const k = 170 + (rng() - 0.5) * 30;
    return [k, k, k];
  });
  for (let i = 0; i <= 4; i++) {
    for (const [ctx, style] of [[g, 'rgba(90,86,80,0.4)'], [h, '#383838']]) {
      ctx.fillStyle = style;
      ctx.fillRect(i * cell - 1, 0, 2, S);
      ctx.fillRect(0, i * cell - 1, S, 2);
    }
  }
  // gum spots, stains and chipped corners
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(60,58,55,${0.15 + rng() * 0.25})`;
    g.beginPath();
    g.arc(rng() * S, rng() * S, 2 + rng() * 4, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 8; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const rad = 20 + rng() * 50;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, 'rgba(90,85,75,0.22)');
    grad.addColorStop(1, 'rgba(90,85,75,0)');
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 3; i++) crack([[g, 'rgba(60,58,54,0.6)'], [h, 'rgba(40,40,40,0.9)']], rng, rng() * S, rng() * S, 4, 1.5);
  return { map: toTexture(c), normalMap: heightToNormal(hc, 2.5) };
}

export function makeConcrete() {
  const S = 512;
  const rng = makeRng(13);
  const [c, g] = canvas(S, S);
  const [hc, h] = canvas(S, S);
  const n = fbm(rng, 4, 5);
  paint(g, S, S, (u, v) => {
    const k = 168 + (n(u, v) - 0.5) * 40 + (rng() - 0.5) * 22;
    return [k, k - 1, k - 6];
  });
  paint(h, S, S, (u, v) => {
    const k = 128 + (n(u, v) - 0.5) * 60 + (rng() - 0.5) * 60;
    return [k, k, k];
  });
  g.strokeStyle = 'rgba(60,60,60,0.35)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, S - 3, S - 3);
  h.strokeStyle = '#303030';
  h.lineWidth = 4;
  h.strokeRect(2, 2, S - 4, S - 4);
  for (let i = 0; i < 4; i++) crack([[g, 'rgba(70,70,70,0.5)'], [h, 'rgba(40,40,40,0.9)']], rng, rng() * S, rng() * S, 6, 1.5);
  return { map: toTexture(c), normalMap: heightToNormal(hc, 2) };
}

export function makeGrass() {
  const rng = makeRng(14);
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#5c8a3c';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const h = 80 + rng() * 40;
    const l = 25 + rng() * 25;
    g.fillStyle = `hsla(${h},45%,${l}%,0.35)`;
    g.fillRect(rng() * 256, rng() * 256, 2, 3);
  }
  return toTexture(c);
}

export function makeSand() {
  const rng = makeRng(15);
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#e3cf9f';
  g.fillRect(0, 0, 256, 256);
  noise(g, 256, 256, rng, 12000, 0.1, 2);
  return toTexture(c);
}

export function makeWood() {
  const rng = makeRng(16);
  const [c, g] = canvas(256, 256);
  for (let i = 0; i < 8; i++) {
    const v = 120 + rng() * 40;
    g.fillStyle = `rgb(${v + 30},${v},${v - 40})`;
    g.fillRect(0, i * 32, 256, 30);
    g.fillStyle = 'rgba(40,25,10,0.6)';
    g.fillRect(0, i * 32 + 30, 256, 2);
  }
  noise(g, 256, 256, rng, 4000, 0.08, 2);
  return toTexture(c);
}

export function makeRoof() {
  const rng = makeRng(17);
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#8d8b86';
  g.fillRect(0, 0, 256, 256);
  noise(g, 256, 256, rng, 15000, 0.12, 2);
  return toTexture(c);
}

export function makeRoofTiles() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#e0e0e0';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 16) {
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(0, y + 13, 256, 3);
    for (let x = (y / 16) % 2 ? 0 : 12; x < 256; x += 24) {
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(x, y, 2, 16);
    }
  }
  return toTexture(c);
}

// Tileable normal map for the sea, made from summed sine waves.
export function makeWaterNormal() {
  const N = 256;
  const [c, g] = canvas(N, N);
  const img = g.createImageData(N, N);
  const rng = makeRng(18);
  const waves = Array.from({ length: 6 }, () => ({
    kx: Math.floor(rng() * 6 + 1) * (rng() < 0.5 ? 1 : -1),
    ky: Math.floor(rng() * 6 + 1),
    p: rng() * Math.PI * 2,
    a: 0.5 + rng(),
  }));
  const h = (x, y) =>
    waves.reduce((s, w) => s + w.a * Math.sin(((w.kx * x + w.ky * y) / N) * Math.PI * 2 + w.p), 0);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = h(x + 1, y) - h(x - 1, y);
      const dy = h(x, y + 1) - h(x, y - 1);
      const nx = -dx * 2;
      const ny = -dy * 2;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * N + x) * 4;
      img.data[i] = (nx / len) * 127 + 128;
      img.data[i + 1] = (ny / len) * 127 + 128;
      img.data[i + 2] = (1 / len) * 127 + 128;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return toTexture(c, { srgb: false });
}

// ---------------------------------------------------------------- signs and adverts
// One atlas holds every sign in the city: each entry is a row of the canvas.

export function makeSignAtlas(entries) {
  const W = 1024;
  const RH = 96;
  const [c, g] = canvas(W, RH * entries.length);
  entries.forEach((e, i) => {
    const y = i * RH;
    g.fillStyle = e.bg;
    g.fillRect(0, y, W, RH);
    if (e.border) {
      g.strokeStyle = e.border;
      g.lineWidth = 6;
      g.strokeRect(6, y + 6, W - 12, RH - 12);
    }
    g.fillStyle = e.fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 64;
    g.font = `800 ${size}px "Segoe UI", Arial, sans-serif`;
    while (g.measureText(e.text).width > W - 60 && size > 20) {
      size -= 4;
      g.font = `800 ${size}px "Segoe UI", Arial, sans-serif`;
    }
    g.fillText(e.text, W / 2, y + RH / 2 + 2);
  });
  const tex = toTexture(c, { repeat: false });
  const rows = entries.length;
  return {
    texture: tex,
    // UV rectangle for an entry (v counts from the bottom because textures are flipped)
    uv(i) {
      const v1 = 1 - i / rows;
      const v0 = 1 - (i + 1) / rows;
      return [0, v0, 1, v1];
    },
  };
}

const ADS = [
  { title: 'SUNSET COLA', tag: 'Taste the coast', a: '#ff6b35', b: '#f7c548', fg: '#fff' },
  { title: 'VORTEX MOTORS', tag: 'Drive louder.', a: '#111827', b: '#3b82f6', fg: '#fff' },
  { title: 'PALM BAY 101.7', tag: 'The sound of Solano', a: '#7c3aed', b: '#ec4899', fg: '#fff' },
  { title: "BIG RICO'S PIZZA", tag: 'Hot in 20 or it’s free', a: '#b91c1c', b: '#f59e0b', fg: '#fff' },
  { title: 'SOLANO BANK', tag: 'Your money, safe(ish)', a: '#065f46', b: '#10b981', fg: '#fff' },
  { title: 'AQUA MARINA', tag: 'Luxury living by the sea', a: '#0e7490', b: '#67e8f9', fg: '#06283d' },
  { title: 'NITRO ENERGY', tag: 'Sleep is optional', a: '#1f2937', b: '#84cc16', fg: '#f7fee7' },
  { title: 'FLYNN & PARTNERS', tag: 'Injured? Call us.', a: '#1e3a8a', b: '#93c5fd', fg: '#fff' },
];

export function makeAdAtlas() {
  const CW = 512;
  const CH = 256;
  const [c, g] = canvas(CW * 2, CH * 4);
  ADS.forEach((ad, i) => {
    const x = (i % 2) * CW;
    const y = Math.floor(i / 2) * CH;
    const grad = g.createLinearGradient(x, y, x + CW, y + CH);
    grad.addColorStop(0, ad.a);
    grad.addColorStop(1, ad.b);
    g.fillStyle = grad;
    g.fillRect(x, y, CW, CH);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath();
    g.arc(x + CW * 0.82, y + CH * 0.3, 120, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = ad.fg;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    let size = 60;
    g.font = `900 ${size}px "Segoe UI", Arial, sans-serif`;
    while (g.measureText(ad.title).width > CW - 60) {
      size -= 4;
      g.font = `900 ${size}px "Segoe UI", Arial, sans-serif`;
    }
    g.fillText(ad.title, x + 30, y + 130);
    g.font = `italic 600 30px "Segoe UI", Arial, sans-serif`;
    g.fillText(ad.tag, x + 32, y + 180);
  });
  const tex = toTexture(c, { repeat: false });
  return {
    texture: tex,
    count: ADS.length,
    uv(i) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      return [col / 2, 1 - (row + 1) / 4, (col + 1) / 2, 1 - row / 4];
    },
  };
}

// Small text texture, e.g. "POLICE" on car doors.
export function makeLabelTexture(text, fg = '#ffffff', bg = 'rgba(0,0,0,0)') {
  const [c, g] = canvas(256, 64);
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = fg;
  g.font = '900 44px "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  return toTexture(c, { repeat: false });
}

// ---------------------------------------------------------------- foliage

// A clump of leaves with transparent gaps, for tree crowns. Drawn in light
// greens so each tree's instance colour can tint it.
export function makeLeafCluster() {
  const S = 256;
  const rng = makeRng(31);
  const [c, g] = canvas(S, S);
  g.clearRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) {
    // leaves bunch towards the middle of the card
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * S * 0.42;
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r;
    const l = 150 + rng() * 80;
    g.save();
    g.translate(x, y);
    g.rotate(rng() * Math.PI * 2);
    g.fillStyle = `rgb(${l * 0.78},${l},${l * 0.62})`;
    g.beginPath();
    g.ellipse(0, 0, 5 + rng() * 4, 2.2 + rng() * 1.5, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = `rgba(80,100,60,0.5)`;
    g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(-5, 0);
    g.lineTo(5, 0);
    g.stroke();
    g.restore();
  }
  const t = toTexture(c, { repeat: false });
  t.premultiplyAlpha = false;
  return t;
}

// One palm frond: a central rib with leaflets fanning out on both sides.
export function makePalmFrond() {
  const W = 128;
  const H = 512;
  const rng = makeRng(32);
  const [c, g] = canvas(W, H);
  g.clearRect(0, 0, W, H);
  for (let y = 8; y < H - 4; y += 5) {
    const t = y / H;
    const len = (Math.sin(t * Math.PI) * 0.85 + 0.15) * (W / 2 - 4);
    const l = 140 + rng() * 70;
    g.strokeStyle = `rgb(${l * 0.8},${l},${l * 0.6})`;
    g.lineWidth = 2.4;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(W / 2, y);
      g.quadraticCurveTo(W / 2 + side * len * 0.5, y + 4, W / 2 + side * len, y + 14 + rng() * 6);
      g.stroke();
    }
  }
  g.fillStyle = '#c8c09a';
  g.fillRect(W / 2 - 2, 0, 4, H);
  return toTexture(c, { repeat: false });
}

// Light falling out of lit shop windows onto the pavement: one window bay
// across (u), bright at the wall and fading out over the paving (v = 1 at the wall).
export function makeWindowSpill() {
  const [c, ctx] = canvas(128, 64);
  const img = ctx.createImageData(128, 64);
  for (let y = 0; y < 64; y++) {
    const v = y / 63; // 0 at the far edge, 1 at the wall
    const fall = Math.pow(v, 2.2);
    for (let x = 0; x < 128; x++) {
      const u = x / 127;
      // the window glass spans most of the bay; the pillar between bays casts a soft gap
      const across = Math.min(1, Math.max(0, Math.min(u - 0.06, 0.94 - u) / 0.12 + (1 - v) * 0.5));
      const k = Math.round(255 * fall * (0.25 + 0.75 * across));
      const i = (y * 128 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = k;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = toTexture(c);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
