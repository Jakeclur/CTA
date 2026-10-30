// Smooth character bodies. Each body segment (torso, pelvis, head, upper arm,
// forearm and hand, thigh, shin and foot) is one mesh with clothing and skin
// painted in as vertex colours, so a whole person shares one material and
// costs one draw call per segment. Geometries are cached per look, so a crowd
// reuses them.
//
// Two levels of detail:
// * full (the player and mission characters): a lofted torso with a chest,
//   shoulder slope and an open jacket, a sculpted head (brow, eye sockets,
//   cheekbones, nose, lips, chin) with eyes and eyelids, a hair shell with a
//   hairline and strands, hands with fingers, laced trainers, and clothing
//   details such as seams, cuffs, pockets and a zip.
// * lite (crowds): coarser lathed shapes with a simple face.
import * as THREE from 'three';
import { mergeParts, part } from './props.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const cache = new Map();
const cached = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

export const characterMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const gauss = (dx, dy, s) => Math.exp(-(dx * dx + dy * dy) / (s * s));
const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

function paint(g, colourAt) {
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.set(colourAt(pos.getY(i), pos.getX(i), pos.getZ(i), i));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Lathed shape from [y, radius] pairs (bottom to top), smoothed, scaled in x/z.
// colourAt(y, x, z) paints it (sleeves, cuffs, seams, shorts).
function lathe(points, { sx = 1, sz = 1, segs = 14, steps = 16, colourAt }) {
  const curve = new THREE.SplineCurve(points.map(([y, r]) => new THREE.Vector2(r, y)));
  const pts = curve.getPoints(steps).map((p) => new THREE.Vector2(Math.max(0.0005, p.x), p.y));
  const g = new THREE.LatheGeometry(pts, segs);
  g.scale(sx, 1, sz);
  g.computeVertexNormals();
  return paint(g, colourAt);
}

// Lofted body from cross-sections [y, halfWidth, front, back, n]: each ring is a
// superellipse (n = 2 is an ellipse, higher is squarer) with separate depths in
// front and behind, so a chest and a flat back come out of one smooth surface.
// The rings are smoothed with a spline; the first and last should be tiny to close the shape.
function loft(rings, { segs = 40, steps = 40, colourAt }) {
  const curves = [1, 2, 3, 4].map((k) => new THREE.SplineCurve(rings.map((r) => new THREE.Vector2(r[0], r[k] ?? 2.4))));
  const pos = [];
  const idx = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = curves[0].getPoint(t).x;
    const [w, df, db, n] = curves.map((c) => c.getPoint(t).y);
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const e = 2 / n;
      const x = Math.max(0.0005, w) * Math.sign(ca) * Math.abs(ca) ** e;
      const z = (sa > 0 ? df : db) * Math.sign(sa) * Math.abs(sa) ** e;
      pos.push(x, y, z);
    }
  }
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * segs + j;
      const b = (i + 1) * segs + j;
      const c = i * segs + ((j + 1) % segs);
      const d = (i + 1) * segs + ((j + 1) % segs);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return paint(g, colourAt);
}

const ball = (rx, ry, rz, seg = 12) => {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, seg * 0.75));
  g.scale(rx, ry, rz);
  return g;
};
const keep = (geo) => part(geo, {}, null);

// A capsule from `start` heading along `dir` (a finger joint, a thumb).
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const DOWN = new THREE.Vector3(0, -1, 0);
function bone(start, dir, len, r, colour) {
  const d = dir.clone().normalize();
  _q.setFromUnitVectors(DOWN, d);
  _e.setFromQuaternion(_q);
  const mid = start.clone().addScaledVector(d, len / 2);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - r * 2), 3, 8);
  return { p: part(g, { x: mid.x, y: mid.y, z: mid.z, rx: _e.x, ry: _e.y, rz: _e.z }, colour), end: start.clone().addScaledVector(d, len), dir: d };
}

// ------------------------------------------------------------------ the head

// Heights of the features on the unit sphere (eyes halfway down the head).
const FACE = { eye: 0.0, brow: 0.17, nose: -0.36, mouth: -0.6 };

