// Vehicles: original procedural car models, arcade-style physics with grip and
// drifting, collisions with the city and each other, and door animations.
// To add a vehicle, add an entry to VEHICLE_TYPES.
import * as THREE from 'three';
import { clamp, damp, makeRng } from './utils.js';
import { makeLabelTexture } from './textures.js';
import { mergeParts, part } from './props.js';

const SEDAN_SHAPE = {
  L: 4.7, W: 1.85, H: 1.45, clr: 0.2, belt: 0.92, hoodL: 1.25, wsRun: 0.85, roofL: 1.6, rearRun: 0.6,
  deck: 0.98, wheelR: 0.34, wheelBase: 2.8, track: 1.58,
};

// Handling: maxSpeed (m/s), accel (m/s^2), brake (m/s^2), steer (rad), grip (lateral friction)
export const VEHICLE_TYPES = {
  compact: {
    name: 'Pixie', L: 3.8, W: 1.72, H: 1.5, clr: 0.18, belt: 0.95, hoodL: 0.8, wsRun: 0.75, roofL: 1.45, rearRun: 0.2,
    deck: 0.95, wheelR: 0.31, wheelBase: 2.45, track: 1.48, hatch: true,
    mass: 1000, maxSpeed: 41, accel: 6.8, brake: 20, steer: 0.62, grip: 9,
    colors: ['#e9c46a', '#8ecae6', '#ff8fab', '#90be6d', '#f1faee'],
  },
  sedan: {
    name: 'Meridian', ...SEDAN_SHAPE,
    mass: 1450, maxSpeed: 47, accel: 7.4, brake: 21, steer: 0.58, grip: 8.5,
    colors: ['#c81d25', '#1d3557', '#adb5bd', '#2b2d42', '#f8f9fa', '#606c38'],
  },
  sports: {
    name: 'Falcora GT', L: 4.5, W: 1.95, H: 1.2, clr: 0.14, belt: 0.8, hoodL: 1.55, wsRun: 0.95, roofL: 0.95, rearRun: 0.85,
    deck: 0.86, wheelR: 0.35, wheelBase: 2.65, track: 1.66, spoiler: true,
    mass: 1350, maxSpeed: 64, accel: 11, brake: 25, steer: 0.55, grip: 10.5,
    colors: ['#f5b700', '#d00000', '#0077b6', '#111111', '#ff6d00'],
  },
  suv: {
    name: 'Bastion', L: 4.85, W: 1.98, H: 1.85, clr: 0.3, belt: 1.15, hoodL: 1.15, wsRun: 0.7, roofL: 2.55, rearRun: 0.15,
    deck: 1.15, wheelR: 0.42, wheelBase: 2.9, track: 1.68, hatch: true, roofRails: true,
    mass: 2100, maxSpeed: 44, accel: 6.6, brake: 19, steer: 0.55, grip: 8,
    colors: ['#344e41', '#3d405b', '#e0e1dd', '#14213d', '#9a031e'],
  },
  van: {
    name: 'Courier', L: 5.2, W: 2.0, H: 2.35, clr: 0.25, belt: 1.15, hoodL: 0.75, wsRun: 0.55, roofL: 3.6, rearRun: 0.05,
    deck: 1.15, wheelR: 0.38, wheelBase: 3.3, track: 1.72, van: true,
    mass: 2400, maxSpeed: 36, accel: 4.8, brake: 17, steer: 0.52, grip: 7.5,
    colors: ['#f8f9fa', '#e9ecef', '#264653', '#e76f51'],
  },
  police: {
    name: 'Patrol Cruiser', ...SEDAN_SHAPE, police: true,
    mass: 1550, maxSpeed: 55, accel: 9, brake: 23, steer: 0.58, grip: 9.5,
    colors: ['#14213d'],
  },
};

// ------------------------------------------------------------------ models

