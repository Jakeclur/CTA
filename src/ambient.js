// Background life that is not people or cars: flocks of pigeons pecking around
// fountains and benches that scatter when someone walks or drives at them,
// gulls wheeling over the beach, and steam drifting out of some manholes.
// Birds are three instanced meshes per species (body, left wing, right wing),
// so the whole lot costs six draw calls.
import * as THREE from 'three';
import { mergeParts, part } from './props.js';
import { SAND_Z0, SHORE_Z, BOUNDS } from './config.js';
import { makeRng, damp } from './utils.js';

const FLOCK_RANGE = 90; // flocks further than this from the player are hidden
const FLOCK_SIZE = 7;
const GULLS = 7;

function birdBody(body, head, beak) {
  return mergeParts([
    part(new THREE.SphereGeometry(1, 10, 7), { sx: 0.09, sy: 0.085, sz: 0.17 }, body),
    part(new THREE.SphereGeometry(1, 8, 6), { y: 0.08, z: 0.13, sx: 0.055, sy: 0.055, sz: 0.06 }, head),
    part(new THREE.ConeGeometry(0.012, 0.05, 5), { y: 0.075, z: 0.2, rx: Math.PI / 2 }, beak),
    part(new THREE.BoxGeometry(0.1, 0.012, 0.12), { y: 0.01, z: -0.2, rx: 0.15 }, body), // tail
  ]);
}

// A wing hinged at x = 0, reaching out along +x (mirrored for the left wing).
function wing(colour, tip) {
  const g = new THREE.BufferGeometry();
  const v = [0, 0, 0.08, 0, 0, -0.1, 0.3, 0, -0.06, 0.22, 0, 0.06];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  g.computeVertexNormals();
  const c1 = new THREE.Color(colour);
  const c2 = new THREE.Color(tip);
  g.setAttribute('color', new THREE.Float32BufferAttribute([...c1.toArray(), ...c1.toArray(), ...c2.toArray(), ...c2.toArray()], 3));
  return g;
}

class Species {
  constructor(scene, count, scale, look) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    this.body = new THREE.InstancedMesh(birdBody(look.body, look.head, look.beak), mat, count);
    this.right = new THREE.InstancedMesh(wing(look.wing, look.tip), mat, count);
    const lg = wing(look.wing, look.tip);
    lg.scale(-1, 1, 1);
    lg.setIndex([0, 1, 2, 0, 2, 3]);
    this.left = new THREE.InstancedMesh(lg, mat, count);
    for (const m of [this.body, this.left, this.right]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = scale > 1;
      scene.add(m);
    }
    this.scale = scale;
    this.count = count;
    this._m = new THREE.Matrix4();
    this._w = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._hide = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  // b: { x, y, z, yaw, pitch, bank, flap } — flap is the wing angle in radians
  set(i, b) {
    if (!b) {
      this.body.setMatrixAt(i, this._hide);
      this.left.setMatrixAt(i, this._hide);
      this.right.setMatrixAt(i, this._hide);
      return;
    }
    this._e.set(b.pitch, b.yaw, b.bank);
    this._q.setFromEuler(this._e);
    this._s.setScalar(this.scale);
    this._m.compose(this._p.set(b.x, b.y, b.z), this._q, this._s);
    this.body.setMatrixAt(i, this._m);
    for (const [mesh, side] of [[this.right, -1], [this.left, 1]]) {
      // wings hinge at the shoulders; folded wings lie along the body
      this._e.set(0, side * -b.fold, side * b.flap);
      this._q.setFromEuler(this._e);
      this._w.compose(this._p.set(side * -0.07, 0.04, 0.02), this._q, this._s.setScalar(1));
      mesh.setMatrixAt(i, this._w.premultiply(this._m));
    }
  }

  commit() {
    for (const m of [this.body, this.left, this.right]) m.instanceMatrix.needsUpdate = true;
  }
}

