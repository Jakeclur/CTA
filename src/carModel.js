// Smooth car bodies. Each body is lofted: a rounded cross-section (a
// superellipse, like a rectangle with soft corners) is swept from the rear
// bumper to the nose, following the car's side profile, with wheel arches cut
// in over the wheels. The cabin (glass, pillars and roof) is lofted the same way
// on top. Everything is generated from the dimensions in VEHICLE_TYPES.
import * as THREE from 'three';

// A smoothed piecewise-linear profile y(z) through [z, y] points (any order).
export function profile(points, radius = 0.1) {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const lin = (z) => {
    if (z <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [z1, y1] = pts[i];
      if (z <= z1) {
        const [z0, y0] = pts[i - 1];
        return z1 === z0 ? y1 : y0 + ((y1 - y0) * (z - z0)) / (z1 - z0);
      }
    }
    return pts[pts.length - 1][1];
  };
  if (radius <= 0) return lin;
  const z0 = pts[0][0];
  const z1 = pts[pts.length - 1][0];
  // box-filtered, but never reaching past the ends so the end heights stay put
  return (z) => {
    let s = 0;
    for (let k = -4; k <= 4; k++) s += lin(Math.min(z1, Math.max(z0, z + (k * radius) / 4)));
    return s / 9;
  };
}

const sgnPow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);

// Half-width of a rounded section at height y (used for doors and trim).
function sectionX(w, yc, hh, n, tumble, y) {
  const s = Math.max(-1, Math.min(1, (y - yc) / hh));
  return w * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(s), n)), 1 / n) * (1 - tumble * Math.max(0, s));
}