const shared = {};
let nightLevel = 0;
// 0 = day, 1 = night: cars with someone driving switch their lights on after dark
export function setVehicleNight(k) {
  nightLevel = k;
}
function sharedMaterials() {
  if (shared.glass) return shared;
  shared.glass = new THREE.MeshStandardMaterial({ color: '#1b2630', roughness: 0.05, metalness: 0.6, envMapIntensity: 1.5 });
  shared.head = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6dd', emissiveIntensity: 0.5 });
  shared.headOn = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6dd', emissiveIntensity: 5 });
  shared.red = new THREE.MeshStandardMaterial({ color: '#ff2020', emissive: '#ff0000', emissiveIntensity: 1.2 });
  shared.blue = new THREE.MeshStandardMaterial({ color: '#2050ff', emissive: '#0030ff', emissiveIntensity: 1.2 });
  shared.label = new THREE.MeshBasicMaterial({ map: makeLabelTexture('POLICE', '#14213d'), transparent: true });
  shared.trimVC = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.35 });
  shared.wheelVC = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 });
  shared.paints = new Map();
  return shared;
}

function paint(color) {
  const s = sharedMaterials();
  if (!s.paints.has(color)) {
    s.paints.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.55, envMapIntensity: 1.2 }));
  }
  return s.paints.get(color);
}

function extrude(shape, width, bevel = 0.05) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10,
  });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2); // shape x (length) -> +z, extrusion -> x
  g.computeVertexNormals();
  return g;
}

const geoCache = new Map();
function profileGeometries(t) {
  if (geoCache.has(t)) return geoCache.get(t);
  const front = t.L / 2;
  const rear = -t.L / 2;
  const cowl = front - t.hoodL;
  const roofF = cowl - t.wsRun;
  const roofR = t.van ? rear + 0.05 : roofF - t.roofL;
  const glassR = t.van ? roofF - 0.85 : t.hatch ? rear + 0.12 : roofR - t.rearRun;
  const wf = t.wheelBase / 2;
  const wr = -t.wheelBase / 2;
  const R = t.wheelR + 0.07;
  const hoodY = t.belt - (t.van ? 0.12 : 0.14);

  const body = new THREE.Shape();
  body.moveTo(rear + 0.08, t.clr);
  body.lineTo(wr - R, t.clr);
  body.absarc(wr, t.wheelR, R, Math.PI, 0, true);
  body.lineTo(wr + R, t.clr);
  body.lineTo(wf - R, t.clr);
  body.absarc(wf, t.wheelR, R, Math.PI, 0, true);
  body.lineTo(wf + R, t.clr);
  body.lineTo(front - 0.12, t.clr);
  body.lineTo(front, t.clr + 0.22);
  body.lineTo(front - 0.03, hoodY);
  body.lineTo(cowl, t.belt);
  if (t.van) {
    body.lineTo(glassR, t.belt);
    body.lineTo(glassR, t.H);
    body.lineTo(rear, t.H);
    body.lineTo(rear, t.clr + 0.25);
  } else {
    body.lineTo(glassR, t.belt);
    body.lineTo(rear + 0.05, t.deck);
    body.lineTo(rear, t.clr + 0.25);
  }
  body.closePath();

  const gh = new THREE.Shape();
  gh.moveTo(cowl + 0.02, t.belt - 0.02);
  gh.lineTo(roofF, t.H - 0.06);
  if (t.van) {
    gh.lineTo(glassR, t.H - 0.06);
    gh.lineTo(glassR, t.belt - 0.02);
  } else {
    gh.lineTo(roofR, t.H - 0.06);
    gh.lineTo(glassR, t.belt - 0.02);
  }
  gh.closePath();

  const roof = new THREE.Shape();
  const roofEnd = t.van ? glassR : roofR;
  roof.moveTo(roofF + 0.06, t.H - 0.1);
  roof.lineTo(roofEnd + (t.hatch ? 0.02 : 0.05), t.H - 0.1);
  roof.lineTo(roofEnd + 0.1, t.H - 0.02);
  roof.lineTo(roofF - 0.02, t.H - 0.02);
  roof.closePath();

  const out = {
    body: extrude(body, t.W, 0.06),
    glass: extrude(gh, t.W - 0.2, 0.03),
    roof: extrude(roof, t.W - 0.14, 0.03),
    dims: { front, rear, cowl, roofF, roofR, glassR, hoodY },
  };
  geoCache.set(t, out);
  return out;
}