export class Ambient {
  constructor(game) {
    this.g = game;
    const scene = game.scene;
    const w = game.world;
    this.rng = makeRng(808);
    const r = this.rng;

    // pigeons gather where people sit: fountains and a share of the benches
    const spots = [...(w.fountains || []).map((f) => ({ x: f.x, z: f.z + 5 }))];
    for (const b of w.benches || []) if (r.chance(0.35)) spots.push({ x: b.x + Math.sin(b.rot) * 2.5, z: b.z + Math.cos(b.rot) * 2.5 });
    this.flocks = spots.map((s) => ({
      x: s.x, z: s.z, scared: 0, away: false,
      birds: Array.from({ length: FLOCK_SIZE }, () => this.newPigeon(s)),
    }));
    this.pigeons = new Species(scene, Math.max(1, this.flocks.length * FLOCK_SIZE), 1, {
      body: '#7d8590', head: '#4f5a66', beak: '#3a3a3a', wing: '#8a929c', tip: '#3f454c',
    });

    this.gulls = new Species(scene, GULLS, 2.4, {
      body: '#f2f2ef', head: '#ffffff', beak: '#e0a526', wing: '#c9ccd1', tip: '#2c2f33',
    });
    this.gullList = Array.from({ length: GULLS }, () => ({
      cx: r.range(BOUNDS.minX + 40, BOUNDS.maxX - 40),
      cz: r.range(SAND_Z0 + 10, SHORE_Z + 30),
      rad: r.range(14, 34),
      h: r.range(14, 30),
      a: r.range(0, Math.PI * 2),
      speed: r.range(0.18, 0.32) * (r.chance(0.5) ? 1 : -1),
      flapT: r.range(0, 4),
    }));

    // a third of the manholes breathe steam
    this.vents = (w.manholes || []).filter(() => r.chance(0.33)).map((m) => ({ x: m.x, z: m.z, acc: 0 }));
  }

  newPigeon(s) {
    const r = this.rng;
    const a = r.range(0, Math.PI * 2);
    const d = r.range(0.3, 3);
    return {
      x: s.x + Math.cos(a) * d, z: s.z + Math.sin(a) * d, y: 0, yaw: r.range(0, Math.PI * 2),
      peck: r.range(0, 3), hop: 0, hopX: 0, hopZ: 0, vy: 0, vx: 0, vz: 0, fly: 0, flapPh: r.range(0, 6),
    };
  }

  update(dt, t) {
    const g = this.g;
    const p = g.playerPosition();
    const heightAt = g.world.heightAt;
    let n = 0;
    for (const f of this.flocks) {
      const d = Math.hypot(f.x - p.x, f.z - p.z);
      if (d > FLOCK_RANGE) {
        // out of sight: the flock settles again
        if (f.away) {
          f.away = false;
          f.birds = f.birds.map(() => this.newPigeon(f));
        }
        for (let i = 0; i < FLOCK_SIZE; i++) this.pigeons.set(n++, null);
        continue;
      }
      if (f.ground === undefined) f.ground = heightAt(f.x, f.z);
      // a person walking into the flock, or a car coming past, sends it up
      const threat = this.threatNear(f.x, f.z, p);
      if (threat && !f.away) {
        f.away = true;
        f.scared = 12 + this.rng() * 10;
        for (const b of f.birds) {
          const ax = b.x - threat.x;
          const az = b.z - threat.z;
          const l = Math.hypot(ax, az) || 1;
          b.fly = 1;
          b.vx = (ax / l) * 6 + (this.rng() - 0.5) * 3;
          b.vz = (az / l) * 6 + (this.rng() - 0.5) * 3;
          b.vy = 4 + this.rng() * 2;
        }
        if (d < 40) g.audio.play('flutter');
      }
      if (f.away) {
        f.scared -= dt;
        if (f.scared <= 0 && !this.threatNear(f.x, f.z, p, 14)) {
          // come back down: drop in from above
          f.away = false;
          f.birds = f.birds.map(() => {
            const b = this.newPigeon(f);
            b.y = 12;
            b.fly = 1;
            b.landing = true;
            return b;
          });
        }
      }
      for (const b of f.birds) this.pigeon(b, f, dt, t, n++);
    }
    this.pigeons.commit();

    for (let i = 0; i < GULLS; i++) {
      const s = this.gullList[i];
      if (Math.abs(s.cz - p.z) > 260 || Math.abs(s.cx - p.x) > 320) {
        this.gulls.set(i, null);
        continue;
      }
      s.a += (s.speed * dt * 12) / s.rad;
      const x = s.cx + Math.cos(s.a) * s.rad;
      const z = s.cz + Math.sin(s.a) * s.rad;
      // tangent of the circle: the way the gull is flying
      const dir = Math.sign(s.speed);
      const yaw = Math.atan2(-Math.sin(s.a) * dir, Math.cos(s.a) * dir);
      // mostly gliding, with bursts of flapping
      s.flapT -= dt;
      if (s.flapT < -1.6) s.flapT = 2 + this.rng() * 5;
      const flap = s.flapT < 0 ? Math.sin(t * 9 + i) * 0.7 : 0.12 + Math.sin(t * 0.8 + i) * 0.05;
      this.gulls.set(i, { x, y: s.h + Math.sin(t * 0.5 + i) * 1.5, z, yaw, pitch: 0, bank: dir * 0.35, flap, fold: 0 });
    }
    this.gulls.commit();

    this.steam(dt, p, g);
  }

