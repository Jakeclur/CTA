import * as THREE from 'three';

// Shared soft contact shadows keep feet and tyres grounded even on Low.
export class GroundShadows {
  constructor(scene) {
    const size = 32, pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const distance = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
      pixels[(y * size + x) * 4 + 3] = Math.round(Math.max(0, 1 - distance) ** 1.6 * 100);
    }
    const texture = new THREE.DataTexture(pixels, size, size);
    texture.needsUpdate = true;
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }), 160);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.transform = new THREE.Object3D();
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  update(game) {
    this.mesh.count = 0;
    const camera = game.camera.position;
    const add = (x, y, z, width, length, heading) => {
      if (this.mesh.count >= 160 || Math.hypot(x - camera.x, z - camera.z) > 65) return;
      const object = this.transform;
      object.position.set(x, y + 0.025, z);
      object.rotation.set(-Math.PI / 2, 0, -heading);
      object.scale.set(width, length, 1);
      object.updateMatrix();
      this.mesh.setMatrixAt(this.mesh.count++, object.matrix);
    };
    for (const v of game.vehicles.list) {
      const p = v.model.root.position;
      const ground = game.world.heightAt(p.x, p.z);
      if (v.y - ground < 1.5) add(p.x, ground, p.z, v.spec.W * 1.6, v.spec.L * 1.25, v.heading);
    }
    if (game.player.mesh.visible) {
      const p = game.player.pos;
      add(p.x, game.world.heightAt(p.x, p.z), p.z, 1.1, 1.1, 0);
    }
    for (const pedestrian of game.peds.list) {
      const p = pedestrian.pos;
      add(p.x, game.world.heightAt(p.x, p.z), p.z, 0.9, 0.9, 0);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
