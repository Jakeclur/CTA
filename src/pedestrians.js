// Pedestrians: walk around the pavements of each block, cross at the zebra
// crossings when the lights let them, get out of the way of fast cars, run from
// trouble, and fall over (then get back up) when a car knocks them down.
import * as THREE from 'three';
import { Character } from './player.js';
import { GRID, ROAD_LINES, ROAD_HALF } from './config.js';
import { makeRng, dampAngle, damp } from './utils.js';

const INSET = 2.4; // walking line, metres in from the kerb
const WALK = 1.35;
const RUN = 5.2;
const SPAWN_MIN = 35;
const SPAWN_MAX = 110;
const DESPAWN = 140;
export const PED_DENSITY = { off: 0, low: 8, medium: 16, high: 24 };

const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#5c3a21', '#ffdbac'];
const TOPS = ['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#e9c46a', '#264653', '#ffffff', '#6d597a', '#b5838d', '#83c5be'];
const PANTS = ['#2b2d42', '#1d3557', '#6c757d', '#a68a64', '#3a5a40', '#111111', '#cdb4db'];
const HAIR = ['#111111', '#3b2414', '#6f4e37', '#c9a66b', '#d8d8d8', '#7f1d1d'];
const SHOES = ['#f8f9fa', '#111111', '#7f5539', '#e63946'];

function blockCorners(bx, bz) {
  const x0 = ROAD_LINES[bx] + ROAD_HALF + INSET;
  const x1 = ROAD_LINES[bx + 1] - ROAD_HALF - INSET;
  const z0 = ROAD_LINES[bz] + ROAD_HALF + INSET;
  const z1 = ROAD_LINES[bz + 1] - ROAD_HALF - INSET;
  // clockwise from the north-west corner
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}

// Crossing from corner k of a block: the neighbouring block and the corner arrived at.
// Each corner has two crossings: across the road along x or along z.
const CROSS = {
  0: [{ db: [-1, 0], to: 1, road: 'ns' }, { db: [0, -1], to: 3, road: 'ew' }],
  1: [{ db: [1, 0], to: 0, road: 'ns' }, { db: [0, -1], to: 2, road: 'ew' }],
  2: [{ db: [1, 0], to: 3, road: 'ns' }, { db: [0, 1], to: 1, road: 'ew' }],
  3: [{ db: [-1, 0], to: 2, road: 'ns' }, { db: [0, 1], to: 0, road: 'ew' }],
};

// Far-away pedestrians are three instanced shapes (legs, body, head) for the whole crowd.
const LOD_CAPACITY = 48;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();

function lodMeshes(scene) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  const make = (geo) => {
    const m = new THREE.InstancedMesh(geo, mat, LOD_CAPACITY);
    m.count = 0;
    m.frustumCulled = false;
    m.setColorAt(0, _c.set('#ffffff'));
    scene.add(m);
    return m;
  };
  const legs = new THREE.BoxGeometry(0.34, 0.9, 0.2);
  legs.translate(0, 0.45, 0);
  const body = new THREE.BoxGeometry(0.44, 0.62, 0.24);
  body.translate(0, 1.22, 0);
  const head = new THREE.SphereGeometry(0.13, 8, 6);
  head.translate(0, 1.66, 0);
  return { legs: make(legs), body: make(body), head: make(head) };
}

