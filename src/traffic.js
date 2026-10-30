// AI traffic: cars that drive on the left along the road grid, pick random turns
// at intersections, stop at red lights, queue behind other cars and react to crashes.
// Cars are spawned out of sight around the player and removed when far away.
import * as THREE from 'three';
import { AIDriver } from './ai.js';
import { DIRS, OPPOSITE, NODES, nodeX, nodeZ, validNode, nearestNode } from './roads.js';
import { ROAD_HALF } from './config.js';
import { makeRng } from './utils.js';

const TYPES = ['compact', 'compact', 'sedan', 'sedan', 'sedan', 'suv', 'suv', 'van', 'sports', 'taxi', 'taxi', 'ute', 'ute', 'muscle'];
const LANES = [2.2]; // inner lane: the outer lane is used for kerbside parking
const STOP_BACK = ROAD_HALF + 4.6; // stop line distance from the intersection centre
const SPAWN_MIN = 90;
const SPAWN_MAX = 210;
const DESPAWN = 250;
export const DENSITY = { off: 0, low: 7, medium: 13, high: 20 };

// Left-of-travel vector for a direction (traffic keeps left)
const leftOf = (d) => [DIRS[d].fz, -DIRS[d].fx];

export class Traffic {
  constructor(game) {
    this.g = game;
    this.cars = [];
    this.rng = makeRng(5150);
    this.target = DENSITY.medium;
    this.spawnT = 0;
    this._v = new THREE.Vector3();
  }

  setDensity(name) {
    this.target = DENSITY[name] ?? DENSITY.medium;
  }

  clear() {
    for (const c of this.cars) this.g.vehicles.remove(c.v);
    this.cars = [];
  }

  // The player took this car: it leaves the traffic system.
  release(v) {
    const i = this.cars.findIndex((c) => c.v === v);
    if (i < 0) return false;
    this.cars.splice(i, 1);
    v.ctrl = null;
    v.role = 'parked';
    return true;
  }

  // ------------------------------------------------------------------ paths

  // Point on the lane of the road leaving node (i, j) in direction d, `along` metres out.
  lanePoint(i, j, d, lane, along) {
    const [lx, lz] = leftOf(d);
    return [nodeX(i) + DIRS[d].fx * along + lx * lane, nodeZ(j) + DIRS[d].fz * along + lz * lane];
  }

  // Plan the drive along the segment from node A (in direction d) and through the
  // next intersection: appends points and records where the stop line is.
  extend(c) {
    const { i, j, d } = c.seg;
    const ni = i + DIRS[d].di;
    const nj = j + DIRS[d].dj;
    // choose where to go at the next intersection
    const options = [];
    for (let k = 0; k < 4; k++) {
      if (k === OPPOSITE[d] || !validNode(ni + DIRS[k].di, nj + DIRS[k].dj)) continue;
      options.push({ k, w: k === d ? 3 : 1.5 });
    }
    let pick = options.length ? options[0].k : OPPOSITE[d];
    let sum = options.reduce((a, o) => a + o.w, 0) * this.rng();
    for (const o of options) {
      sum -= o.w;
      if (sum <= 0) {
        pick = o.k;
        break;
      }
    }
    const d2 = pick;
    // entry: the stop line before the next intersection
    const back = OPPOSITE[d];
    const [ex, ez] = this.lanePoint(ni, nj, back, -c.lane, STOP_BACK);
    c.path.push([ex, ez]);
    c.stopIdx = c.path.length - 1;
    c.stopNode = [ni, nj];
    c.axis = DIRS[d].fx !== 0 ? 'ew' : 'ns';
    c.inDir = d;
    // driving on the left, a right turn cuts across the oncoming lanes
    const [lx0, lz0] = leftOf(d);
    c.turnRight = lx0 * DIRS[d2].fx + lz0 * DIRS[d2].fz < -0.5;
    c.giveT = 0;
    // through the intersection: a curve for turns
    const [x2, z2] = this.lanePoint(ni, nj, d2, c.lane, STOP_BACK - 1);
    if (d2 !== d) {
      const [l1x, l1z] = leftOf(d);
      const [l2x, l2z] = leftOf(d2);
      const cx = nodeX(ni) + (l1x + l2x) * c.lane;
      const cz = nodeZ(nj) + (l1z + l2z) * c.lane;
      for (const t of [0.3, 0.55, 0.8]) {
        const a = (1 - t) * (1 - t);
        const b = 2 * t * (1 - t);
        const e = t * t;
        c.path.push([a * ex + b * cx + e * x2, a * ez + b * cz + e * z2]);
      }
    }
    c.path.push([x2, z2]);
    c.seg = { i: ni, j: nj, d: d2 };
  }

