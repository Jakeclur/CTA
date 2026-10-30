// Particle effects: tyre smoke when cars slide, dust and debris puffs on crashes.
// One Points object with a small custom shader, so all particles are a single draw call.
import * as THREE from 'three';

const MAX = 400;

const VERT = /* glsl */ `
uniform float scale;
attribute float size;
attribute float alpha;
varying float vAlpha;
void main() {
  vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform vec3 color;
varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.1, d) * vAlpha;
  gl_FragColor = vec4(color, a);
}`;

export class Effects {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    this.parts = [];
    for (let i = 0; i < MAX; i++) this.parts.push({ life: 0, max: 1, x: 0, y: -100, z: 0, vx: 0, vy: 0, vz: 0, s0: 1, s1: 3, a: 0.5 });
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
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
  }

  emit(x, y, z, { vx = 0, vy = 0.6, vz = 0, life = 1.6, s0 = 0.8, s1 = 3.2, a = 0.35 } = {}) {
    const p = this.parts[this.next];
    this.next = (this.next + 1) % MAX;
    Object.assign(p, { x, y, z, vx, vy, vz, life, max: life, s0, s1, a });
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
  }

  // Smoke picks up the sky colour so it is not bright white at night.
  setTint(night) {
    this.mat.uniforms.color.value.setRGB(0.85 - night * 0.6, 0.85 - night * 0.58, 0.86 - night * 0.52);
  }
}
