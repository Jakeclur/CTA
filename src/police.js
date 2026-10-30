// Wanted level and police response.
//  0 stars: police ignore the player
//  1 star:  nearby units drive to where the crime happened and investigate
//  2 stars: units actively pursue; officers chase on foot
//  3 stars: more units, faster and willing to ram, roadblocks ahead of the player
//  4 stars: every unit in the city, more roadblocks
// Police only know where the player is while a unit can see them; otherwise they
// search the last known position until the wanted level cools down.
import * as THREE from 'three';
import { AIDriver } from './ai.js';
import { Character } from './player.js';
import { nearestNode, validNode, nodeX, nodeZ, DIRS, laneOffset } from './roads.js';
import { damp, dampAngle } from './utils.js';

export const MAX_LEVEL = 4;
const UNITS_FOR_LEVEL = [0, 1, 2, 4, 5];
const SIGHT_RANGE = [0, 60, 90, 120, 140];
const COOL_DOWN = [0, 10, 16, 24, 30]; // seconds out of sight before the level clears
const ROADBLOCK_EVERY = [0, 0, 0, 22, 14]; // seconds between roadblocks
const OFFICER_LOOK = { skin: '#b07a55', shirt: '#dbe4f0', jacket: '#1e2a4a', pants: '#1e2a4a', shoes: '#111111', hair: '#1e2a4a', cap: true };

export class Police {
  constructor(game) {
    this.g = game;
    this.level = 0;
    this.units = [];
    this.lastSeen = new THREE.Vector3();
    this.unseenT = 0;
    this.seeing = false;
    this.spawnT = 0;
    this.checkT = 0;
    this.lastEscalate = -99;
    this.fleeT = 0;
    this.onLevelChange = null;
    this.roadblocks = []; // { cars: [vehicle], x, z }
    this.roadblockT = 8;
  }

  get searching() {
    return this.level > 0 && this.unseenT > 2;
  }

  // A crime was committed where the player is. severity: the level it raises to.
  crime(label, severity) {
    const t = this.g.time;
    let next = Math.max(this.level, severity);
    if (this.level > 0 && severity >= this.level && t - this.lastEscalate > 6) next = this.level + 1;
    next = Math.min(MAX_LEVEL, next);
    this.lastSeen.copy(this.g.playerPosition());
    this.unseenT = 0;
    if (next > this.level) {
      this.lastEscalate = t;
      this.setLevel(next, label);
    }
  }

  setLevel(level, reason) {
    const before = this.level;
    this.level = level;
    if (this.onLevelChange) this.onLevelChange(level, before, reason);
  }

  clear(silent = false) {
    if (this.level === 0) return;
    this.setLevel(0, silent ? null : 'lost');
    this.unseenT = 0;
    for (const u of this.units) {
      u.v.siren = false;
      this.removeOfficer(u);
    }
    for (const rb of this.roadblocks) for (const v of rb.cars) v.siren = false;
  }

  // Remove every unit at once (after an arrest or a blackout).
  reset() {
    this.level = 0;
    for (const u of this.units) {
      this.removeOfficer(u);
      this.g.vehicles.remove(u.v);
    }
    this.units = [];
    this.unseenT = 0;
    this.clearRoadblocks();
  }

  clearRoadblocks() {
    for (const rb of this.roadblocks) for (const v of rb.cars) if (v.role === 'police') this.g.vehicles.remove(v);
    this.roadblocks = [];
  }

  // The player took this car: it stops being a police unit.
  release(vehicle) {
    for (const rb of this.roadblocks) {
      const k = rb.cars.indexOf(vehicle);
      if (k >= 0) rb.cars.splice(k, 1);
    }
    if (vehicle.type === 'police' && vehicle.role === 'police') {
      vehicle.siren = false;
      vehicle.role = 'parked';
    }
    const u = this.units.find((x) => x.v === vehicle);
    if (!u) return;
    this.removeOfficer(u);
    vehicle.ctrl = null;
    vehicle.siren = false;
    vehicle.role = 'parked';
    this.units.splice(this.units.indexOf(u), 1);
  }

  // Two cruisers parked across the road a couple of blocks ahead of a fleeing car.
  placeRoadblock() {
    const g = this.g;
    const pv = g.player.vehicle;
    if (!pv || pv.speed < 8) return false;
    const dir = Math.abs(pv.vx) > Math.abs(pv.vz) ? (pv.vx > 0 ? 2 : 3) : pv.vz > 0 ? 0 : 1;
    const d = DIRS[dir];
    let [i, j] = nearestNode(pv.x, pv.z);
    // the intersection two ahead of the player, then block the road just past it
    for (let k = 0; k < 2; k++) {
      if (!validNode(i + d.di, j + d.dj)) return false;
      i += d.di;
      j += d.dj;
    }
    if (!validNode(i + d.di, j + d.dj)) return false;
    const cx = nodeX(i) + d.fx * 22;
    const cz = nodeZ(j) + d.fz * 22;
    if (this.roadblocks.some((rb) => Math.hypot(rb.x - cx, rb.z - cz) < 20)) return false;
    const cars = [];
    for (const off of [-3.4, 3.4]) {
      const x = cx + d.fz * off;
      const z = cz - d.fx * off;
      if (!g.vehicles.isFree(x, z, 2.5)) continue;
      // parked across the road, nose angled toward the player
      const v = g.vehicles.spawn('police', x, z, Math.atan2(d.fz, -d.fx) + (off > 0 ? 0.35 : -0.35));
      v.role = 'police';
      v.siren = true;
      v.asleep = true;
      cars.push(v);
    }
    if (!cars.length) return false;
    this.roadblocks.push({ cars, x: cx, z: cz });
    g.ui.notify('Roadblock ahead', 'The police have blocked a road. Find another way.', 'warn');
    return true;
  }

