// Mission engine: runs the step lists in missionData.js, draws world markers,
// tracks objectives, timers, rewards, failure and replays.
import * as THREE from 'three';
import { Character } from './player.js';

// A glowing column with a ring and a bobbing arrow, used for objectives.
export class Marker {
  constructor(scene, color = '#ffd23f', radius = 1.6) {
    this.group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 6, 24, 1, true), mat);
    beam.position.y = 3;
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.8, radius, 32), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 4), new THREE.MeshBasicMaterial({ color, fog: false }));
    arrow.rotation.x = Math.PI;
    this.arrow = arrow;
    this.group.add(beam, ring, arrow);
    this.group.visible = false;
    this.scene = scene;
    scene.add(this.group);
    this.followVehicle = null;
  }

  show(x, y, z, scale = 1) {
    this.group.position.set(x, y, z);
    this.group.scale.setScalar(scale);
    this.group.visible = true;
  }

  hide() {
    this.group.visible = false;
    this.followVehicle = null;
  }

  update(t) {
    if (!this.group.visible) return;
    if (this.followVehicle) {
      const v = this.followVehicle;
      this.group.position.set(v.x, v.y + v.spec.H, v.z);
    }
    this.arrow.position.y = (this.followVehicle ? 1.6 : 4.2) + Math.sin(t * 3) * 0.25;
    this.arrow.rotation.y = t * 1.5;
  }
}

export class Missions {
  constructor(game, defs) {
    this.g = game;
    this.defs = defs;
    this.completed = new Set();
    this.active = null;
    this.autoDone = new Set();
    this.objective = new Marker(game.scene, '#ffd23f', 1.6);
    this.starts = defs.filter((d) => d.start).map((d) => ({ def: d, marker: new Marker(game.scene, '#3fd2ff', 1.2) }));
    this.npcs = new Map();
    this.playTime = 0;
    this.navTarget = null; // { x, z } for the minimap and GPS
  }

  load(ids) {
    this.completed = new Set(ids || []);
  }

  serialize() {
    return [...this.completed];
  }

  isAvailable(def) {
    return !def.requires || def.requires.every((id) => this.completed.has(id));
  }

  // ------------------------------------------------------------------ control

  start(def) {
    if (this.active) return false;
    const g = this.g;
    if (g.police.level > 0) {
      g.ui.notify('Lose the police first', 'Missions can only start with no wanted level.', 'warn');
      return false;
    }
    this.active = { def, idx: -1, vehicles: {}, timer: null, stepT: 0 };
    g.ui.missionTitle(def.title);
    g.audio?.play('mission');
    this.next();
    return true;
  }

  abandon() {
    if (!this.active) return;
    this.fail('Mission abandoned');
  }

  fail(reason) {
    const a = this.active;
    if (!a) return;
    this.cleanup();
    this.g.ui.missionResult(false, a.def.title, reason);
    this.g.audio?.play('fail');
  }

  pass() {
    const a = this.active;
    const reward = a.step.cash || 0;
    this.cleanup();
    this.completed.add(a.def.id);
    this.g.cash += reward;
    this.g.ui.missionResult(true, a.def.title, reward ? `+$${reward.toLocaleString('en-US')}` : '');
    this.g.audio?.play('passed');
    this.g.saveNow();
  }

  cleanup() {
    const a = this.active;
    for (const v of Object.values(a.vehicles)) if (v.role === 'mission') v.role = 'parked';
    for (const [id, c] of this.npcs) {
      c.dispose(this.g.scene);
      this.npcs.delete(id);
    }
    this.objective.hide();
    this.active = null;
    this.navTarget = null;
    this.g.ui.setObjective(null);
    this.g.ui.setTimer(null);
  }

