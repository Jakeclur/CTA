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
  return [c, c.getContext('2d')];
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

  const glass = (x, y, w, h, tone = rng()) => {
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
    }
  } else if (style === 'office') {
    g.fillStyle = '#dcd8d0';
    g.fillRect(0, 0, S, S);
    noise(g, S, S, rng, 3000, 0.05);
    for (let fy = 0; fy < 4; fy++) {
      const y = fy * cell + 22;
      glass(0, y, S, 72, 0.5);
      g.fillStyle = '#6f757a';
      for (let x = 0; x < S; x += 32) g.fillRect(x, y, 4, 72);
      g.fillStyle = '#bdb8ae';
      g.fillRect(0, y + 72, S, 6);
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
      for (let x = (y / 8) % 2 ? 0 : 8; x < S; x += 16) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + 8);
        g.stroke();
      }
    }
    noise(g, S, S, rng, 4000, 0.06);
    for (let fy = 0; fy < 4; fy++) {
      for (let bx = 0; bx < 4; bx++) {
        const x = bx * cell + 34;
        const y = fy * cell + 26;
        g.fillStyle = '#efeae2';
        g.fillRect(x - 6, y - 6, 72, 92);
        glass(x, y, 60, 76);
        curtain(x, y, 60, 76);
        g.fillStyle = '#f4f0ea';
        g.fillRect(x + 28, y, 4, 76);
        g.fillRect(x - 8, y + 80, 76, 8);
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
        if (balcony) {
          g.fillStyle = 'rgba(40,40,40,0.85)';
          g.fillRect(x - 22, y + 62, 92, 4);
          for (let i = 0; i < 12; i++) g.fillRect(x - 22 + i * 8, y + 62, 2, 34);
          g.fillRect(x - 22, y + 96, 92, 4);
        } else {
          g.fillStyle = '#e2dccf';
          g.fillRect(x - 6, y + 76, 60, 6);
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
  return { map, roughnessMap };
}

// Shop fronts: 2 shops per 14m tile, one storey (4.5m) high.
export function makeStorefront() {
  const rng = makeRng(7);
  const [c, g] = canvas(512, 160);
  const [rc, r] = canvas(512, 160);
  g.fillStyle = '#e8e4dc';
  g.fillRect(0, 0, 512, 160);
  r.fillStyle = '#d0d0d0';
  r.fillRect(0, 0, 512, 160);
  for (let s = 0; s < 2; s++) {
    const x0 = s * 256;
    // sign band
    g.fillStyle = '#f7f4ee';
    g.fillRect(x0 + 8, 6, 240, 28);
    // awning stripes
    for (let i = 0; i < 12; i++) {
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.9)' : 'rgba(170,170,170,0.9)';
      g.fillRect(x0 + 8 + i * 20, 34, 20, 14);
    }
    // display windows and door
    g.fillStyle = '#2b2f33';
    g.fillRect(x0 + 10, 50, 236, 108);
    const grad = g.createLinearGradient(0, 52, 0, 158);
    grad.addColorStop(0, '#5d7487');
    grad.addColorStop(1, '#22303b');
    g.fillStyle = grad;
    g.fillRect(x0 + 14, 54, 150, 104);
    g.fillRect(x0 + 200, 54, 42, 104);
    g.fillStyle = '#8a6a48';
    g.fillRect(x0 + 168, 60, 28, 98);
    g.fillStyle = 'rgba(255,240,210,0.15)';
    g.fillRect(x0 + 14, 120, 150, 38);
    // shelves of goods inside the window
    for (let k = 0; k < 18; k++) {
      g.fillStyle = `hsla(${rng() * 360},50%,60%,0.6)`;
      g.fillRect(x0 + 20 + rng() * 135, 100 + rng() * 40, 8, 10);
    }
    r.fillStyle = '#303030';
    r.fillRect(x0 + 14, 54, 150, 104);
    r.fillRect(x0 + 200, 54, 42, 104);
  }
  return { map: toTexture(c), roughnessMap: toTexture(rc, { srgb: false }) };
}

// ---------------------------------------------------------------- ground surfaces

export function makeAsphalt() {
  const rng = makeRng(11);
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#4a4c50';
  g.fillRect(0, 0, 512, 512);
  noise(g, 512, 512, rng, 40000, 0.12, 2);
  // patches and cracks
  for (let i = 0; i < 6; i++) {
    g.fillStyle = `rgba(30,30,32,${0.15 + rng() * 0.1})`;
    g.fillRect(rng() * 512, rng() * 512, 40 + rng() * 90, 30 + rng() * 60);
  }
  g.strokeStyle = 'rgba(20,20,20,0.35)';
  for (let i = 0; i < 8; i++) {
    g.beginPath();
    let x = rng() * 512;
    let y = rng() * 512;
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (rng() - 0.5) * 40;
      y += (rng() - 0.5) * 40;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return toTexture(c);
}

export function makePaving() {
  const rng = makeRng(12);
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#b9b6ae';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      const v = 175 + Math.floor(rng() * 25);
      g.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
      g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
    }
  noise(g, 256, 256, rng, 6000, 0.08);
  return toTexture(c);
}

export function makeConcrete() {
  const rng = makeRng(13);
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#a9a8a2';
  g.fillRect(0, 0, 256, 256);
  noise(g, 256, 256, rng, 9000, 0.07, 3);
  g.strokeStyle = 'rgba(60,60,60,0.25)';
  g.strokeRect(0.5, 0.5, 255, 255);
  return toTexture(c);
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