// Head shape on a unit sphere: returns the radial push for a point (ux, uy, uz)
// (x to the character's left, y up, z forward).
function sculpt(ux, uy, uz) {
  const ax = Math.abs(ux);
  const front = smooth(0.15, 0.6, uz);
  let r = 1;
  r -= 0.08 * gauss(ax - 0.36, uy - FACE.eye, 0.15) * front; // eye sockets
  r += 0.045 * gauss(ax - 0.33, uy - FACE.brow, 0.13) * front; // brow ridge
  r += 0.04 * gauss(ax - 0.55, uy - FACE.eye + 0.22, 0.2) * smooth(0, 0.4, uz); // cheekbones
  // nose: a ridge that grows out from between the eyes to the tip, then the nostrils
  const nose = Math.exp(-((ux / 0.12) ** 2)) * front;
  const top = FACE.eye + 0.08;
  const ridge = Math.min(1, Math.max(0, (top - uy) / (top - FACE.nose))) ** 1.6 * 0.24 * smooth(FACE.nose - 0.12, FACE.nose - 0.02, uy);
  r += nose * (ridge + 0.08 * gauss(0, uy - FACE.nose, 0.07));
  r += 0.06 * gauss(ax - 0.12, uy - FACE.nose + 0.02, 0.07) * front; // nostril wings
  // lips and the line of the mouth
  const lips = smooth(0.3, 0.16, ax) * front;
  r += 0.045 * gauss(0, uy - FACE.mouth - 0.055, 0.05) * lips;
  r += 0.05 * gauss(0, uy - FACE.mouth + 0.06, 0.05) * lips;
  r -= 0.035 * gauss(0, uy - FACE.mouth, 0.022) * lips;
  r += 0.05 * gauss(ux * 0.6, uy + 0.86, 0.13) * front; // chin
  return r;
}

// Where the hair starts, in unit-sphere height, for a direction around the head:
// high on the forehead, above the ears at the sides, low at the nape.
function hairline(uz, style) {
  const f = (uz + 1) / 2; // 1 at the front, 0 at the back
  const top = style === 'buzz' ? 0.6 : 0.56;
  return f > 0.5 ? 0.12 + (top - 0.12) * ((f - 0.5) / 0.5) ** 0.8 : -0.55 + 0.67 * (f / 0.5);
}

const HEAD = { sx: 0.084, sy: 0.118, front: 0.1, back: 0.108 };

function headShape(segs, rows, push = () => 1) {
  const g = new THREE.SphereGeometry(1, segs, rows);
  const p = g.attributes.position;
  const unit = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    // SphereGeometry's +z is forward and +x is to the right of the viewer: match the rig
    const ux = p.getX(i);
    const uy = p.getY(i);
    const uz = p.getZ(i);
    unit.set([ux, uy, uz], i * 3);
    const r = push(ux, uy, uz);
    const jaw = 1 - 0.22 * smooth(-0.05, -0.85, uy); // narrower towards the jaw
    p.setXYZ(i, ux * r * HEAD.sx * jaw, uy * r * HEAD.sy, uz * r * (uz > 0 ? HEAD.front : HEAD.back));
  }
  g.computeVertexNormals();
  g.userData.unit = unit;
  return g;
}