// Each vehicle type's parts are merged into a handful of geometries (one per
// material) and shared by every car of that type, keeping draw calls low.
const BoxG = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const at = (geo, x, y, z) => part(geo, { x, y, z });

const modelCache = new Map();
function typeGeometries(t) {
  if (modelCache.has(t)) return modelCache.get(t);
  const G = profileGeometries(t);
  const { front, rear, cowl, glassR, hoodY } = G.dims;
  const hw = t.W / 2;
  const TRIM = '#1f2226';
  const PLATE = '#f4f4f0';
  const CHROME = '#d9dde2';
  const WHITE = '#f5f5f5';

  const paintParts = [part(G.body), part(G.roof)];
  const trimParts = [
    part(BoxG(t.W - 0.08, 0.18, 0.14), { y: t.clr + 0.12, z: front - 0.02 }, TRIM),
    part(BoxG(t.W - 0.08, 0.18, 0.14), { y: t.clr + 0.12, z: rear + 0.02 }, TRIM),
    part(BoxG(t.W * 0.42, 0.13, 0.05), { y: hoodY - 0.12, z: front - 0.01 }, TRIM),
    part(BoxG(0.5, 0.12, 0.02), { y: t.clr + 0.3, z: rear - 0.01 }, PLATE),
    part(BoxG(0.5, 0.12, 0.02), { y: t.clr + 0.27, z: front + 0.06 }, PLATE),
  ];
  const headParts = [];
  const tailParts = [];
  for (const sx of [-1, 1]) {
    headParts.push(at(BoxG(0.34, 0.11, 0.06), sx * (hw - 0.3), hoodY - 0.1, front - 0.02));
    tailParts.push(at(BoxG(0.36, 0.12, 0.06), sx * (hw - 0.28), (t.van ? t.belt : t.deck) - 0.1, rear + 0.01));
    trimParts.push(part(BoxG(0.12, 0.08, 0.2), { x: sx * (hw + 0.06), y: t.belt + 0.05, z: cowl - 0.1 }, TRIM)); // mirrors
    trimParts.push(part(BoxG(0.04, 0.08, t.wheelBase - 0.9), { x: sx * (hw + 0.005), y: t.clr + 0.1 }, TRIM)); // sills
  }
  if (t.spoiler) {
    paintParts.push(at(BoxG(t.W - 0.2, 0.05, 0.32), 0, t.deck + 0.22, rear + 0.22));
    for (const sx of [-1, 1]) trimParts.push(part(BoxG(0.05, 0.2, 0.12), { x: sx * (hw - 0.35), y: t.deck + 0.1, z: rear + 0.25 }, TRIM));
  }
  if (t.roofRails) {
    for (const sx of [-1, 1]) trimParts.push(part(BoxG(0.05, 0.06, t.roofL * 0.9), { x: sx * (hw - 0.18), y: t.H + 0.02, z: G.dims.roofF - t.roofL / 2 }, CHROME));
  }
  const red = [];
  const blue = [];
  const labels = [];
  if (t.police) {
    const doorZ = (cowl + glassR) / 2;
    const y = (t.belt + t.clr) / 2 + 0.05;
    for (const sx of [-1, 1]) {
      trimParts.push(part(BoxG(0.02, t.belt - t.clr - 0.2, 2.2), { x: sx * (hw + 0.012), y, z: doorZ }, WHITE));
      labels.push(part(new THREE.PlaneGeometry(1.2, 0.3), { x: sx * (hw + 0.03), y, z: doorZ, ry: (sx * Math.PI) / 2 }));
    }
    const barZ = G.dims.roofF - t.roofL * 0.3;
    trimParts.push(part(BoxG(1.3, 0.08, 0.3), { y: t.H + 0.02, z: barZ }, TRIM));
    trimParts.push(part(BoxG(t.W * 0.6, 0.3, 0.1), { y: t.clr + 0.25, z: front + 0.12 }, TRIM));
    red.push(at(BoxG(0.55, 0.12, 0.26), -0.33, t.H + 0.11, barZ));
    blue.push(at(BoxG(0.55, 0.12, 0.26), 0.33, t.H + 0.11, barZ));
  }
  if (t.van) {
    for (const sx of [-1, 1]) trimParts.push(part(BoxG(0.03, 0.6, 2.4), { x: sx * (hw + 0.01), y: t.belt + 0.55, z: rear + 1.6 }, WHITE));
  }

  // driver's door (driver sits on the right, which is local -x), hinged at its front edge
  const doorFront = cowl - 0.05;
  const doorLen = clamp((cowl - glassR) * 0.5, 0.9, 1.25);
  const panelH = t.belt - t.clr - 0.12;
  const doorPaint = mergeParts([at(BoxG(0.05, panelH, doorLen), 0, t.clr + 0.08 + panelH / 2, -doorLen / 2)]);
  const doorTrim = mergeParts([
    part(BoxG(0.03, 0.03, 0.18), { x: -0.03, y: t.belt - 0.1, z: -doorLen + 0.25 }, CHROME),
    part(BoxG(0.035, 0.012, doorLen), { y: t.clr + 0.08, z: -doorLen / 2 }, TRIM),
  ]);

  const tire = new THREE.CylinderGeometry(t.wheelR, t.wheelR, 0.26, 18);
  tire.rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(t.wheelR * 0.62, t.wheelR * 0.62, 0.275, 10);
  rim.rotateZ(Math.PI / 2);
  const wheel = mergeParts([
    part(tire, {}, '#1a1a1a'),
    part(rim, {}, '#c9ced3'),
    part(BoxG(0.28, t.wheelR * 0.9, 0.06), {}, '#aab0b6'), // spoke shows the wheel turning
  ]);

  const out = {
    paint: mergeParts(paintParts),
    glass: G.glass,
    trim: mergeParts(trimParts),
    head: mergeParts(headParts),
    tail: mergeParts(tailParts),
    red: red.length ? mergeParts(red) : null,
    blue: blue.length ? mergeParts(blue) : null,
    labels: labels.length ? mergeParts(labels) : null,
    doorPaint,
    doorTrim,
    doorFront,
    doorLen,
    wheel,
  };
  modelCache.set(t, out);
  return out;
}

