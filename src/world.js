// Procedural city generation: districts, roads, pavements, buildings, collisions
// and the data the minimap, vehicles and pickups need.
import * as THREE from 'three';
import {
  GRID, PITCH, ROAD_HALF, SIDEWALK, HALF, CURB_H, ROAD_LINES,
  BOARDWALK_Z0, SAND_Z0, SHORE_Z, BOUNDS, SEED,
} from './config.js';
import { GeoBuilder, rgb } from './geometry.js';
import * as TX from './textures.js';
import { StaticColliders } from './collision.js';
import { makeRng, nextFrame } from './utils.js';
import { buildProps } from './props.js';

// Special blocks, keyed "bx,bz" (bx grows east, bz grows south towards the sea)
const SPECIAL = {
  '2,5': 'park',
  '5,2': 'police',
  '1,3': 'hospital',
  '1,6': 'petrol',
  '5,0': 'petrol',
  '4,5': 'parking',
  '6,4': 'garage',
};

export const STREETS_NS = ['Cliff St', 'Harbor St', 'Pelican Ave', 'Market St', 'Grand Ave', 'Vista St', 'Coral Ave', 'Dune St', 'Breaker Rd'];
export const STREETS_EW = ['North Rd', 'Hillcrest Ave', 'Elm St', '1st St', '2nd St', '3rd St', 'Union St', 'Bayview Ave', 'Ocean Dr'];

const SHOP_NAMES = [
  'SUNNY MART 24/7', 'TACO LOCO', 'BLUE WAVE SURF', 'CAFE MARINA', 'QUICKWASH', 'PIXEL ARCADE',
  'DRAGON NOODLE', 'BELLA HAIR', 'GOLDLINE PAWN', 'NIGHT OWL DINER', 'SEASIDE BOOKS', 'IRON GYM',
  'POPS ICE CREAM', 'VINYL VAULT', 'PHONE DOCTOR', 'SALT & PEPPER',
];

function districtOf(bx, bz) {
  if (bz === GRID - 1) return 'waterfront';
  if (bz <= 1) return 'suburb';
  const d = Math.max(Math.abs(bx - 3.5), Math.abs(bz - 3.5));
  if (d < 1) return 'downtown';
  if (d < 2) return 'midtown';
  return 'residential';
}

const WALL_TINTS = {
  glass: ['#ffffff', '#e8f0f5', '#dfe9e6', '#f2ece2'],
  office: ['#ffffff', '#efe6d8', '#e3e6ea', '#f5e9dd'],
  brick: ['#ffffff', '#e9c4b0', '#d9b39c', '#f0d8c8', '#c9a28c'],
  stucco: ['#fff6e5', '#ffe4d6', '#e8f4ef', '#fdf0c9', '#e7ecf7', '#f9dfe6'],
  house: ['#ffffff', '#fdf3df', '#e5eef5', '#f3e3e3', '#e8f1e0'],
};
const SHOP_TINTS = ['#c0392b', '#2471a3', '#239b56', '#b9770e', '#7d3c98', '#d35400', '#117a65'];
const ROOF_TINTS = ['#b5523b', '#4b5563', '#7c4a2d', '#8a8f98', '#9c3d2e'];

export async function buildWorld(scene, onProgress) {
  const rng = makeRng(SEED);
  const colliders = new StaticColliders();
  const ctx = {
    rng,
    colliders,
    buildings: [],
    blocks: [],
    signs: [],
    props: {
      streetlights: [], trafficLights: [], trees: [], palms: [], benches: [], bins: [], hydrants: [],
      ac: [], tanks: [], antennas: [], helipads: [], billboards: [], pumps: [], umbrellas: [],
      fountains: [], canopies: [], lifeguards: [], bollards: [], manholes: [], drains: [],
    },
    map: { rects: [], pois: [] },
    nightMaterials: [],
    nightFns: [],
    spots: { parking: [], pickups: [], vending: [] },
    places: { garage: null, stores: [], docks: null },
    builders: {
      paving: new GeoBuilder(), grass: new GeoBuilder(), concrete: new GeoBuilder(), lot: new GeoBuilder(),
      sand: new GeoBuilder(), wood: new GeoBuilder(), path: new GeoBuilder(), markings: new GeoBuilder(),
      trim: new GeoBuilder(), pool: new GeoBuilder(),
    },
  };

  onProgress(0.05, 'Painting textures');
  await nextFrame();
  const tex = {
    facades: TX.makeFacades(),
    store: TX.makeStorefront(),
    asphalt: TX.makeAsphalt(),
    paving: TX.makePaving(),
    concrete: TX.makeConcrete(),
    grass: TX.makeGrass(),
    sand: TX.makeSand(),
    wood: TX.makeWood(),
    roof: TX.makeRoof(),
    tiles: TX.makeRoofTiles(),
    wornPaint: TX.makeWornPaint(),
  };

  onProgress(0.2, 'Laying out districts');
  await nextFrame();
  layoutBlocks(ctx);

  onProgress(0.35, 'Paving roads');
  await nextFrame();
  buildRoads(ctx);
  buildOuterRing(ctx);

  onProgress(0.5, 'Raising buildings');
  await nextFrame();
  const group = new THREE.Group();
  group.name = 'city';
  scene.add(group);
  buildGroundMeshes(ctx, tex, group);
  buildBuildingMeshes(ctx, tex, group);

  onProgress(0.65, 'Placing street furniture');
  await nextFrame();
  const props = buildProps(ctx, group);

  const heightAt = makeHeightFn(ctx);
  const areaAt = makeAreaFn();

  return {
    group,
    colliders,
    heightAt,
    areaAt,
    map: ctx.map,
    spots: ctx.spots,
    spawn: ctx.spawn,
    respawn: ctx.respawn,
    policeRespawn: ctx.policeRespawn,
    places: ctx.places,
    benches: ctx.props.benches,
    fountains: ctx.props.fountains,
    manholes: ctx.props.manholes,
    signals: props.signals,
    update(dt, t) {
      props.update(dt, t);
    },
    // 0 = day, 1 = night: windows, shop fronts and street lamps glow
    setNight(k) {
      for (const { m, max, min = 0 } of ctx.nightMaterials) m.emissiveIntensity = Math.max(min, k * max);
      for (const f of ctx.nightFns) f(k);
      props.setNight(k);
    },
  };
}

// ------------------------------------------------------------------ layout

function blockRect(bx, bz) {
  const x0 = ROAD_LINES[bx] + ROAD_HALF;
  const x1 = ROAD_LINES[bx + 1] - ROAD_HALF;
  const z0 = ROAD_LINES[bz] + ROAD_HALF;
  const z1 = ROAD_LINES[bz + 1] - ROAD_HALF;
  return { x0, z0, x1, z1 };
}

function layoutBlocks(ctx) {
  const { rng } = ctx;
  for (let bz = 0; bz < GRID; bz++)
    for (let bx = 0; bx < GRID; bx++) {
      const r = blockRect(bx, bz);
      const block = {
        bx, bz, ...r,
        district: districtOf(bx, bz),
        special: SPECIAL[`${bx},${bz}`] || null,
        alleys: [],
        ground: 'paving',
      };
      ctx.blocks.push(block);
      const fn = {
        park: genPark, police: genPolice, hospital: genHospital, petrol: genPetrol,
        parking: genParking, garage: genGarage,
      }[block.special] || {
        downtown: genDowntown, midtown: genMidtown, residential: genResidential,
        suburb: genSuburb, waterfront: genWaterfront,
      }[block.district];
      fn(ctx, block, rng);
      buildBlockGround(ctx, block);
      ctx.map.rects.push({ ...r, type: block.ground === 'grass' ? 'grass' : 'block' });
      for (const a of block.alleys) ctx.map.rects.push({ ...a, type: 'road' });
    }

  // Player start: on the pavement of Market St, beside a parked sedan
  const cx = ROAD_LINES[4];
  ctx.spawn = { x: cx - 10.5, z: 38, heading: Math.PI };
  ctx.spots.parking.unshift({ x: cx - 5.6, z: 30, heading: Math.PI, type: 'sedan', color: '#c81d25', starter: true });
}

// Inner lot after the pavement ring
const inner = (b, pad = 0) => ({
  x0: b.x0 + SIDEWALK + pad,
  z0: b.z0 + SIDEWALK + pad,
  x1: b.x1 - SIDEWALK - pad,
  z1: b.z1 - SIDEWALK - pad,
});