function fullHead(L) {
  const skin = L.skin;
  const hair = L.hair;
  const style = L.hairStyle || 'short';
  const lipCol = new THREE.Color(skin).lerp(new THREE.Color('#9a4a4a'), 0.38);
  const cheek = new THREE.Color(skin).lerp(new THREE.Color('#c0605a'), 0.12);
  const stubble = new THREE.Color(skin).lerp(new THREE.Color(hair), L.build === 'f' ? 0 : 0.14);
  const skinC = new THREE.Color(skin);
  const hairC = new THREE.Color(hair);
  const out = new THREE.Color();

  const skull = headShape(52, 40, sculpt);
  const u = skull.userData.unit;
  paint(skull, (y, x, z, i) => {
    const ux = u[i * 3];
    const uy = u[i * 3 + 1];
    const uz = u[i * 3 + 2];
    const ax = Math.abs(ux);
    const front = smooth(0.2, 0.6, uz);
    // scalp under the hair is painted hair coloured so no skin shows through
    if (style !== 'bald' && uy > hairline(uz, style) + 0.04) return out.copy(hairC).multiplyScalar(0.8);
    // eyebrows: an arch above each eye
    out.copy(skinC);
    // eyebrows: a soft arch above each eye, thicker towards the nose
    const browY = FACE.brow + 0.03 - (ax - 0.34) ** 2 * 1.2;
    const browW = 0.03 - (ax - 0.2) * 0.04;
    const brow = front * smooth(0.13, 0.17, ax) * smooth(0.54, 0.48, ax) * smooth(browW, browW * 0.4, Math.abs(uy - browY));
    const lips = smooth(0.27, 0.17, ax) * front;
    const lip = Math.max(gauss(0, uy - FACE.mouth - 0.05, 0.035), gauss(0, uy - FACE.mouth + 0.055, 0.04)) * lips;
    out.lerp(cheek, gauss(ax - 0.5, uy - FACE.eye + 0.3, 0.2) * front);
    out.lerp(stubble, smooth(FACE.nose - 0.05, FACE.mouth, uy) * front * 0.9);
    out.lerp(lipCol, smooth(0.35, 0.6, lip));
    // shading: eye sockets, under the brow, nostrils, the mouth line, below the lower lip
    let ao = 0.2 * gauss(ax - 0.36, uy - FACE.eye - 0.06, 0.11) * front;
    ao += 0.45 * gauss(ax - 0.07, uy - FACE.nose + 0.04, 0.035) * front;
    ao += 0.35 * gauss(0, uy - FACE.mouth, 0.02) * lips;
    ao += 0.12 * gauss(0, uy - FACE.mouth + 0.13, 0.04) * front;
    ao += 0.1 * gauss(ax - 0.11, uy - FACE.nose + 0.01, 0.12) * front; // beside the nose
    out.multiplyScalar(1 - Math.min(0.6, ao));
    out.lerp(hairC, brow * 0.9);
    return out;
  });

  const headY = 0.165;
  const parts = [part(skull, { y: headY }, null)];
  // neck, tucked into the skull and down into the collar
  parts.push(keep(lathe([[-0.05, 0.06], [0.02, 0.056], [0.07, 0.053], [0.11, 0.05], [0.15, 0.03]], {
    segs: 24, steps: 10, colourAt: (y) => (y > 0.1 ? skin : shade(skin, 0.93)),
  })));
  // eyes: whites, irises and pupils, set into the sockets, with eyelids
  for (const s of [-1, 1]) {
    const ex = s * 0.0302;
    const ey = headY + FACE.eye * HEAD.sy;
    const ez = 0.081;
    parts.push(part(ball(0.0118, 0.0118, 0.0118, 14), { x: ex, y: ey, z: ez }, '#ebe6dd'));
    parts.push(part(ball(0.0058, 0.0058, 0.0025, 12), { x: ex, y: ey, z: ez + 0.0105 }, L.eyes || '#4b3320'));
    parts.push(part(ball(0.0026, 0.0026, 0.0012, 8), { x: ex, y: ey, z: ez + 0.0127 }, '#0d0b0a'));
    const lid = new THREE.SphereGeometry(0.0128, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.38);
    parts.push(part(lid, { x: ex, y: ey, z: ez, rx: 0.35 }, shade(skin, 0.85)));
    const lower = new THREE.SphereGeometry(0.0124, 14, 4, 0, Math.PI * 2, Math.PI * 0.78, Math.PI * 0.22);
    parts.push(part(lower, { x: ex, y: ey, z: ez, rx: -0.5 }, shade(skin, 0.95)));
    // ears: an outer rim and a darker hollow
    parts.push(part(ball(0.011, 0.03, 0.02, 12), { x: s * 0.084, y: headY - 0.004, z: -0.004, ry: s * 0.35 }, skin));
    parts.push(part(ball(0.005, 0.018, 0.011, 8), { x: s * 0.091, y: headY - 0.004, z: -0.002, ry: s * 0.35 }, shade(skin, 0.7)));
  }

  if (style !== 'bald') {
    // the hair: a shell over the skull, thin at the hairline and fuller on top,
    // with streaks of lighter and darker strands
    const shell = headShape(52, 32, (ux, uy, uz) => {
      const hl = hairline(uz, style);
      const thick = 0.018 + (style === 'buzz' ? 0.01 : 0.06) * smooth(hl, hl + 0.35, uy);
      const crown = (style === 'buzz' ? 0.01 : 0.05) * Math.max(0, uy) * smooth(-0.2, 0.6, uz + 0.4);
      const tufts = style === 'buzz' ? 0 : 0.012 * Math.sin(Math.atan2(ux, uz) * 9 + uy * 6) * smooth(hl, hl + 0.2, uy);
      return 1 + thick + crown + tufts;
    });
    const su = shell.userData.unit;
    // keep only the triangles above the hairline
    const keepIdx = [];
    const idx = shell.index;
    for (let i = 0; i < idx.count; i += 3) {
      let ok = true;
      for (let k = 0; k < 3; k++) {
        const v = idx.getX(i + k);
        if (su[v * 3 + 1] < hairline(su[v * 3 + 2], style)) ok = false;
      }
      if (ok) keepIdx.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
    }
    shell.setIndex(keepIdx);
    paint(shell, (y, x, z, i) => {
      const ux = su[i * 3];
      const uy = su[i * 3 + 1];
      const uz = su[i * 3 + 2];
      const ang = Math.atan2(ux, uz);
      const strand = 0.5 + 0.5 * Math.sin(ang * 70 + Math.sin(ang * 13) * 3 + uy * 4);
      const edge = smooth(hairline(uz, style), hairline(uz, style) + 0.12, uy);
      return out.copy(hairC).multiplyScalar((0.78 + strand * 0.35) * (0.75 + edge * 0.25));
    });
    parts.push(part(shell, { y: headY }, null));
    if (style === 'long') {
      const back = loft([
        [-0.2, 0.001, 0.001, 0.001], [-0.18, 0.07, 0.02, 0.035], [-0.05, 0.095, 0.03, 0.05], [0.05, 0.1, 0.03, 0.055], [0.1, 0.09, 0.03, 0.05], [0.12, 0.001, 0.001, 0.001],
      ], { segs: 28, steps: 18, colourAt: (y, x) => shade(hair, 0.85 + 0.25 * (0.5 + 0.5 * Math.sin(x * 260))) });
      parts.push(part(back, { y: headY - 0.02, z: -0.06 }, null));
    }
    if (style === 'bun') parts.push(part(ball(0.045, 0.042, 0.045, 14), { y: headY + 0.11, z: -0.07 }, shade(hair, 0.9)));
  }
  if (L.cap) {
    const colour = L.capColour || hair;
    const capG = new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
    capG.scale(0.1, 0.1, 0.112);
    parts.push(part(capG, { y: headY + 0.035, z: -0.004 }, colour));
    parts.push(part(new RoundedBoxGeometry(0.17, 0.012, 0.1, 2, 0.005), { y: headY + 0.04, z: 0.115, rx: -0.12 }, shade(colour, 0.9)));
  }
  return mergeParts(parts);
}

