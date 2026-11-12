import * as THREE from 'three';

// Beach practice ramps have matching rendered and sampled surfaces.
export const RAMPS = [
  { x: -150, z: 355, width: 7, length: 14, height: 2.4 },
  { x: -120, z: 355, width: 7, length: 14, height: 1.3 },
];

export function rampHeight(x, z, base) {
  for (const ramp of RAMPS) {
    if (Math.abs(x - ramp.x) <= ramp.width / 2 && z >= ramp.z && z <= ramp.z + ramp.length) {
      return base + (z - ramp.z) / ramp.length * ramp.height;
    }
  }
  return base;
}

export function buildRamps(group, heightAt) {
  const concrete = new THREE.MeshStandardMaterial({ color: '#9c998e', roughness: 0.88 });
  const edge = new THREE.MeshStandardMaterial({ color: '#e9b949', roughness: 0.7 });
  for (const ramp of RAMPS) {
    const slope = Math.atan2(ramp.height, ramp.length);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(ramp.width, 0.18, Math.hypot(ramp.height, ramp.length)), concrete);
    mesh.position.set(ramp.x, heightAt(ramp.x, ramp.z) + ramp.height / 2 - 0.09, ramp.z + ramp.length / 2);
    mesh.rotation.x = -slope;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    for (const side of [-1, 1]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, Math.hypot(ramp.height, ramp.length)), edge);
      stripe.position.copy(mesh.position);
      stripe.position.x += side * (ramp.width / 2 - 0.15);
      stripe.position.y += 0.11;
      stripe.rotation.x = -slope;
      group.add(stripe);
    }
  }
}