// Which side of a block a rectangle is closest to: returns 'n','s','e','w'
function nearestSide(b, x0, z0, x1, z1) {
  const d = { n: z0 - b.z0, s: b.z1 - z1, w: x0 - b.x0, e: b.x1 - x1 };
  return Object.keys(d).reduce((a, k) => (d[k] < d[a] ? k : a), 'n');
}

function addBuilding(ctx, b, x0, z0, x1, z1, h, opts = {}) {
  const rec = {
    x0, z0, x1, z1, h,
    base: opts.base ?? CURB_H,
    style: opts.style || 'office',
    tint: opts.tint || '#ffffff',
    storefront: !!opts.storefront,
    shopTint: opts.shopTint || ctx.rng.pick(SHOP_TINTS),
    roof: opts.roof || 'flat',
    roofTint: opts.roofTint || ctx.rng.pick(ROOF_TINTS),
    parapet: opts.parapet ?? 0.9,
  };
  ctx.buildings.push(rec);
  if (!opts.noCollider) {
    ctx.colliders.add(x0, z0, x1, z1, h + (rec.roof === 'gable' ? 3 : 1), -5, 'building');
    ctx.map.rects.push({ x0, z0, x1, z1, type: 'building', h });
  }
  // shop sign above the shop front on the side facing the street
  if (rec.storefront && opts.sign !== false && b) {
    const side = nearestSide(b, x0, z0, x1, z1);
    const name = opts.signText || ctx.rng.pick(SHOP_NAMES);
    addWallSign(ctx, rec, side, name, rec.base + 3.72, Math.min(7, (side === 'n' || side === 's' ? x1 - x0 : z1 - z0) * 0.6), 0.62);
  }
  // rooftop clutter
  if (rec.roof === 'flat' && !opts.noRoofProps) {
    const area = (x1 - x0) * (z1 - z0);
    const n = area > 900 ? 4 : area > 300 ? 2 : area > 120 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      ctx.props.ac.push({
        x: ctx.rng.range(x0 + 2, x1 - 2), y: h, z: ctx.rng.range(z0 + 2, z1 - 2),
        rot: ctx.rng.pick([0, Math.PI / 2]), s: ctx.rng.range(0.8, 1.4),
      });
    }
    if ((rec.style === 'brick' || rec.style === 'stucco') && area > 200 && ctx.rng.chance(0.45)) {
      ctx.props.tanks.push({ x: ctx.rng.range(x0 + 3, x1 - 3), y: h, z: ctx.rng.range(z0 + 3, z1 - 3), s: 1 });
    }
  }
  return rec;
}

function addWallSign(ctx, rec, side, text, y, w, h) {
  const cx = (rec.x0 + rec.x1) / 2;
  const cz = (rec.z0 + rec.z1) / 2;
  const off = 0.08;
  let x;
  let z;
  let rot;
  if (side === 'n') [x, z, rot] = [cx, rec.z0 - off, Math.PI];
  else if (side === 's') [x, z, rot] = [cx, rec.z1 + off, 0];
  else if (side === 'w') [x, z, rot] = [rec.x0 - off, cz, -Math.PI / 2];
  else [x, z, rot] = [rec.x1 + off, cz, Math.PI / 2];
  ctx.signs.push({ x, y, z, rot, w, h, text, kind: 'shop' });
}

function towerHeight(rng, b) {
  const centre = 1 - Math.hypot(b.bx - 3.5, b.bz - 3.5) / 3;
  return 60 + rng() * 70 + centre * 70;
}

function genDowntown(ctx, b, rng) {
  const L = inner(b);
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  if (rng.chance(0.5)) {
    // two towers either side of a north-south service alley
    b.alleys.push({ x0: cx - 4, z0: b.z0, x1: cx + 4, z1: b.z1 });
    for (const [x0, x1] of [[L.x0 + 1, cx - 5], [cx + 5, L.x1 - 1]]) {
      const h = towerHeight(rng, b);
      const style = rng.chance(0.6) ? 'glass' : 'office';
      setbackTower(ctx, b, x0, L.z0 + 1, x1, L.z1 - 1, h, style, rng);
    }
    ctx.spots.pickups.push({ x: cx, z: cz });
  } else {
    // one landmark tower on a plaza
    const s = rng.range(15, 19);
    const h = towerHeight(rng, b) + 30;
    setbackTower(ctx, b, cx - s, cz - s, cx + s, cz + s, h, rng.chance(0.7) ? 'glass' : 'office', rng, true);
    for (const [px, pz] of [[L.x0 + 2, L.z0 + 2], [L.x1 - 2, L.z0 + 2], [L.x0 + 2, L.z1 - 2], [L.x1 - 2, L.z1 - 2]]) {
      ctx.props.trees.push({ x: px, z: pz, s: rng.range(0.8, 1.1) });
    }
    ctx.props.benches.push({ x: cx, z: L.z1 - 1, rot: 0 });
    ctx.spots.vending.push({ x: cx - s - 1.2, z: cz + s - 3, rot: -Math.PI / 2 });
  }
}

function setbackTower(ctx, b, x0, z0, x1, z1, h, style, rng, landmark = false) {
  const tint = rng.pick(WALL_TINTS[style]);
  const podium = rng.range(10, 18);
  addBuilding(ctx, b, x0, z0, x1, z1, CURB_H + podium, {
    style: 'office', tint: '#ffffff', storefront: true, noRoofProps: true,
  });
  const inset = rng.range(1.5, 3.5);
  const mid = landmark ? h * 0.72 : h;
  const top = addBuilding(ctx, b, x0 + inset, z0 + inset, x1 - inset, z1 - inset, mid, {
    style, tint, base: CURB_H + podium, noCollider: true, parapet: style === 'glass' ? 2 : 1,
  });
  ctx.colliders.add(x0, z0, x1, z1, mid + 2, -5, 'building');
  if (landmark) {
    const i2 = inset + rng.range(3, 5);
    addBuilding(ctx, b, x0 + i2, z0 + i2, x1 - i2, z1 - i2, h, {
      style, tint, base: mid, noCollider: true, noRoofProps: true, parapet: 2.5,
    });
    ctx.colliders.add(x0 + i2, z0 + i2, x1 - i2, z1 - i2, h + 3, -5, 'building');
    ctx.props.antennas.push({ x: (x0 + x1) / 2, y: h, z: (z0 + z1) / 2, s: 1.6 });
    ctx.map.rects.push({ x0: x0 + i2, z0: z0 + i2, x1: x1 - i2, z1: z1 - i2, type: 'building', h });
  } else if (rng.chance(0.5)) {
    ctx.props.helipads.push({ x: (top.x0 + top.x1) / 2, y: h + 0.02, z: (top.z0 + top.z1) / 2 });
  } else {
    ctx.props.antennas.push({ x: top.x0 + 3, y: h, z: top.z0 + 3, s: 1 });
  }
}

function quadrants(L, gap) {
  const mx = (L.x0 + L.x1) / 2;
  const mz = (L.z0 + L.z1) / 2;
  const g = gap / 2;
  return [
    [L.x0, L.z0, mx - g, mz - g],
    [mx + g, L.z0, L.x1, mz - g],
    [L.x0, mz + g, mx - g, L.z1],
    [mx + g, mz + g, L.x1, L.z1],
  ];
}

function genMidtown(ctx, b, rng) {
  const L = inner(b);
  let gap = 4;
  if (rng.chance(0.4)) {
    const cz = (b.z0 + b.z1) / 2;
    b.alleys.push({ x0: b.x0, z0: cz - 4, x1: b.x1, z1: cz + 4 });
    gap = 10;
    ctx.spots.pickups.push({ x: (b.x0 + b.x1) / 2 + rng.range(-10, 10), z: cz });
  }
  let billboard = rng.chance(0.5);
  for (const [x0, z0, x1, z1] of quadrants(L, gap)) {
    if (rng.chance(0.12)) {
      // pocket plaza
      ctx.props.trees.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, s: 1.1 });
      ctx.props.benches.push({ x: (x0 + x1) / 2, z: z1 - 2, rot: 0 });
      ctx.props.bins.push({ x: (x0 + x1) / 2 + 2, z: z1 - 2 });
      continue;
    }
    const style = rng.pick(['office', 'office', 'glass', 'brick', 'stucco']);
    const h = CURB_H + rng.range(16, 58);
    const rec = addBuilding(ctx, b, x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, h, {
      style, tint: rng.pick(WALL_TINTS[style]), storefront: rng.chance(0.75),
    });
    if (billboard && h < 40) {
      billboard = false;
      const side = nearestSide(b, rec.x0, rec.z0, rec.x1, rec.z1);
      ctx.props.billboards.push(roofBillboard(rec, side, rng));
    }
  }
}