// ------------------------------------------------------------------ hands and feet

// Hand hanging from the wrist (y = -0.25), palm towards the body (-x) and the
// thumb forward. The arm mesh is mirrored for the right side.
function fullHand(skin) {
  const parts = [part(new RoundedBoxGeometry(0.028, 0.085, 0.074, 3, 0.012), { y: -0.297, x: -0.002 }, skin)];
  const knuckle = shade(skin, 0.96);
  const fingers = [[0.026, 0.044], [0.009, 0.049], [-0.009, 0.046], [-0.025, 0.037]];
  fingers.forEach(([z, len], k) => {
    const curl = 0.18 + k * 0.05;
    let b = bone(new THREE.Vector3(-0.002, -0.336, z), new THREE.Vector3(-Math.sin(curl), -Math.cos(curl), 0), len * 0.55, 0.0082, knuckle);
    parts.push(b.p);
    const c2 = curl + 0.5;
    b = bone(b.end, new THREE.Vector3(-Math.sin(c2), -Math.cos(c2), 0), len * 0.5, 0.0074, skin);
    parts.push(b.p);
  });
  let t = bone(new THREE.Vector3(-0.01, -0.282, 0.03), new THREE.Vector3(-0.35, -0.55, 0.75), 0.032, 0.0098, skin);
  parts.push(t.p);
  t = bone(t.end, new THREE.Vector3(-0.45, -0.75, 0.45), 0.026, 0.0086, skin);
  parts.push(t.p);
  return parts;
}

