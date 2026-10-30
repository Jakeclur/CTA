// Third-person player: a jointed character model with procedural animation
// (idle, walk, run, jump) and simple capsule-style physics.
import * as THREE from 'three';
import { damp, dampAngle, clamp } from './utils.js';
import { characterParts, characterMaterial } from './characterModel.js';

const WALK_SPEED = 3.4;
const SPRINT_SPEED = 7.4;
const GRAVITY = 22;
const JUMP_SPEED = 6.8;
export const PLAYER_RADIUS = 0.35;
export const PLAYER_HEIGHT = 1.8;

export const PLAYER_LOOK = {
  skin: '#c68863', shirt: '#d8d4cc', jacket: '#1f2933', pants: '#2b3a55', shoes: '#ece9e4', hair: '#2a1a12', hairStyle: 'short', build: 'm',
};

// Builds a jointed character from smooth segments (see characterModel.js).
// `lite` uses coarser shapes without faces and shadows, for crowds.
export function buildCharacter(look = PLAYER_LOOK, lite = false) {
  const L = { ...PLAYER_LOOK, ...look };
  const G = characterParts(L, lite);
  const shadow = !lite;
  const seg = (geo, parent, y = 0) => {
    const m = new THREE.Mesh(geo, characterMaterial);
    m.position.y = y;
    m.castShadow = shadow;
    parent.add(m);
    return m;
  };

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hips = new THREE.Group();
  hips.position.y = 0.95;
  body.add(hips);

  const torso = new THREE.Group();
  hips.add(torso);
  seg(G.torso, torso, 0.02);
  seg(G.pelvis, torso, 0.0);

  const head = new THREE.Group();
  head.position.y = 0.58;
  torso.add(head);
  seg(G.head, head);

  const female = L.build === 'f';
  const makeArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * (lite ? (female ? 0.19 : 0.215) : female ? 0.162 : 0.178), lite ? 0.5 : 0.475, 0);
    torso.add(shoulder);
    seg(G.upperArm, shoulder);
    const elbow = new THREE.Group();
    elbow.position.y = -0.29;
    shoulder.add(elbow);
    const fa = seg(G.forearm, elbow);
    fa.scale.x = side; // mirror the thumb
    return { shoulder, elbow };
  };
  const makeLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(side * (female ? 0.095 : 0.1), 0, 0);
    hips.add(hip);
    seg(G.thigh, hip);
    const knee = new THREE.Group();
    knee.position.y = -0.45;
    hip.add(knee);
    seg(G.shin, knee);
    const ankle = new THREE.Group();
    ankle.position.y = -0.42;
    knee.add(ankle);
    seg(G.foot, ankle);
    return { hip, knee, ankle };
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

    const idle = 1 - m;
    // standing: weight shifts slowly from foot to foot and the head looks about
    const shift = Math.sin(this.time * 0.45 + this.phase) * idle * (1 - this.airBlend);
    const lookAbout = Math.sin(this.time * 0.31 + this.phase * 2) * 0.35 + Math.sin(this.time * 0.83) * 0.1;

    // legs (positive x swings a leg back); the swing leg lifts its knee
    const hipL = -s * legAmp * m + this.airBlend * -0.7 + shift * 0.04;
    const hipR = s * legAmp * m + this.airBlend * 0.25 - shift * 0.04;
    const kneeL = (Math.max(0, -c) * kneeAmp + 0.05) * m + this.airBlend * 1.1 + Math.max(0, -shift) * 0.12;
    const kneeR = (Math.max(0, c) * kneeAmp + 0.05) * m + this.airBlend * 0.4 + Math.max(0, shift) * 0.12;
    set(r.legL.hip, 'x', hipL);
    set(r.legR.hip, 'x', hipR);
    set(r.legL.knee, 'x', kneeL);
    set(r.legR.knee, 'x', kneeR);
    // feet stay level with the ground, roll onto the toes as they push off and
    // lift the toes as the heel comes down
    const roll = (h, k) => -(h + k) + Math.max(0, h) * 0.9 * m - Math.max(0, -h) * 0.35 * m + this.airBlend * 0.35;
    set(r.legL.ankle, 'x', roll(hipL, kneeL));
    set(r.legR.ankle, 'x', roll(hipR, kneeR));
    // arms swing opposite the legs, elbows bend more on the forward swing
    set(r.armL.shoulder, 'x', s * armAmp * m + breathe * 0.03 * idle - this.airBlend * 0.5);
    set(r.armR.shoulder, 'x', -s * armAmp * m - breathe * 0.03 * idle - this.airBlend * 0.5);
    set(r.armL.shoulder, 'z', 0.08 + this.runBlend * 0.08 * m + this.airBlend * 0.5);
    set(r.armR.shoulder, 'z', -0.08 - this.runBlend * 0.08 * m - this.airBlend * 0.5);
    set(r.armL.elbow, 'x', -0.18 - Math.max(0, -s) * 0.35 * m - this.runBlend * 1.1 * m);
    set(r.armR.elbow, 'x', -0.18 - Math.max(0, s) * 0.35 * m - this.runBlend * 1.1 * m);
    // body: bobs twice per stride, hips sway and twist against the shoulders
    r.body.position.y = (Math.abs(s) - 0.5) * (0.035 + this.runBlend * 0.05) * m;
    r.body.position.x = shift * 0.025;
    set(r.hips, 'x', this.runBlend * 0.22 * m);
    set(r.hips, 'y', s * 0.09 * m);
    set(r.hips, 'z', c * 0.05 * m * (1 - this.runBlend * 0.5) - shift * 0.035);
    r.torso.scale.y = 1 + breathe * 0.008 * idle;
    set(r.torso, 'y', -s * 0.2 * m);
    set(r.torso, 'z', -c * 0.04 * m + shift * 0.03);
    // the head stays steady and looks ahead while walking
    set(r.head, 'y', s * 0.11 * m + lookAbout * idle);
    set(r.head, 'z', c * 0.02 * m - shift * 0.02);
  }
}