function roofBillboard(rec, side, rng) {
  const rot = { n: Math.PI, s: 0, w: -Math.PI / 2, e: Math.PI / 2 }[side];
  const cx = (rec.x0 + rec.x1) / 2;
  const cz = (rec.z0 + rec.z1) / 2;
  const off = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[side];
  const hw = side === 'n' || side === 's' ? (rec.x1 - rec.x0) / 2 : (rec.z1 - rec.z0) / 2;
  return {
    x: cx + off[0] * ((rec.x1 - rec.x0) / 2 - 2),
    z: cz + off[1] * ((rec.z1 - rec.z0) / 2 - 2),
    y: rec.h, rot, w: Math.min(12, hw * 1.6), h: 5, legs: 2.5, ad: Math.floor(rng() * 8),
  };
}

function genResidential(ctx, b, rng) {
  const L = inner(b);
  let gap = 6;
  if (rng.chance(0.3)) {
    const cx = (b.x0 + b.x1) / 2;
    b.alleys.push({ x0: cx - 4, z0: b.z0, x1: cx + 4, z1: b.z1 });
    gap = 10;
  }
  for (const [x0, z0, x1, z1] of quadrants(L, gap)) {
    const style = rng.pick(['stucco', 'stucco', 'brick', 'brick', 'office']);
    const h = CURB_H + rng.range(9, 26);
    addBuilding(ctx, b, x0 + 1, z0 + 1, x1 - 1, z1 - 1, h, {
      style, tint: rng.pick(WALL_TINTS[style]), storefront: rng.chance(0.45),
    });
  }
  if (!b.alleys.length && rng.chance(0.5)) {
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    ctx.props.trees.push({ x: cx, z: cz, s: 0.9 });
  }
}

function genWaterfront(ctx, b, rng) {
  const L = inner(b);
  const mz = (L.z0 + L.z1) / 2;
  // hotels / apartments on the inland half
  const mx = (L.x0 + L.x1) / 2;
  for (const [x0, x1] of [[L.x0 + 1, mx - 2], [mx + 2, L.x1 - 1]]) {
    const h = CURB_H + rng.range(14, 42);
    addBuilding(ctx, b, x0, L.z0 + 1, x1, mz - 3, h, {
      style: 'stucco', tint: rng.pick(WALL_TINTS.stucco), storefront: false,
    });
  }
  // a row of small beach shops facing the sea
  const n = 4;
  const w = (L.x1 - L.x0) / n;
  for (let i = 0; i < n; i++) {
    const x0 = L.x0 + i * w + 0.8;
    const x1 = L.x0 + (i + 1) * w - 0.8;
    addBuilding(ctx, null, x0, mz + 3, x1, L.z1 - 1, CURB_H + rng.range(5, 9), {
      style: 'stucco', tint: rng.pick(WALL_TINTS.stucco), storefront: true,
    });
    ctx.signs.push({ x: (x0 + x1) / 2, y: CURB_H + 3.72, z: L.z1 - 1 + 0.08, rot: 0, w: (x1 - x0) * 0.7, h: 0.62, text: rng.pick(SHOP_NAMES), kind: 'shop' });
  }
  // palms along the seafront pavement
  for (let x = b.x0 + 4; x < b.x1 - 2; x += 12) ctx.props.palms.push({ x, z: b.z1 - 1.6, s: rng.range(0.9, 1.2) });
}

function genSuburb(ctx, b, rng) {
  b.ground = 'grass';
  const L = inner(b);
  const n = 3;
  const lw = (L.x1 - L.x0) / n;
  const lh = (L.z1 - L.z0) / n;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x0 = L.x0 + i * lw;
      const z0 = L.z0 + j * lh;
      const x1 = x0 + lw;
      const z1 = z0 + lh;
      if (i === 1 && j === 1) {
        // shared garden with a pool
        ctx.builders.pool.top(x0 + 5, z0 + 6, x1 - 5, z1 - 6, CURB_H + 0.03, 4, rgb('#ffffff'));
        ctx.builders.concrete.walls(x0 + 4.5, z0 + 5.5, x1 - 4.5, z1 - 5.5, CURB_H, CURB_H + 0.12, 4, 4, rgb('#ffffff'));
        ctx.props.palms.push({ x: x0 + 2.5, z: z0 + 2.5, s: 0.8 });
        ctx.props.palms.push({ x: x1 - 2.5, z: z1 - 2.5, s: 0.9 });
        ctx.map.rects.push({ x0: x0 + 5, z0: z0 + 6, x1: x1 - 5, z1: z1 - 6, type: 'water' });
        continue;
      }
      // houses face the closest street
      const faceS = j === 2;
      const faceN = j === 0;
      const hw = rng.range(4.8, 6.2);
      const hd = rng.range(4, 5);
      const cx = (x0 + x1) / 2 + rng.range(-1, 1);
      let cz = (z0 + z1) / 2;
      if (faceN) cz = z0 + 3 + hd;
      if (faceS) cz = z1 - 3 - hd;
      const floors = rng.chance(0.45) ? 2 : 1;
      const h = CURB_H + floors * 3;
      addBuilding(ctx, b, cx - hw, cz - hd, cx + hw, cz + hd, h, {
        style: 'house', tint: rng.pick(WALL_TINTS.house), roof: 'gable', roofTint: rng.pick(ROOF_TINTS),
      });
      // driveway
      const dx = cx + hw - 1.6;
      if (faceN) ctx.builders.path.top(dx - 1.4, b.z0 + SIDEWALK, dx + 1.4, cz - hd, CURB_H + 0.012, 4, rgb('#ffffff'));
      else if (faceS) ctx.builders.path.top(dx - 1.4, cz + hd, dx + 1.4, b.z1 - SIDEWALK, CURB_H + 0.012, 4, rgb('#ffffff'));
      // garden trees
      if (rng.chance(0.8)) ctx.props.trees.push({ x: x0 + rng.range(1.5, 3), z: faceS ? z0 + 2.5 : z1 - 2.5, s: rng.range(0.7, 1.1) });
      if (rng.chance(0.4)) ctx.props.trees.push({ x: x1 - rng.range(1.5, 3), z: faceS ? z0 + 2.5 : z1 - 2.5, s: rng.range(0.7, 1) });
    }
  // street trees on the pavement
  for (let x = b.x0 + 6; x < b.x1 - 4; x += 14) {
    ctx.props.trees.push({ x, z: b.z0 + 2, s: rng.range(0.8, 1.05) });
    ctx.props.trees.push({ x, z: b.z1 - 2, s: rng.range(0.8, 1.05) });
  }
  if (rng.chance(0.5)) ctx.spots.pickups.push({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 });
}

function genPark(ctx, b, rng) {
  b.ground = 'grass';
  const L = inner(b);
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  const P = ctx.builders.path;
  const white = rgb('#ffffff');
  P.top(cx - 2, L.z0, cx + 2, cz - 7, CURB_H + 0.012, 4, white);
  P.top(cx - 2, cz + 7, cx + 2, L.z1, CURB_H + 0.012, 4, white);
  P.top(L.x0, cz - 2, cx - 7, cz + 2, CURB_H + 0.012, 4, white);
  P.top(cx + 7, cz - 2, L.x1, cz + 2, CURB_H + 0.012, 4, white);
  P.top(cx - 7, cz - 7, cx + 7, cz + 7, CURB_H + 0.012, 4, white);
  ctx.props.fountains.push({ x: cx, z: cz });
  ctx.colliders.add(cx - 3.2, cz - 3.2, cx + 3.2, cz + 3.2, 1.2, -5, 'fountain');
  for (let i = 0; i < 46; i++) {
    const x = rng.range(L.x0 + 2, L.x1 - 2);
    const z = rng.range(L.z0 + 2, L.z1 - 2);
    if (Math.abs(x - cx) < 4.5 || Math.abs(z - cz) < 4.5) continue;
    ctx.props.trees.push({ x, z, s: rng.range(0.9, 1.5) });
  }
  for (const [x, z, rot] of [[cx - 3.2, cz - 14, Math.PI / 2], [cx + 3.2, cz + 14, -Math.PI / 2], [cx - 14, cz + 3.2, Math.PI], [cx + 14, cz - 3.2, 0]]) {
    ctx.props.benches.push({ x, z, rot });
  }
  ctx.props.bins.push({ x: cx + 3.4, z: cz - 12 });
  ctx.props.bins.push({ x: cx - 12, z: cz - 3.4 });
  ctx.spots.vending.push({ x: cx + 8, z: cz + 3.4, rot: Math.PI });
  ctx.spots.pickups.push({ x: cx + 18, z: cz + 18 });
  ctx.map.pois.push({ x: cx, z: cz, type: 'park', label: 'Palm Park' });
}