// A trainer, from the ankle joint: sole, a padded upper that slopes down to the
// toe, a collar, a heel tab and laces.
function fullFoot(L) {
  const shoe = L.shoes;
  const parts = [];
  const upper = new RoundedBoxGeometry(0.094, 0.074, 0.245, 5, 0.032);
  const p = upper.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const z = p.getZ(i);
    // the toe slopes down and the heel narrows a little
    if (y > -0.01 && z > 0.0) p.setY(i, y - (z / 0.12) * 0.03 * (y + 0.01) / 0.047);
    if (z < -0.06) p.setX(i, p.getX(i) * (1 - (-0.06 - z) * 0.9));
  }
  upper.computeVertexNormals();
  paint(upper, (y, x, z) => (z > 0.075 && y < 0.0 ? shade(shoe, 0.92) : Math.abs(x) > 0.044 && y < -0.012 && z < 0.06 && z > -0.06 ? shade(shoe, 0.86) : shoe));
  parts.push(part(upper, { y: -0.008, z: 0.048 }, null));
  // sole: off-white with a grey stripe round the middle
  const sole = new RoundedBoxGeometry(0.1, 0.03, 0.272, 3, 0.012);
  paint(sole, (y) => (y > 0.004 ? '#f1eee8' : y > -0.006 ? '#9aa0a6' : '#4a4a4a'));
  parts.push(part(sole, { y: -0.05, z: 0.05 }, null));
  parts.push(part(new THREE.TorusGeometry(0.04, 0.011, 8, 20), { y: 0.028, z: -0.012, rx: Math.PI / 2 + 0.2, sz: 1.2 }, shade(shoe, 0.6)));
  parts.push(part(new RoundedBoxGeometry(0.03, 0.04, 0.012, 1, 0.004), { y: 0.03, z: -0.073, rx: 0.2 }, shade(L.pants, 0.9)));
  for (let k = 0; k < 4; k++) {
    const z = 0.02 + k * 0.025;
    parts.push(part(new RoundedBoxGeometry(0.046, 0.006, 0.009, 1, 0.002), { y: 0.03 - k * 0.0065, z: z + 0.012, rx: 0.25 }, '#e0ddd6'));
  }
  return mergeParts(parts);
}

// ------------------------------------------------------------------ the parts

// The look decides clothing: a jacket over a shirt, or a T-shirt with bare
// forearms; trousers or shorts; one of several hair styles; male or female build.
export function characterParts(L, lite) {
  return lite ? liteParts(L) : fullParts(L);
}