// Builds an indexed loft. rings[i] is an array of [x, y] at z = zs[i].
// Closed rings wrap around; caps close the first and last ring with a fan.
function loftGeometry(zs, rings, { closed = true, capStart = false, capEnd = false } = {}) {
  const M = rings[0].length;
  const pos = [];
  for (let i = 0; i < zs.length; i++) for (const [x, y] of rings[i]) pos.push(x, y, zs[i]);
  const idx = [];
  const segs = closed ? M : M - 1;
  for (let i = 0; i < zs.length - 1; i++) {
    for (let k = 0; k < segs; k++) {
      const a = i * M + k;
      const b = i * M + ((k + 1) % M);
      const c = (i + 1) * M + ((k + 1) % M);
      const d = (i + 1) * M + k;
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the winding depends on the ring direction; flip so normals face outwards
  const n = g.attributes.normal;
  const mid = Math.floor(zs.length / 2) * M;
  let out = 0;
  for (let k = 0; k < M; k++) out += n.getX(mid + k) * pos[(mid + k) * 3] + n.getY(mid + k) * (pos[(mid + k) * 3 + 1] - avgY(rings[Math.floor(zs.length / 2)]));
  if (out < 0) {
    for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  const parts = [g];
  if (capStart) parts.push(capGeometry(rings[0], zs[0], -1));
  if (capEnd) parts.push(capGeometry(rings[rings.length - 1], zs[zs.length - 1], 1));
  return parts;
}

function avgY(ring) {
  return ring.reduce((a, p) => a + p[1], 0) / ring.length;
}

// Flat cap facing dir (+1 = +z) over a ring.
function capGeometry(ring, z, dir) {
  const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
  const cy = avgY(ring);
  const pos = [cx, cy, z];
  for (const [x, y] of ring) pos.push(x, y, z);
  const idx = [];
  const M = ring.length;
  for (let k = 0; k < M; k++) {
    const a = 1 + k;
    const b = 1 + ((k + 1) % M);
    idx.push(0, a, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (g.attributes.normal.getZ(0) * dir < 0) {
    for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
    g.setIndex(idx);
  }
  const nor = new Float32Array(pos.length);
  for (let i = 0; i < nor.length; i += 3) nor[i + 2] = dir;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

// The side profile of a vehicle type: body top line, cabin top line and the
// key stations along the car (z runs from rear, negative, to front, positive).
export function carProfile(t) {
  const front = t.L / 2;
  const rear = -t.L / 2;
  const cowl = front - t.hoodL;
  const roofF = cowl - t.wsRun;
  const roofR = t.van ? rear + 0.05 : roofF - t.roofL;
  const glassR = t.van ? roofF - 0.85 : t.ute ? roofR : t.hatch ? rear + 0.12 : roofR - t.rearRun;
  const hoodY = t.belt - (t.van ? 0.12 : 0.14);
  const deck = t.van ? t.H - 0.02 : t.deck;

  const topPts = [
    [front, Math.min(hoodY - 0.24, t.clr + 0.42)],
    [front - 0.06, hoodY - 0.07],
    [front - 0.3, hoodY],
    [cowl, t.belt],
  ];
  if (t.van) {
    topPts.push([glassR + 0.02, t.belt], [glassR - 0.02, deck], [rear + 0.12, deck], [rear, deck - 0.12]);
  } else if (t.ute) {
    topPts.push([glassR, t.belt], [rear + 0.15, deck], [rear, deck - 0.12]);
  } else {
    topPts.push([glassR, t.belt], [rear + 0.3, deck], [rear + 0.06, deck - 0.05], [rear, deck - 0.2]);
  }
  const top = profile(topPts, t.van ? 0.03 : 0.1);

  const cabinPts = [[cowl, t.belt], [roofF, t.H]];
  if (t.van) cabinPts.push([glassR, t.H]);
  else cabinPts.push([roofR, t.H], [glassR, t.ute || t.hatch ? t.belt : top(glassR)]);
  const cabin = profile(cabinPts, 0.12);

  return { front, rear, cowl, roofF, roofR, glassR, hoodY, deck, top, cabin };
}

// Body shell: lofted rounded sections with wheel arches. detail 1 = full, 0 = far LOD.
export function bodyGeometry(t, P, detail = 1) {
  const n = 5; // squareness of the section
  const tumble = 0.05;
  const R = t.wheelR + 0.07;
  const step = detail ? 0.07 : 0.2;
  const M = detail ? 28 : 12;
  const zs = [];
  for (let z = P.rear; z < P.front - 1e-6; z += step) zs.push(z);
  zs.push(P.front);
  const wheelsZ = [t.wheelBase / 2, -t.wheelBase / 2];
  const halfW = (z) => {
    const e = Math.max(0, (Math.abs(z) - (t.L / 2 - 0.55)) / 0.55);
    return (t.W / 2) * (1 - 0.09 * e * e);
  };
  const bottom = (z) => {
    let b = t.clr + 0.07 * Math.pow(Math.max(0, (Math.abs(z) - (t.L / 2 - 0.4)) / 0.4), 2);
    for (const wz of wheelsZ) {
      const d = z - wz;
      if (Math.abs(d) < R) b = Math.max(b, t.wheelR + Math.sqrt(R * R - d * d));
    }
    return b;
  };
  const rings = zs.map((z) => {
    const w = halfW(z);
    const yt = P.top(z);
    const yb = Math.min(bottom(z), yt - 0.06);
    const yc = (yt + yb) / 2;
    const hh = (yt - yb) / 2;
    const ring = [];
    for (let k = 0; k < M; k++) {
      const th = (k / M) * Math.PI * 2;
      const s = sgnPow(Math.sin(th), 2 / n);
      let x = w * sgnPow(Math.cos(th), 2 / n) * (1 - tumble * Math.max(0, s));
      x *= 1 - 0.04 * Math.max(0, -s); // tuck the sills under slightly
      ring.push([x, yc + hh * s]);
    }
    return ring;
  });
  const parts = loftGeometry(zs, rings, { capStart: true, capEnd: true });
  const sideX = (z, y) => {
    const yt = P.top(z);
    const yb = Math.min(bottom(z), yt - 0.06);
    return sectionX(halfW(z), (yt + yb) / 2, (yt - yb) / 2, n, tumble, y);
  };
  return { parts, sideX, halfW, bottom };
}

// The cabin: glass with painted pillars and roof, split into two geometries.
export function cabinGeometry(t, P, bodyHalfW, detail = 1) {
  const n = 4;
  const z0 = P.glassR;
  const z1 = P.cowl;
  const step = detail ? 0.05 : 0.2;
  const zs = [];
  for (let z = z0; z < z1 - 1e-6; z += step) zs.push(z);
  zs.push(z1);
  // ring angles from the right sill (0) over the roof to the left sill (pi)
  const quarter = detail ? [0, 0.08, 0.22, 0.36, 0.46, 0.56, 0.68, 0.85, 1.1, 1.35] : [0, 0.3, 0.6, 1.1];
  const angles = [...quarter, Math.PI / 2, ...quarter.slice().reverse().map((a) => Math.PI - a)];
  const rings = zs.map((z) => {
    const yb = P.top(z) - 0.03;
    const yt = Math.max(yb + 0.001, P.cabin(z));
    const wb = bodyHalfW(z) - 0.07;
    const wt = wb - Math.min(0.2, (yt - yb) * 0.32);
    return angles.map((th) => {
      const s = Math.pow(Math.abs(Math.sin(th)), 2 / n);
      const y = yb + (yt - yb) * s;
      const x = sgnPow(Math.cos(th), 2 / n) * (wb + (wt - wb) * s);
      return [x, y];
    });
  });
  const needEnd = (i) => P.cabin(zs[i]) - P.top(zs[i]) > 0.08;
  const [shell, ...caps] = loftGeometry(zs, rings, { closed: false, capStart: needEnd(0), capEnd: needEnd(zs.length - 1) });
  // split the faces: glass, or paint for pillars, roof and the window line
  const A = angles.length;
  const idx = shell.index.array;
  const glass = [];
  const paint = [];
  const pillarB = P.cowl - 0.05 - Math.min(1.25, Math.max(0.9, (P.cowl - P.glassR) * 0.5));
  const solidRear = !t.hatch && !t.van && !t.ute; // fastback quarter panels
  for (let f = 0; f < idx.length; f += 3) {
    let zm = 0;
    let km = 0;
    for (let j = 0; j < 3; j++) {
      const v = idx[f + j];
      zm += zs[Math.floor(v / A)] / 3;
      km += (v % A) / 3;
    }
    const th = angles[Math.min(A - 1, Math.floor(km))] * (1 - (km % 1)) + angles[Math.min(A - 1, Math.ceil(km))] * (km % 1);
    const e = Math.min(th, Math.PI - th); // 0 at the sills, pi/2 on the roof centre
    let isPaint;
    if (e < 0.07) isPaint = true; // window line
    else if (e < 0.4) isPaint = Math.abs(zm - pillarB) < 0.07 || (solidRear && zm < P.roofR + 0.08) || (t.hatch && zm < P.glassR + 0.2) || (t.van && zm < P.glassR + 0.12);
    else if (e < 0.6) isPaint = true; // A and C pillars, roof rails
    else isPaint = zm > P.roofR + 0.04 && zm < P.roofF - 0.04;
    (isPaint ? paint : glass).push(idx[f], idx[f + 1], idx[f + 2]);
  }
  const withIndex = (list) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', shell.attributes.position);
    g.setAttribute('normal', shell.attributes.normal);
    g.setIndex(list);
    return g;
  };
  return { glass: [withIndex(glass)], paint: [withIndex(paint), ...caps] };
}

// Tyre, rim with five spokes, brake disc and hub. Axle along x.
export function wheelGeometries(t, detail = 1) {
  const r = t.wheelR;
  const w = 0.25;
  if (!detail) {
    const c = new THREE.CylinderGeometry(r, r, w, 10);
    c.rotateZ(Math.PI / 2);
    return { tyre: c, rim: null };
  }
  const prof = [
    [r * 0.66, -w / 2], [r * 0.93, -w / 2], [r * 0.99, -w / 2 + 0.03], [r, -w / 2 + 0.07],
    [r, w / 2 - 0.07], [r * 0.99, w / 2 - 0.03], [r * 0.93, w / 2], [r * 0.66, w / 2],
  ].map(([a, b]) => new THREE.Vector2(a, b));
  const tyre = new THREE.LatheGeometry(prof, 28);
  tyre.rotateZ(Math.PI / 2);
  const rimParts = [];
  const barrel = new THREE.CylinderGeometry(r * 0.66, r * 0.66, w - 0.02, 24, 1, true);
  barrel.rotateZ(Math.PI / 2);
  rimParts.push({ geo: barrel, color: '#9aa1a8' });
  const disc = new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.03, 20);
  disc.rotateZ(Math.PI / 2);
  rimParts.push({ geo: disc, color: '#5a5d61' });
  for (const side of [-1, 1]) {
    const face = side * (w / 2 - 0.035);
    const hub = new THREE.CylinderGeometry(r * 0.16, r * 0.18, 0.05, 12);
    hub.rotateZ(Math.PI / 2);
    hub.translate(face, 0, 0);
    rimParts.push({ geo: hub, color: '#c9ced3' });
    const lip = new THREE.TorusGeometry(r * 0.64, 0.016, 6, 28);
    lip.rotateY(Math.PI / 2);
    lip.translate(face + side * 0.02, 0, 0);
    rimParts.push({ geo: lip, color: '#dfe3e7' });
    for (let k = 0; k < 5; k++) {
      const sp = new THREE.BoxGeometry(0.035, r * 0.5, 0.06);
      sp.translate(0, r * 0.38, 0);
      sp.rotateX((k / 5) * Math.PI * 2);
      sp.translate(face, 0, 0);
      rimParts.push({ geo: sp, color: '#c9ced3' });
    }
  }
  return { tyre, rim: rimParts };
}

// A curved panel following the body side (the driver's door), in door-local space.
export function doorPanel(t, sideX, zFront, len, y0, y1, origin) {
  const NZ = 8;
  const NY = 8;
  const pos = [];
  for (let j = 0; j <= NY; j++) {
    const y = y0 + ((y1 - y0) * j) / NY;
    for (let i = 0; i <= NZ; i++) {
      const z = zFront - (len * i) / NZ;
      const x = -(sideX(z, y) + 0.008);
      pos.push(x - origin.x, y - origin.y, z - origin.z);
    }
  }
  const idx = [];
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NZ; i++) {
      const a = j * (NZ + 1) + i;
      idx.push(a, a + NZ + 1, a + 1, a + 1, a + NZ + 1, a + NZ + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (g.attributes.normal.getX(0) > 0) {
    for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}
