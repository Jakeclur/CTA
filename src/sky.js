// Sky dome, sunlight with shadows that follow the player, fog, reflections and the sea.
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
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(horizonColor, topColor, pow(max(h, 0.0), 0.5));
  col = mix(col, groundColor, smoothstep(0.0, -0.2, h));
  float s = max(dot(d, sunDir), 0.0);
  col += vec3(1.0, 0.8, 0.55) * pow(s, 6.0) * 0.3;
  col += vec3(1.0, 0.95, 0.85) * pow(s, 1200.0) * 6.0;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function buildEnvironment(scene, renderer) {
  const sunDir = new THREE.Vector3(-0.55, 0.62, 0.56).normalize();
  const horizon = new THREE.Color('#cfdbe6');
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color('#3f79c4') },
      horizonColor: { value: horizon },
      groundColor: { value: new THREE.Color('#a9b4bd') },
      sunDir: { value: sunDir },
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
  const env = pmrem.fromScene(envScene, 0.02, 0.1, 500).texture;
  scene.environment = env;
  pmrem.dispose();

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

  return {
    sun,
    setQuality({ shadows, shadowSize, drawDistance }) {
      sun.castShadow = shadows;
      if (sun.shadow.mapSize.x !== shadowSize) {
        sun.shadow.mapSize.set(shadowSize, shadowSize);
        if (sun.shadow.map) {
          sun.shadow.map.dispose();
          sun.shadow.map = null;
        }
      }
      shadowRange = shadowSize >= 2048 ? 110 : 80;
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
      sun.position.set(fx + sunDir.x * 250, sunDir.y * 250, fz + sunDir.z * 250);
      waterNormal.offset.set(t * 0.012, t * 0.02);
    },
  };
}
