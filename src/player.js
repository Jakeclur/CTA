// Third-person player: a jointed character model with procedural animation
// (idle, walk, run, jump) and simple capsule-style physics.
import * as THREE from 'three';
import { damp, dampAngle, clamp } from './utils.js';

const WALK_SPEED = 3.4;
const SPRINT_SPEED = 7.4;
const GRAVITY = 22;
const JUMP_SPEED = 6.8;
export const PLAYER_RADIUS = 0.35;
export const PLAYER_HEIGHT = 1.8;

const matCache = new Map();
function mat(color, roughness = 0.75) {
  const k = color + roughness;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness }));
  return matCache.get(k);
}

const capsuleCache = new Map();
function capsule(r, len, material, y, shadow) {
  const k = `${r}|${len}`;
  if (!capsuleCache.has(k)) capsuleCache.set(k, new THREE.CapsuleGeometry(r, len, 3, 8));
  const m = new THREE.Mesh(capsuleCache.get(k), material);
  m.position.y = y;
  m.castShadow = shadow;
  return m;
}

export const PLAYER_LOOK = {
  skin: '#c68863', shirt: '#2d6a8f', jacket: '#1f2933', pants: '#2b3a55', shoes: '#f2f2f2', hair: '#2a1a12',
};

// Builds a jointed character. `lite` drops small details (eyes, neck, hands) and
// shadows for crowds of pedestrians.
export function buildCharacter(look = PLAYER_LOOK, lite = false) {
  const L = { ...PLAYER_LOOK, ...look };
  const shadow = !lite;
  const skin = mat(L.skin, 0.7);
  const jacket = mat(L.jacket, 0.65);
  const pants = mat(L.pants, 0.9);
  const shoes = mat(L.shoes, 0.6);
  const hair = mat(L.hair, 0.9);

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hips = new THREE.Group();
  hips.position.y = 0.95;
  body.add(hips);

  const torso = new THREE.Group();
  hips.add(torso);
  const chest = capsule(0.19, 0.3, jacket, 0.33, shadow);
  chest.scale.set(1.12, 1, 0.66);
  torso.add(chest);
  if (!lite) {
    const shirtFront = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, 0.02), mat(L.shirt, 0.8));
    shirtFront.position.set(0, 0.33, 0.13);
    torso.add(shirtFront);
  }
  const pelvis = capsule(0.16, 0.08, pants, 0.02, shadow);
  pelvis.scale.set(1.15, 1, 0.75);
  torso.add(pelvis);

  const head = new THREE.Group();
  head.position.y = 0.66;
  torso.add(head);
  if (!lite) head.add(capsule(0.05, 0.06, skin, -0.04, shadow));
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.12, lite ? 10 : 16, lite ? 8 : 12), skin);
  skull.position.y = 0.1;
  skull.scale.set(0.92, 1.05, 1);
  skull.castShadow = shadow;
  head.add(skull);
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.128, lite ? 10 : 16, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
  hairCap.position.set(0, 0.12, -0.012);
  hairCap.rotation.x = -0.25;
  head.add(hairCap);
  if (L.cap) {
    const peak = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.12), hair);
    peak.position.set(0, 0.17, 0.13);
    head.add(peak);
  }
  if (!lite) {
    const eyeMat = mat('#111111');
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 6), eyeMat);
      eye.position.set(sx * 0.04, 0.12, 0.108);
      head.add(eye);
    }
  }

  const makeArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.25, 0.5, 0);
    torso.add(shoulder);
    shoulder.add(capsule(0.06, 0.2, jacket, -0.14, shadow));
    const elbow = new THREE.Group();
    elbow.position.y = -0.29;
    shoulder.add(elbow);
    elbow.add(capsule(0.05, lite ? 0.26 : 0.18, skin, lite ? -0.16 : -0.12, shadow));
    if (!lite) {
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), skin);
      hand.position.y = -0.27;
      elbow.add(hand);
    }
    return { shoulder, elbow };
  };
  const makeLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.1, 0, 0);
    hips.add(hip);
    hip.add(capsule(0.08, 0.28, pants, -0.22, shadow));
    const knee = new THREE.Group();
    knee.position.y = -0.45;
    hip.add(knee);
    knee.add(capsule(0.066, 0.3, pants, -0.2, shadow));
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.26), shoes);
    foot.position.set(0, -0.44, 0.05);
    foot.castShadow = shadow;
    knee.add(foot);
    return { hip, knee };
  };

  // The character faces local +z; its left is +x.
  return {
    root, body, hips, torso, head,
    armL: makeArm(1), armR: makeArm(-1),
    legL: makeLeg(1), legR: makeLeg(-1),
  };
}

// A character model plus its procedural animation state. Used by the player,
// pedestrians and police officers.
export class Character {
  constructor(scene, look, lite = false) {
    this.rig = buildCharacter(look, lite);
    this.mesh = this.rig.root;
    scene.add(this.mesh);
    this.phase = Math.random() * 6;
    this.runBlend = 0;
    this.moveBlend = 0;
    this.airBlend = 0;
    this.time = Math.random() * 10;
    this.grounded = true;
    this.stepCount = 0;
  }

