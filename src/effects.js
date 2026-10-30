// Particle effects: tyre smoke when cars slide, dust and debris puffs on crashes.
// One Points object with a small custom shader, so all particles are a single draw call.
import * as THREE from 'three';

const MAX = 400;

const VERT = /* glsl */ `
uniform float scale;
attribute float size;
attribute float alpha;
attribute float shade;
varying float vAlpha;
varying float vShade;
void main() {
  vAlpha = alpha;
  vShade = shade;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform vec3 color;
varying float vAlpha;
varying float vShade;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.1, d) * vAlpha;
  gl_FragColor = vec4(color * vShade, a);
}`;

export class Effects {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    this.shade = new Float32Array(MAX).fill(1);
    this.parts = [];
    for (let i = 0; i < MAX; i++) this.parts.push({ life: 0, max: 1, x: 0, y: -100, z: 0, vx: 0, vy: 0, vz: 0, s0: 1, s1: 3, a: 0.5, shade: 1 });
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('shade', new THREE.BufferAttribute(this.shade, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color('#d8d8d8') }, scale: { value: 300 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.sparks = new Sparks(scene);
    this.skids = new SkidMarks(scene);
  }

  emit(x, y, z, { vx = 0, vy = 0.6, vz = 0, life = 1.6, s0 = 0.8, s1 = 3.2, a = 0.35, shade = 1 } = {}) {
    const i = this.next;
    const p = this.parts[i];
    this.next = (this.next + 1) % MAX;
    Object.assign(p, { x, y, z, vx, vy, vz, life, max: life, s0, s1, a });
    this.shade[i] = shade;
    this.points.geometry.attributes.shade.needsUpdate = true;
  }

  // Smoke from under the bonnet of a damaged car: grey, then black when it is nearly wrecked.
  engineSmoke(v, dt) {
    const d = v.damage;
    if (d < 0.6) return;
    v.engineSmokeAcc = (v.engineSmokeAcc || 0) + dt * (4 + (d - 0.6) * 30);
    const c = Math.cos(v.heading);
    const s = Math.sin(v.heading);
    const front = v.spec.L / 2 - v.spec.hoodL * 0.5;
    while (v.engineSmokeAcc > 1) {
      v.engineSmokeAcc -= 1;
      this.emit(v.x + front * s + (Math.random() - 0.5) * 0.5, v.y + v.spec.belt + 0.1, v.z + front * c + (Math.random() - 0.5) * 0.5, {
        vx: v.vx * 0.5 + (Math.random() - 0.5) * 0.4, vz: v.vz * 0.5 + (Math.random() - 0.5) * 0.4, vy: 1.2 + Math.random(),
        life: 1.6 + Math.random(), s0: 0.6, s1: 3.4, a: 0.3 + (d - 0.6) * 0.6, shade: d > 0.85 ? 0.18 : 0.55,
      });
    }
  }

  // Smoke from the rear wheels of sliding cars.
  tyreSmoke(v, dt) {
    const amount = Math.max(0, v.slip - 3) * (v.speed > 2 ? 1 : 0) + (v.burnout || 0);
    if (amount <= 0) return;
    v.smokeAcc = (v.smokeAcc || 0) + Math.min(3, amount) * dt * 9;
    const c = Math.cos(v.heading);
    const s = Math.sin(v.heading);
    const back = -v.spec.wheelBase / 2;
    while (v.smokeAcc > 1) {
      v.smokeAcc -= 1;
      for (const side of [-1, 1]) {
        const lx = (side * v.spec.track) / 2;
        const x = v.x + lx * c + back * s;
        const z = v.z - lx * s + back * c;
        this.emit(x + (Math.random() - 0.5) * 0.4, v.y + 0.25, z + (Math.random() - 0.5) * 0.4, {
          vx: v.vx * 0.2 + (Math.random() - 0.5), vz: v.vz * 0.2 + (Math.random() - 0.5), vy: 0.5 + Math.random() * 0.5,
          life: 1.4 + Math.random() * 0.8, s0: 0.9, s1: 3.6, a: Math.min(0.5, 0.18 + amount * 0.03),
        });
      }
    }
  }

  // A burst of dust where two things collided.
  crash(x, y, z, impact) {
    const n = Math.min(14, 3 + Math.floor(impact / 2));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 3;
      this.emit(x, y + 0.6, z, { vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 0.8 + Math.random(), life: 0.9 + Math.random() * 0.6, s0: 0.6, s1: 2.6, a: 0.4 });
    }
  }

