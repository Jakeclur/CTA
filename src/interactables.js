// Things the player can collect or use: cash pickups and vending machines (F).
import * as THREE from 'three';
import { makeRng } from './utils.js';

const RESPAWN_TIME = 180; // seconds before a collected pickup returns

export class CashPickups {
  constructor(scene, spots) {
    this.rng = makeRng(9);
    const bills = new THREE.MeshStandardMaterial({ color: '#2fbf71', emissive: '#16a34a', emissiveIntensity: 0.6, roughness: 0.5 });
    const band = new THREE.MeshStandardMaterial({ color: '#f5f5dc', roughness: 0.6 });
    const ringMat = new THREE.MeshBasicMaterial({ color: '#4ade80', transparent: true, opacity: 0.45, depthWrite: false });
    this.items = spots.map((s) => {
      const g = new THREE.Group();
      const stack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.26), bills);
      stack.castShadow = true;
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.19, 0.27), band);
      const spin = new THREE.Group();
      spin.add(stack, strap);
      spin.position.y = 0.8;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.7, 24), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.2;
      g.add(spin, ring);
      g.position.set(s.x, 0, s.z);
      scene.add(g);
      return { group: g, spin, x: s.x, z: s.z, active: true, timer: 0, amount: 0 };
    });
    for (const it of this.items) it.amount = this.roll();
  }

  roll() {
    return Math.round(this.rng.range(40, 220) / 10) * 10;
  }

  // Returns cash collected this frame (0 if none)
  update(dt, t, pos, inVehicle, heightAt) {
    let got = 0;
    const reach = inVehicle ? 2.8 : 1.3;
    for (const it of this.items) {
      if (!it.active) {
        it.timer -= dt;
        if (it.timer <= 0) {
          it.active = true;
          it.group.visible = true;
          it.amount = this.roll();
        }
        continue;
      }
      it.group.position.y = heightAt(it.x, it.z);
      it.spin.rotation.y = t * 2;
      it.spin.position.y = 0.8 + Math.sin(t * 3 + it.x) * 0.12;
      const d = Math.hypot(pos.x - it.x, pos.z - it.z);
      if (d < reach) {
        it.active = false;
        it.group.visible = false;
        it.timer = RESPAWN_TIME;
        got += it.amount;
      }
    }
    return got;
  }
}

export class VendingMachines {
  constructor(scene, spots, heightAt) {
    const body = new THREE.MeshStandardMaterial({ color: '#c1121f', roughness: 0.4, metalness: 0.3 });
    const front = new THREE.MeshStandardMaterial({ color: '#fefae0', emissive: '#fff3c4', emissiveIntensity: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: '#1b1b1b', roughness: 0.4 });
    this.items = spots.map((s) => {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1.9, 0.8), body);
      b.position.y = 0.95;
      b.castShadow = true;
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.2), front);
      f.position.set(-0.1, 1.15, 0.41);
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.05), dark);
      slot.position.set(-0.1, 0.35, 0.41);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.04), dark);
      pad.position.set(0.32, 1.2, 0.41);
      g.add(b, f, slot, pad);
      g.position.set(s.x, heightAt(s.x, s.z), s.z);
      g.rotation.y = s.rot || 0;
      scene.add(g);
      return { x: s.x, z: s.z, rot: s.rot || 0 };
    });
  }

  addColliders(colliders) {
    for (const it of this.items) colliders.addPost(it.x, it.z, 0.55, 2);
  }

  nearest(pos, maxDist = 1.9) {
    let best = null;
    let bd = maxDist;
    for (const it of this.items) {
      const d = Math.hypot(pos.x - it.x, pos.z - it.z);
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    return best;
  }
}

export const DRINK_PRICE = 5;
export const DRINK_HEAL = 35;