  // Put a car on the road leaving node (i, j) in direction d.
  place(v, i, j, d, along) {
    const lane = this.rng.pick(LANES);
    const [x, z] = this.lanePoint(i, j, d, lane, along);
    v.setPose(x, z, Math.atan2(DIRS[d].fx, DIRS[d].fz), this.g.world.heightAt(x, z));
    const c = {
      v,
      ai: new AIDriver(v),
      lane,
      path: [[x, z]],
      idx: 0,
      seg: { i, j, d },
      stopIdx: -1,
      cruise: 11 + this.rng() * 4,
      waitT: 0,
      shockT: 0,
      offT: 0,
    };
    this.extend(c);
    return c;
  }

  // ------------------------------------------------------------------ spawning

  spawnOne(px, pz) {
    const g = this.g;
    const cam = g.camera;
    cam.getWorldDirection(this._v);
    const look = this._v;
    for (let tries = 0; tries < 8; tries++) {
      const i = Math.floor(this.rng() * NODES);
      const j = Math.floor(this.rng() * NODES);
      const d = Math.floor(this.rng() * 4);
      if (!validNode(i + DIRS[d].di, j + DIRS[d].dj)) continue;
      const along = 18 + this.rng() * 40;
      const x = nodeX(i) + DIRS[d].fx * along;
      const z = nodeZ(j) + DIRS[d].fz * along;
      const dist = Math.hypot(x - px, z - pz);
      if (dist < SPAWN_MIN || dist > SPAWN_MAX) continue;
      // avoid popping in right in front of the camera when close
      const inView = (x - cam.position.x) * look.x + (z - cam.position.z) * look.z > 0;
      if (inView && dist < 150) continue;
      if (!g.vehicles.isFree(x, z, 4)) continue;
      const type = this.rng.pick(TYPES);
      const v = g.vehicles.spawn(type, x, z, 0);
      v.role = 'traffic';
      const c = this.place(v, i, j, d, along);
      if (!g.vehicles.isFree(v.x, v.z, 3, v)) {
        g.vehicles.remove(v);
        continue;
      }
      this.cars.push(c);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ per frame

  update(dt) {
    const g = this.g;
    const p = g.playerPosition();
    // remove cars that are far away, out of the system or wrecked
    for (let k = this.cars.length - 1; k >= 0; k--) {
      const c = this.cars[k];
      const d = Math.hypot(c.v.x - p.x, c.v.z - p.z);
      if (d > DESPAWN || (c.offT > 12 && d > 60) || c.v.role !== 'traffic') {
        if (c.v.role === 'traffic') g.vehicles.remove(c.v);
        else c.v.ctrl = null;
        this.cars.splice(k, 1);
      }
    }
    this.spawnT -= dt;
    if (this.cars.length < this.target && this.spawnT <= 0) {
      this.spawnT = 0.4;
      this.spawnOne(p.x, p.z);
    } else if (this.cars.length > this.target) {
      // density lowered: drop the furthest car once it is out of sight
      const far = this.cars.reduce((a, c) => (Math.hypot(c.v.x - p.x, c.v.z - p.z) > Math.hypot(a.v.x - p.x, a.v.z - p.z) ? c : a));
      if (Math.hypot(far.v.x - p.x, far.v.z - p.z) > 80) {
        g.vehicles.remove(far.v);
        this.cars.splice(this.cars.indexOf(far), 1);
      }
    }
    const sig = g.world.signals(g.time);
    for (const c of this.cars) this.drive(c, dt, sig);
  }

  drive(c, dt, sig) {
    const v = c.v;
    const g = this.g;
    // shaken by a crash: stop for a moment
    if (c.shockT > 0) {
      c.shockT -= dt;
      v.ctrl = c.ai.stop();
      return;
    }
    // advance along the path
    const P = c.path;
    while (c.idx < P.length - 1) {
      const [ax, az] = P[c.idx];
      const [bx, bz] = P[c.idx + 1];
      const sx = bx - ax;
      const sz = bz - az;
      const len2 = sx * sx + sz * sz || 1;
      const t = ((v.x - ax) * sx + (v.z - az) * sz) / len2;
      if (t < 1) break;
      c.idx++;
    }
    if (c.idx >= c.stopIdx && c.idx >= P.length - 2) {
      // passed the intersection: plan the next block, drop old points
      this.extend(c);
      const drop = Math.max(0, c.idx - 1);
      P.splice(0, drop);
      c.idx -= drop;
      c.stopIdx -= drop;
    }
    // distance from the path: pushed off the road
    const [ax, az] = P[c.idx];
    const [bx, bz] = P[Math.min(P.length - 1, c.idx + 1)];
    const off = distToSeg(v.x, v.z, ax, az, bx, bz);
    c.offT = off > 8 ? c.offT + dt : 0;
    if (c.offT > 4) this.replan(c);

    // aim point: a little way ahead along the path
    const look = 5 + Math.abs(v.forwardSpeed) * 0.5;
    const [tx, tz] = pointAhead(P, c.idx, v.x, v.z, look);

    // speed: cruise, slow for the light, keep a gap to whatever is in front
    let speed = c.cruise;
    const distStop = c.stopIdx > c.idx ? pathDistance(P, c.idx, v.x, v.z, c.stopIdx) : Infinity;
    if (distStop < 60) {
      const light = sig[c.axis];
      const tooLateForYellow = light === 1 && distStop < Math.max(4, v.speed * v.speed / 12);
      if (light === 0 || (light === 1 && !tooLateForYellow)) {
        speed = Math.min(speed, Math.sqrt(Math.max(0, distStop - 1.5) * 5));
      }
    }
    // turning right on green: wait at the line for a gap in oncoming traffic
    if (c.turnRight && distStop < 25 && sig[c.axis] === 2 && c.giveT < 9 && this.oncoming(c)) {
      speed = Math.min(speed, Math.sqrt(Math.max(0, distStop - 1.5) * 5));
      if (distStop < 4) c.giveT += dt;
    }
    const gap = this.gapAhead(c);
    if (gap < 40) speed = Math.min(speed, Math.max(0, (gap - 3.5) * 0.9));
    if (speed < 0.6) {
      c.waitT += dt;
      v.ctrl = c.ai.stop();
      v.ctrl.handbrake = false;
      return;
    }
    c.waitT = 0;
    v.ctrl = c.ai.steerTo(dt, tx, tz, speed);
  }

  // Is anything coming the other way towards the junction this car turns across?
  oncoming(c) {
    const [ni, nj] = c.stopNode;
    const nx = nodeX(ni);
    const nz = nodeZ(nj);
    const fx = DIRS[c.inDir].fx;
    const fz = DIRS[c.inDir].fz;
    for (const o of this.g.vehicles.list) {
      if (o === c.v) continue;
      const dx = o.x - nx;
      const dz = o.z - nz;
      const ahead = dx * fx + dz * fz; // beyond the junction, on the far side
      if (ahead < -2 || ahead > 45) continue;
      if (Math.abs(dx * fz - dz * fx) > ROAD_HALF) continue; // on this road
      const closing = -(o.vx * fx + o.vz * fz); // speed towards the junction
      if (closing > 1.5 && ahead / closing < 4.5) return true;
    }
    return false;
  }

  // Distance to the nearest car, pedestrian or player in our lane ahead.
  gapAhead(c) {
    const v = c.v;
    const fx = Math.sin(v.heading);
    const fz = Math.cos(v.heading);
    let best = Infinity;
    const test = (x, z, r, width) => {
      const dx = x - v.x;
      const dz = z - v.z;
      const fwd = dx * fx + dz * fz;
      if (fwd <= 0 || fwd > 40) return;
      const lat = Math.abs(dx * fz - dz * fx);
      if (lat > width) return;
      best = Math.min(best, fwd - r - v.spec.L / 2);
    };
    for (const o of this.g.vehicles.list) {
      if (o === v) continue;
      test(o.x, o.z, o.spec.L / 2, 1.6 + o.spec.W / 2);
    }
    const p = this.g.player;
    if (!p.vehicle) test(p.pos.x, p.pos.z, 0.3, 1.7);
    const peds = this.g.peds;
    if (peds) for (const q of peds.list) if (!q.down) test(q.pos.x, q.pos.z, 0.3, 1.6);
    return best + v.spec.L / 2;
  }

  // Lost the route (pushed off the road): join the nearest road again.
  replan(c) {
    const v = c.v;
    const [i, j] = nearestNode(v.x, v.z);
    let bestD = -1;
    let bestDot = -Infinity;
    const fx = Math.sin(v.heading);
    const fz = Math.cos(v.heading);
    for (let k = 0; k < 4; k++) {
      if (!validNode(i + DIRS[k].di, j + DIRS[k].dj)) continue;
      const dot = DIRS[k].fx * fx + DIRS[k].fz * fz;
      if (dot > bestDot) {
        bestDot = dot;
        bestD = k;
      }
    }
    if (bestD < 0) return;
    c.seg = { i, j, d: bestD };
    c.path = [[v.x, v.z], this.lanePoint(i, j, bestD, c.lane, ROAD_HALF + 3)];
    c.idx = 0;
    c.stopIdx = -1;
    c.offT = 0;
    this.extend(c);
  }

  // A car in the system was hit hard.
  shock(v, impact) {
    const c = this.cars.find((x) => x.v === v);
    if (!c) return;
    c.shockT = Math.min(4, 1 + impact * 0.25);
  }
}

function distToSeg(px, pz, ax, az, bx, bz) {
  const sx = bx - ax;
  const sz = bz - az;
  const len2 = sx * sx + sz * sz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * sx + (pz - az) * sz) / len2)) : 0;
  return Math.hypot(px - (ax + sx * t), pz - (az + sz * t));
}

