// Static collision world: axis-aligned boxes stored in a spatial hash grid.
// Used by the player, vehicles and the camera.

const CELL = 16;

export class StaticColliders {
  constructor() {
    this.boxes = [];
    this.grid = new Map();
    this.marks = [];
    this.stamp = 0;
    this._found = [];
  }

  key(ix, iz) {
    return (ix + 2048) * 4096 + (iz + 2048);
  }

  add(minX, minZ, maxX, maxZ, maxY = 200, minY = -5, tag = 'solid') {
    const id = this.boxes.length;
    this.boxes.push({ minX, minZ, maxX, maxZ, minY, maxY, tag });
    this.marks.push(0);
    const ix0 = Math.floor(minX / CELL);
    const ix1 = Math.floor(maxX / CELL);
    const iz0 = Math.floor(minZ / CELL);
    const iz1 = Math.floor(maxZ / CELL);
    for (let ix = ix0; ix <= ix1; ix++)
      for (let iz = iz0; iz <= iz1; iz++) {
        const k = this.key(ix, iz);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(id);
      }
    return id;
  }

  // Square collider centred on a point (poles, trees...)
  addPost(x, z, r, h = 6) {
    return this.add(x - r, z - r, x + r, z + r, h);
  }

  query(minX, minZ, maxX, maxZ) {
    const out = this._found;
    out.length = 0;
    this.stamp++;
    const ix0 = Math.floor(minX / CELL);
    const ix1 = Math.floor(maxX / CELL);
    const iz0 = Math.floor(minZ / CELL);
    const iz1 = Math.floor(maxZ / CELL);
    for (let ix = ix0; ix <= ix1; ix++)
      for (let iz = iz0; iz <= iz1; iz++) {
        const list = this.grid.get(this.key(ix, iz));
        if (!list) continue;
        for (const id of list) {
          if (this.marks[id] === this.stamp) continue;
          this.marks[id] = this.stamp;
          out.push(this.boxes[id]);
        }
      }
    return out;
  }

  // Pushes a circle (p.x, p.z, radius r) out of every box it overlaps.
  // Returns the strongest contact normal, or null if nothing was hit.
  resolveCircle(p, r, y = 0, height = 2) {
    let best = null;
    for (let pass = 0; pass < 2; pass++) {
      const boxes = this.query(p.x - r, p.z - r, p.x + r, p.z + r);
      let moved = false;
      for (const b of boxes) {
        if (y >= b.maxY || y + height <= b.minY) continue;
        const cx = p.x < b.minX ? b.minX : p.x > b.maxX ? b.maxX : p.x;
        const cz = p.z < b.minZ ? b.minZ : p.z > b.maxZ ? b.maxZ : p.z;
        const dx = p.x - cx;
        const dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        let nx;
        let nz;
        let depth;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          nx = dx / d;
          nz = dz / d;
          depth = r - d;
        } else {
          // centre is inside the box: leave by the nearest side
          const l = p.x - b.minX;
          const rr = b.maxX - p.x;
          const t = p.z - b.minZ;
          const bb = b.maxZ - p.z;
          const m = Math.min(l, rr, t, bb);
          if (m === l) [nx, nz] = [-1, 0];
          else if (m === rr) [nx, nz] = [1, 0];
          else if (m === t) [nx, nz] = [0, -1];
          else [nx, nz] = [0, 1];
          depth = m + r;
        }
        p.x += nx * depth;
        p.z += nz * depth;
        moved = true;
        if (!best || depth > best.depth) best = { nx, nz, depth, box: b };
      }
      if (!moved) break;
    }
    return best;
  }

  // Distance along a 3D ray until it hits a box (or maxDist).
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    const ex = ox + dx * maxDist;
    const ez = oz + dz * maxDist;
    const boxes = this.query(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez));
    let best = maxDist;
    for (const b of boxes) {
      let tmin = 0;
      let tmax = best;
      const axes = [
        [ox, dx, b.minX, b.maxX],
        [oy, dy, b.minY, b.maxY],
        [oz, dz, b.minZ, b.maxZ],
      ];
      let hit = true;
      for (const [o, d, lo, hi] of axes) {
        if (Math.abs(d) < 1e-9) {
          if (o < lo || o > hi) {
            hit = false;
            break;
          }
        } else {
          let t1 = (lo - o) / d;
          let t2 = (hi - o) / d;
          if (t1 > t2) [t1, t2] = [t2, t1];
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) {
            hit = false;
            break;
          }
        }
      }
      if (hit && tmin < best) best = tmin;
    }
    return best;
  }
}