  threatNear(x, z, p, r = 5) {
    const g = this.g;
    if (!g.player.vehicle && Math.hypot(x - p.x, z - p.z) < r) return p;
    for (const v of g.vehicles.list) if (v.speed > 3 && Math.abs(v.x - x) < r + 4 && Math.abs(v.z - z) < r + 4) return v;
    return null;
  }

  pigeon(b, f, dt, t, i) {
    const ground = f.ground;
    if (b.fly > 0) {
      if (b.landing) {
        // glide down onto the square
        b.y = Math.max(ground, b.y - dt * 4);
        if (b.y <= ground + 0.01) {
          b.fly = 0;
          b.landing = false;
        }
      } else {
        b.x += b.vx * dt;
        b.z += b.vz * dt;
        b.y += b.vy * dt;
        b.vy = Math.max(1.2, b.vy - dt * 1.5);
        if (b.y > 30) {
          this.pigeons.set(i, null);
          return;
        }
        b.yaw = Math.atan2(b.vx, b.vz);
      }
      b.flapPh += dt * 22;
      this.pigeons.set(i, { x: b.x, y: b.y, z: b.z, yaw: b.yaw, pitch: -0.2, bank: 0, flap: Math.sin(b.flapPh) * 0.9, fold: 0 });
      return;
    }
    // on the ground: peck, look about, and hop a few steps now and then
    b.peck -= dt;
    if (b.peck < 0) {
      b.peck = 0.6 + this.rng() * 2.5;
      if (this.rng.chance(0.35)) {
        const a = this.rng() * Math.PI * 2;
        b.hopX = Math.cos(a) * 0.5;
        b.hopZ = Math.sin(a) * 0.5;
        b.hop = 0.5;
        b.yaw = Math.atan2(b.hopX, b.hopZ);
      }
    }
    let lift = 0;
    if (b.hop > 0) {
      b.hop -= dt;
      b.x += b.hopX * dt * 2;
      b.z += b.hopZ * dt * 2;
      lift = Math.abs(Math.sin(b.hop * 25)) * 0.04;
      // stay close to the flock's spot
      if (Math.hypot(b.x - f.x, b.z - f.z) > 4) {
        b.hopX = (f.x - b.x) * 0.2;
        b.hopZ = (f.z - b.z) * 0.2;
      }
    }
    const pecking = b.peck < 0.35 && b.hop <= 0;
    b.y = damp(b.y, ground, 10, dt);
    this.pigeons.set(i, {
      x: b.x, y: b.y + 0.09 + lift, z: b.z, yaw: b.yaw,
      pitch: pecking ? 0.5 + Math.sin(t * 30) * 0.1 : 0, bank: 0, flap: 0.05, fold: 1.35,
    });
  }

  // Steam out of vents near the player; thicker in the cool of the night.
  steam(dt, p, g) {
    const fx = g.effects;
    const k = 0.5 + (g.nightK || 0) * 0.5;
    for (const v of this.vents) {
      if (Math.abs(v.x - p.x) > 60 || Math.abs(v.z - p.z) > 60) continue;
      v.acc += dt * 2.5;
      while (v.acc > 1) {
        v.acc -= 1;
        fx.emit(v.x + (Math.random() - 0.5) * 0.4, (v.y ??= g.world.heightAt(v.x, v.z)) + 0.1, v.z + (Math.random() - 0.5) * 0.4, {
          vx: 0.3 + (Math.random() - 0.5) * 0.4, vz: (Math.random() - 0.5) * 0.4, vy: 0.9 + Math.random() * 0.5,
          life: 2.4 + Math.random(), s0: 0.6, s1: 3.2, a: 0.16 * k, shade: 1.2,
        });
      }
    }
  }
}
