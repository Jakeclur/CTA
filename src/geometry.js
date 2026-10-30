// GeoBuilder collects many quads and boxes into one BufferGeometry, so an entire
// category of objects (all glass towers, all pavements...) is drawn in a single call.
import * as THREE from 'three';

const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _n = new THREE.Vector3();

export class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  // a, b, c, d: corners [x, y, z] in order around the quad.
  // uv: [u0, v0, u1, v1] mapped a=(u0,v0) b=(u1,v0) c=(u1,v1) d=(u0,v1)
  // normal: [nx, ny, nz] facing direction (winding is fixed automatically).
  quad(a, b, c, d, normal, uv = [0, 0, 1, 1], color = [1, 1, 1]) {
    const base = this.vertexCount;
    const [u0, v0, u1, v1] = uv;
    for (const p of [a, b, c, d]) this.pos.push(p[0], p[1], p[2]);
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    for (let i = 0; i < 4; i++) {
      this.nor.push(normal[0], normal[1], normal[2]);
      this.col.push(color[0], color[1], color[2]);
    }
    _ab.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _ac.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _n.crossVectors(_ab, _ac);
    if (_n.x * normal[0] + _n.y * normal[1] + _n.z * normal[2] >= 0) {
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }

  // Horizontal rectangle facing up, UVs in world metres / tile.
  top(x0, z0, x1, z1, y, tile = 4, color) {
    this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, 1, 0],
      [x0 / tile, -z0 / tile, x1 / tile, -z1 / tile], color);
  }

  // Four vertical walls of an axis aligned box (no top or bottom).
  // tileU / tileV: metres per texture repeat horizontally / vertically.
  // vOffset shifts the texture vertically (in metres) e.g. above a shop front.
  walls(x0, z0, x1, z1, y0, y1, tileU, tileV, color, vOffset = 0) {
    const w = x1 - x0;
    const d = z1 - z0;
    const v0 = vOffset / tileV;
    const v1 = (vOffset + (y1 - y0)) / tileV;
    // +z face
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [0, v0, w / tileU, v1], color);
    // -z face
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [0, v0, w / tileU, v1], color);
    // +x face
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [0, v0, d / tileU, v1], color);
    // -x face
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [0, v0, d / tileU, v1], color);
  }

  // Solid box: walls plus top (and optionally bottom).
  box(x0, y0, z0, x1, y1, z1, color, tile = 4, bottom = false) {
    this.walls(x0, z0, x1, z1, y0, y1, tile, tile, color);
    this.top(x0, z0, x1, z1, y1, tile, color);
    if (bottom) {
      this.quad([x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0], [0, -1, 0], [0, 0, 1, 1], color);
    }
  }

  // A box rotated about the vertical axis around its centre.
  orientedBox(cx, cz, y0, y1, hw, hd, angle, color, tile = 4) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const P = (lx, lz, y) => [cx + lx * c + lz * s, y, cz - lx * s + lz * c];
    const N = (lx, lz) => [lx * c + lz * s, 0, -lx * s + lz * c];
    const corners = [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[(i + 1) % 4];
      const len = Math.hypot(bx - ax, bz - az);
      const n = N((ax + bx) / 2 === 0 ? 0 : Math.sign(ax + bx), (az + bz) / 2 === 0 ? 0 : Math.sign(az + bz));
      this.quad(P(ax, az, y0), P(bx, bz, y0), P(bx, bz, y1), P(ax, az, y1), n,
        [0, y0 / tile, len / tile, y1 / tile], color);
    }
    this.quad(P(-hw, -hd, y1), P(hw, -hd, y1), P(hw, hd, y1), P(-hw, hd, y1), [0, 1, 0],
      [0, 0, (2 * hw) / tile, (2 * hd) / tile], color);
  }

  // Gabled roof over a rectangle; the ridge runs along the longer side.
  gable(x0, z0, x1, z1, y, rise, overhang, color, tile = 3) {
    x0 -= overhang;
    z0 -= overhang;
    x1 += overhang;
    z1 += overhang;
    const alongX = x1 - x0 >= z1 - z0;
    const yr = y + rise;
    if (alongX) {
      const zm = (z0 + z1) / 2;
      const half = zm - z0;
      const slope = Math.hypot(half, rise);
      const nA = [0, half / slope, -rise / slope];
      const nB = [0, half / slope, rise / slope];
      this.quad([x0, y, z0], [x1, y, z0], [x1, yr, zm], [x0, yr, zm], nA, [0, 0, (x1 - x0) / tile, slope / tile], color);
      this.quad([x1, y, z1], [x0, y, z1], [x0, yr, zm], [x1, yr, zm], nB, [0, 0, (x1 - x0) / tile, slope / tile], color);
      // gable ends (triangles stored as degenerate quads)
      this.quad([x0 + overhang, y, z1 - overhang], [x0 + overhang, y, z0 + overhang], [x0 + overhang, yr, zm], [x0 + overhang, yr, zm], [-1, 0, 0], [0, 0, 1, 1], color);
      this.quad([x1 - overhang, y, z0 + overhang], [x1 - overhang, y, z1 - overhang], [x1 - overhang, yr, zm], [x1 - overhang, yr, zm], [1, 0, 0], [0, 0, 1, 1], color);
    } else {
      const xm = (x0 + x1) / 2;
      const half = xm - x0;
      const slope = Math.hypot(half, rise);
      const nA = [-rise / slope, half / slope, 0];
      const nB = [rise / slope, half / slope, 0];
      this.quad([x0, y, z1], [x0, y, z0], [xm, yr, z0], [xm, yr, z1], nA, [0, 0, (z1 - z0) / tile, slope / tile], color);
      this.quad([x1, y, z0], [x1, y, z1], [xm, yr, z1], [xm, yr, z0], nB, [0, 0, (z1 - z0) / tile, slope / tile], color);
      this.quad([x0 + overhang, y, z0 + overhang], [x1 - overhang, y, z0 + overhang], [xm, yr, z0 + overhang], [xm, yr, z0 + overhang], [0, 0, -1], [0, 0, 1, 1], color);
      this.quad([x1 - overhang, y, z1 - overhang], [x0 + overhang, y, z1 - overhang], [xm, yr, z1 - overhang], [xm, yr, z1 - overhang], [0, 0, 1], [0, 0, 1, 1], color);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  // Convenience: build and wrap in a mesh (returns null if empty).
  mesh(material, { castShadow = false, receiveShadow = true } = {}) {
    if (this.vertexCount === 0) return null;
    const m = new THREE.Mesh(this.build(), material);
    m.castShadow = castShadow;
    m.receiveShadow = receiveShadow;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }
}

// Hex colour -> [r, g, b] in linear space for vertex colours.
const _c = new THREE.Color();
export function rgb(hex, mul = 1) {
  _c.set(hex);
  return [_c.r * mul, _c.g * mul, _c.b * mul];
}