function genPolice(ctx, b, rng) {
  const L = inner(b);
  const rec = addBuilding(ctx, b, L.x0 + 4, L.z0 + 2, L.x1 - 4, L.z0 + 24, CURB_H + 15, {
    style: 'office', tint: '#d6e2f0', storefront: false,
  });
  ctx.signs.push({ x: (rec.x0 + rec.x1) / 2, y: CURB_H + 9, z: rec.z1 + 0.08, rot: 0, w: 12, h: 1.4, text: 'POLICE', kind: 'police' });
  b.ground = 'concrete';
  for (let i = 0; i < 3; i++) {
    const x = L.x0 + 12 + i * 8;
    ctx.spots.parking.push({ x, z: L.z1 - 8, heading: Math.PI, type: 'police' });
    lotStall(ctx, x, L.z1 - 8, 3.2, 6, true);
  }
  ctx.policeRespawn = { x: (b.x0 + b.x1) / 2 + 18, z: b.z1 - 2, heading: 0 };
  ctx.map.pois.push({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, type: 'police', label: 'Police Station' });
}

function genHospital(ctx, b, rng) {
  const L = inner(b);
  const rec = addBuilding(ctx, b, L.x0 + 3, L.z0 + 4, L.x1 - 3, L.z1 - 12, CURB_H + 26, {
    style: 'office', tint: '#ffffff', storefront: false, noRoofProps: true,
  });
  ctx.signs.push({ x: (rec.x0 + rec.x1) / 2, y: CURB_H + 6, z: rec.z1 + 0.08, rot: 0, w: 18, h: 1.5, text: 'PORT SOLANO GENERAL', kind: 'hospital' });
  ctx.props.helipads.push({ x: (rec.x0 + rec.x1) / 2, y: rec.h + 0.02, z: (rec.z0 + rec.z1) / 2 });
  ctx.respawn = { x: (b.x0 + b.x1) / 2, z: b.z1 - 3, heading: 0 };
  ctx.spots.vending.push({ x: rec.x0 + 4, z: rec.z1 + 1.2, rot: 0 });
  ctx.map.pois.push({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, type: 'hospital', label: 'Hospital' });
}