function fullParts(L) {
  const tee = L.jacket === L.shirt;
  const f = L.build === 'f';
  const k = `full|${f}`;
  const jacket = L.jacket;
  const pants = L.pants;

  const torso = cached(`t|${k}|${jacket}|${L.shirt}|${tee}`, () => {
    // cross-sections from the hem up to the base of the neck
    const rings = f
      ? [[-0.03, 0.001, 0.001, 0.001, 2], [-0.02, 0.15, 0.1, 0.1, 2.3], [0.1, 0.135, 0.09, 0.09, 2.3], [0.22, 0.145, 0.095, 0.085, 2.4],
        [0.33, 0.158, 0.123, 0.09, 2.4], [0.43, 0.162, 0.105, 0.088, 2.4], [0.5, 0.155, 0.082, 0.082, 2.4], [0.545, 0.12, 0.063, 0.068, 2.3],
        [0.58, 0.07, 0.055, 0.055, 2.2], [0.6, 0.001, 0.001, 0.001, 2]]
      : [[-0.03, 0.001, 0.001, 0.001, 2], [-0.02, 0.158, 0.1, 0.1, 2.3], [0.1, 0.152, 0.098, 0.1, 2.4], [0.24, 0.163, 0.112, 0.103, 2.5],
        [0.36, 0.178, 0.123, 0.105, 2.5], [0.44, 0.19, 0.112, 0.1, 2.4], [0.49, 0.183, 0.092, 0.09, 2.3], [0.53, 0.145, 0.072, 0.077, 2.2],
        [0.565, 0.085, 0.062, 0.064, 2.1], [0.6, 0.001, 0.001, 0.001, 2]];
    const jacketDark = shade(jacket, 0.72);
    const hem = shade(jacket, 0.82);
    const g = loft(rings, {
      segs: 60, steps: 44,
      colourAt: (y, x, z) => {
        const ax = Math.abs(x);
        if (!tee) {
          // zipped jacket: the zip runs up the middle of the front
          if (z > 0.03 && ax < 0.006) return jacketDark;
          if (z > 0.03 && y > 0.05 && y < 0.17 && ax > 0.07 && ax < 0.13) return Math.abs(y - 0.165) < 0.008 ? jacketDark : shade(jacket, 0.94); // pockets
        }
        if (y < 0.035) return hem; // hem band
        if (Math.abs(z) < 0.012 && y < 0.45) return shade(jacket, 0.88); // side seams
        if (y > 0.49 && Math.abs(ax - 0.1) < 0.006) return shade(jacket, 0.88); // shoulder seams
        return jacket;
      },
    });
    const parts = [keep(g)];
    // collar: a rolled band around the neck
    parts.push(part(new THREE.TorusGeometry(0.068, tee ? 0.009 : 0.016, 8, 32), { y: 0.575, z: 0.004, rx: Math.PI / 2 + 0.12, sy: tee ? 1 : 1.2 }, tee ? shade(jacket, 0.85) : jacket));
    if (!tee) {
      // zip pull at the collar, and the shirt's neckline showing inside the collar
      parts.push(part(new RoundedBoxGeometry(0.008, 0.024, 0.004, 1, 0.002), { y: 0.535, z: 0.087, rx: -0.3 }, '#b8bcc2'));
      parts.push(part(new THREE.TorusGeometry(0.058, 0.007, 6, 28), { y: 0.588, z: 0.008, rx: Math.PI / 2 + 0.2 }, L.shirt));
    }
    return mergeParts(parts);
  });

  const pelvis = cached(`p|${k}|${pants}|${tee}`, () => {
    const w = f ? 1.08 : 1;
    const parts = [keep(loft([
      [-0.15, 0.001, 0.001, 0.001, 2], [-0.135, 0.11 * w, 0.07, 0.08, 2.2], [-0.07, 0.16 * w, 0.095, 0.11, 2.4],
      [0.01, 0.163 * w, 0.1, 0.105, 2.4], [0.08, 0.155 * w, 0.097, 0.1, 2.4], [0.11, 0.001, 0.001, 0.001, 2],
    ], { segs: 40, steps: 20, colourAt: () => pants }))];
    if (tee) {
      // a belt with a buckle shows under a T-shirt
      parts.push(part(new THREE.CylinderGeometry(0.162, 0.162, 0.035, 32, 1, true), { y: 0.06, sx: f ? 1.18 : 1.1, sz: 0.74 }, '#3b2a1e'));
      parts.push(part(new RoundedBoxGeometry(0.04, 0.03, 0.01, 1, 0.003), { y: 0.06, z: 0.12 }, '#b8a77a'));
    }
    return mergeParts(parts);
  });

  const upperArm = cached(`ua|${k}|${jacket}|${L.skin}|${tee}`, () =>
    lathe([[-0.3, 0.001], [-0.285, 0.04], [-0.16, 0.045], [-0.05, f ? 0.048 : 0.053], [0.0, f ? 0.05 : 0.055], [0.03, 0.045], [0.048, 0.001]], {
      segs: 28, steps: 18,
      colourAt: (y) => (tee && y < -0.13 ? L.skin : tee && y < -0.115 ? shade(jacket, 0.85) : jacket),
    }),
  );

  const forearm = cached(`fa|${k}|${jacket}|${L.skin}|${tee}`, () => {
    const arm = lathe([[-0.255, 0.001], [-0.245, 0.03], [-0.2, 0.033], [-0.11, 0.04], [-0.03, 0.044], [0.02, 0.001]], {
      segs: 24, steps: 14,
      colourAt: (y) => (tee || y < -0.235 ? L.skin : y < -0.2 ? shade(jacket, 0.8) : jacket), // ribbed cuff
    });
    return mergeParts([keep(arm), ...fullHand(L.skin)]);
  });

  const thigh = cached(`th|${k}|${pants}|${L.skin}|${L.shorts}`, () =>
    lathe([[-0.47, 0.001], [-0.45, 0.056], [-0.3, 0.069], [-0.1, f ? 0.088 : 0.086], [0.02, 0.081], [0.05, 0.001]], {
      segs: 28, steps: 18,
      colourAt: (y, x, z) => {
        if (L.shorts && y < -0.28) return L.skin;
        const r = Math.hypot(x, z) || 1;
        if (y < -0.03 && Math.abs(x) / r > 0.97) return shade(pants, 0.84); // seams
        if (z / r > 0.6 && y > -0.32 && y < -0.05) return shade(pants, 1.08); // worn front
        return pants;
      },
    }),
  );

  const shin = cached(`sh|${k}|${pants}|${L.skin}|${L.shorts}`, () =>
    lathe([[-0.43, 0.001], [-0.42, 0.042], [-0.38, 0.045], [-0.3, 0.047], [-0.13, 0.058], [0, 0.055], [0.03, 0.001]], {
      segs: 26, steps: 16,
      colourAt: (y, x, z) => {
        if (L.shorts) return L.skin;
        const r = Math.hypot(x, z) || 1;
        if (y < -0.4) return shade(pants, 0.86); // turned-up hem
        return Math.abs(x) / r > 0.97 ? shade(pants, 0.84) : pants;
      },
    }),
  );

  const foot = cached(`ft|${k}|${L.shoes}|${pants}`, () => fullFoot(L));
  const head = cached(`h|${k}|${L.skin}|${L.hair}|${L.hairStyle}|${L.cap}|${L.capColour}|${L.eyes}`, () => fullHead(L));
  return { torso, pelvis, upperArm, forearm, thigh, shin, foot, head };
}

