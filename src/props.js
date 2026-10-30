// Street furniture, trees, signs, billboards, rooftop clutter and the distant skyline.
// Repeated objects use InstancedMesh so hundreds of them cost one draw call each.
import * as THREE from 'three';
import { GeoBuilder, rgb } from './geometry.js';
import { makeSignAtlas, makeAdAtlas } from './textures.js';
import { makeRng } from './utils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _c = new THREE.Color();

// A primitive placed inside a prop template, with its own vertex colour.
export function part(geo, t = {}, color = '#ffffff') {
  _p.set(t.x || 0, t.y || 0, t.z || 0);
  _e.set(t.rx || 0, t.ry || 0, t.rz || 0);
  _q.setFromEuler(_e);
  _s.set(t.sx || 1, t.sy || 1, t.sz || 1);
  return { geo, m: new THREE.Matrix4().compose(_p, _q, _s), color };
}

// Merge several primitives into one geometry with a colour attribute.
// A part whose color is null keeps the colours already in its geometry.
export function mergeParts(parts) {
  const pos = [];
  const nor = [];
  const uv = [];
  const col = [];
  const idx = [];
  let off = 0;
  for (const p of parts) {
    const g = p.geo;
    const gp = g.attributes.position;
    const gn = g.attributes.normal;
    const gu = g.attributes.uv;
    _nm.getNormalMatrix(p.m);
    const gc = p.color === null ? g.attributes.color : null;
    if (!gc) _c.set(p.color);
    for (let i = 0; i < gp.count; i++) {
      _v.fromBufferAttribute(gp, i).applyMatrix4(p.m);
      pos.push(_v.x, _v.y, _v.z);
      _n.fromBufferAttribute(gn, i).applyMatrix3(_nm).normalize();
      nor.push(_n.x, _n.y, _n.z);
      if (gu) uv.push(gu.getX(i), gu.getY(i));
      else uv.push(0, 0);
      if (gc) col.push(gc.getX(i), gc.getY(i), gc.getZ(i));
      else col.push(_c.r, _c.g, _c.b);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off);
    else for (let i = 0; i < gp.count; i++) idx.push(i + off);
    off += gp.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(off > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

const Box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const Cyl = (rt, rb, h, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);

function instanced(geo, mat, recs, { cast = true, receive = true, color } = {}) {
  if (!recs.length) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, recs.length);
  recs.forEach((r, i) => {
    _p.set(r.x, r.y || 0, r.z);
    _e.set(0, r.rot || 0, 0);
    _q.setFromEuler(_e);
    const s = r.s || 1;
    _s.set(s, s, s);
    mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    if (color) mesh.setColorAt(i, color(r, i));
  });
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.computeBoundingSphere();
  return mesh;
}

export function buildProps(ctx, group) {
  const P = ctx.props;
  const C = ctx.colliders;
  const rng = makeRng(4242);
  const add = (m) => m && group.add(m);
  const vc = (opts = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, ...opts });
  const metal = vc({ metalness: 0.5, roughness: 0.45 });
  const plain = vc();

  // ---------------- street lights
  const lampPole = mergeParts([
    part(Cyl(0.09, 0.14, 8), { y: 4 }, '#5b6168'),
    part(Box(0.12, 0.12, 2.3), { y: 7.92, z: 1.1 }, '#5b6168'),
    part(Box(0.5, 0.16, 0.95), { y: 7.85, z: 2.2 }, '#3a3f45'),
  ]);
  add(instanced(lampPole, metal, P.streetlights));
  const lampGlow = new THREE.MeshStandardMaterial({ color: '#fff4d6', emissive: '#ffe2a8', emissiveIntensity: 0.25 });
  const glowGeo = Box(0.42, 0.04, 0.8);
  glowGeo.translate(0, 7.76, 2.2);
  const glowMesh = instanced(glowGeo, lampGlow, P.streetlights, { cast: false });
  add(glowMesh);
  // pools of light on the pavement under each lamp after dark
  const poolTex = makePoolTexture();
  const poolMat = new THREE.MeshBasicMaterial({
    map: poolTex, color: '#ffd9a0', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const poolGeo = new THREE.PlaneGeometry(13, 13);
  poolGeo.rotateX(-Math.PI / 2);
  poolGeo.translate(0, 0.2, 3.2);
  const pools = instanced(poolGeo, poolMat, P.streetlights, { cast: false });
  if (pools) {
    pools.receiveShadow = false;
    pools.visible = false;
    add(pools);
  }

  // ---------------- traffic lights
  const tlPole = mergeParts([
    part(Cyl(0.08, 0.1, 5.2), { y: 2.6 }, '#3d4248'),
    part(Box(0.42, 1.15, 0.32), { y: 3.6, z: 0.12 }, '#22262a'),
    part(Box(0.5, 1.25, 0.04), { y: 3.6, z: -0.05 }, '#1a1d20'),
  ]);
  add(instanced(tlPole, metal, P.trafficLights));
  const bulbs = ['red', 'yellow', 'green'].map((name, k) => {
    const g = new THREE.SphereGeometry(0.11, 7, 5);
    g.translate(0, 3.95 - k * 0.35, 0.3);
    const m = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    const mesh = instanced(g, m, P.trafficLights, { cast: false, color: () => new THREE.Color('#222') });
    add(mesh);
    return mesh;
  });
  const ON = [new THREE.Color('#ff3b30').multiplyScalar(2), new THREE.Color('#ffcc00').multiplyScalar(2), new THREE.Color('#34ff6a').multiplyScalar(1.6)];
  const OFF = [new THREE.Color('#3a1210'), new THREE.Color('#3a3110'), new THREE.Color('#10351a')];
  let lastPhase = '';
  function setSignals(t) {
    const { ns, ew } = signalState(t);
    const key = `${ns}${ew}`;
    if (key === lastPhase) return;
    lastPhase = key;
    P.trafficLights.forEach((L, i) => {
      const lit = L.phase === 'ns' ? ns : ew;
      bulbs.forEach((mesh, k) => mesh && mesh.setColorAt(i, k === lit ? ON[k] : OFF[k]));
    });
    bulbs.forEach((m) => m && (m.instanceColor.needsUpdate = true));
  }
  setSignals(0);

  // ---------------- trees
  const trunk = mergeParts([part(Cyl(0.13, 0.22, 2.6, 6), { y: 1.3 }, '#6b4a2f')]);
  const crown = mergeParts([
    part(new THREE.IcosahedronGeometry(1.9, 1), { y: 3.9, sy: 0.85 }, '#ffffff'),
    part(new THREE.IcosahedronGeometry(1.3, 0), { x: 0.8, y: 4.9, z: 0.3 }, '#ffffff'),
    part(new THREE.IcosahedronGeometry(1.25, 0), { x: -0.7, y: 4.5, z: -0.6 }, '#ffffff'),
  ]);
  const treeRecs = P.trees.map((t) => ({ ...t, rot: rng() * Math.PI * 2 }));
  add(instanced(trunk, plain, treeRecs));
  const greens = ['#4f7d34', '#5f8f3a', '#3f6b2c', '#6b9a3f', '#557a2b'];
  add(instanced(crown, vc({ flatShading: true, roughness: 0.9 }), treeRecs, {
    color: () => new THREE.Color(greens[Math.floor(rng() * greens.length)]),
  }));
  for (const t of P.trees) C.addPost(t.x, t.z, 0.3 * (t.s || 1), 6);

  // ---------------- palms
  const palmTrunk = Cyl(0.13, 0.22, 7.2, 6);
  palmTrunk.translate(0, 3.6, 0);
  const tp = palmTrunk.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i) / 7.2;
    tp.setX(i, tp.getX(i) + y * y * 0.9);
  }
  palmTrunk.computeVertexNormals();
  add(instanced(mergeParts([part(palmTrunk, {}, '#8a6d4d')]), plain, P.palms));
  add(instanced(makePalmFronds(), vc({ side: THREE.DoubleSide, roughness: 0.9 }), P.palms, {
    color: () => new THREE.Color(greens[Math.floor(rng() * 3)]).multiplyScalar(1.1),
  }));

  // ---------------- benches, bins, hydrants
  const bench = mergeParts([
    part(Box(1.8, 0.07, 0.48), { y: 0.46 }, '#8b5a2b'),
    part(Box(1.8, 0.4, 0.06), { y: 0.78, z: -0.24, rx: -0.15 }, '#8b5a2b'),
    part(Box(0.07, 0.46, 0.5), { x: -0.8, y: 0.23 }, '#2f3337'),
    part(Box(0.07, 0.46, 0.5), { x: 0.8, y: 0.23 }, '#2f3337'),
  ]);
  add(instanced(bench, plain, P.benches));
  for (const b of P.benches) C.addPost(b.x, b.z, 0.6, 1);
  const bin = mergeParts([
    part(Cyl(0.3, 0.26, 0.9, 10), { y: 0.45 }, '#2e5e3e'),
    part(Cyl(0.32, 0.32, 0.06, 10), { y: 0.92 }, '#1f2a24'),
  ]);
  add(instanced(bin, plain, P.bins));
  for (const b of P.bins) C.addPost(b.x, b.z, 0.3, 1);
  const hydrant = mergeParts([
    part(Cyl(0.14, 0.16, 0.6, 8), { y: 0.3 }, '#c0392b'),
    part(new THREE.SphereGeometry(0.15, 8, 6), { y: 0.62 }, '#c0392b'),
    part(Cyl(0.06, 0.06, 0.4, 6), { y: 0.42, rz: Math.PI / 2 }, '#a93226'),
  ]);
  add(instanced(hydrant, plain, P.hydrants));
  for (const h of P.hydrants) C.addPost(h.x, h.z, 0.2, 0.8);

  // ---------------- beach umbrellas and lifeguard towers
  const umbrella = mergeParts([
    part(Cyl(0.03, 0.03, 2.4, 6), { y: 1.2 }, '#dddddd'),
    part(new THREE.ConeGeometry(1.4, 0.5, 10, 1, true), { y: 2.3 }, '#ffffff'),
  ]);
  const umbrellaColors = ['#e63946', '#2a9d8f', '#f4a261', '#457b9d', '#e9c46a'];
  add(instanced(umbrella, vc({ side: THREE.DoubleSide }), P.umbrellas, {
    color: (r) => new THREE.Color(umbrellaColors[r.color % umbrellaColors.length]),
  }));
  const tower = mergeParts([
    ...[[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]].map(([x, z]) => part(Box(0.15, 2.4, 0.15), { x, y: 1.2, z }, '#f1f1f1')),
    part(Box(3, 0.12, 3), { y: 2.45 }, '#f1f1f1'),
    part(Box(2.4, 1.6, 2.4), { y: 3.3 }, '#e63946'),
    part(Box(3.2, 0.12, 3.2), { y: 4.2 }, '#ffffff'),
    part(Box(1.8, 0.7, 0.05), { y: 3.5, z: 1.22 }, '#1d3557'),
  ]);
  add(instanced(tower, plain, P.lifeguards));

  // ---------------- rooftop details
  const ac = mergeParts([
    part(Box(2, 1.1, 1.4), { y: 0.55 }, '#b8bcc0'),
    part(Cyl(0.45, 0.45, 0.08, 12), { x: 0.4, y: 1.12 }, '#4b5157'),
    part(Box(0.6, 0.5, 0.5), { x: -0.6, y: 1.35 }, '#9ea3a8'),
  ]);
  add(instanced(ac, metal, P.ac));
  const tank = mergeParts([
    ...[[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]].map(([x, z]) => part(Box(0.15, 1.6, 0.15), { x, y: 0.8, z }, '#3b3b3b')),
    part(Cyl(1.3, 1.3, 2.4, 14), { y: 2.8 }, '#8a6748'),
    part(new THREE.ConeGeometry(1.4, 0.8, 14), { y: 4.4 }, '#5c4330'),
  ]);
  add(instanced(tank, plain, P.tanks));
  const antenna = mergeParts([
    part(Cyl(0.08, 0.15, 14, 6), { y: 7 }, '#cfd3d6'),
    part(Box(0.6, 0.6, 0.6), { y: 1 }, '#8d9399'),
    part(new THREE.SphereGeometry(0.18, 8, 6), { y: 14.1 }, '#ff3b30'),
  ]);
  add(instanced(antenna, metal, P.antennas));
  for (const h of P.helipads) {
    const pad = new THREE.Mesh(new THREE.CircleGeometry(7, 32), new THREE.MeshStandardMaterial({ color: '#3a3f44', roughness: 0.9 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(h.x, h.y + 0.01, h.z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(5.6, 6.1, 40), new THREE.MeshStandardMaterial({ color: '#f2c230' }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(h.x, h.y + 0.03, h.z);
    const hBar = new GeoBuilder();
    const y = h.y + 0.03;
    hBar.top(h.x - 2, h.z - 2.5, h.x - 1.2, h.z + 2.5, y, 1, rgb('#ffffff'));
    hBar.top(h.x + 1.2, h.z - 2.5, h.x + 2, h.z + 2.5, y, 1, rgb('#ffffff'));
    hBar.top(h.x - 1.2, h.z - 0.4, h.x + 1.2, h.z + 0.4, y, 1, rgb('#ffffff'));
    group.add(pad, ring, hBar.mesh(new THREE.MeshStandardMaterial({ vertexColors: true })));
  }

  // ---------------- petrol station pumps and canopies
  const pump = mergeParts([
    part(Box(1.2, 0.25, 3.2), { y: 0.125 }, '#c9c5bd'),
    part(Box(0.7, 1.7, 0.5), { y: 1.1, z: -0.7 }, '#f1f1f1'),
    part(Box(0.72, 0.3, 0.52), { y: 1.85, z: -0.7 }, '#e4572e'),
    part(Box(0.7, 1.7, 0.5), { y: 1.1, z: 0.7 }, '#f1f1f1'),
    part(Box(0.72, 0.3, 0.52), { y: 1.85, z: 0.7 }, '#e4572e'),
    part(Box(0.4, 0.3, 0.05), { y: 1.35, z: -0.97 }, '#1f2937'),
    part(Box(0.4, 0.3, 0.05), { y: 1.35, z: 0.97 }, '#1f2937'),
  ]);
  add(instanced(pump, plain, P.pumps.map((p) => ({ ...p, y: 0.15 }))));
  const canopy = new GeoBuilder();
  for (const c of P.canopies) {
    const hw = c.w / 2;
    const hd = c.d / 2;
    canopy.box(c.x - hw, c.h, c.z - hd, c.x + hw, c.h + 0.9, c.z + hd, rgb('#f4f4f4'), 4, true);
    canopy.walls(c.x - hw - 0.02, c.z - hd - 0.02, c.x + hw + 0.02, c.z + hd + 0.02, c.h + 0.3, c.h + 0.75, 4, 4, rgb('#e4572e'));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const px = c.x + sx * (hw - 1.5);
      const pz = c.z + sz * (hd - 1.5);
      canopy.box(px - 0.3, 0, pz - 0.3, px + 0.3, c.h, pz + 0.3, rgb('#d9d9d9'), 4);
    }
  }
  add(canopy.mesh(vc({ roughness: 0.6 }), { castShadow: true }));
  // Lights under the canopy
  for (const c of P.canopies) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(c.w - 4, 1.2), new THREE.MeshBasicMaterial({ color: '#fffbea' }));
    panel.rotation.x = Math.PI / 2;
    panel.position.set(c.x, c.h - 0.01, c.z);
    group.add(panel);
  }

  // ---------------- fountains (animated spray)
  const sprays = [];
  for (const f of P.fountains) {
    const basin = new THREE.Mesh(
      mergeParts([
        part(Cyl(3.2, 3.4, 0.7, 28), { y: 0.5 }, '#d6d0c4'),
        part(Cyl(0.5, 0.7, 1.8, 12), { y: 1.1 }, '#d6d0c4'),
        part(Cyl(1.2, 1.0, 0.2, 16), { y: 2 }, '#d6d0c4'),
      ]),
      vc({ roughness: 0.8 }),
    );
    basin.position.set(f.x, 0, f.z);
    basin.castShadow = true;
    basin.receiveShadow = true;
    const water = new THREE.Mesh(new THREE.CircleGeometry(3, 28), new THREE.MeshStandardMaterial({ color: '#4fb3d9', roughness: 0.05, metalness: 0.3 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(f.x, 0.8, f.z);
    const spray = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.4, 12, 1, true), new THREE.MeshStandardMaterial({ color: '#dff6ff', transparent: true, opacity: 0.55, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false }));
    spray.position.set(f.x, 3.2, f.z);
    spray.rotation.x = Math.PI;
    sprays.push(spray);
    group.add(basin, water, spray);
  }

  // ---------------- signs (one atlas for every sign in the city)
  const entryIndex = new Map();
  const entries = [];
  const style = {
    shop: { bg: '#f8f5ef', fg: '#1f2937', border: '#1f2937' },
    street: { bg: '#1f6f43', fg: '#ffffff', border: '#ffffff' },
    police: { bg: '#1e3a8a', fg: '#ffffff' },
    hospital: { bg: '#ffffff', fg: '#c0392b', border: '#c0392b' },
    petrol: { bg: '#e4572e', fg: '#ffffff' },
    garage: { bg: '#111827', fg: '#f5b700', border: '#f5b700' },
  };
  for (const s of ctx.signs) {
    const key = `${s.kind}|${s.text}`;
    if (!entryIndex.has(key)) {
      entryIndex.set(key, entries.length);
      entries.push({ text: s.text, ...style[s.kind] });
    }
  }
  const atlas = makeSignAtlas(entries);
  const signB = new GeoBuilder();
  const white = rgb('#ffffff');
  for (const s of ctx.signs) {
    const uv = atlas.uv(entryIndex.get(`${s.kind}|${s.text}`));
    const c = Math.cos(s.rot);
    const sn = Math.sin(s.rot);
    const hw = s.w / 2;
    const hh = s.h / 2;
    // local +x maps to world (cos, -sin) when rotated by rot about y
    const P0 = (lx, ly) => [s.x + lx * c, s.y + ly, s.z - lx * sn];
    const nrm = [sn, 0, c];
    signB.quad(P0(-hw, -hh), P0(hw, -hh), P0(hw, hh), P0(-hw, hh), nrm, uv, white);
    if (s.twoSided) {
      const back = [-sn, 0, -c];
      const off = 0.03;
      const Q = (lx, ly) => [s.x + lx * c - sn * off, s.y + ly, s.z - lx * sn - c * off];
      signB.quad(Q(hw, -hh), Q(-hw, -hh), Q(-hw, hh), Q(hw, hh), back, uv, white);
    }
  }
  add(signB.mesh(new THREE.MeshStandardMaterial({
    map: atlas.texture, emissive: '#ffffff', emissiveMap: atlas.texture, emissiveIntensity: 0.18, roughness: 0.6,
  }), { receiveShadow: false }));

  // ---------------- billboards
  const ads = makeAdAtlas();
  const adB = new GeoBuilder();
  const frame = new GeoBuilder();
  for (const b of P.billboards) {
    const c = Math.cos(b.rot);
    const sn = Math.sin(b.rot);
    const hw = b.w / 2;
    const y0 = b.y + b.legs;
    const y1 = y0 + b.h;
    const P0 = (lx, y, lz = 0) => [b.x + lx * c + lz * sn, y, b.z - lx * sn + lz * c];
    adB.quad(P0(-hw, y0, 0.06), P0(hw, y0, 0.06), P0(hw, y1, 0.06), P0(-hw, y1, 0.06), [sn, 0, c], ads.uv(b.ad % ads.count), white);
    frame.orientedBox(b.x, b.z, y0 - 0.2, y1 + 0.2, hw + 0.2, 0.05, b.rot, rgb('#2d3136'), 4);
    for (const lx of [-hw * 0.6, hw * 0.6]) {
      const [px, , pz] = P0(lx, 0, 0);
      frame.orientedBox(px, pz, b.y, y0, 0.12, 0.12, b.rot, rgb('#4a4f55'), 4);
    }
  }
  add(adB.mesh(new THREE.MeshStandardMaterial({ map: ads.texture, emissive: '#ffffff', emissiveMap: ads.texture, emissiveIntensity: 0.12, roughness: 0.5 })));
  add(frame.mesh(vc({ metalness: 0.4, roughness: 0.5 }), { castShadow: true }));

  // ---------------- distant skyline (no collisions, fades into the fog)
  const sky = [];
  for (let i = 0; i < 180; i++) {
    const a = rng.range(0.85, Math.PI * 2 - 0.85); // leave the sea (+z) open
    const r = rng.range(650, 1250);
    const cluster = Math.max(0, Math.cos(a - Math.PI) * 0.6 + Math.cos(a * 3) * 0.4);
    sky.push({
      x: Math.sin(a) * r, z: Math.cos(a) * r,
      w: rng.range(25, 70), d: rng.range(25, 70), h: rng.range(20, 60) + cluster * rng.range(40, 200),
    });
  }
  const skyGeo = Box(1, 1, 1);
  skyGeo.translate(0, 0.5, 0);
  const skyMesh = new THREE.InstancedMesh(skyGeo, new THREE.MeshStandardMaterial({ color: '#8e9bab', roughness: 0.9 }), sky.length);
  sky.forEach((b, i) => {
    _m.compose(_p.set(b.x, 0, b.z), _q.identity(), _s.set(b.w, b.h, b.d));
    skyMesh.setMatrixAt(i, _m);
    const shade = 0.85 + rng() * 0.3;
    skyMesh.setColorAt(i, new THREE.Color(shade, shade, shade * 1.05));
  });
  skyMesh.computeBoundingSphere();
  group.add(skyMesh);
  // hills behind the northern skyline
  for (let i = 0; i < 9; i++) {
    const hill = new THREE.Mesh(new THREE.ConeGeometry(rng.range(260, 420), rng.range(120, 240), 7), new THREE.MeshStandardMaterial({ color: '#6d7f6a', roughness: 1, flatShading: true }));
    const a = Math.PI + rng.range(-1.6, 1.6);
    hill.position.set(Math.sin(a) * 1500, 40, Math.cos(a) * 1500);
    group.add(hill);
  }

  return {
    signals: signalState,
    setNight(k) {
      lampGlow.emissiveIntensity = 0.25 + k * 3;
      if (pools) {
        pools.visible = k > 0.02;
        poolMat.opacity = k * 0.55;
      }
    },
    update(dt, t) {
      setSignals(t);
      for (const s of sprays) {
        s.scale.y = 1 + Math.sin(t * 6) * 0.06;
        s.material.opacity = 0.45 + Math.sin(t * 9) * 0.08;
      }
    },
  };
}

// Traffic signal state at time t for each axis: 2 green, 1 yellow, 0 red.
// ns (traffic moving along z): green 0-10, yellow 10-13, red 13-26.
// ew (traffic moving along x): red 0-13, green 13-23, yellow 23-26.
export function signalState(t) {
  const c = ((t % 26) + 26) % 26;
  return { ns: c < 10 ? 2 : c < 13 ? 1 : 0, ew: c < 13 ? 0 : c < 23 ? 2 : 1, cycle: c };
}

function makePoolTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makePalmFronds() {
  const pos = [];
  const idx = [];
  const n = 9;
  const segs = 6;
  const len = 3.4;
  const topX = 0.9;
  const topY = 7.1;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const px = -dz;
    const pz = dx;
    const base = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const w = Math.sin(t * Math.PI) * 0.55 + 0.05;
      const cx = topX + dx * t * len;
      const cz = dz * t * len;
      const cy = topY + t * 0.9 - t * t * 2.2;
      pos.push(cx + px * w, cy, cz + pz * w);
      pos.push(cx - px * w, cy, cz - pz * w);
    }
    for (let s = 0; s < segs; s++) {
      const i = base + s * 2;
      idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return mergeParts([part(g, {}, '#ffffff')]);
}