function buildModel(t, color) {
  const S = sharedMaterials();
  const M = typeGeometries(t);
  const P = paint(color);
  const root = new THREE.Group();
  const body = new THREE.Group(); // rolls and pitches
  root.add(body);
  const add = (geo, mat, parent = body, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    parent.add(m);
    return m;
  };
  add(M.paint, P);
  add(M.glass, S.glass);
  add(M.trim, S.trimVC);
  const head = add(M.head, S.head, body, false);
  const tail = new THREE.MeshStandardMaterial({ color: '#b00000', emissive: '#ff1010', emissiveIntensity: 0.35 });
  add(M.tail, tail, body, false);
  // police lightbars get their own materials so each car can flash independently
  const siren = M.red ? { red: S.red.clone(), blue: S.blue.clone() } : null;
  if (M.red) add(M.red, siren.red, body, false);
  if (M.blue) add(M.blue, siren.blue, body, false);
  if (M.labels) add(M.labels, S.label, body, false);

  const door = new THREE.Group();
  door.position.set(-(t.W / 2 + 0.015), 0, M.doorFront);
  add(M.doorPaint, P, door);
  add(M.doorTrim, S.trimVC, door, false);
  body.add(door);

  const wheels = [];
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const steerG = new THREE.Group();
    steerG.position.set(sx * (t.track / 2), t.wheelR, sz * (t.wheelBase / 2));
    const spin = new THREE.Group();
    add(M.wheel, S.wheelVC, spin);
    steerG.add(spin);
    root.add(steerG);
    wheels.push({ steerG, spin, front: sz > 0 });
  }

  return { root, body, door, wheels, tail, head, siren, doorZ: M.doorFront - M.doorLen / 2 };
}