export class Pedestrians {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.lod = lodMeshes(game.scene);
    this.lodDistance = 35;
    this.rng = makeRng(2468);
    this.target = PED_DENSITY.medium;
    this.spawnT = 0;
    this._v = new THREE.Vector3();
  }

  setDensity(name) {
    this.target = PED_DENSITY[name] ?? PED_DENSITY.medium;
  }

  clear() {
    for (const p of this.list) p.c.dispose(this.g.scene);
    this.list = [];
    this.drawLod();
  }

  randomLook() {
    const r = this.rng;
    const top = r.pick(TOPS);
    const build = r.chance(0.5) ? 'f' : 'm';
    const hairStyle = build === 'f' ? r.pick(['long', 'long', 'bun', 'short']) : r.pick(['short', 'short', 'short', 'bald']);
    return {
      skin: r.pick(SKIN), shirt: top, jacket: r.chance(0.35) ? r.pick(TOPS) : top, pants: r.pick(PANTS),
      shoes: r.pick(SHOES), hair: r.pick(HAIR), cap: r.chance(0.12), capColour: r.pick(TOPS),
      build, hairStyle, shorts: r.chance(0.2),
    };
  }

  add(x, z, bx, bz, corner) {
    const look = this.randomLook();
    const c = new Character(this.g.scene, look, true);
    c.mesh.rotation.order = 'YXZ';
    const p = {
      c,
      look,
      far: false,
      pos: new THREE.Vector3(x, this.g.world.heightAt(x, z), z),
      facing: 0,
      bx,
      bz,
      corner,
      dir: this.rng.chance(0.5) ? 1 : -1,
      mode: 'walk', // walk | wait | cross | flee | down
      speed: WALK * (0.85 + this.rng() * 0.3),
      t: 0,
      fall: 0,
      vx: 0,
      vz: 0,
      threat: null,
      down: false,
    };
    p.target = this.cornerPoint(p, p.corner);
    this.list.push(p);
    return p;
  }

  cornerPoint(p, k) {
    return blockCorners(p.bx, p.bz)[k];
  }

  // A pedestrian runs from a point (the driver of a car the player took, for example).
  spawnFleeing(x, z, fromX, fromZ) {
    const bx = Math.max(0, Math.min(GRID - 1, Math.floor((x - ROAD_LINES[0]) / (ROAD_LINES[1] - ROAD_LINES[0]))));
    const bz = Math.max(0, Math.min(GRID - 1, Math.floor((z - ROAD_LINES[0]) / (ROAD_LINES[1] - ROAD_LINES[0]))));
    const p = this.add(x, z, bx, bz, 0);
    this.flee(p, fromX, fromZ, 6);
    return p;
  }

  flee(p, fx, fz, time = 4) {
    if (p.mode === 'down') return;
    p.mode = 'flee';
    p.t = time;
    p.threat = [fx, fz];
  }

  // ------------------------------------------------------------------ spawning

  spawnOne(px, pz) {
    const cam = this.g.camera;
    cam.getWorldDirection(this._v);
    for (let tries = 0; tries < 8; tries++) {
      const bx = Math.floor(this.rng() * GRID);
      const bz = Math.floor(this.rng() * GRID);
      const corners = blockCorners(bx, bz);
      const k = Math.floor(this.rng() * 4);
      const [ax, az] = corners[k];
      const [bx2, bz2] = corners[(k + 1) % 4];
      const f = this.rng();
      const x = ax + (bx2 - ax) * f;
      const z = az + (bz2 - az) * f;
      const d = Math.hypot(x - px, z - pz);
      if (d < SPAWN_MIN || d > SPAWN_MAX) continue;
      const inView = (x - cam.position.x) * this._v.x + (z - cam.position.z) * this._v.z > 0;
      if (inView && d < 80) continue;
      const p = this.add(x, z, bx, bz, (k + 1) % 4);
      p.dir = 1;
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ per frame

  update(dt) {
    const g = this.g;
    const pp = g.playerPosition();
    for (let k = this.list.length - 1; k >= 0; k--) {
      const p = this.list[k];
      if (Math.hypot(p.pos.x - pp.x, p.pos.z - pp.z) > DESPAWN) {
        p.c.dispose(g.scene);
        this.list.splice(k, 1);
      }
    }
    this.spawnT -= dt;
    if (this.list.length < this.target && this.spawnT <= 0) {
      this.spawnT = 0.3;
      this.spawnOne(pp.x, pp.z);
    } else if (this.list.length > this.target + 4) {
      // density lowered: drop the furthest pedestrian
      let far = null;
      let fd = 60;
      for (const p of this.list) {
        const d = Math.hypot(p.pos.x - pp.x, p.pos.z - pp.z);
        if (d > fd) {
          fd = d;
          far = p;
        }
      }
      if (far) {
        far.c.dispose(g.scene);
        this.list.splice(this.list.indexOf(far), 1);
      }
    }
    const sig = g.world.signals(g.time);
    const cam = g.camera.position;
    const far2 = this.lodDistance * this.lodDistance;
    for (const p of this.list) {
      p.far = (p.pos.x - cam.x) ** 2 + (p.pos.z - cam.z) ** 2 > far2;
      this.step(p, dt, sig);
    }
    this.drawLod();
  }

  // Distant pedestrians: hide the jointed model, draw a simple instanced figure.
  drawLod() {
    const L = this.lod;
    L.legs.count = L.body.count = L.head.count = 0;
    for (const p of this.list) {
      const far = p.far && L.body.count < LOD_CAPACITY;
      p.c.mesh.visible = !far;
      if (!far) continue;
      const m = p.c.mesh;
      _q.setFromEuler(m.rotation);
      _m.compose(m.position, _q, _s);
      const i = L.body.count++;
      L.legs.count++;
      L.head.count++;
      L.legs.setMatrixAt(i, _m);
      L.body.setMatrixAt(i, _m);
      L.head.setMatrixAt(i, _m);
      L.legs.setColorAt(i, _c.set(p.look.pants));
      L.body.setColorAt(i, _c.set(p.look.jacket));
      L.head.setColorAt(i, _c.set(p.look.skin));
    }
    for (const m of [L.legs, L.body, L.head]) {
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }
  }

  step(p, dt, sig) {
    const g = this.g;
    const w = g.world;
    this.checkThreats(p);
    let speed = 0;
    let gx = p.pos.x;
    let gz = p.pos.z;

    if (p.mode === 'down') {
      // knocked over: slide, lie still, then get up and run
      p.t -= dt;
      p.pos.x += p.vx * dt;
      p.pos.z += p.vz * dt;
      p.vx = damp(p.vx, 0, 4, dt);
      p.vz = damp(p.vz, 0, 4, dt);
      p.fall = damp(p.fall, p.t > 0.6 ? 1 : 0, p.t > 0.6 ? 9 : 5, dt);
      if (p.t <= 0) {
        p.down = false;
        p.c.mesh.rotation.x = 0;
        this.flee(p, p.pos.x - p.vx, p.pos.z - p.vz, 5);
      }
    } else if (p.mode === 'flee') {
      p.t -= dt;
      const dx = p.pos.x - p.threat[0];
      const dz = p.pos.z - p.threat[1];
      const len = Math.hypot(dx, dz) || 1;
      gx = p.pos.x + (dx / len) * 5;
      gz = p.pos.z + (dz / len) * 5;
      speed = RUN;
      if (p.t <= 0) this.rejoin(p);
    } else if (p.mode === 'wait') {
      const c = sig.cycle;
      // the crossed road's traffic must be red, with enough time left to cross
      const ok = p.cross.road === 'ns' ? sig.ns === 0 && c < 22 : sig.ew === 0 && c < 9;
      if (ok) {
        p.mode = 'cross';
        p.target = p.crossTo;
      }
      const [tx, tz] = p.target;
      p.facing = dampAngle(p.facing, Math.atan2(p.crossTo[0] - tx, p.crossTo[1] - tz), 6, dt);
    } else {
      const [tx, tz] = p.target;
      gx = tx;
      gz = tz;
      speed = p.mode === 'cross' ? p.speed * 1.25 : p.speed;
      if (Math.hypot(tx - p.pos.x, tz - p.pos.z) < 0.6) this.arrive(p);
    }

    if (speed > 0) {
      const dx = gx - p.pos.x;
      const dz = gz - p.pos.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.05) {
        p.facing = dampAngle(p.facing, Math.atan2(dx, dz), 8, dt);
        const step = Math.min(len, speed * dt);
        p.pos.x += (dx / len) * step;
        p.pos.z += (dz / len) * step;
      }
    }
    if (p.mode !== 'down') {
      w.colliders.resolveCircle(p.pos, 0.3, p.pos.y + 0.2, 1.6);
      g.vehicles.pushOut(p.pos, 0.3);
    }
    p.pos.y = damp(p.pos.y, w.heightAt(p.pos.x, p.pos.z), 20, dt);
    const m = p.c.mesh;
    m.position.copy(p.pos);
    m.rotation.y = p.facing;
    m.rotation.x = -p.fall * Math.PI * 0.5;
    if (p.fall > 0.01) m.position.y += p.fall * 0.25;
    // joints are only animated where they can be seen
    if (!p.far) p.c.animate(dt, p.mode === 'down' || p.mode === 'wait' ? 0 : speed);
  }

  // Reached the corner we were walking to.
  arrive(p) {
    if (p.mode === 'cross') {
      p.bx += p.cross.db[0];
      p.bz += p.cross.db[1];
      p.corner = p.cross.to;
      p.mode = 'walk';
    }
    // sometimes cross the street to the next block
    if (p.mode === 'walk' && this.rng.chance(0.35)) {
      const options = CROSS[p.corner].filter((o) => {
        const nx = p.bx + o.db[0];
        const nz = p.bz + o.db[1];
        return nx >= 0 && nz >= 0 && nx < GRID && nz < GRID;
      });
      if (options.length) {
        const o = this.rng.pick(options);
        p.cross = o;
        p.crossTo = blockCorners(p.bx + o.db[0], p.bz + o.db[1])[o.to];
        p.mode = 'wait';
        return;
      }
    }
    p.corner = (p.corner + p.dir + 4) % 4;
    p.target = this.cornerPoint(p, p.corner);
  }

  // After running away, head back to the nearest corner of the block we are on.
  rejoin(p) {
    const span = ROAD_LINES[1] - ROAD_LINES[0];
    p.bx = Math.max(0, Math.min(GRID - 1, Math.floor((p.pos.x - ROAD_LINES[0]) / span)));
    p.bz = Math.max(0, Math.min(GRID - 1, Math.floor((p.pos.z - ROAD_LINES[0]) / span)));
    const cs = blockCorners(p.bx, p.bz);
    let best = 0;
    cs.forEach(([x, z], k) => {
      if (Math.hypot(x - p.pos.x, z - p.pos.z) < Math.hypot(cs[best][0] - p.pos.x, cs[best][1] - p.pos.z)) best = k;
    });
    p.corner = best;
    p.target = cs[best];
    p.mode = 'walk';
  }

  checkThreats(p) {
    if (p.mode === 'down') return;
    const g = this.g;
    // cars: knocked down on contact, dodge when one comes fast
    for (const v of g.vehicles.list) {
      const dx = p.pos.x - v.x;
      const dz = p.pos.z - v.z;
      if (dx * dx + dz * dz > 400) continue;
      const c = Math.cos(v.heading);
      const s = Math.sin(v.heading);
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      const hit = Math.abs(lx) < v.spec.W / 2 + 0.3 && Math.abs(lz) < v.spec.L / 2 + 0.3;
      if (hit && v.speed > 3.5) {
        this.knockDown(p, v);
        return;
      }
      if (v.speed > 9 && v === g.player.vehicle && p.mode !== 'flee') {
        const toward = -(dx * v.vx + dz * v.vz) / (Math.hypot(dx, dz) || 1);
        if (toward > 6 && Math.hypot(dx, dz) < 14) this.flee(p, v.x, v.z, 2.5);
      }
    }
    // wanted player nearby: keep clear
    if (g.police.level > 0 && p.mode !== 'flee') {
      const pp = g.playerPosition();
      if (Math.hypot(pp.x - p.pos.x, pp.z - p.pos.z) < 14) this.flee(p, pp.x, pp.z, 4);
    }
  }

  knockDown(p, v) {
    p.mode = 'down';
    p.down = true;
    p.t = 5;
    p.vx = v.vx * 0.7;
    p.vz = v.vz * 0.7;
    // fall away from the car
    p.facing = Math.atan2(-p.vx, -p.vz);
    v.vx *= 0.94;
    v.vz *= 0.94;
    this.g.audio?.play('thud', Math.min(1, v.speed / 15));
    // everyone close by runs
    for (const q of this.list) {
      if (q !== p && Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z) < 18) this.flee(q, p.pos.x, p.pos.z, 5);
    }
    if (v === this.g.player.vehicle) this.g.police.crime('Hitting a pedestrian', 1);
  }
}