// Point `dist` metres ahead of the car's projection onto the path.
function pointAhead(P, idx, x, z, dist) {
  let [ax, az] = P[idx];
  let k = idx + 1;
  if (k >= P.length) return [ax, az];
  // start from the projection onto the current segment
  const [bx, bz] = P[k];
  const sx = bx - ax;
  const sz = bz - az;
  const len = Math.hypot(sx, sz) || 1;
  const t = Math.max(0, Math.min(len, ((x - ax) * sx + (z - az) * sz) / len));
  ax += (sx / len) * t;
  az += (sz / len) * t;
  let left = dist;
  while (k < P.length) {
    const [nx, nz] = P[k];
    const d = Math.hypot(nx - ax, nz - az);
    if (d >= left) return [ax + ((nx - ax) / d) * left, az + ((nz - az) / d) * left];
    left -= d;
    ax = nx;
    az = nz;
    k++;
  }
  return [ax, az];
}

// Distance along the path from the car to point `to`.
function pathDistance(P, idx, x, z, to) {
  let d = 0;
  let px = x;
  let pz = z;
  for (let k = idx + 1; k <= to; k++) {
    d += Math.hypot(P[k][0] - px, P[k][1] - pz);
    px = P[k][0];
    pz = P[k][1];
  }
  return d;
}