  dispose(scene) {
    scene.remove(this.mesh);
  }

  animate(dt, speed) {
    const r = this.rig;
    this.time += dt;
    this.moveBlend = damp(this.moveBlend, clamp(speed / 1.5, 0, 1), 10, dt);
    this.runBlend = damp(this.runBlend, clamp((speed - WALK_SPEED) / (SPRINT_SPEED - WALK_SPEED), 0, 1), 6, dt);
    this.airBlend = damp(this.airBlend, this.grounded ? 0 : 1, 12, dt);
    const stride = 1.5 + this.runBlend * 1.1;
    const before = Math.floor(this.phase / Math.PI);
    this.phase += (speed / stride) * Math.PI * 2 * dt;
    // one footstep every half cycle (used for footstep sounds)
    if (this.grounded && speed > 0.5 && Math.floor(this.phase / Math.PI) !== before) this.stepCount++;

    const m = this.moveBlend * (1 - this.airBlend);
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const legAmp = 0.5 + this.runBlend * 0.45;
    const kneeAmp = 0.6 + this.runBlend * 0.9;
    const armAmp = 0.45 + this.runBlend * 0.5;

    const breathe = Math.sin(this.time * 2.2);
    const set = (o, k, v) => (o.rotation[k] = damp(o.rotation[k], v, 18, dt));

    // legs
    set(r.legL.hip, 'x', -s * legAmp * m + this.airBlend * -0.7);
    set(r.legR.hip, 'x', s * legAmp * m + this.airBlend * 0.25);
    set(r.legL.knee, 'x', (Math.max(0, -c) * kneeAmp + 0.05) * m + this.airBlend * 1.1);
    set(r.legR.knee, 'x', (Math.max(0, c) * kneeAmp + 0.05) * m + this.airBlend * 0.4);
    // arms swing opposite the legs
    set(r.armL.shoulder, 'x', s * armAmp * m + breathe * 0.03 * (1 - m) - this.airBlend * 0.5);
    set(r.armR.shoulder, 'x', -s * armAmp * m - breathe * 0.03 * (1 - m) - this.airBlend * 0.5);
    set(r.armL.shoulder, 'z', 0.1 + this.airBlend * 0.5);
    set(r.armR.shoulder, 'z', -0.1 - this.airBlend * 0.5);
    set(r.armL.elbow, 'x', -0.2 - this.runBlend * 1.1 * m);
    set(r.armR.elbow, 'x', -0.2 - this.runBlend * 1.1 * m);
    // body bob and lean
    r.body.position.y = Math.abs(s) * (0.03 + this.runBlend * 0.05) * m;
    set(r.hips, 'x', this.runBlend * 0.22 * m);
    r.torso.scale.y = 1 + breathe * 0.008 * (1 - m);
    set(r.torso, 'y', -s * 0.12 * m);
    set(r.head, 'y', s * 0.1 * m);
  }
}

export class Player extends Character {
  constructor(scene) {
    super(scene, PLAYER_LOOK, false);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.health = 100;
    this.vehicle = null; // vehicle currently driven
  }

  setPosition(x, y, z, facing = this.facing) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.facing = facing;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = facing;
  }

  setVisible(v) {
    this.mesh.visible = v;
  }

  // input: Input, camYaw: camera heading, world: { colliders, heightAt }, pushOut(pos, r) for vehicles
  update(dt, input, camYaw, world, pushOut) {
    const fwd = input.axis('KeyS', 'KeyW');
    const side = input.axis('KeyA', 'KeyD');
    const fx = Math.sin(camYaw);
    const fz = Math.cos(camYaw);
    // camera right is (-cos, sin)
    let dx = fx * fwd - fz * side;
    let dz = fz * fwd + fx * side;
    const len = Math.hypot(dx, dz);
    if (len > 0) {
      dx /= len;
      dz /= len;
    }
    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
    const target = len > 0 ? (sprint ? SPRINT_SPEED : WALK_SPEED) : 0;
    const accel = this.grounded ? 12 : 2.5;
    this.vel.x = damp(this.vel.x, dx * target, accel, dt);
    this.vel.z = damp(this.vel.z, dz * target, accel, dt);

    if (this.grounded && input.hit('Space')) {
      this.vel.y = JUMP_SPEED;
      this.grounded = false;
    }
    this.vel.y -= GRAVITY * dt;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    world.colliders.resolveCircle(this.pos, PLAYER_RADIUS, this.pos.y + 0.2, PLAYER_HEIGHT - 0.2);
    if (pushOut) pushOut(this.pos, PLAYER_RADIUS);

    const ground = world.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y <= ground) {
      this.pos.y = ground;
      this.vel.y = 0;
      this.grounded = true;
    } else if (this.grounded && this.pos.y - ground < 0.3 && this.vel.y <= 0) {
      this.pos.y = ground; // walk down kerbs smoothly
      this.vel.y = 0;
    } else {
      this.grounded = false;
    }

    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (len > 0 && speed > 0.3) this.facing = dampAngle(this.facing, Math.atan2(this.vel.x, this.vel.z), 12, dt);

    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.facing;
    this.animate(dt, speed);
    return speed;
  }
}