// Standing and sitting activities for pedestrians: on the phone, chatting with
// gestures, looking in a shop window with hands behind the back, sitting on a
// bench. Joints ease into each pose, with small movements so nobody freezes.
Character.prototype.pose = function pose(dt, kind, t) {
  const r = this.rig;
  const set = (o, k, v, rate = 6) => (o.rotation[k] = damp(o.rotation[k], v, rate, dt));
  const sway = Math.sin(t * 0.9 + this.phase) * 0.04;
  let hipX = 0;
  let kneeX = 0.04;
  let bodyY = 0;
  let armLx = 0.05;
  let armRx = -0.05;
  let armLz = 0.1;
  let armRz = -0.1;
  let elbowL = -0.25;
  let elbowR = -0.25;
  let headX = 0;
  let headY = 0;
  if (kind === 'phone') {
    armRx = -0.35;
    armRz = -0.55;
    elbowR = -2.5;
    headX = 0.12;
    headY = Math.sin(t * 0.6 + this.phase) * 0.35;
  } else if (kind === 'chat') {
    const talk = Math.sin(t * 1.7 + this.phase);
    armLx = -0.25 - Math.max(0, talk) * 0.4;
    elbowL = -0.9 - Math.max(0, talk) * 0.5;
    armRx = -0.2 - Math.max(0, -talk) * 0.35;
    elbowR = -0.8;
    headX = Math.sin(t * 3.1 + this.phase) * 0.06;
    headY = Math.sin(t * 0.7 + this.phase) * 0.15;
  } else if (kind === 'window') {
    armLx = 0.45;
    armRx = 0.45;
    elbowL = elbowR = -0.7;
    headX = 0.08;
    headY = Math.sin(t * 0.35 + this.phase) * 0.4;
  } else if (kind === 'sit') {
    hipX = -1.5;
    kneeX = 1.45;
    bodyY = -0.43;
    armLx = armRx = -0.35;
    elbowL = elbowR = -0.7;
    headY = Math.sin(t * 0.4 + this.phase) * 0.3;
  }
  set(r.legL.hip, 'x', hipX + (kind === 'sit' ? 0 : sway));
  set(r.legR.hip, 'x', hipX - (kind === 'sit' ? 0 : sway * 0.5));
  set(r.legL.knee, 'x', kneeX);
  set(r.legR.knee, 'x', kneeX);
  set(r.armL.shoulder, 'x', armLx);
  set(r.armR.shoulder, 'x', armRx);
  set(r.armL.shoulder, 'z', armLz);
  set(r.armR.shoulder, 'z', armRz);
  set(r.armL.elbow, 'x', elbowL);
  set(r.armR.elbow, 'x', elbowR);
  set(r.head, 'x', headX);
  set(r.head, 'y', headY, 3);
  // feet flat on the ground
  set(r.legL.ankle, 'x', -(hipX + kneeX));
  set(r.legR.ankle, 'x', -(hipX + kneeX));
  set(r.hips, 'x', 0);
  set(r.hips, 'y', 0);
  set(r.torso, 'y', 0);
  set(r.torso, 'z', 0);
  set(r.head, 'z', 0);
  r.body.position.x = damp(r.body.position.x, 0, 6, dt);
  r.body.position.y = damp(r.body.position.y, bodyY, 6, dt);
  r.torso.scale.y = 1 + Math.sin(t * 2.2 + this.phase) * 0.008;
  r.hips.rotation.z = kind === 'sit' ? 0 : sway * 0.3; // shifting weight
};

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
