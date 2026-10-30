// Smooth character bodies. Each body segment (torso, pelvis, head, upper arm,
// forearm and hand, thigh, shin and shoe) is one mesh made from lathed,
// tapered shapes with clothing and skin painted in as vertex colours, so a
// whole person shares one material and costs one draw call per segment.
// Geometries are cached per look, so a crowd reuses them.
import * as THREE from 'three';
import { mergeParts, part } from './props.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const cache = new Map();
const cached = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

export const characterMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });

// Lathed shape from [y, radius] pairs (bottom to top), smoothed, scaled in x/z.
// colourAt(y) paints each ring (for sleeves, cuffs and shorts).
function lathe(points, { sx = 1, sz = 1, segs = 14, steps = 16, colourAt }) {
  const curve = new THREE.SplineCurve(points.map(([y, r]) => new THREE.Vector2(r, y)));
  const pts = curve.getPoints(steps).map((p) => new THREE.Vector2(Math.max(0.0005, p.x), p.y));
  const g = new THREE.LatheGeometry(pts, segs);
  g.scale(sx, 1, sz);
  g.computeVertexNormals();
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.set(colourAt(pos.getY(i)));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const ball = (rx, ry, rz, seg = 12) => {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, seg * 0.75));
  g.scale(rx, ry, rz);
  return g;
};
const keep = (geo) => part(geo, {}, null);