  update(dt) {
    const g = this.g;
    const target = g.playerPosition();
    const pv = g.player.vehicle;
    const pvx = pv ? pv.vx : g.player.vel.x;
    const pvz = pv ? pv.vz : g.player.vel.z;

    // ---- can any unit see the player?
    this.checkT -= dt;
    if (this.level > 0 && this.checkT <= 0) {
      this.checkT = 0.2;
      this.seeing = this.units.some((u) => this.canSee(u, target)) ||
        this.roadblocks.some((rb) => rb.cars.some((v) => this.canSee({ v }, target)));
      if (this.seeing) this.lastSeen.copy(target);
    }
    if (this.level > 0) {
      this.unseenT = this.seeing ? 0 : this.unseenT + dt;
      if (this.unseenT > COOL_DOWN[this.level]) this.clear();
      // at one star, driving away from police that can see you counts as evading
      if (this.level === 1 && this.seeing && pv && pv.speed > 9) {
        this.fleeT += dt;
        if (this.fleeT > 3) {
          this.fleeT = 0;
          this.crime('Evading police', 2);
        }
      } else this.fleeT = Math.max(0, this.fleeT - dt);
    }

    // ---- spawn and despawn
    const want = UNITS_FOR_LEVEL[this.level];
    this.spawnT -= dt;
    if (this.units.length < want && this.spawnT <= 0) {
      this.spawnT = 2;
      this.spawnUnit(target);
    }
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      const d = Math.hypot(u.v.x - target.x, u.v.z - target.z);
      const surplus = this.units.length > want;
      if ((this.level === 0 || surplus) && d > 140 && !u.officer) {
        this.g.vehicles.remove(u.v);
        this.units.splice(i, 1);
      }
    }

    // ---- roadblocks at 3+ stars; old ones are cleared once far behind
    if (ROADBLOCK_EVERY[this.level]) {
      this.roadblockT -= dt;
      if (this.roadblockT <= 0 && this.placeRoadblock()) this.roadblockT = ROADBLOCK_EVERY[this.level];
      else if (this.roadblockT <= 0) this.roadblockT = 2;
    }
    for (let k = this.roadblocks.length - 1; k >= 0; k--) {
      const rb = this.roadblocks[k];
      const d = Math.hypot(rb.x - target.x, rb.z - target.z);
      if (d > 220 || (this.level === 0 && d > 90)) {
        for (const v of rb.cars) if (v.role === 'police') g.vehicles.remove(v);
        this.roadblocks.splice(k, 1);
      }
    }