function genPetrol(ctx, b, rng) {
  b.ground = 'concrete';
  const L = inner(b);
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2 + 6;
  const shop = addBuilding(ctx, b, cx - 10, L.z0 + 2, cx + 10, L.z0 + 13, CURB_H + 4.8, {
    style: 'stucco', tint: '#ffffff', storefront: true, sign: false, shopTint: '#e4572e',
  });
  ctx.signs.push({ x: cx, y: CURB_H + 3.72, z: shop.z1 + 0.08, rot: 0, w: 9, h: 0.62, text: 'PETROSOL', kind: 'petrol' });
  ctx.props.canopies.push({ x: cx, z: cz, w: 24, d: 13, h: 5.5 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ctx.colliders.addPost(cx + sx * 10.5, cz + sz * 5, 0.35, 5.5);
  for (const px of [-6, 0, 6]) {
    ctx.props.pumps.push({ x: cx + px, z: cz, rot: 0 });
    ctx.colliders.add(cx + px - 0.6, cz - 1.6, cx + px + 0.6, cz + 1.6, 1.8, -5, 'pump');
  }
  ctx.spots.parking.push({ x: cx - 3, z: cz - 3.3, heading: Math.PI / 2, type: 'compact' });
  ctx.spots.vending.push({ x: shop.x1 + 1.2, z: shop.z1 - 2, rot: Math.PI / 2 });
  ctx.map.pois.push({ x: cx, z: cz, type: 'petrol', label: 'PetroSol' });
  ctx.places.stores.push({ x: cx - 4, z: shop.z1 + 1.6 });
}

function lotStall(ctx, x, z, w, d, alongZ) {
  const M = ctx.builders.markings;
  const white = rgb('#f2f2f2');
  const y = CURB_H + 0.015;
  const t = 0.12;
  if (alongZ) {
    M.top(x - w / 2 - t / 2, z - d / 2, x - w / 2 + t / 2, z + d / 2, y, 1, white);
    M.top(x + w / 2 - t / 2, z - d / 2, x + w / 2 + t / 2, z + d / 2, y, 1, white);
  }
}

function genParking(ctx, b, rng) {
  b.ground = 'lot';
  const L = inner(b);
  const types = ['compact', 'sedan', 'sedan', 'suv', 'van', 'sports', 'compact', 'suv'];
  const rows = [
    { z: L.z0 + 3.2, heading: Math.PI },
    { z: (L.z0 + L.z1) / 2 - 3.2, heading: 0 },
    { z: (L.z0 + L.z1) / 2 + 3.2, heading: Math.PI },
    { z: L.z1 - 3.2, heading: 0 },
  ];
  for (const row of rows) {
    for (let x = L.x0 + 3; x <= L.x1 - 3; x += 3.2) {
      lotStall(ctx, x, row.z, 3.2, 5.6, true);
      if (rng.chance(0.3)) ctx.spots.parking.push({ x, z: row.z, heading: row.heading, type: rng.pick(types) });
    }
  }
  ctx.spots.pickups.push({ x: (L.x0 + L.x1) / 2, z: (L.z0 + L.z1) / 2 + 9.5 });
  ctx.map.pois.push({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, type: 'parking', label: 'Parking' });
}

function genGarage(ctx, b, rng) {
  b.ground = 'concrete';
  const L = inner(b);
  const rec = addBuilding(ctx, b, L.x0 + 6, L.z0 + 3, L.x1 - 6, L.z0 + 21, CURB_H + 8, {
    style: 'brick', tint: '#9aa0a6', storefront: true, sign: false, shopTint: '#374151',
  });
  ctx.signs.push({ x: (rec.x0 + rec.x1) / 2, y: CURB_H + 6, z: rec.z1 + 0.08, rot: 0, w: 14, h: 1.3, text: 'SOLANO CUSTOMS', kind: 'garage' });
  ctx.spots.parking.push({ x: rec.x0 + 8, z: L.z1 - 10, heading: Math.PI * 0.85, type: 'sports', color: '#f5b700' });
  ctx.spots.parking.push({ x: rec.x1 - 8, z: L.z1 - 10, heading: -Math.PI * 0.85, type: 'sports', color: '#1d4ed8' });
  // a second, smaller building at the back
  addBuilding(ctx, b, L.x0 + 2, L.z1 - 4, L.x0 + 14, L.z1 - 1, CURB_H + 4, { style: 'brick', tint: '#c9a28c' });
  ctx.map.pois.push({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, type: 'garage', label: 'Solano Customs' });
  const mx = (rec.x0 + rec.x1) / 2;
  ctx.places.garage = {
    dealer: { x: mx - 6, z: rec.z1 + 2.5 }, // showroom door, on foot
    bay: { x: mx + 10, z: rec.z1 + 11 }, // drive in to store a car
    delivery: { x: mx, z: rec.z1 + 19, heading: Math.PI / 2 },
  };
}

// ------------------------------------------------------------------ block ground

function buildBlockGround(ctx, b) {
  // Raised areas = block minus any alleys
  let rects = [{ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 }];
  for (const a of b.alleys) {
    const next = [];
    for (const r of rects) {
      if (a.x1 <= r.x0 || a.x0 >= r.x1 || a.z1 <= r.z0 || a.z0 >= r.z1) {
        next.push(r);
        continue;
      }
      if (a.x0 > r.x0) next.push({ ...r, x1: a.x0 });
      if (a.x1 < r.x1) next.push({ ...r, x0: a.x1 });
      if (a.z0 > r.z0) next.push({ x0: Math.max(r.x0, a.x0), x1: Math.min(r.x1, a.x1), z0: r.z0, z1: a.z0 });
      if (a.z1 < r.z1) next.push({ x0: Math.max(r.x0, a.x0), x1: Math.min(r.x1, a.x1), z0: a.z1, z1: r.z1 });
    }
    rects = next;
  }
  b.raised = rects;
  const pave = ctx.builders.paving;
  const white = rgb('#ffffff');
  for (const r of rects) {
    // curb faces
    pave.walls(r.x0, r.z0, r.x1, r.z1, 0, CURB_H, 4, 4, rgb('#cfcac0'));
    if (b.ground === 'paving') {
      pave.top(r.x0, r.z0, r.x1, r.z1, CURB_H, 4, white);
    } else {
      const s = SIDEWALK;
      pave.top(r.x0, r.z0, r.x1, r.z0 + s, CURB_H, 4, white);
      pave.top(r.x0, r.z1 - s, r.x1, r.z1, CURB_H, 4, white);
      pave.top(r.x0, r.z0 + s, r.x0 + s, r.z1 - s, CURB_H, 4, white);
      pave.top(r.x1 - s, r.z0 + s, r.x1, r.z1 - s, CURB_H, 4, white);
      ctx.builders[b.ground].top(r.x0 + s, r.z0 + s, r.x1 - s, r.z1 - s, CURB_H, b.ground === 'lot' ? 8 : 4, white);
    }
  }
}

// ------------------------------------------------------------------ roads

function buildRoads(ctx) {
  const M = ctx.builders.markings;
  const white = rgb('#f2f2f2');
  const yellow = rgb('#f2c230');
  const y = 0.02;
  const rng = ctx.rng;

  const seg = (alongZ, c, s0, s1, fn) => {
    // fn(x0,z0,x1,z1) in road-local terms: across = offset from centre, along = s
    const R = (a0, s0_, a1, s1_) => (alongZ ? fn(c + a0, s0_, c + a1, s1_) : fn(s0_, c + a0, s1_, c + a1));
    return R;
  };

  for (let i = 0; i <= GRID; i++) {
    const c = ROAD_LINES[i];
    for (let j = 0; j < GRID; j++) {
      const s0 = ROAD_LINES[j] + ROAD_HALF;
      const s1 = ROAD_LINES[j + 1] - ROAD_HALF;
      for (const alongZ of [true, false]) {
        const R = seg(alongZ, c, s0, s1, (x0, z0, x1, z1) => M.top(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), y, 3, white));
        const RY = seg(alongZ, c, s0, s1, (x0, z0, x1, z1) => M.top(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), y, 3, yellow));
        const cw0 = s0 + 0.6;
        const cw1 = s1 - 0.6;
        // double yellow centre line
        RY(-0.28, cw0 + 4, -0.16, cw1 - 4);
        RY(0.16, cw0 + 4, 0.28, cw1 - 4);
        // dashed lane dividers
        for (let s = cw0 + 5; s < cw1 - 6; s += 6) {
          R(-4.06, s, -3.94, s + 3);
          R(3.94, s, 4.06, s + 3);
        }
        // zebra crossings at both ends
        for (const [a, b] of [[s0 + 0.5, s0 + 3.5], [s1 - 3.5, s1 - 0.5]]) {
          for (let k = -7.5; k < 7.5; k += 1.2) R(k, a, k + 0.6, b);
        }
        // concrete gutters along both kerbs
        const gutter = rgb('#8f8b83');
        const RG = seg(alongZ, c, s0, s1, (x0, z0, x1, z1) => M.top(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), y - 0.005, 3, gutter));
        RG(-ROAD_HALF, s0, -ROAD_HALF + 0.45, s1);
        RG(ROAD_HALF - 0.45, s0, ROAD_HALF, s1);
        // a manhole cover in the road and storm drains at the kerb
        const roadPt = (a, s) => (alongZ ? { x: c + a, z: s } : { x: s, z: c + a });
        if (rng.chance(0.75)) {
          const p = roadPt(rng.pick([-1, 1]) * rng.range(1.2, 6.5), rng.range(s0 + 8, s1 - 8));
          ctx.props.manholes.push({ ...p, rot: rng.range(0, Math.PI) });
        }
        for (const t of [0.15, 0.55, 0.9]) {
          const side = rng.pick([-1, 1]);
          ctx.props.drains.push({ ...roadPt(side * (ROAD_HALF - 0.25), s0 + (s1 - s0) * t), rot: alongZ ? Math.PI / 2 : 0 });
        }
        // stop lines (traffic drives on the left: +z traffic uses x > c, +x traffic uses z < c)
        const L = alongZ ? 1 : -1;
        R(L * 0.3, s1 - 4.3, L * (ROAD_HALF - 0.3), s1 - 3.9);
        R(-L * (ROAD_HALF - 0.3), s0 + 3.9, -L * 0.3, s0 + 4.3);

        // street lights on both pavements, facing the road
        for (const t of [0.3, 0.75]) {
          const s = s0 + (s1 - s0) * t;
          for (const side of [-1, 1]) {
            const a = side * (ROAD_HALF + 0.7);
            const px = alongZ ? c + a : s;
            const pz = alongZ ? s : c + a;
            // rot makes the lamp arm (local +z) point at the road
            const rot = alongZ ? (side < 0 ? Math.PI / 2 : -Math.PI / 2) : side < 0 ? 0 : Math.PI;
            ctx.props.streetlights.push({ x: px, z: pz, rot });
            ctx.colliders.addPost(px, pz, 0.25, 8);
            if (rng.chance(0.18)) {
              const bs = s + 3;
              const bx = alongZ ? c + side * (ROAD_HALF + 1.4) : bs;
              const bz = alongZ ? bs : c + side * (ROAD_HALF + 1.4);
              ctx.props.bins.push({ x: bx, z: bz });
            }
            if (rng.chance(0.12)) {
              const hs = s - 4;
              ctx.props.hydrants.push({ x: alongZ ? c + side * (ROAD_HALF + 0.6) : hs, z: alongZ ? hs : c + side * (ROAD_HALF + 0.6) });
            }
          }
        }
      }
    }
  }

  // intersections: traffic lights and street name signs
  const signs = ctx.signs;
  for (let i = 0; i <= GRID; i++)
    for (let j = 0; j <= GRID; j++) {
      const x = ROAD_LINES[i];
      const z = ROAD_LINES[j];
      const o = ROAD_HALF + 1.2;
      // Each approach gets a signal on its near (left) corner.
      // phase 'ns' controls traffic moving along z, 'ew' along x.
      const lights = [
        { x: x - o, z: z + o, rot: 0, phase: 'ns' }, // faces +z: seen by cars coming from the south
        { x: x + o, z: z - o, rot: Math.PI, phase: 'ns' },
        { x: x + o, z: z + o, rot: Math.PI / 2, phase: 'ew' },
        { x: x - o, z: z - o, rot: -Math.PI / 2, phase: 'ew' },
      ];
      for (const L of lights) {
        if (Math.abs(L.x) > HALF + 5 || Math.abs(L.z) > HALF + 5) continue;
        ctx.props.trafficLights.push(L);
        ctx.colliders.addPost(L.x, L.z, 0.25, 6);
      }
      // name blades on the north-west corner pole
      const sx = x - o;
      const sz = z - o;
      if (Math.abs(sx) <= HALF && Math.abs(sz) <= HALF) {
        // each blade runs parallel to the street it names
        signs.push({ x: sx + 0.12, y: 4.75, z: sz, rot: Math.PI / 2, w: 2.2, h: 0.35, text: STREETS_NS[i], kind: 'street', twoSided: true });
        signs.push({ x: sx, y: 5.15, z: sz + 0.12, rot: 0, w: 2.2, h: 0.35, text: STREETS_EW[j], kind: 'street', twoSided: true });
      }
    }

  // curb-side parking (cars park on the left, facing the direction of traffic)
  for (let k = 0; k < 44; k++) {
    const i = rng.int(1, GRID - 1);
    const j = rng.int(0, GRID - 1);
    const alongZ = rng.chance(0.5);
    const c = ROAD_LINES[i];
    const s = ROAD_LINES[j] + ROAD_HALF + rng.range(12, PITCH - 2 * ROAD_HALF - 12);
    const dir = rng.chance(0.5) ? 1 : -1; // direction of travel along the road axis
    // left-hand traffic: moving +z uses x > c; moving +x uses z < c
    const a = alongZ ? (dir > 0 ? 5.6 : -5.6) : dir > 0 ? -5.6 : 5.6;
    const x = alongZ ? c + a : s;
    const z = alongZ ? s : c + a;
    const heading = alongZ ? (dir > 0 ? 0 : Math.PI) : dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    if (Math.hypot(x - ctx.spawn.x, z - ctx.spawn.z) < 20) continue;
    ctx.spots.parking.push({ x, z, heading, type: rng.pick(['compact', 'sedan', 'sedan', 'suv', 'van', 'ute', 'taxi']) });
  }
}

