// Third-person camera that orbits a target with the mouse, re-centres behind
// vehicles, and pulls in when a wall would block the view.
import * as THREE from 'three';
import { clamp, damp, dampAngle } from './utils.js';

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pitch = 0.25;
    this.dist = 4.6;
    this.curDist = 4.6;
    this.target = new THREE.Vector3();
    this.smoothTarget = new THREE.Vector3();
    this.shake = 0;
    this.baseFov = 70;
    this.sensitivity = 1;
    this.invertY = false;
    this.autoCenter = true;
    this.lastLook = 0;
  }

  snap(target, yaw) {
    this.target.copy(target);
    this.smoothTarget.copy(target);
    if (yaw !== undefined) this.yaw = yaw;
  }

  look(dx, dy, now) {
    if (dx === 0 && dy === 0) return;
    const k = 0.0024 * this.sensitivity;
    this.yaw -= dx * k;
    this.pitch += dy * k * (this.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -0.45, 1.25);
    this.lastLook = now;
  }

  // focus: point to look at, opts: { dist, height, followYaw, speed }
  update(dt, now, focus, colliders, opts) {
    const { dist, followYaw, speed = 0 } = opts;
    this.target.copy(focus);
    // Vehicles move fast: follow tightly so the car does not drift in frame
    this.smoothTarget.x = damp(this.smoothTarget.x, this.target.x, opts.vehicle ? 30 : 18, dt);
    this.smoothTarget.y = damp(this.smoothTarget.y, this.target.y, 10, dt);
    this.smoothTarget.z = damp(this.smoothTarget.z, this.target.z, opts.vehicle ? 30 : 18, dt);

    // Re-centre behind a moving vehicle after the mouse has been still for a moment
    if (followYaw !== undefined && this.autoCenter && now - this.lastLook > 1400 && Math.abs(speed) > 2) {
      this.yaw = dampAngle(this.yaw, followYaw, 2.4, dt);
      this.pitch = damp(this.pitch, 0.18, 1.5, dt);
    }

    this.dist = dist;
    const cp = Math.cos(this.pitch);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp);

    // Camera collision: march back from the target and stop short of walls
    const t = this.smoothTarget;
    let want = this.dist;
    if (colliders) {
      let hit = colliders.raycast(t.x, t.y, t.z, -dir.x, -dir.y, -dir.z, this.dist + 0.4);
      if (opts.extraRay) hit = Math.min(hit, opts.extraRay(t.x, t.y, t.z, -dir.x, -dir.y, -dir.z, this.dist + 0.4));
      want = Math.max(0.8, Math.min(this.dist, hit - 0.4));
    }
    // pull in instantly, ease back out
    this.curDist = want < this.curDist ? want : damp(this.curDist, want, 4, dt);

    const cam = this.camera;
    cam.position.set(t.x - dir.x * this.curDist, t.y - dir.y * this.curDist, t.z - dir.z * this.curDist);
    if (cam.position.y < 0.4) cam.position.y = 0.4;

    if (this.shake > 0) {
      const s = this.shake;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    cam.lookAt(t.x, t.y, t.z);

    const fov = this.baseFov + clamp(Math.abs(speed) - 8, 0, 40) * 0.3;
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov = damp(cam.fov, fov, 3, dt);
      cam.updateProjectionMatrix();
    }
  }
}