// The look decides clothing: a jacket over a shirt, or a T-shirt with bare
// forearms; trousers or shorts; one of several hair styles; male or female build.
export function characterParts(L, lite) {
  const segs = lite ? 9 : 16;
  const steps = lite ? 9 : 16;
  const tee = L.jacket === L.shirt;
  const f = L.build === 'f';
  const k = `${lite}|${f}`;
  const torsoKey = `t|${k}|${L.jacket}|${L.shirt}|${tee}`;

  const torso = cached(torsoKey, () => {
    const prof = f
      ? [[-0.02, 0.001], [0, 0.14], [0.13, 0.12], [0.3, 0.155], [0.44, 0.15], [0.53, 0.12], [0.58, 0.05], [0.6, 0.001]]
      : [[-0.02, 0.001], [0, 0.135], [0.12, 0.135], [0.3, 0.165], [0.45, 0.172], [0.53, 0.13], [0.58, 0.055], [0.6, 0.001]];
    const parts = [keep(lathe(prof, { sx: f ? 1.1 : 1.18, sz: 0.64, segs, steps, colourAt: () => L.jacket }))];
    if (!tee && !lite) {
      // open jacket: shirt showing down the front, and a collar
      parts.push(part(new RoundedBoxGeometry(0.11, 0.44, 0.03, 2, 0.012), { y: 0.3, z: f ? 0.088 : 0.094, rx: -0.04 }, L.shirt));
      parts.push(part(new THREE.TorusGeometry(0.068, 0.018, 6, 14), { y: 0.56, rx: Math.PI / 2 + 0.25 }, L.jacket));
    }
    return mergeParts(parts);
  });

  const pelvis = cached(`p|${k}|${L.pants}`, () =>
    lathe([[-0.13, 0.001], [-0.1, 0.12], [-0.02, 0.15], [0.06, 0.14], [0.1, 0.001]], { sx: f ? 1.18 : 1.1, sz: 0.74, segs, steps: 10, colourAt: () => L.pants }),
  );

  const upperArm = cached(`ua|${k}|${L.jacket}|${L.skin}|${tee}`, () =>
    lathe([[-0.3, 0.001], [-0.28, 0.038], [-0.15, 0.045], [-0.02, f ? 0.05 : 0.055], [0.03, 0.05], [0.06, 0.001]], {
      segs, steps, colourAt: (y) => (tee && y < -0.13 ? L.skin : L.jacket),
    }),
  );

  const forearm = cached(`fa|${k}|${L.jacket}|${L.skin}|${tee}`, () => {
    const arm = lathe([[-0.25, 0.001], [-0.24, 0.031], [-0.12, 0.038], [-0.02, 0.042], [0.02, 0.001]], {
      segs, steps: 10, colourAt: (y) => (tee || y < -0.23 ? L.skin : L.jacket),
    });
    const parts = [keep(arm), part(ball(0.03, 0.06, 0.042, lite ? 8 : 12), { y: -0.3, z: 0.005 }, L.skin)];
    if (!lite) parts.push(part(ball(0.013, 0.032, 0.015, 8), { x: 0.02, y: -0.285, z: 0.03, rz: -0.4 }, L.skin)); // thumb
    return mergeParts(parts);
  });

  const thigh = cached(`th|${k}|${L.pants}|${L.skin}|${L.shorts}`, () =>
    lathe([[-0.47, 0.001], [-0.45, 0.055], [-0.3, 0.068], [-0.1, f ? 0.088 : 0.085], [0.02, 0.08], [0.05, 0.001]], {
      segs, steps, colourAt: (y) => (L.shorts && y < -0.28 ? L.skin : L.pants),
    }),
  );

  const shin = cached(`sh|${k}|${L.pants}|${L.skin}|${L.shorts}|${L.shoes}`, () => {
    const leg = lathe([[-0.42, 0.001], [-0.4, 0.04], [-0.3, 0.047], [-0.13, 0.058], [0, 0.054], [0.03, 0.001]], {
      segs, steps, colourAt: () => (L.shorts ? L.skin : L.pants),
    });
    return mergeParts([
      keep(leg),
      part(new RoundedBoxGeometry(0.1, 0.08, 0.26, 2, 0.035), { y: -0.435, z: 0.05 }, L.shoes),
      part(new RoundedBoxGeometry(0.108, 0.022, 0.272, 1, 0.01), { y: -0.471, z: 0.05 }, '#2b2b2b'),
    ]);
  });

  const head = cached(`h|${k}|${L.skin}|${L.hair}|${L.hairStyle}|${L.cap}|${L.capColour}`, () => {
    const skin = L.skin;
    const parts = [
      part(new THREE.CylinderGeometry(0.045, 0.052, 0.12, segs), { y: 0.05 }, skin),
      part(ball(0.092, 0.112, 0.103, lite ? 10 : 18), { y: 0.165 }, skin),
      part(ball(0.072, 0.058, 0.08, lite ? 8 : 14), { y: 0.1, z: 0.018 }, skin), // jaw
    ];
    if (!lite) {
      const darker = new THREE.Color(skin).multiplyScalar(0.72).getStyle();
      const lips = new THREE.Color(skin).lerp(new THREE.Color('#9a4a4a'), 0.35).getStyle();
      parts.push(part(ball(0.014, 0.028, 0.022, 8), { y: 0.148, z: 0.103 }, skin)); // nose
      for (const sx of [-1, 1]) {
        parts.push(part(ball(0.012, 0.028, 0.02, 8), { x: sx * 0.09, y: 0.158, z: -0.005 }, skin)); // ears
        parts.push(part(ball(0.013, 0.009, 0.006, 8), { x: sx * 0.035, y: 0.172, z: 0.093 }, '#f2efe9')); // eyes
        parts.push(part(ball(0.006, 0.006, 0.004, 6), { x: sx * 0.035, y: 0.172, z: 0.099 }, '#2a1d14'));
        parts.push(part(new RoundedBoxGeometry(0.036, 0.008, 0.01, 1, 0.003), { x: sx * 0.036, y: 0.193, z: 0.096, rz: sx * -0.08 }, L.hair));
      }
      parts.push(part(new RoundedBoxGeometry(0.036, 0.008, 0.008, 1, 0.003), { y: 0.111, z: 0.094 }, lips));
      parts.push(part(ball(0.03, 0.012, 0.012, 8), { y: 0.135, z: 0.09 }, darker)); // shadow under the nose
    }
    const style = L.hairStyle || 'short';
    if (style !== 'bald') {
      const capG = new THREE.SphereGeometry(1, lite ? 10 : 18, 8, 0, Math.PI * 2, 0, Math.PI * (style === 'long' ? 0.62 : 0.52));
      capG.scale(0.098, 0.12, 0.11);
      parts.push(part(capG, { y: 0.17, z: -0.012, rx: -0.28 }, L.hair));
      if (style === 'long') parts.push(part(new RoundedBoxGeometry(0.17, 0.2, 0.06, 2, 0.025), { y: 0.1, z: -0.075, rx: 0.12 }, L.hair));
      if (style === 'bun') parts.push(part(ball(0.045, 0.045, 0.045, 10), { y: 0.25, z: -0.07 }, L.hair));
    }
    if (L.cap) {
      const colour = L.capColour || L.hair;
      const capG = new THREE.SphereGeometry(1, lite ? 10 : 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
      capG.scale(0.104, 0.1, 0.114);
      parts.push(part(capG, { y: 0.19, z: -0.004 }, colour));
      parts.push(part(new RoundedBoxGeometry(0.17, 0.014, 0.1, 1, 0.006), { y: 0.198, z: 0.12, rx: -0.12 }, colour));
    }
    return mergeParts(parts);
  });

  return { torso, pelvis, upperArm, forearm, thigh, shin, head };
}