function buildOuterRing(ctx) {
  const pave = ctx.builders.paving;
  const white = rgb('#ffffff');
  const curb = rgb('#cfcac0');
  const E = HALF + ROAD_HALF; // 328
  const S = E + SIDEWALK; // 332
  // outer pavements (west, east, north)
  for (const [x0, z0, x1, z1] of [
    [-S, -S, -E, S], [E, -S, S, S], [-E, -S, E, -E],
  ]) {
    pave.walls(x0, z0, x1, z1, 0, CURB_H, 4, 4, curb);
    pave.top(x0, z0, x1, z1, CURB_H, 4, white);
  }
  // seafront pavement and boardwalk
  pave.walls(-E, E, E, S, 0, CURB_H, 4, 4, curb);
  pave.top(-E, E, E, S, CURB_H, 4, white);
  ctx.builders.wood.top(-S, BOARDWALK_Z0, S, SAND_Z0, CURB_H + 0.01, 4, white);
  ctx.builders.wood.walls(-S, BOARDWALK_Z0, S, SAND_Z0, -0.3, CURB_H + 0.01, 4, 4, rgb('#8a6a48'));
  ctx.map.rects.push({ x0: -S, z0: BOARDWALK_Z0, x1: S, z1: SAND_Z0, type: 'boardwalk' });
  ctx.map.rects.push({ x0: -S, z0: SAND_Z0, x1: S, z1: SHORE_Z + 4, type: 'sand' });

  // beach life
  const rng = ctx.rng;
  for (let x = -S + 6; x < S; x += 16) {
    ctx.props.palms.push({ x, z: BOARDWALK_Z0 + 1.2, s: rng.range(0.9, 1.25) });
    ctx.colliders.addPost(x, BOARDWALK_Z0 + 1.2, 0.3, 8);
    if (rng.chance(0.4)) ctx.props.benches.push({ x: x + 6, z: SAND_Z0 - 1.2, rot: 0 });
  }
  for (let k = 0; k < 40; k++) {
    const x = rng.range(-S + 5, S - 5);
    const z = rng.range(SAND_Z0 + 8, SHORE_Z - 12);
    const rot = rng() * Math.PI;
    const color = rng.int(0, 4);
    if (x > DOCKS.x0 - 4) continue; // no sunbathing on the wharf
    ctx.props.umbrellas.push({ x, z, rot, color });
    ctx.colliders.addPost(x, z, 0.2, 2.6);
  }
  for (const x of [-180, 60, 190]) {
    ctx.props.lifeguards.push({ x, z: SHORE_Z - 20 });
    ctx.colliders.add(x - 1.6, SHORE_Z - 21.6, x + 1.6, SHORE_Z - 18.4, 5, -5, 'tower');
  }
  ctx.spots.vending.push({ x: -100, z: SAND_Z0 - 0.8, rot: Math.PI });
  ctx.spots.vending.push({ x: 140, z: SAND_Z0 - 0.8, rot: Math.PI });
  ctx.spots.pickups.push({ x: -40, z: 372 });
  ctx.spots.pickups.push({ x: 210, z: 385 });
  ctx.map.pois.push({ x: -40, z: 370, type: 'beach', label: 'Solano Beach' });
  buildDocks(ctx);

  // city limits: fences and trees beyond the outer pavement
  const T = ctx.builders.trim;
  const fence = rgb('#6b7280');
  const B = BOUNDS;
  for (const [x0, z0, x1, z1] of [
    [B.minX - 0.2, B.minZ, B.minX + 0.2, SAND_Z0],
    [B.maxX - 0.2, B.minZ, B.maxX + 0.2, SAND_Z0],
    [B.minX, B.minZ - 0.2, B.maxX, B.minZ + 0.2],
  ]) {
    T.box(x0, 0, z0, x1, 1.4, z1, fence, 2);
  }
  ctx.colliders.add(B.minX - 30, B.minZ - 30, B.minX, B.maxZ + 30, 200, -5, 'bound');
  ctx.colliders.add(B.maxX, B.minZ - 30, B.maxX + 30, B.maxZ + 30, 200, -5, 'bound');
  ctx.colliders.add(B.minX - 30, B.minZ - 30, B.maxX + 30, B.minZ, 200, -5, 'bound');
  // the sea, except where the wharf sticks out
  const D = DOCKS;
  ctx.colliders.add(B.minX - 30, B.maxZ, D.x0, B.maxZ + 80, 200, -5, 'bound');
  ctx.colliders.add(D.x1, B.maxZ, B.maxX + 30, B.maxZ + 80, 200, -5, 'bound');
  ctx.colliders.add(D.x0, D.z1, D.x1, D.z1 + 30, 200, -5, 'bound');
  for (let t = B.minZ; t < SAND_Z0; t += 9) {
    ctx.props.trees.push({ x: B.minX - 4 - rng() * 6, z: t + rng() * 4, s: rng.range(1, 1.6) });
    ctx.props.trees.push({ x: B.maxX + 4 + rng() * 6, z: t + rng() * 4, s: rng.range(1, 1.6) });
  }
  for (let t = B.minX; t < B.maxX; t += 9) {
    ctx.props.trees.push({ x: t + rng() * 4, z: B.minZ - 4 - rng() * 6, s: rng.range(1, 1.6) });
  }
}

// ------------------------------------------------------------------ docks

// The container wharf at the east end of the beach, reaching out into the sea.
export const DOCKS = { x0: 236, x1: 342, z0: SAND_Z0, z1: 448, top: CURB_H + 0.04 };

function buildDocks(ctx) {
  const D = DOCKS;
  const T = ctx.builders.trim;
  const C = ctx.builders.concrete;
  const rng = makeRng(SEED + 9);
  const y = D.top;
  // deck and its sea wall
  C.top(D.x0, D.z0, D.x1, D.z1, y, 6, rgb('#d9d6cf'));
  C.walls(D.x0, D.z0, D.x1, D.z1, -3, y, 6, 6, rgb('#9a958c'));
  ctx.map.rects.push({ x0: D.x0, z0: D.z0, x1: D.x1, z1: D.z1, type: 'dock' });
  ctx.map.pois.push({ x: 290, z: 400, type: 'docks', label: 'Port Docks' });
  // yellow safety line along the water's edge
  const M = ctx.builders.markings;
  const yellow = rgb('#f2c230');
  M.top(D.x0 + 1, D.z1 - 1.6, D.x1 - 1, D.z1 - 1.2, y + 0.01, 1, yellow);
  M.top(D.x0 + 1.2, SHORE_Z, D.x0 + 1.6, D.z1 - 1.2, y + 0.01, 1, yellow);
  // bollards on the edge
  for (let x = D.x0 + 6; x < D.x1 - 2; x += 12) {
    T.box(x - 0.3, y, D.z1 - 0.9, x + 0.3, y + 0.7, D.z1 - 0.3, rgb('#2b2d31'), 2);
    ctx.colliders.addPost(x, D.z1 - 0.6, 0.35, 0.7);
  }
  // container stacks in rows, leaving lanes to drive through
  const colours = ['#c0392b', '#2471a3', '#1e8449', '#d68910', '#7d3c98', '#5d6d7e', '#ca6f1e', '#17a589'];
  for (let row = 0; row < 3; row++) {
    const z0 = 352 + row * 22;
    for (let x = D.x0 + 12; x < D.x1 - 14; x += 15) {
      if (rng.chance(0.25)) continue; // gaps between stacks
      const len = 12.2;
      const w = 2.5;
      const levels = rng.int(1, 3);
      for (let k = 0; k < 2; k++) {
        const zz = z0 + k * (w + 0.3);
        for (let l = 0; l < levels; l++) {
          const c = rgb(rng.pick(colours), 0.9 + rng() * 0.2);
          const y0 = y + l * 2.6;
          T.box(x, y0, zz, x + len, y0 + 2.55, zz + w, c, 2);
          // ribs so the boxes read as containers
          for (let r = 1; r < 6; r++) T.box(x + r * 2, y0 + 0.1, zz - 0.04, x + r * 2 + 0.12, y0 + 2.45, zz + w + 0.04, rgb('#000000', 0.25), 1);
        }
      }
      ctx.colliders.add(x, z0, x + len, z0 + 2 * w + 0.3, y + levels * 2.6, -5, 'container');
    }
  }
  // two gantry cranes over the quay
  for (const cx of [262, 312]) {
    const z0 = 424;
    const z1 = D.z1 + 14;
    const steel = rgb('#e4a11b');
    for (const lx of [cx - 9, cx + 9]) {
      for (const lz of [z0, D.z1 - 3]) {
        T.box(lx - 0.6, y, lz - 0.6, lx + 0.6, y + 26, lz + 0.6, steel, 2);
        ctx.colliders.add(lx - 0.7, lz - 0.7, lx + 0.7, lz + 0.7, 26, -5, 'crane');
      }
      T.box(lx - 0.5, y + 24, z0 - 8, lx + 0.5, y + 25.4, z1, steel, 2);
    }
    T.box(cx - 9, y + 25.4, z0 - 8, cx + 9, y + 26.6, z0 - 6.5, steel, 2);
    T.box(cx - 9, y + 25.4, z1 - 1.5, cx + 9, y + 26.6, z1, steel, 2);
    T.box(cx - 3, y + 21, z0 + 6, cx + 3, y + 24, z0 + 11, rgb('#f5f5f5'), 2); // trolley cab
    T.box(cx - 0.1, y + 9, z0 + 8.4, cx + 0.1, y + 21, z0 + 8.6, rgb('#222222'), 1); // cable
  }
  // a cargo ship moored alongside
  const sx0 = D.x0 + 8;
  const sx1 = D.x1 - 6;
  const sz0 = D.z1 + 3;
  const sz1 = sz0 + 16;
  T.box(sx0, -3, sz0, sx1, 4.5, sz1, rgb('#7b241c'), 2);
  T.box(sx0, 4.5, sz0, sx1, 5.2, sz1, rgb('#2c3e50'), 2);
  T.box(sx1 - 18, 5.2, sz0 + 2, sx1 - 4, 15, sz1 - 2, rgb('#ecf0f1'), 2);
  T.box(sx1 - 10, 15, sz0 + 6, sx1 - 7, 20, sz1 - 6, rgb('#c0392b'), 2);
  for (let x = sx0 + 6; x < sx1 - 24; x += 13) {
    for (let l = 0; l < 2; l++) T.box(x, 5.2 + l * 2.6, sz0 + 2.5, x + 12.2, 7.75 + l * 2.6, sz1 - 2.5, rgb(rng.pick(colours)), 2);
  }
  ctx.places.docks = { x: 290, z: 432 };
  ctx.spots.pickups.push({ x: 300, z: 398 });
}