// ------------------------------------------------------------------ physics

export class Vehicle {
  constructor(type, color, scene) {
    this.type = type;
    this.spec = VEHICLE_TYPES[type];
    this.color = color;
    this.model = buildModel(this.spec, color);
    scene.add(this.model.root);
    this.x = 0;
    this.z = 0;
    this.y = 0;
    this.heading = 0;
    this.vx = 0;
    this.vz = 0;
    this.angVel = 0;
    this.steer = 0;
    this.forwardSpeed = 0;
    this.wheelSpin = 0;
    this.roll = 0;
    this.pitch = 0;
    this.prevVF = 0;
    this.prevVR = 0;
    this.doorOpen = 0;
    this.doorTarget = 0;
    this.driver = null;
    this.ctrl = null; // controls set by an AI driver each frame
    this.role = 'parked'; // parked | traffic | police | mission
    this.siren = false;
    this.slip = 0;
    this.asleep = true;
    this.still = 0;
    this.braking = false;
    this.radius = this.spec.W / 2;
    const half = this.spec.L / 2 - this.radius;
    this.offsets = [-half, 0, half]; // collision circles along the car
    this.reach = this.spec.L / 2 + 0.2;
  }

  get name() {
    return this.spec.name;
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  setPose(x, z, heading, y = 0) {
    this.x = x;
    this.z = z;
    this.y = y;
    this.heading = heading;
    this.vx = this.vz = this.angVel = 0;
    this.syncModel(0);
  }

  // Driver's door position in world space
  doorPoint(out = new THREE.Vector3(), extra = 0.8) {
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const side = -(this.spec.W / 2 + extra); // local -x is the driver's side
    // local x maps to world (cos, -sin)
    out.set(this.x + Math.cos(this.heading) * side + fx * this.model.doorZ, this.y, this.z - Math.sin(this.heading) * side + fz * this.model.doorZ);
    return out;
  }

  // ctrl: { throttle, brake, steer (+left), handbrake } or null when parked
  step(dt, ctrl, world) {
    const s = this.spec;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const rx = -fz;
    const rz = fx;
    let vF = this.vx * fx + this.vz * fz;
    let vR = this.vx * rx + this.vz * rz;
    const c = ctrl || { throttle: 0, brake: 0, steer: 0, handbrake: false };

    const steerLimit = s.steer / (1 + Math.abs(vF) / 22);
    this.steer = damp(this.steer, c.steer * steerLimit, 7, dt);

    let a = 0;
    this.braking = false;
    if (c.throttle > 0) {
      if (vF < -0.5) {
        a += s.brake;
        this.braking = true;
      } else a += s.accel * c.throttle * Math.max(0, 1 - Math.pow(Math.max(0, vF) / s.maxSpeed, 1.6));
    }
    if (c.brake > 0) {
      if (vF > 0.5) {
        a -= s.brake * c.brake;
        this.braking = true;
      } else {
        const maxRev = s.maxSpeed * 0.3;
        a -= s.accel * 0.7 * Math.max(0, 1 - Math.max(0, -vF) / maxRev);
      }
    }
    vF += a * dt;
    // air drag, rolling resistance and engine braking
    const coast = c.throttle === 0 && c.brake === 0;
    vF -= (vF * Math.abs(vF) * 0.0011 + vF * (coast ? 0.22 : 0.04)) * dt;
    if (c.handbrake) {
      const d = 8 * dt;
      vF = Math.abs(vF) <= d ? 0 : vF - Math.sign(vF) * d;
      this.braking = true;
    }
    if (coast && Math.abs(vF) < 0.25) vF = 0;

    const grip = c.handbrake ? s.grip * 0.14 : s.grip;
    vR *= Math.exp(-grip * dt);
    if (Math.abs(vR) < 0.02) vR = 0;
    // sliding scrubs speed
    vF -= Math.sign(vF) * Math.min(Math.abs(vF), Math.abs(vR) * 0.25 * dt);

    let targetW = (vF * Math.tan(this.steer)) / s.wheelBase;
    if (c.handbrake && Math.abs(vF) > 4) targetW *= 1.45;
    this.angVel = damp(this.angVel, targetW, c.handbrake ? 3.5 : 9, dt);
    this.heading += this.angVel * dt;

    this.vx = fx * vF + rx * vR;
    this.vz = fz * vF + rz * vR;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // body roll and pitch from accelerations
    const longA = (vF - this.prevVF) / dt;
    const latA = this.angVel * vF;
    this.prevVF = vF;
    this.pitch = damp(this.pitch, clamp(-longA * 0.006, -0.06, 0.06), 6, dt);
    this.roll = damp(this.roll, clamp(-latA * 0.006, -0.07, 0.07), 6, dt);
    this.forwardSpeed = vF;
    this.slip = Math.abs(vR);

    const impact = this.collideStatic(world.colliders);
    const ground = world.heightAt(this.x, this.z);
    this.y = damp(this.y, ground, 14, dt);
    return impact;
  }

  // Resolve overlap with buildings; returns impact speed (m/s) into the obstacle
  collideStatic(colliders) {
    let impact = 0;
    const p = { x: 0, z: 0 };
    const I = (this.spec.L * this.spec.L) / 12 + 0.3;
    for (const o of this.offsets) {
      const fx = Math.sin(this.heading);
      const fz = Math.cos(this.heading);
      p.x = this.x + fx * o;
      p.z = this.z + fz * o;
      const hit = colliders.resolveCircle(p, this.radius, this.y + 0.2, this.spec.H);
      if (!hit) continue;
      this.x += p.x - (this.x + fx * o);
      this.z += p.z - (this.z + fz * o);
      impact = Math.max(impact, this.applyImpulse(hit.nx, hit.nz, fx * o, fz * o, 0.25, I));
    }
    return impact;
  }

  // Bounce off a surface with normal n at contact arm r (relative to the centre).
  applyImpulse(nx, nz, rx, rz, e, I) {
    // velocity of the contact point = v + w x r  (w about +y: (w*rz, -w*rx))
    const cvx = this.vx + this.angVel * rz;
    const cvz = this.vz - this.angVel * rx;
    const vn = cvx * nx + cvz * nz;
    if (vn >= 0) return 0;
    const rn = rz * nx - rx * nz; // torque arm (r x n)_y
    const j = (-(1 + e) * vn) / (1 + (rn * rn) / I);
    this.vx += j * nx;
    this.vz += j * nz;
    this.angVel += (j * rn) / I;
    // scrape: lose some tangential speed
    const tx = -nz;
    const tz = nx;
    const vt = this.vx * tx + this.vz * tz;
    this.vx -= tx * vt * 0.08;
    this.vz -= tz * vt * 0.08;
    this.asleep = false;
    return -vn;
  }

  syncModel(dt) {
    const m = this.model;
    m.root.position.set(this.x, this.y, this.z);
    m.root.rotation.y = this.heading;
    m.body.rotation.x = this.pitch;
    m.body.rotation.z = this.roll;
    this.wheelSpin += (this.forwardSpeed / this.spec.wheelR) * dt;
    for (const w of m.wheels) {
      w.spin.rotation.x = this.wheelSpin;
      if (w.front) w.steerG.rotation.y = this.steer;
    }
    if (dt > 0) {
      this.doorOpen = damp(this.doorOpen, this.doorTarget, 10, dt);
      m.door.rotation.y = this.doorOpen * 1.15;
      const lights = nightLevel > 0.3 && (this.driver || this.ctrl);
      m.tail.emissiveIntensity = this.braking && (this.driver || this.ctrl) ? 2.2 : lights ? 1 : 0.35;
      const hm = lights ? sharedMaterials().headOn : sharedMaterials().head;
      if (m.head.material !== hm) m.head.material = hm;
      if (m.siren) {
        const t = performance.now() / 1000;
        const on = this.siren;
        const flash = Math.floor(t * 6) % 2;
        m.siren.red.emissiveIntensity = on ? (flash ? 3 : 0.2) : 0.6;
        m.siren.blue.emissiveIntensity = on ? (flash ? 0.2 : 3) : 0.6;
      }
    }
  }
}

// ------------------------------------------------------------------ manager

export class VehicleManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.list = [];
    this.rng = makeRng(77);
    this.lastImpact = 0;
    this.hits = []; // car-to-car hits this frame: { a, b, impact }
  }

  remove(v) {
    const i = this.list.indexOf(v);
    if (i >= 0) this.list.splice(i, 1);
    this.scene.remove(v.model.root);
    if (v.model.tail) v.model.tail.dispose();
  }

  spawn(type, x, z, heading, color) {
    const spec = VEHICLE_TYPES[type];
    const v = new Vehicle(type, color || this.rng.pick(spec.colors), this.scene);
    v.setPose(x, z, heading, this.world.heightAt(x, z));
    this.list.push(v);
    return v;
  }

  // driven: the player's vehicle (or null), ctrl: its controls
  update(dt, driven, ctrl) {
    let impact = 0;
    for (const v of this.list) {
      if (v === driven) {
        v.asleep = false;
        impact = Math.max(impact, v.step(dt, ctrl, this.world));
      } else if (v.ctrl) {
        v.asleep = false;
        v.staticImpact = Math.max(v.staticImpact || 0, v.step(dt, v.ctrl, this.world));
      } else if (!v.asleep) {
        v.step(dt, null, this.world);
        if (v.speed < 0.05 && Math.abs(v.angVel) < 0.02) {
          v.still += dt;
          if (v.still > 1) {
            v.asleep = true;
            v.vx = v.vz = v.angVel = 0;
          }
        } else v.still = 0;
      }
    }
    impact = Math.max(impact, this.collidePairs(driven));
    for (const v of this.list) v.syncModel(dt);
    this.lastImpact = impact;
    return impact;
  }

  collidePairs(driven) {
    let impact = 0;
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (a.asleep && b.asleep) continue;
        const dx0 = b.x - a.x;
        const dz0 = b.z - a.z;
        const reach = a.reach + b.reach;
        if (dx0 * dx0 + dz0 * dz0 > reach * reach) continue;
        const hit = this.collidePair(a, b);
        if (hit > 0.5) this.hits.push({ a, b, impact: hit });
        if (hit > 0 && (a === driven || b === driven)) impact = Math.max(impact, hit);
      }
    }
    return impact;
  }

  collidePair(a, b) {
    let impact = 0;
    const afx = Math.sin(a.heading);
    const afz = Math.cos(a.heading);
    const bfx = Math.sin(b.heading);
    const bfz = Math.cos(b.heading);
    const Ia = (a.spec.L * a.spec.L) / 12 + 0.3;
    const Ib = (b.spec.L * b.spec.L) / 12 + 0.3;
    for (const oa of a.offsets) {
      for (const ob of b.offsets) {
        const ax = a.x + afx * oa;
        const az = a.z + afz * oa;
        const bx = b.x + bfx * ob;
        const bz = b.z + bfz * ob;
        const dx = bx - ax;
        const dz = bz - az;
        const r = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const nz = dz / d; // from a to b
        const depth = r - d;
        const ma = a.spec.mass;
        const mb = b.spec.mass;
        const ta = mb / (ma + mb);
        const tb = ma / (ma + mb);
        a.x -= nx * depth * ta;
        a.z -= nz * depth * ta;
        b.x += nx * depth * tb;
        b.z += nz * depth * tb;
        // relative velocity at contact
        const rvx = b.vx - a.vx;
        const rvz = b.vz - a.vz;
        const vn = rvx * nx + rvz * nz;
        if (vn >= 0) continue;
        const e = 0.2;
        const jImp = (-(1 + e) * vn) / (1 / ma + 1 / mb);
        a.vx -= (jImp / ma) * nx;
        a.vz -= (jImp / ma) * nz;
        b.vx += (jImp / mb) * nx;
        b.vz += (jImp / mb) * nz;
        // spin from off-centre hits
        const raX = afx * oa;
        const raZ = afz * oa;
        const rbX = bfx * ob;
        const rbZ = bfz * ob;
        a.angVel -= ((raZ * nx - raX * nz) * jImp) / ma / Ia;
        b.angVel += ((rbZ * nx - rbX * nz) * jImp) / mb / Ib;
        a.asleep = false;
        b.asleep = false;
        a.still = b.still = 0;
        impact = Math.max(impact, -vn);
      }
    }
    return impact;
  }

  // Push a walking character (circle) out of every car.
  pushOut(pos, r) {
    for (const v of this.list) {
      const dx0 = pos.x - v.x;
      const dz0 = pos.z - v.z;
      if (dx0 * dx0 + dz0 * dz0 > (v.reach + r) ** 2) continue;
      if (pos.y > v.y + v.spec.H) continue;
      const fx = Math.sin(v.heading);
      const fz = Math.cos(v.heading);
      for (const o of v.offsets) {
        const cx = v.x + fx * o;
        const cz = v.z + fz * o;
        const dx = pos.x - cx;
        const dz = pos.z - cz;
        const rr = v.radius + r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        pos.x += (dx / d) * (rr - d);
        pos.z += (dz / d) * (rr - d);
      }
    }
  }

  // Closest vehicle whose driver's door (or body) is within reach
  nearestEnterable(pos, maxDist = 3) {
    let best = null;
    let bestD = maxDist;
    const p = new THREE.Vector3();
    for (const v of this.list) {
      if (v.driver) continue;
      const dc = Math.hypot(pos.x - v.x, pos.z - v.z);
      if (dc > v.reach + maxDist) continue;
      v.doorPoint(p, 0.5);
      const d = Math.min(Math.hypot(pos.x - p.x, pos.z - p.z), dc - v.reach + 1);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  // Distance along a ray to the nearest car body (used by the camera)
  raycast(ox, oy, oz, dx, dy, dz, maxDist, ignore) {
    let best = maxDist;
    for (const v of this.list) {
      if (v === ignore) continue;
      const rx = ox - v.x;
      const ry = oy - v.y;
      const rz = oz - v.z;
      if (rx * rx + rz * rz > (maxDist + v.reach) ** 2) continue;
      const c = Math.cos(v.heading);
      const sn = Math.sin(v.heading);
      // into the car's local frame: x axis (cos, -sin), z axis (sin, cos)
      const o = [rx * c - rz * sn, ry, rx * sn + rz * c];
      const d = [dx * c - dz * sn, dy, dx * sn + dz * c];
      const lo = [-v.spec.W / 2, 0, -v.spec.L / 2];
      const hi = [v.spec.W / 2, v.spec.H, v.spec.L / 2];
      let t0 = 0;
      let t1 = best;
      let hit = true;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(d[k]) < 1e-9) {
          if (o[k] < lo[k] || o[k] > hi[k]) {
            hit = false;
            break;
          }
          continue;
        }
        let a = (lo[k] - o[k]) / d[k];
        let b = (hi[k] - o[k]) / d[k];
        if (a > b) [a, b] = [b, a];
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 > t1) {
          hit = false;
          break;
        }
      }
      if (hit && t0 < best) best = t0;
    }
    return best;
  }

  // Is a circle at (x, z) free of cars (other than `ignore`)?
  isFree(x, z, r, ignore) {
    for (const v of this.list) {
      if (v === ignore) continue;
      const fx = Math.sin(v.heading);
      const fz = Math.cos(v.heading);
      for (const o of v.offsets) {
        const dx = x - (v.x + fx * o);
        const dz = z - (v.z + fz * o);
        if (dx * dx + dz * dz < (v.radius + r) ** 2) return false;
      }
    }
    return true;
  }
}
