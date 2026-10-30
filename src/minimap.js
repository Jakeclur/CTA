// Minimap: the city is drawn once onto an offscreen canvas, then a rotating
// window of it is copied into the HUD every frame. M opens the full-screen map.

const PX = 1.4; // pixels per metre on the base map
const EXTENT = 460; // metres from the centre covered by the base map

const COLORS = {
  ground: '#3f5a36',
  road: '#5c6066',
  block: '#9c9a94',
  grass: '#4f7a3a',
  building: '#33373d',
  water: '#2f7fa6',
  sand: '#d8c38f',
  boardwalk: '#9b7650',
  sea: '#1f5f80',
};

const POI_STYLE = {
  police: { color: '#3b82f6', letter: 'P' },
  hospital: { color: '#ef4444', letter: 'H' },
  petrol: { color: '#f97316', letter: 'F' },
  parking: { color: '#64748b', letter: 'P' },
  garage: { color: '#eab308', letter: 'G' },
  park: { color: '#22c55e', letter: '♣' },
  beach: { color: '#facc15', letter: '☀' },
};

export class Minimap {
  constructor(world, canvas, bigCanvas) {
    this.world = world;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.big = bigCanvas;
    this.bigCtx = bigCanvas.getContext('2d');
    this.base = this.renderBase();
    this.zoom = 1;
  }

  renderBase() {
    const size = Math.round(EXTENT * 2 * PX);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const X = (x) => (x + EXTENT) * PX;
    const Z = (z) => (z + EXTENT) * PX;
    g.fillStyle = COLORS.ground;
    g.fillRect(0, 0, size, size);
    // the whole city area starts as road
    g.fillStyle = COLORS.road;
    g.fillRect(X(-332), Z(-332), 664 * PX, 664 * PX);
    const order = ['block', 'grass', 'road', 'boardwalk', 'sand', 'water', 'building'];
    const rects = [...this.world.map.rects].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    for (const r of rects) {
      g.fillStyle = COLORS[r.type] || COLORS.block;
      g.fillRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * PX, (r.z1 - r.z0) * PX);
    }
    g.fillStyle = COLORS.sea;
    g.fillRect(0, Z(388), size, size);
    return c;
  }

  // Draws the circular minimap, rotated so the camera's view direction is up.
  draw(px, pz, heading, camYaw) {
    const g = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const scale = (W / 260) * this.zoom; // ~130 m radius visible
    g.save();
    g.clearRect(0, 0, W, H);
    g.beginPath();
    g.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = COLORS.ground;
    g.fillRect(0, 0, W, H);
    g.translate(W / 2, H / 2);
    // world +z is screen down; rotate so the camera's forward points up
    g.rotate(Math.PI + camYaw);
    g.scale(scale / PX, scale / PX);
    g.drawImage(this.base, -(px + EXTENT) * PX, -(pz + EXTENT) * PX);
    g.restore();

    // points of interest
    g.save();
    for (const p of this.world.map.pois) {
      const [sx, sy] = this.toScreen(p.x, p.z, px, pz, camYaw, scale, W, H);
      const dx = sx - W / 2;
      const dy = sy - H / 2;
      const d = Math.hypot(dx, dy);
      const rmax = W / 2 - 12;
      const k = d > rmax ? rmax / d : 1;
      this.icon(g, W / 2 + dx * k, H / 2 + dy * k, p.type, 9);
    }
    g.restore();

    // player arrow
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(-(heading - camYaw));
    g.fillStyle = '#ffffff';
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(6.5, 7);
    g.lineTo(0, 3.5);
    g.lineTo(-6.5, 7);
    g.closePath();
    g.stroke();
    g.fill();
    g.restore();

    // north marker on the rim
    // world -z (north) lands at (-sin yaw, cos yaw) on screen after the map rotation
    const nx = W / 2 - Math.sin(camYaw) * (W / 2 - 12);
    const ny = H / 2 + Math.cos(camYaw) * (H / 2 - 12);
    g.fillStyle = 'rgba(10,12,16,0.85)';
    g.beginPath();
    g.arc(nx, ny, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = '700 11px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', nx, ny + 0.5);
  }

  toScreen(x, z, px, pz, camYaw, scale, W, H) {
    const dx = (x - px) * scale;
    const dz = (z - pz) * scale;
    const a = Math.PI + camYaw;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [W / 2 + dx * c - dz * s, H / 2 + dx * s + dz * c];
  }

  icon(g, x, y, type, r) {
    const st = POI_STYLE[type] || { color: '#fff', letter: '?' };
    g.fillStyle = st.color;
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#fff';
    g.font = `800 ${Math.round(r * 1.2)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(st.letter, x, y + 0.5);
  }

  // Full-screen map, north up, with labels.
  drawBig(px, pz, heading, streetsNS, streetsEW, roadLines) {
    const c = this.big;
    const rect = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.round(rect.width * dpr)) {
      c.width = Math.round(rect.width * dpr);
      c.height = Math.round(rect.height * dpr);
    }
    const g = this.bigCtx;
    const W = c.width;
    const H = c.height;
    const span = 800; // metres shown
    const scale = Math.min(W, H) / span;
    const ox = W / 2;
    const oy = H / 2 - 28 * scale; // centre the view slightly south to include the beach
    const S = (x, z) => [ox + x * scale, oy + z * scale];
    g.fillStyle = '#16202a';
    g.fillRect(0, 0, W, H);
    const [bx, by] = S(-EXTENT, -EXTENT);
    g.drawImage(this.base, bx, by, EXTENT * 2 * scale, EXTENT * 2 * scale);

    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = `600 ${Math.max(10, Math.round(9 * dpr))}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    roadLines.forEach((r, i) => {
      g.save();
      const [x, y] = S(r, -350);
      g.translate(x, y);
      g.fillText(streetsNS[i], 0, 0);
      g.restore();
      const [x2, y2] = S(-375, r);
      g.textAlign = 'right';
      g.fillText(streetsEW[i], x2 + 30 * dpr, y2);
      g.textAlign = 'center';
    });

    for (const p of this.world.map.pois) {
      const [x, y] = S(p.x, p.z);
      this.icon(g, x, y, p.type, 11 * dpr);
      g.fillStyle = '#fff';
      g.font = `600 ${Math.round(11 * dpr)}px system-ui, sans-serif`;
      g.fillText(p.label, x, y + 20 * dpr);
    }

    const [mx, my] = S(px, pz);
    g.save();
    g.translate(mx, my);
    g.rotate(Math.PI - heading);
    g.scale(dpr * 1.4, dpr * 1.4);
    g.fillStyle = '#fff';
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(6.5, 7);
    g.lineTo(0, 3.5);
    g.lineTo(-6.5, 7);
    g.closePath();
    g.stroke();
    g.fill();
    g.restore();
  }
}