// ------------------------------------------------------------------ meshes

function buildGroundMeshes(ctx, tex, group) {
  const std = (map, opts = {}) => new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.95, ...opts });

  // Base asphalt slab under the whole city
  const tiled = (t, n) => {
    const c = t.clone();
    c.repeat.set(n, n);
    c.needsUpdate = true;
    return c;
  };
  const A = tex.asphalt;
  const asphaltMat = new THREE.MeshStandardMaterial({
    map: tiled(A.map, 84), normalMap: tiled(A.normalMap, 84), roughnessMap: tiled(A.roughnessMap, 84),
    normalScale: new THREE.Vector2(0.8, 0.8), roughness: 1,
  });
  const S = HALF + ROAD_HALF + SIDEWALK;
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(S * 2, S * 2), asphaltMat);
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.receiveShadow = true;
  group.add(asphalt);

  // Grass beyond the city
  // Grass beyond the city, stopping where the beach begins
  const grassDepth = 2600 + SAND_Z0;
  const grassFar = tex.grass.clone();
  grassFar.repeat.set(400, grassDepth / 10);
  grassFar.needsUpdate = true;
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(4000, grassDepth), new THREE.MeshStandardMaterial({ map: grassFar, roughness: 1, color: '#c9d6b0' }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.set(0, -0.08, SAND_Z0 - grassDepth / 2);
  outer.receiveShadow = true;
  group.add(outer);

  // Sand sloping into the sea
  const sandW = 2400;
  const sandGeo = new THREE.PlaneGeometry(sandW, SHORE_Z - SAND_Z0 + 40, 1, 8);
  sandGeo.rotateX(-Math.PI / 2);
  const pos = sandGeo.attributes.position;
  const sz0 = SAND_Z0;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i) + (SAND_Z0 + SHORE_Z + 40) / 2;
    const t = Math.max(0, (z - (SHORE_Z - 30)) / 40);
    pos.setY(i, CURB_H - 0.02 - t * 1.2);
  }
  sandGeo.computeVertexNormals();
  const sandTex = tex.sand.clone();
  sandTex.repeat.set(sandW / 6, (SHORE_Z - sz0 + 40) / 6);
  sandTex.needsUpdate = true;
  const sand = new THREE.Mesh(sandGeo, new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1 }));
  sand.position.z = (SAND_Z0 + SHORE_Z + 40) / 2;
  sand.receiveShadow = true;
  group.add(sand);

  const B = ctx.builders;
  const meshes = [
    B.paving.mesh(std(tex.paving.map, { normalMap: tex.paving.normalMap, roughness: 0.88 })),
    B.grass.mesh(std(tex.grass, { roughness: 1 })),
    B.concrete.mesh(std(tex.concrete.map, { normalMap: tex.concrete.normalMap })),
    B.lot.mesh(std(tex.asphalt.map, { normalMap: tex.asphalt.normalMap, roughnessMap: tex.asphalt.roughnessMap, roughness: 1 })),
    B.wood.mesh(std(tex.wood, { roughness: 0.85 })),
    B.path.mesh(std(tex.concrete.map, { normalMap: tex.concrete.normalMap, color: '#e8dcc3', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })),
    B.markings.mesh(new THREE.MeshStandardMaterial({ map: tex.wornPaint, vertexColors: true, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
    B.pool.mesh(new THREE.MeshStandardMaterial({ color: '#3fb8d8', roughness: 0.08, metalness: 0.2 })),
    B.trim.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), { castShadow: true }),
  ];
  for (const m of meshes) if (m) group.add(m);
}

// Real geometry on the walls: a plinth at street level, string courses at each
// floor on brick and stucco, a cornice under the roof line, and vertical fins
// on glass towers. Window recesses and sills come from the facade normal maps.
function addFacadeRelief(trim, b, y0) {
  if (b.h - y0 < 3) return;
  const tint = rgb(b.tint, 0.9);
  const { x0, z0, x1, z1 } = b;
  const ring = (ya, yb, o, colour) => trim.box(x0 - o, ya, z0 - o, x1 + o, yb, z1 + o, colour, 2);
  if (!b.storefront && b.style !== 'house') ring(y0, y0 + 0.75, 0.08, rgb(b.style === 'glass' ? '#5b6268' : b.tint, 0.62));
  if (b.style === 'brick' || b.style === 'stucco') {
    for (let y = y0 + 3.5; y < b.h - 2; y += b.style === 'brick' ? 3.5 : 7) ring(y - 0.1, y + 0.08, 0.07, rgb(b.style === 'brick' ? '#d8d0c4' : b.tint, 0.95));
  }
  if (b.roof === 'flat' && b.style !== 'glass') {
    ring(b.h - 0.75, b.h - 0.45, 0.32, tint);
    ring(b.h - 0.45, b.h - 0.12, 0.2, tint);
  }
  if (b.style === 'glass') {
    const fin = rgb('#9aa3ab');
    const fins = (len, put) => {
      for (let d = 1.75; d < len - 0.5; d += 1.75) put(d);
    };
    fins(x1 - x0, (d) => {
      trim.box(x0 + d - 0.05, y0, z0 - 0.14, x0 + d + 0.05, b.h, z0, fin, 4);
      trim.box(x0 + d - 0.05, y0, z1, x0 + d + 0.05, b.h, z1 + 0.14, fin, 4);
    });
    fins(z1 - z0, (d) => {
      trim.box(x0 - 0.14, y0, z0 + d - 0.05, x0, b.h, z0 + d + 0.05, fin, 4);
      trim.box(x1, y0, z0 + d - 0.05, x1 + 0.14, b.h, z0 + d + 0.05, fin, 4);
    });
  }
}