  update(dt) {
    this.sparks.update(dt);
    for (let i = 0; i < MAX; i++) {
      const p = this.parts[i];
      if (p.life > 0) {
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.vx *= 1 - dt * 1.5;
        p.vz *= 1 - dt * 1.5;
        const k = 1 - Math.max(0, p.life) / p.max;
        this.size[i] = p.s0 + (p.s1 - p.s0) * k;
        this.alpha[i] = p.a * (1 - k) * Math.min(1, (p.max - p.life) * 12);
        this.pos[i * 3] = p.x;
        this.pos[i * 3 + 1] = p.y;
        this.pos[i * 3 + 2] = p.z;
      } else if (this.alpha[i] !== 0) {
        this.alpha[i] = 0;
      }
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
  }

  // Point sizes are in pixels: scale world sizes by the viewport height and field of view.
  setViewport(heightPx, fovDeg) {
    this.mat.uniforms.scale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.sparks.mat.uniforms.scale.value = this.mat.uniforms.scale.value;
  }

  // Smoke picks up the sky colour so it is not bright white at night.
  setTint(night) {
    this.mat.uniforms.color.value.setRGB(0.85 - night * 0.6, 0.85 - night * 0.58, 0.86 - night * 0.52);
  }
}

// Sparks: bright, short-lived points that fall and bounce when metal scrapes.
const SPARKS = 240;
class Sparks {
  constructor(scene) {
    this.pos = new Float32Array(SPARKS * 3);
    this.alpha = new Float32Array(SPARKS);
    this.size = new Float32Array(SPARKS).fill(0.09);
    this.parts = Array.from({ length: SPARKS }, () => ({ life: 0, x: 0, y: -100, z: 0, vx: 0, vy: 0, vz: 0 }));
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('shade', new THREE.BufferAttribute(new Float32Array(SPARKS).fill(1), 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(6, 3.2, 1.1) }, scale: { value: 300 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  // n sparks from a contact point, thrown mostly along (dx, dz)
  emit(x, y, z, dx, dz, n) {
    for (let k = 0; k < n; k++) {
      const p = this.parts[this.next];
      this.next = (this.next + 1) % SPARKS;
      const sp = 2 + Math.random() * 6;
      Object.assign(p, {
        x, y, z, life: 0.25 + Math.random() * 0.35,
        vx: dx * sp + (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 3, vz: dz * sp + (Math.random() - 0.5) * 3,
      });
    }
  }

  update(dt) {
    for (let i = 0; i < SPARKS; i++) {
      const p = this.parts[i];
      if (p.life <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      p.life -= dt;
      p.vy -= 14 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.05 && p.vy < 0) {
        p.y = 0.05;
        p.vy *= -0.35;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      this.alpha[i] = Math.min(1, p.life * 4);
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
  }
}

// Skid marks: dark rubber strips laid down by sliding or hard-braking tyres,
// kept in a ring buffer so the oldest fade away as new ones are drawn.
const SKID_QUADS = 3000;
class SkidMarks {
  constructor(scene) {
    this.pos = new Float32Array(SKID_QUADS * 4 * 3);
    this.col = new Float32Array(SKID_QUADS * 4 * 4);
    const idx = new Uint16Array(SKID_QUADS * 6);
    for (let q = 0; q < SKID_QUADS; q++) {
      const b = q * 4;
      idx.set([b, b + 2, b + 1, b + 1, b + 2, b + 3], q * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.next = 0;
    this.last = new WeakMap(); // vehicle -> previous left/right tyre points
  }

  // Called every frame for each nearby car; lays a strip under each rear tyre while it slides.
  track(v, heightAt) {
    const sliding = v.speed > 3 && (v.slip > 1.8 || (v.handbrakeOn && v.speed > 5) || (v.hardBrake && Math.abs(v.forwardSpeed) > 9));
    if (!sliding) {
      this.last.delete(v);
      return;
    }
    const c = Math.cos(v.heading);
    const s = Math.sin(v.heading);
    const back = -v.spec.wheelBase / 2;
    const pts = [-1, 1].map((side) => {
      const lx = (side * v.spec.track) / 2;
      return [v.x + lx * c + back * s, v.z - lx * s + back * c];
    });
    const prev = this.last.get(v);
    this.last.set(v, pts);
    if (!prev) return;
    const strength = Math.min(0.7, 0.25 + v.slip * 0.05);
    for (let k = 0; k < 2; k++) {
      const [x0, z0] = prev[k];
      const [x1, z1] = pts[k];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.05 || len > 4) continue;
      const nx = (-(z1 - z0) / len) * 0.12;
      const nz = ((x1 - x0) / len) * 0.12;
      const y0 = heightAt(x0, z0) + 0.025;
      const y1 = heightAt(x1, z1) + 0.025;
      const q = this.next;
      this.next = (this.next + 1) % SKID_QUADS;
      this.pos.set([x0 - nx, y0, z0 - nz, x0 + nx, y0, z0 + nz, x1 - nx, y1, z1 - nz, x1 + nx, y1, z1 + nz], q * 12);
      for (let j = 0; j < 4; j++) this.col.set([0.03, 0.03, 0.03, strength], q * 16 + j * 4);
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }
}
