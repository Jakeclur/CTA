// The road network as a graph: intersections are nodes on a 9 x 9 grid and every
// road segment between neighbours is an edge. Used for AI driving and GPS routes.
import { GRID, ROAD_LINES, HALF, PITCH } from './config.js';

export const NODES = GRID + 1;
export const LANE = 2.2; // distance from the centre line to the middle of the driving lane

// Directions: 0 = +z (south), 1 = -z (north), 2 = +x (east), 3 = -x (west)
export const DIRS = [
  { di: 0, dj: 1, fx: 0, fz: 1 },
  { di: 0, dj: -1, fx: 0, fz: -1 },
  { di: 1, dj: 0, fx: 1, fz: 0 },
  { di: -1, dj: 0, fx: -1, fz: 0 },
];
export const OPPOSITE = [1, 0, 3, 2];

export const nodeX = (i) => ROAD_LINES[i];
export const nodeZ = (j) => ROAD_LINES[j];
export const validNode = (i, j) => i >= 0 && j >= 0 && i < NODES && j < NODES;

export function nearestNode(x, z) {
  const i = Math.max(0, Math.min(NODES - 1, Math.round((x + HALF) / PITCH)));
  const j = Math.max(0, Math.min(NODES - 1, Math.round((z + HALF) / PITCH)));
  return [i, j];
}

// Traffic drives on the left: the lane is offset to the left of the direction of travel.
// For forward (fx, fz) the left vector is (fz, -fx).
export function laneOffset(dir) {
  const d = DIRS[dir];
  return [d.fz * LANE, -d.fx * LANE];
}

export function dirFromVector(x, z) {
  if (Math.abs(x) > Math.abs(z)) return x > 0 ? 2 : 3;
  return z > 0 ? 0 : 1;
}

// Breadth-first route between two nodes. Returns a list of [i, j] including both ends.
export function route(from, to) {
  const key = (i, j) => i * NODES + j;
  const prev = new Map();
  const q = [from];
  prev.set(key(...from), null);
  while (q.length) {
    const [i, j] = q.shift();
    if (i === to[0] && j === to[1]) break;
    // explore the direction towards the goal first so routes prefer fewer turns
    const order = [0, 1, 2, 3].sort((a, b) => {
      const da = Math.abs(i + DIRS[a].di - to[0]) + Math.abs(j + DIRS[a].dj - to[1]);
      const db = Math.abs(i + DIRS[b].di - to[0]) + Math.abs(j + DIRS[b].dj - to[1]);
      return da - db;
    });
    for (const d of order) {
      const ni = i + DIRS[d].di;
      const nj = j + DIRS[d].dj;
      if (!validNode(ni, nj) || prev.has(key(ni, nj))) continue;
      prev.set(key(ni, nj), [i, j]);
      q.push([ni, nj]);
    }
  }
  const path = [];
  let cur = to;
  while (cur) {
    path.unshift(cur);
    cur = prev.get(key(...cur));
  }
  return path;
}

// Closest point on any road centre line, plus the road's axis ('x' or 'z').
export function nearestRoadPoint(x, z) {
  const cx = Math.max(-HALF, Math.min(HALF, x));
  const cz = Math.max(-HALF, Math.min(HALF, z));
  const ix = Math.round((cx + HALF) / PITCH);
  const iz = Math.round((cz + HALF) / PITCH);
  const rx = ROAD_LINES[ix];
  const rz = ROAD_LINES[iz];
  // on a north-south road (x = rx) or an east-west road (z = rz)
  const dNS = Math.abs(x - rx) + Math.max(0, Math.abs(cz - z));
  const dEW = Math.abs(z - rz) + Math.max(0, Math.abs(cx - x));
  return dNS < dEW ? { x: rx, z: cz, axis: 'z' } : { x: cx, z: rz, axis: 'x' };
}

// The two intersections at the ends of the road segment a road point lies on.
function segmentNodes(p) {
  const fi = (p.x + HALF) / PITCH;
  const fj = (p.z + HALF) / PITCH;
  const c = (v) => Math.max(0, Math.min(NODES - 1, v));
  if (p.axis === 'z') {
    const i = c(Math.round(fi));
    return [[i, c(Math.floor(fj))], [i, c(Math.ceil(fj))]];
  }
  const j = c(Math.round(fj));
  return [[c(Math.floor(fi)), j], [c(Math.ceil(fi)), j]];
}

// A GPS route from (x0, z0) to (x1, z1) as a polyline of world points along the roads.
export function gpsRoute(x0, z0, x1, z1) {
  const a = nearestRoadPoint(x0, z0);
  const b = nearestRoadPoint(x1, z1);
  let best = null;
  for (const na of segmentNodes(a))
    for (const nb of segmentNodes(b)) {
      const cost = Math.hypot(a.x - nodeX(na[0]), a.z - nodeZ(na[1])) +
        PITCH * (Math.abs(na[0] - nb[0]) + Math.abs(na[1] - nb[1])) +
        Math.hypot(b.x - nodeX(nb[0]), b.z - nodeZ(nb[1]));
      if (!best || cost < best.cost) best = { cost, na, nb };
    }
  const pts = [[x0, z0], [a.x, a.z]];
  // same segment: go straight along it
  const direct = Math.abs(a.x - b.x) < 1 || Math.abs(a.z - b.z) < 1;
  if (!(direct && a.axis === b.axis && Math.hypot(a.x - b.x, a.z - b.z) < PITCH)) {
    for (const [i, j] of route(best.na, best.nb)) pts.push([nodeX(i), nodeZ(j)]);
  }
  pts.push([b.x, b.z], [x1, z1]);
  return pts;
}