    // ---- drive each unit
    for (const u of this.units) this.driveUnit(u, dt, target, pvx, pvz);
  }

  canSee(u, target) {
    const range = SIGHT_RANGE[this.level];
    const eyes = [[u.v.x, u.v.z]];
    if (u.officer) eyes.push([u.officer.pos.x, u.officer.pos.z]);
    for (const [x, z] of eyes) {
      const dx = target.x - x;
      const dz = target.z - z;
      const d = Math.hypot(dx, dz);
      if (d > range) continue;
      if (d < 8) return true;
      const dy = target.y + 1 - 1.3;
      const len = Math.hypot(dx, dy, dz);
      const hit = this.g.world.colliders.raycast(x, 1.3, z, dx / len, dy / len, dz / len, len);
      if (hit >= len - 0.5) return true;
    }
    return false;
  }

  spawnUnit(target) {
    const g = this.g;
    const cam = g.camera;
    const look = new THREE.Vector3();
    cam.getWorldDirection(look);
    const [ci, cj] = nearestNode(target.x, target.z);
    const options = [];
    for (let i = ci - 3; i <= ci + 3; i++)
      for (let j = cj - 3; j <= cj + 3; j++) {
        if (!validNode(i, j)) continue;
        const x = nodeX(i);
        const z = nodeZ(j);
        const d = Math.hypot(x - target.x, z - target.z);
        if (d < 100 || d > 230) continue;
        // prefer places the camera is not looking at, so cars do not pop in
        const inView = (x - cam.position.x) * look.x + (z - cam.position.z) * look.z > 0;
        options.push({ i, j, x, z, score: (inView ? 1 : 0) + Math.random() * 0.5 });
      }
    options.sort((a, b) => a.score - b.score);
    for (const o of options.slice(0, 6)) {
      // drive out of the intersection along the road that heads towards the player
      let bestDir = -1;
      let bestDot = -Infinity;
      DIRS.forEach((dir, k) => {
        if (!validNode(o.i + dir.di, o.j + dir.dj)) return;
        const dot = dir.fx * (target.x - o.x) + dir.fz * (target.z - o.z);
        if (dot > bestDot) {
          bestDot = dot;
          bestDir = k;
        }
      });
      if (bestDir < 0) continue;
      const dir = DIRS[bestDir];
      const [lx, lz] = laneOffset(bestDir);
      const x = o.x + dir.fx * 14 + lx;
      const z = o.z + dir.fz * 14 + lz;
      if (!g.vehicles.isFree(x, z, 3)) continue;
      const v = g.vehicles.spawn('police', x, z, Math.atan2(dir.fx, dir.fz));
      v.role = 'police';
      v.siren = true;
      this.units.push({ v, ai: new AIDriver(v), officer: null });
      return;
    }
  }

  driveUnit(u, dt, target, pvx, pvz) {
    const v = u.v;
    const g = this.g;
    if (this.level === 0) {
      v.siren = false;
      v.ctrl = u.ai.stop();
      return;
    }
    v.siren = true;
    const onFoot = !g.player.vehicle;
    const known = this.unseenT < 2;
    const goal = known ? target : this.lastSeen;
    const d = Math.hypot(goal.x - v.x, goal.z - v.z);

    // officers get out to chase a player on foot
    if (u.officer) {
      this.updateOfficer(u, dt, target);
      v.ctrl = u.ai.stop();
      return;
    }
    if (onFoot && known && d < 16 && Math.abs(v.forwardSpeed) < 4) {
      this.deployOfficer(u);
      v.ctrl = u.ai.stop();
      return;
    }

    let speed;
    if (this.level === 1) speed = 15;
    else if (this.level >= 4) speed = v.spec.maxSpeed;
    else speed = v.spec.maxSpeed * (this.level >= 3 ? 0.95 : 0.8);

    let tx = goal.x;
    let tz = goal.z;
    if (known && !onFoot) {
      tx += pvx * 0.6; // aim ahead of a moving car
      tz += pvz * 0.6;
    }
    if (d > 45) [tx, tz] = u.ai.routeAim(dt, tx, tz);
    else if (onFoot || !known) speed = Math.min(speed, Math.max(3, d * 0.8));
    else if (this.level < 3) speed = Math.min(speed, (g.player.vehicle ? g.player.vehicle.speed : 0) + 4 + d * 0.3);

    if (!known && d < 10) {
      v.ctrl = u.ai.stop(); // searching the last known spot
      return;
    }
    v.ctrl = u.ai.steerTo(dt, tx, tz, speed);
  }

  deployOfficer(u) {
    const g = this.g;
    const o = new Character(g.scene, OFFICER_LOOK, true);
    const door = u.v.doorPoint(new THREE.Vector3(), 0.7);
    o.pos = new THREE.Vector3(door.x, g.world.heightAt(door.x, door.z), door.z);
    o.facing = u.v.heading;
    o.mesh.position.copy(o.pos);
    u.officer = o;
    u.v.doorTarget = 1;
    setTimeout(() => (u.v.doorTarget = 0), 600);
  }

  removeOfficer(u) {
    if (!u.officer) return;
    u.officer.dispose(this.g.scene);
    u.officer = null;
  }

  updateOfficer(u, dt, target) {
    const g = this.g;
    const o = u.officer;
    const onFoot = !g.player.vehicle;
    const dPlayer = Math.hypot(target.x - o.pos.x, target.z - o.pos.z);
    let gx;
    let gz;
    let speed;
    // give up and return to the car when the player drives off or gets away
    const returning = !onFoot || dPlayer > 45 || this.unseenT > 3;
    if (returning) {
      const door = u.v.doorPoint(new THREE.Vector3(), 0.7);
      gx = door.x;
      gz = door.z;
      speed = 4.2;
      if (Math.hypot(gx - o.pos.x, gz - o.pos.z) < 1.2) {
        this.removeOfficer(u);
        return;
      }
    } else {
      gx = target.x;
      gz = target.z;
      speed = this.level === 1 ? 4.2 : 5.6;
      if (dPlayer < 1.1) {
        g.arrest(this.level);
        return;
      }
    }
    const dx = gx - o.pos.x;
    const dz = gz - o.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    o.facing = dampAngle(o.facing, Math.atan2(dx, dz), 10, dt);
    o.pos.x += (dx / len) * speed * dt;
    o.pos.z += (dz / len) * speed * dt;
    g.world.colliders.resolveCircle(o.pos, 0.35, o.pos.y + 0.2, 1.6);
    g.vehicles.pushOut(o.pos, 0.35);
    o.pos.y = damp(o.pos.y, g.world.heightAt(o.pos.x, o.pos.z), 20, dt);
    o.mesh.position.copy(o.pos);
    o.mesh.rotation.y = o.facing;
    o.animate(dt, speed);
  }
}
