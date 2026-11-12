import * as THREE from 'three';
import { damp, makeRng } from './utils.js';

// One bounded particle buffer follows the camera. Rain and wetness also feed
// road materials, tyre grip and sound, so weather affects the whole scene.
export class Weather {
  constructor(scene, world) {
    this.world = world;
    this.amount = 0;
    this.wetness = 0;
    this.mode = 'clear';
    this.count = 700;
    this.rng = makeRng(704);
    this.positions = new Float32Array(1400 * 6);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.LineBasicMaterial({ color: '#b3c7d4', transparent: true, opacity: 0, depthWrite: false });
    this.mesh = new THREE.LineSegments(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.materials = new Set();
    world.group.traverse((object) => {
      if (object.userData.wetSurface) {
        object.material.userData.dryRoughness = object.material.roughness;
        object.material.userData.dryColor = object.material.color.clone();
        object.material.userData.wetColor = object.material.color.clone().multiplyScalar(0.86);
        this.materials.add(object.material);
      }
    });
    for (let i = 0; i < 1400; i++) this.reset(i, 0, 0, 0, true);
  }

  configure(mode, quality) {
    this.mode = mode || 'clear';
    this.count = quality === 'low' ? 180 : quality === 'medium' ? 550 : 1400;
    this.geometry.setDrawRange(0, this.count * 2);
  }

  reset(i, x, y, z, scatter = false) {
    const k = i * 6;
    this.positions[k] = x + (this.rng() - 0.5) * 70;
    this.positions[k + 1] = y + (scatter ? this.rng() * 30 : 30);
    this.positions[k + 2] = z + (this.rng() - 0.5) * 70;
  }

  update(dt, time, camera) {
    const target = this.mode === 'rain' ? 1 : this.mode === 'cycle' && Math.sin(time / 100) > 0.5 ? 1 : 0;
    this.amount = damp(this.amount, target, 0.12, dt);
    this.wetness = damp(this.wetness, this.amount, this.amount > this.wetness ? 0.2 : 0.035, dt);
    this.world.wetness = this.wetness;
    this.mesh.visible = this.amount > 0.01;
    this.material.opacity = this.amount * 0.28;
    for (const material of this.materials) {
      material.roughness = material.userData.dryRoughness * (1 - this.wetness * 0.68);
      // Water darkens asphalt and makes its surface response tighter. This
      // complements the wet road texture and avoids a rain effect that reads
      // as falling streaks over an otherwise dry-looking street.
      material.color.lerpColors(material.userData.dryColor, material.userData.wetColor, this.wetness);
    }
    if (!this.mesh.visible) return;
    const p = camera.position;
    for (let i = 0; i < this.count; i++) {
      const k = i * 6;
      this.positions[k] -= dt * 3;
      this.positions[k + 1] -= dt * 24;
      const x = this.positions[k], y = this.positions[k + 1], z = this.positions[k + 2];
      if (y < this.world.heightAt(x, z) || Math.abs(x - p.x) > 40 || Math.abs(z - p.z) > 40) this.reset(i, p.x, p.y, p.z);
      this.positions[k + 3] = this.positions[k] + 0.12;
      this.positions[k + 4] = this.positions[k + 1] + 1.2;
      this.positions[k + 5] = this.positions[k + 2];
    }
    this.geometry.attributes.position.needsUpdate = true;
  }
}
