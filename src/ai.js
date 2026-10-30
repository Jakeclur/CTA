// AI driving: turns a target point and speed into throttle/brake/steer controls,
// with route finding over the road grid and recovery when a car gets stuck.
import { clamp } from './utils.js';
import { nearestNode, route, nodeX, nodeZ, validNode } from './roads.js';

export class AIDriver {
  constructor(vehicle) {
    this.v = vehicle;
    this.stuckT = 0;
    this.reverseT = 0;
    this.path = null;
    this.pathIdx = 0;
    this.repathT = 0;
  }

  // Drive towards (tx, tz) at up to `speed` m/s.
  steerTo(dt, tx, tz, speed) {
    const v = this.v;
    const s = Math.sin(v.heading);
    const c = Math.cos(v.heading);
    const dx = tx - v.x;
    const dz = tz - v.z;
    const fwd = dx * s + dz * c;
    const left = dx * c - dz * s;
    const ang = Math.atan2(left, fwd);
    const vF = v.forwardSpeed;

    if (this.reverseT > 0) {
      this.reverseT -= dt;
      return { throttle: 0, brake: 1, steer: ang > 0 ? -1 : 1, handbrake: false };
    }
    // stuck against something: back up for a moment
    if (speed > 2 && Math.abs(vF) < 0.7) {
      this.stuckT += dt;
      if (this.stuckT > 1.5) {
        this.stuckT = 0;
        this.reverseT = 1.2;
      }
    } else this.stuckT = 0;

    // slow down for sharp turns
    const turn = Math.min(1, Math.abs(ang) / 1.4);
    const want = Math.max(Math.min(speed, 5), speed * (1 - turn * 0.8));
    const err = want - vF;
    return {
      throttle: err > 0.3 ? Math.min(1, err / 4 + 0.35) : 0,
      brake: err < -1.2 ? Math.min(1, -err / 5) : 0,
      steer: clamp(ang * 2.2, -1, 1),
      handbrake: false,
    };
  }

  // Coast to a stop.
  stop() {
    const vF = this.v.forwardSpeed;
    return { throttle: vF < -0.6 ? 0.5 : 0, brake: vF > 0.6 ? 1 : 0, steer: 0, handbrake: Math.abs(vF) < 2 };
  }

  // The intersection the car should drive to first: close, and not behind it.
  nodeAhead() {
    const v = this.v;
    const s = Math.sin(v.heading);
    const c = Math.cos(v.heading);
    const [ci, cj] = nearestNode(v.x, v.z);
    let best = null;
    let bestScore = Infinity;
    for (let i = ci - 1; i <= ci + 1; i++)
      for (let j = cj - 1; j <= cj + 1; j++) {
        if (!validNode(i, j)) continue;
        const dx = nodeX(i) - v.x;
        const dz = nodeZ(j) - v.z;
        const d = Math.hypot(dx, dz);
        const behind = (dx * s + dz * c) / (d || 1) < -0.2 && d > 12;
        const score = d + (behind ? 120 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = [i, j];
        }
      }
    return best;
  }

  // Follow the road grid towards a far-away target; returns the point to aim at.
  routeAim(dt, tx, tz) {
    this.repathT -= dt;
    if (!this.path || this.repathT <= 0) {
      this.path = route(this.nodeAhead(), nearestNode(tx, tz));
      this.pathIdx = 0;
      this.repathT = 1.5;
    }
    while (this.pathIdx < this.path.length) {
      const [i, j] = this.path[this.pathIdx];
      if (Math.hypot(nodeX(i) - this.v.x, nodeZ(j) - this.v.z) > 9) break;
      this.pathIdx++;
    }
    if (this.pathIdx >= this.path.length) return [tx, tz];
    const [i, j] = this.path[this.pathIdx];
    return [nodeX(i), nodeZ(j)];
  }
}