  next() {
    const a = this.active;
    a.idx++;
    a.stepT = 0;
    a.step = a.def.steps[a.idx];
    if (!a.step) return;
    const s = a.step;
    const g = this.g;
    switch (s.type) {
      case 'message':
        g.ui.phone(s.from, s.text);
        g.audio?.play('phone');
        return this.next();
      case 'npc': {
        const c = new Character(g.scene, s.look, false);
        c.mesh.position.set(s.x, g.world.heightAt(s.x, s.z), s.z);
        c.mesh.rotation.y = s.facing || 0;
        this.npcs.set(s.id, c);
        return this.next();
      }
      case 'removeNpc': {
        const c = this.npcs.get(s.id);
        if (c) c.dispose(g.scene);
        this.npcs.delete(s.id);
        return this.next();
      }
      case 'spawnVehicle': {
        let v = g.vehicles.list.find((x) => Math.hypot(x.x - s.x, x.z - s.z) < 3);
        if (v && v.type !== s.model) {
          // something else is parked in the spot: move it out of the way
          g.vehicles.remove(v);
          v = null;
        }
        if (!v) v = g.vehicles.spawn(s.model, s.x, s.z, s.heading, s.color);
        v.role = 'mission';
        a.vehicles[s.id] = v;
        return this.next();
      }
      case 'wanted':
        g.police.crime(s.label || 'Mission', s.level);
        return this.next();
      case 'timer':
        a.timer = s.seconds;
        return this.next();
      case 'reward':
        return this.pass();
      default:
        return undefined; // goto / enter / drive / loseWanted are checked every frame
    }
  }

  // ------------------------------------------------------------------ per frame

  update(dt) {
    const g = this.g;
    this.playTime += dt;
    const t = g.time;
    for (const c of this.npcs.values()) c.animate(dt, 0);

    // automatic starts (e.g. the phone call that opens the first mission)
    if (!this.active) {
      for (const def of this.defs) {
        if (def.autoStart === undefined || this.completed.has(def.id) || this.autoDone.has(def.id)) continue;
        if (this.playTime > def.autoStart && g.police.level === 0 && !g.player.vehicle) {
          this.autoDone.add(def.id);
          this.start(def);
        }
      }
    }

    // start markers for missions that are available
    const pos = g.playerPosition();
    for (const s of this.starts) {
      const show = !this.active && !this.completed.has(s.def.id) && this.isAvailable(s.def);
      if (!show) {
        s.marker.hide();
        continue;
      }
      s.marker.show(s.def.start.x, g.world.heightAt(s.def.start.x, s.def.start.z), s.def.start.z);
      s.marker.update(t);
      if (Math.hypot(pos.x - s.def.start.x, pos.z - s.def.start.z) < 2.2 && !g.player.vehicle) this.start(s.def);
    }

    const a = this.active;
    if (!a || !a.step) return;
    a.stepT += dt;
    if (a.timer !== null) {
      a.timer -= dt;
      g.ui.setTimer(a.timer);
      if (a.timer <= 0) return this.fail("You ran out of time");
    }
    const s = a.step;
    const pv = g.player.vehicle;
    let target = null;
    let label = s.label;
    let done = false;

    if (s.type === 'goto') {
      target = { x: s.x, z: s.z };
      const d = Math.hypot(pos.x - s.x, pos.z - s.z);
      if (s.onFoot && pv && d < 25) label = 'Get out of the car';
      done = d < s.r && !(s.onFoot && pv);
    } else if (s.type === 'enter') {
      const v = s.vehicle ? a.vehicles[s.vehicle] : null;
      if (v) {
        target = { x: v.x, z: v.z, vehicle: v };
        done = pv === v;
      } else {
        done = !!pv && (!s.vehicleType || pv.type === s.vehicleType);
      }
    } else if (s.type === 'drive') {
      const v = s.vehicle ? a.vehicles[s.vehicle] : null;
      if (v && pv !== v) {
        label = `Get back in the ${v.name}`;
        target = { x: v.x, z: v.z, vehicle: v };
      } else if (!v && !pv) {
        label = 'Get a vehicle';
      } else {
        target = { x: s.x, z: s.z, big: true };
        const d = Math.hypot(pos.x - s.x, pos.z - s.z);
        if (d < s.r && s.stop && pv && pv.speed > 4) label = 'Stop the vehicle';
        done = d < s.r && (!s.stop || (pv && pv.speed <= 4));
      }
    } else if (s.type === 'loseWanted') {
      done = g.police.level === 0;
    }

    // objective marker and HUD
    if (target) {
      if (target.vehicle) {
        this.objective.followVehicle = target.vehicle;
        this.objective.show(target.x, 0, target.z, 0.9);
      } else {
        this.objective.followVehicle = null;
        this.objective.show(target.x, g.world.heightAt(target.x, target.z), target.z, target.big ? 2.2 : 1);
      }
      this.objective.update(t);
      this.navTarget = { x: target.x, z: target.z };
    } else {
      this.objective.hide();
      this.navTarget = null;
    }
    const dist = target ? Math.hypot(pos.x - target.x, pos.z - target.z) : null;
    g.ui.setObjective(label, dist);

    if (done) this.next();
  }
}