// Weathering for walls: grime and splash marks near the ground, and faint rain
// streaks running down from each window column, worked out from world position.
function weathered(m, tintMask = null) {
  if (tintMask) m.userData.tintMask = { value: tintMask };
  m.onBeforeCompile = (sh) => {
    if (tintMask) {
      // the shop's colour only goes where the mask is white (the fascia)
      sh.uniforms.tintMask = m.userData.tintMask;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tintMask;')
        .replace('#include <color_fragment>', '#if defined( USE_COLOR )\n  diffuseColor.rgb *= mix(vec3(1.0), vColor, texture2D(tintMask, vMapUv).g);\n#endif');
    }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWeatherPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWeatherPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWeatherPos;
float wHash(float n) { return fract(sin(n) * 43758.5453); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  {
    vec3 wp = vWeatherPos;
    float ground = 1.0 - smoothstep(0.2, 4.5, wp.y);
    float along = wp.x + wp.z;
    float col = floor(along / 1.75);
    float streak = wHash(col * 17.13) * smoothstep(0.35, 0.0, abs(fract(along / 1.75) - 0.5) - 0.1);
    float drip = streak * (0.5 + 0.5 * sin(wp.y * 0.21 + col)) * 0.09;
    float blotch = wHash(floor(wp.y * 0.3) * 3.1 + col) * 0.05;
    diffuseColor.rgb *= 1.0 - ground * 0.3 - drip - blotch;
  }`);
  };
  m.customProgramCacheKey = () => (tintMask ? 'weathered-tinted' : 'weathered');
  return m;
}

function buildBuildingMeshes(ctx, tex, group) {
  const walls = {};
  for (const s of Object.keys(tex.facades)) walls[s] = new GeoBuilder();
  const store = new GeoBuilder();
  const roof = new GeoBuilder();
  const tiles = new GeoBuilder();
  const trim = new GeoBuilder();

  for (const b of ctx.buildings) {
    const tint = rgb(b.tint);
    let y0 = b.base;
    const tile = b.style === 'house' ? 12 : 14;
    if (b.storefront) {
      store.walls(b.x0, b.z0, b.x1, b.z1, y0, y0 + 4.5, 14, 4.5, rgb(b.shopTint));
      // awning ledge
      const o = 1.1;
      const ledge = rgb(b.shopTint, 0.6);
      const ly = y0 + 4.5;
      trim.box(b.x0 - o, ly - 0.25, b.z0 - o, b.x1 + o, ly, b.z0, ledge, 2, true);
      trim.box(b.x0 - o, ly - 0.25, b.z1, b.x1 + o, ly, b.z1 + o, ledge, 2, true);
      trim.box(b.x0 - o, ly - 0.25, b.z0, b.x0, ly, b.z1, ledge, 2, true);
      trim.box(b.x1, ly - 0.25, b.z0, b.x1 + o, ly, b.z1, ledge, 2, true);
      y0 += 4.5;
    }
    if (b.h > y0) walls[b.style].walls(b.x0, b.z0, b.x1, b.z1, y0, b.h, tile, tile, tint, b.storefront ? 3.5 : 0);
    addFacadeRelief(trim, b, y0);
    if (b.roof === 'gable') {
      tiles.gable(b.x0, b.z0, b.x1, b.z1, b.h, 2.2, 0.5, rgb(b.roofTint));
      // fill the gable triangles with wall colour
    } else {
      roof.top(b.x0, b.z0, b.x1, b.z1, b.h, 6, rgb('#ffffff'));
      const p = b.parapet;
      if (p > 0) {
        const t = 0.35;
        const pc = rgb(b.style === 'glass' ? '#8d969e' : b.tint, b.style === 'glass' ? 1 : 0.82);
        trim.box(b.x0, b.h, b.z0, b.x1, b.h + p, b.z0 + t, pc, 2);
        trim.box(b.x0, b.h, b.z1 - t, b.x1, b.h + p, b.z1, pc, 2);
        trim.box(b.x0, b.h, b.z0 + t, b.x0 + t, b.h + p, b.z1 - t, pc, 2);
        trim.box(b.x1 - t, b.h, b.z0 + t, b.x1, b.h + p, b.z1 - t, pc, 2);
      }
    }
  }

  const facadeMat = (s) =>
    weathered(new THREE.MeshStandardMaterial({
      map: tex.facades[s].map,
      roughnessMap: tex.facades[s].roughnessMap,
      normalMap: tex.facades[s].normalMap,
      normalScale: new THREE.Vector2(1, 1),
      vertexColors: true,
      roughness: 1,
      metalness: s === 'glass' ? 0.35 : 0.08,
      envMapIntensity: s === 'glass' ? 1.4 : 0.7,
      emissive: '#ffffff',
      emissiveMap: tex.facades[s].emissiveMap,
      emissiveIntensity: 0,
    }));
  const add = (m) => m && group.add(m);
  for (const s of Object.keys(walls)) {
    const m = facadeMat(s);
    ctx.nightMaterials.push({ m, max: 0.85 });
    add(walls[s].mesh(m, { castShadow: true }));
  }
  const storeMat = weathered(new THREE.MeshStandardMaterial({
    map: tex.store.map, roughnessMap: tex.store.roughnessMap, normalMap: tex.store.normalMap, vertexColors: true, metalness: 0.15,
    emissive: '#ffffff', emissiveMap: tex.store.emissiveMap, emissiveIntensity: 0.06, envMapIntensity: 1.2,
  }), tex.store.tintMask);
  ctx.nightMaterials.push({ m: storeMat, max: 0.75, min: 0.06 });
  add(store.mesh(storeMat, { castShadow: true }));
  add(windowSpill(ctx));
  add(roof.mesh(new THREE.MeshStandardMaterial({ map: tex.roof, vertexColors: true, roughness: 1 })));
  add(tiles.mesh(new THREE.MeshStandardMaterial({ map: tex.tiles, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }), { castShadow: true }));
  add(trim.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), { castShadow: true }));
}

// After dark, lit shop windows throw warm light across the pavement in front
// of them: a strip on each side of every shop front, one draw call for the city.
function windowSpill(ctx) {
  const pos = [];
  const uv = [];
  const depth = 4.5;
  const bay = 4.5;
  const y = CURB_H + 0.025;
  for (const b of ctx.buildings) {
    if (!b.storefront) continue;
    // each side: a corner on the wall, the direction along it and the outward normal
    const sides = [
      [b.x0, b.z1, 1, 0, 0, 1, b.x1 - b.x0],
      [b.x1, b.z0, -1, 0, 0, -1, b.x1 - b.x0],
      [b.x1, b.z1, 0, -1, 1, 0, b.z1 - b.z0],
      [b.x0, b.z0, 0, 1, -1, 0, b.z1 - b.z0],
    ];
    for (const [x, z, ax, az, nx, nz, len] of sides) {
      const u1 = len / bay;
      const q = [
        [x, z, 0, 1], [x + ax * len, z + az * len, u1, 1],
        [x + ax * len + nx * depth, z + az * len + nz * depth, u1, 0], [x + nx * depth, z + nz * depth, 0, 0],
      ];
      for (const k of [0, 2, 1, 0, 3, 2]) {
        pos.push(q[k][0], y, q[k][1]);
        uv.push(q[k][2], q[k][3]);
      }
    }
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const mat = new THREE.MeshBasicMaterial({
    map: TX.makeWindowSpill(), color: '#ffcf8f', transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  ctx.nightFns.push((k) => {
    mesh.visible = k > 0.02;
    mat.opacity = k * 0.8;
  });
  return mesh;
}

// ------------------------------------------------------------------ queries

function makeHeightFn(ctx) {
  const blocks = ctx.blocks;
  const E = HALF + ROAD_HALF;
  const S = E + SIDEWALK;
  return function heightAt(x, z) {
    const bx = Math.floor((x + HALF) / PITCH);
    const bz = Math.floor((z + HALF) / PITCH);
    if (bx >= 0 && bx < GRID && bz >= 0 && bz < GRID) {
      const b = blocks[bz * GRID + bx];
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) {
        for (const a of b.alleys) if (x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1) return 0;
        return CURB_H;
      }
    }
    const ax = Math.abs(x);
    if (x >= DOCKS.x0 && z >= DOCKS.z0 && z <= DOCKS.z1) return DOCKS.top;
    if (z >= SAND_Z0) {
      const t = Math.max(0, (z - (SHORE_Z - 30)) / 40);
      return CURB_H - 0.02 - t * 1.2;
    }
    if (z >= E && ax <= S) return CURB_H; // seafront pavement and boardwalk
    if (ax >= E && ax <= S && z >= -S) return CURB_H;
    if (z >= -S && z <= -E && ax <= S) return CURB_H;
    if (ax > S || z < -S) return -0.08;
    return 0;
  };
}

function makeAreaFn() {
  return function areaAt(x, z) {
    if (z > HALF + ROAD_HALF + SIDEWALK) return x >= DOCKS.x0 ? 'Port Docks' : 'Solano Beach';
    const bx = Math.max(0, Math.min(GRID - 1, Math.floor((x + HALF) / PITCH)));
    const bz = Math.max(0, Math.min(GRID - 1, Math.floor((z + HALF) / PITCH)));
    const sp = SPECIAL[`${bx},${bz}`];
    if (sp === 'park') return 'Palm Park';
    const d = districtOf(bx, bz);
    if (d === 'downtown') return 'Downtown';
    if (d === 'midtown') return 'Midtown';
    if (d === 'suburb') return 'Northside Hills';
    if (d === 'waterfront') return 'Marina District';
    return x < 0 ? 'Harbour West' : 'Eastgate';
  };
}
