// Post-processing: the camera-like finish on the rendered frame. Glow around
// bright lights (bloom), soft contact shadows (ambient occlusion, Ultra only),
// filmic tone mapping and a colour grade with a gentle vignette and film grain.
// The Low preset skips all of it and renders straight to the screen.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Runs after tone mapping, on display colours.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    contrast: { value: 1.06 },
    saturation: { value: 1.08 },
    warmth: { value: 0.0 }, // + warm highlights, cool shadows (golden hour)
    vignette: { value: 0.28 },
    grain: { value: 0.025 },
    time: { value: 0 },
    aspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float contrast, saturation, warmth, vignette, grain, time, aspect;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // split toning: cool shadows, warm highlights
      vec3 shadowTint = vec3(-0.012, 0.004, 0.022);
      vec3 highTint = vec3(0.03, 0.012, -0.025);
      c += mix(shadowTint, highTint, smoothstep(0.15, 0.75, l)) * (0.6 + warmth);
      c = mix(vec3(l), c, saturation);
      c = (c - 0.5) * contrast + 0.5;
      vec2 d = (vUv - 0.5) * vec2(aspect, 1.0);
      c *= 1.0 - vignette * smoothstep(0.35, 1.05, length(d));
      c += (hash(vUv * 917.0 + fract(time) * 31.0) - 0.5) * grain;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = false;
    this.composer = null;
    this.mode = '';
    this.night = 0;
  }

  // mode: 'off' (Low), 'medium', 'high' or 'ultra'
  configure(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.dispose();
    this.enabled = mode !== 'off';
    if (!this.enabled) return;
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: mode === 'medium' ? 0 : 4, // MSAA smooths edges on High and Ultra
    });
    const composer = new EffectComposer(r, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (mode === 'ultra') {
      this.ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      this.ao.output = GTAOPass.OUTPUT.Default;
      this.ao.blendIntensity = 0.85;
      this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1, samples: 12 });
      this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      composer.addPass(this.ao);
    }
    // bloom works at reduced resolution; it only needs the blurry glow
    const div = mode === 'medium' ? 4 : 2;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / div, size.y / div), 0.35, 0.55, 2.2);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    this.composer = composer;
    this.setSize();
  }

  setSize() {
    if (!this.composer) return;
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(innerWidth, innerHeight);
    if (this.grade) this.grade.uniforms.aspect.value = innerWidth / innerHeight;
  }

  // Night lowers the bloom threshold so lamps, windows and headlights glow;
  // golden hour warms the grade.
  setTime(night, sunHeight) {
    if (!this.bloom) return;
    this.night = night;
    this.bloom.threshold = 2.2 - night * 1.15;
    this.bloom.strength = 0.3 + night * 0.18;
    this.bloom.radius = 0.5 + night * 0.1;
    const golden = Math.max(0, 1 - Math.abs(sunHeight - 0.1) / 0.18) * (1 - night);
    this.grade.uniforms.warmth.value = golden * 1.2;
    this.grade.uniforms.saturation.value = 1.08 + golden * 0.06 - night * 0.06;
    this.grade.uniforms.contrast.value = 1.06 + night * 0.04;
  }

  render(dt) {
    if (!this.enabled) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.grade.uniforms.time.value += dt;
    this.composer.render(dt);
  }

  dispose() {
    if (!this.composer) return;
    for (const p of this.composer.passes) if (p.dispose) p.dispose();
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.composer = null;
    this.bloom = this.grade = this.ao = null;
  }
}