// Crowd detail: coarse lathed shapes, a ball for a hand, a simple face.
function liteParts(L) {
  const segs = 9;
  const steps = 9;
  const tee = L.jacket === L.shirt;
  const f = L.build === 'f';
  const k = `lite|${f}`;

  const torso = cached(`t|${k}|${L.jacket}|${L.shirt}|${tee}`, () => {
    const prof = f
      ? [[-0.02, 0.001], [0, 0.14], [0.13, 0.12], [0.3, 0.155], [0.44, 0.15], [0.53, 0.12], [0.58, 0.05], [0.6, 0.001]]
      : [[-0.02, 0.001], [0, 0.135], [0.12, 0.135], [0.3, 0.165], [0.45, 0.172], [0.53, 0.13], [0.58, 0.055], [0.6, 0.001]];
    return lathe(prof, {
      sx: f ? 1.1 : 1.18, sz: 0.64, segs, steps,
      colourAt: (y, x, z) => (!tee && z > 0.05 && Math.abs(x) < 0.02 + Math.max(0, y) * 0.1 ? L.shirt : L.jacket),
    });
  });

  const pelvis = cached(`p|${k}|${L.pants}`, () =>
    lathe([[-0.13, 0.001], [-0.1, 0.12], [-0.02, 0.15], [0.06, 0.14], [0.1, 0.001]], { sx: f ? 1.18 : 1.1, sz: 0.74, segs, steps: 8, colourAt: () => L.pants }),
  );

  const upperArm = cached(`ua|${k}|${L.jacket}|${L.skin}|${tee}`, () =>
    lathe([[-0.3, 0.001], [-0.28, 0.038], [-0.15, 0.045], [-0.02, f ? 0.05 : 0.055], [0.03, 0.05], [0.06, 0.001]], {
      segs, steps, colourAt: (y) => (tee && y < -0.13 ? L.skin : L.jacket),
    }),
  );

  const forearm = cached(`fa|${k}|${L.jacket}|${L.skin}|${tee}`, () => {
    const arm = lathe([[-0.25, 0.001], [-0.24, 0.031], [-0.12, 0.038], [-0.02, 0.042], [0.02, 0.001]], {
      segs, steps: 8, colourAt: (y) => (tee || y < -0.23 ? L.skin : L.jacket),
    });
    return mergeParts([keep(arm), part(ball(0.03, 0.06, 0.042, 8), { y: -0.3, z: 0.005 }, L.skin)]);
  });

  const thigh = cached(`th|${k}|${L.pants}|${L.skin}|${L.shorts}`, () =>
    lathe([[-0.47, 0.001], [-0.45, 0.055], [-0.3, 0.068], [-0.1, f ? 0.088 : 0.085], [0.02, 0.08], [0.05, 0.001]], {
      segs, steps, colourAt: (y) => (L.shorts && y < -0.28 ? L.skin : L.pants),
    }),
  );

  const shin = cached(`sh|${k}|${L.pants}|${L.skin}|${L.shorts}`, () =>
    lathe([[-0.43, 0.001], [-0.41, 0.04], [-0.3, 0.047], [-0.13, 0.058], [0, 0.054], [0.03, 0.001]], {
      segs, steps, colourAt: () => (L.shorts ? L.skin : L.pants),
    }),
  );

  const foot = cached(`ft|${k}|${L.shoes}`, () =>
    mergeParts([
      part(new RoundedBoxGeometry(0.1, 0.08, 0.26, 1, 0.03), { y: -0.015, z: 0.05 }, L.shoes),
      part(new RoundedBoxGeometry(0.108, 0.022, 0.272, 1, 0.01), { y: -0.051, z: 0.05 }, '#2b2b2b'),
    ]),
  );

  const head = cached(`h|${k}|${L.skin}|${L.hair}|${L.hairStyle}|${L.cap}|${L.capColour}`, () => {
    const skin = L.skin;
    const parts = [
      part(new THREE.CylinderGeometry(0.045, 0.052, 0.12, segs), { y: 0.05 }, skin),
      part(ball(0.088, 0.112, 0.1, 10), { y: 0.165 }, skin),
      part(ball(0.068, 0.058, 0.078, 8), { y: 0.1, z: 0.018 }, skin), // jaw
    ];
    const style = L.hairStyle || 'short';
    if (style !== 'bald') {
      const capG = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI * (style === 'long' ? 0.62 : 0.52));
      capG.scale(0.096, 0.12, 0.108);
      parts.push(part(capG, { y: 0.17, z: -0.012, rx: -0.28 }, L.hair));
      if (style === 'long') parts.push(part(new RoundedBoxGeometry(0.17, 0.2, 0.06, 1, 0.025), { y: 0.1, z: -0.075, rx: 0.12 }, L.hair));
      if (style === 'bun') parts.push(part(ball(0.045, 0.045, 0.045, 8), { y: 0.25, z: -0.07 }, L.hair));
    }
    if (L.cap) {
      const colour = L.capColour || L.hair;
      const capG = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
      capG.scale(0.104, 0.1, 0.114);
      parts.push(part(capG, { y: 0.19, z: -0.004 }, colour));
      parts.push(part(new RoundedBoxGeometry(0.17, 0.014, 0.1, 1, 0.006), { y: 0.198, z: 0.12, rx: -0.12 }, colour));
    }
    return mergeParts(parts);
  });

  return { torso, pelvis, upperArm, forearm, thigh, shin, foot, head };
}
