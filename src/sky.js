// Sky dome with clouds and stars, a day/night cycle, sunlight with shadows that
// follow the player, fog, reflections and the sea.
import * as THREE from 'three';
import { SHORE_Z } from './config.js';
import { makeWaterNormal } from './textures.js';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 topColor;
uniform vec3 horizonColor;
uniform vec3 groundColor;
uniform vec3 sunDir;
uniform vec3 sunGlow;
uniform vec3 cloudColor;
uniform float night;
uniform float time;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(horizonColor, topColor, pow(max(h, 0.0), 0.5));
  col = mix(col, groundColor, smoothstep(0.0, -0.2, h));
  float s = max(dot(d, sunDir), 0.0);
  col += sunGlow * pow(s, 6.0) * 0.3;
  col += vec3(1.0, 0.95, 0.85) * pow(s, 1200.0) * 6.0 * (1.0 - night);
  if (h > 0.0) {
    // stars, fading in at night
    vec2 sp = d.xz / (h + 0.3) * 160.0;
    float st = step(0.985, hash(floor(sp))) * night * night * smoothstep(0.05, 0.3, h);
    col += vec3(st) * 0.9;
    // moon opposite the sun
    float m = max(dot(d, -sunDir), 0.0);
    col += vec3(0.85, 0.9, 1.0) * smoothstep(0.9993, 0.9996, m) * night * 1.4;
    // drifting clouds on a flat layer above the city
    vec2 cp = d.xz / (h + 0.08) * 1.6 + vec2(time * 0.006, time * 0.002);
    float c = smoothstep(0.5, 0.78, fbm(cp));
    c *= smoothstep(0.02, 0.18, h);
    vec3 cc = cloudColor + sunGlow * pow(s, 4.0) * 0.35;
    col = mix(col, cc, c * 0.85);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Colours at key sun heights; everything in between is blended.
const KEYS = [
  { y: -0.25, top: '#040814', horizon: '#121a30', ground: '#0a0e18', cloud: '#1a2236', glow: '#000000', sun: '#8fa8ff', sunI: 0.35, hemiSky: '#3d5287', hemiGround: '#1a1a22', hemiI: 0.35, exposure: 1.1 },
  { y: -0.05, top: '#101c3c', horizon: '#3b3f5e', ground: '#1c1f2c', cloud: '#3a3b52', glow: '#5a2a3a', sun: '#8fa8ff', sunI: 0.25, hemiSky: '#56628f', hemiGround: '#2a2630', hemiI: 0.35, exposure: 1.1 },
  { y: 0.06, top: '#3c5591', horizon: '#f0a070', ground: '#7d6f6a', cloud: '#e8a888', glow: '#ff8a40', sun: '#ffa060', sunI: 1.4, hemiSky: '#c9a890', hemiGround: '#5a4a40', hemiI: 0.45, exposure: 1.05 },
  { y: 0.3, top: '#3f79c4', horizon: '#cfdbe6', ground: '#a9b4bd', cloud: '#f4f6f8', glow: '#ffcc99', sun: '#fff1dc', sunI: 2.6, hemiSky: '#cfe0ff', hemiGround: '#7a6a55', hemiI: 0.55, exposure: 1.05 },
].map((k) => {
  const o = { ...k };
  for (const n of ['top', 'horizon', 'ground', 'cloud', 'glow', 'sun', 'hemiSky', 'hemiGround']) o[n] = new THREE.Color(k[n]);
  return o;
});

// Sun direction for a time of day in hours: rises in the east, sets in the west,
// and passes to the north at midday (Port Solano is in the southern hemisphere).
export function sunDirection(hours, out = new THREE.Vector3()) {
  const a = ((hours - 6) / 12) * Math.PI;
  return out.set(Math.cos(a) * 0.85, Math.sin(a) * 0.82, -0.42).normalize();
}

// How dark it is, 0 (day) to 1 (night), for lamps and windows.
export function nightFactor(hours) {
  const y = sunDirection(hours).y;
  return 1 - Math.min(1, Math.max(0, (y + 0.02) / 0.16));
}

export function buildEnvironment(scene, renderer) {
  const sunDir = sunDirection(15);
  const horizon = new THREE.Color('#cfdbe6');
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color('#3f79c4') },
      horizonColor: { value: horizon },
      groundColor: { value: new THREE.Color('#a9b4bd') },
      cloudColor: { value: new THREE.Color('#f4f6f8') },
      sunGlow: { value: new THREE.Color('#ffcc99') },
      sunDir: { value: sunDir },
      night: { value: 0 },
      time: { value: 0 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);

  // Reflections: bake the sky into an environment map used by every standard material
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
  let envTarget = null;
  function bakeEnv() {
    const old = envTarget;
    envTarget = pmrem.fromScene(envScene, 0.02, 0.1, 500);
    scene.environment = envTarget.texture;
    if (old) old.dispose();
  }

  scene.fog = new THREE.Fog(horizon.clone(), 150, 900);
  scene.background = horizon.clone();

  const hemi = new THREE.HemisphereLight('#cfe0ff', '#7a6a55', 0.55);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight('#fff1dc', 2.6);
  sun.position.copy(sunDir).multiplyScalar(200);
  sun.castShadow = true;
  const sc = sun.shadow.camera;
  sc.left = -90;
  sc.right = 90;
  sc.top = 90;
  sc.bottom = -90;
  sc.near = 10;
  sc.far = 500;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  // The sea
  const waterNormal = makeWaterNormal();
  waterNormal.repeat.set(220, 110);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 3000),
    new THREE.MeshStandardMaterial({
      color: '#1d6f8c', roughness: 0.08, metalness: 0.1, normalMap: waterNormal,
      normalScale: new THREE.Vector2(0.5, 0.5), envMapIntensity: 1.1,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.35, SHORE_Z - 30 + 1500);
  water.receiveShadow = true;
  scene.add(water);

  let shadowRange = 90;
  let bakedAt = -1;
  let night = 0;

  const k0 = {};
  function setTime(hours) {
    sunDirection(hours, sunDir);
    const y = sunDir.y;
    let i = 0;
    while (i < KEYS.length - 2 && y > KEYS[i + 1].y) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const f = Math.min(1, Math.max(0, (y - a.y) / (b.y - a.y)));
    for (const n of ['top', 'horizon', 'ground', 'cloud', 'glow', 'sun', 'hemiSky', 'hemiGround']) {
      k0[n] = k0[n] || new THREE.Color();
      k0[n].copy(a[n]).lerp(b[n], f);
    }
    const u = skyMat.uniforms;
    u.topColor.value.copy(k0.top);
    u.horizonColor.value.copy(k0.horizon);
    u.groundColor.value.copy(k0.ground);
    u.cloudColor.value.copy(k0.cloud);
    u.sunGlow.value.copy(k0.glow);
    night = nightFactor(hours);
    u.night.value = night;
    scene.fog.color.copy(k0.horizon);
    scene.background.copy(k0.horizon);
    hemi.color.copy(k0.hemiSky);
    hemi.groundColor.copy(k0.hemiGround);
    hemi.intensity = a.hemiI + (b.hemiI - a.hemiI) * f;
    sun.color.copy(k0.sun);
    sun.intensity = a.sunI + (b.sunI - a.sunI) * f;
    renderer.toneMappingExposure = a.exposure + (b.exposure - a.exposure) * f;
    water.material.color.set(night > 0.5 ? '#0c2a3a' : '#1d6f8c');
    // below the horizon the moon lights the scene from the opposite side
    lightDir.copy(y > -0.02 ? sunDir : sunDir.clone().negate().setY(Math.max(0.35, -y)).normalize());
    // re-bake reflections when the light has changed enough to notice
    if (bakedAt < 0 || Math.abs(hours - bakedAt) > 0.25) {
      bakedAt = hours;
      bakeEnv();
    }
  }
  const lightDir = sunDir.clone();

  setTime(15);

  return {
    sun,
    setTime,
    get night() {
      return night;
    },
    setQuality({ shadows, shadowSize, drawDistance }) {
      sun.castShadow = shadows;
      if (sun.shadow.mapSize.x !== shadowSize) {
        sun.shadow.mapSize.set(shadowSize, shadowSize);
        if (sun.shadow.map) {
          sun.shadow.map.dispose();
          sun.shadow.map = null;
        }
      }
      shadowRange = shadowSize >= 4096 ? 150 : shadowSize >= 2048 ? 110 : 80;
      sc.left = -shadowRange;
      sc.right = shadowRange;
      sc.top = shadowRange;
      sc.bottom = -shadowRange;
      sc.updateProjectionMatrix();
      scene.fog.near = drawDistance * 0.2;
      scene.fog.far = drawDistance;
    },
    // Keep the sky centred on the camera and the shadow box centred on the action.
    update(dt, t, camera, focus) {
      sky.position.copy(camera.position);
      sky.scale.setScalar((camera.far * 0.9) / 1000);
      // snap to shadow texels to stop shimmering as the player moves
      const texel = (shadowRange * 2) / sun.shadow.mapSize.x;
      const fx = Math.round(focus.x / texel) * texel;
      const fz = Math.round(focus.z / texel) * texel;
      sun.target.position.set(fx, 0, fz);
      sun.position.set(fx + lightDir.x * 250, lightDir.y * 250, fz + lightDir.z * 250);
      waterNormal.offset.set(t * 0.012, t * 0.02);
      skyMat.uniforms.time.value = t;
    },
  };
}
