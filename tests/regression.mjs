import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Vehicle, VehicleManager, VEHICLE_TYPES } from '../src/vehicles.js';
import { StaticColliders } from '../src/collision.js';
import { Missions } from '../src/missions.js';
import { CameraRig } from '../src/camera.js';
import { Weather } from '../src/weather.js';
import { GroundShadows } from '../src/groundShadows.js';
import { rampHeight } from '../src/ramps.js';
import { Player } from '../src/player.js';
import { loadSettings, loadProgress } from '../src/save.js';

// Canvas drawing is stubbed only for texture creation. Geometry, transforms,
// collisions, vehicle models, player animation and game logic run unchanged.
const context = new Proxy({
  measureText: text => ({ width: text.length * 10 }),
  createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: () => ({ addColorStop() {} }),
  getImageData: (x, y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
  createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
}, { get: (target, key) => key in target ? target[key] : () => {} });
globalThis.document = { createElement: () => ({ getContext: () => context, width: 1, height: 1 }) };
globalThis.requestAnimationFrame = callback => setImmediate(callback);

const scene = new THREE.Scene();
const flat = { heightAt: () => 0, colliders: new StaticColliders(), wetness: 0 };
const forward = { throttle: 1, brake: 0, steer: 0, handbrake: false };
const reverse = { ...forward, throttle: 0, brake: 1 };
function createCar(type = 'sedan') {
  const car = new Vehicle(type, '#b02121', scene);
  car.setPose(0, 0, 0);
  return car;
}
function simulate(fps, type = 'sedan') {
  const manager = new VehicleManager(scene, flat);
  const car = manager.spawn(type, 0, 0, 0);
  for (let i = 0; i < fps * 10; i++) manager.update(1 / fps, car, forward);
  return car;
}
const reference = simulate(60);
for (const fps of [30, 75, 120, 144]) {
  assert.ok(Math.abs(simulate(fps).z - reference.z) < 1e-7, `frame-rate independence at ${fps} FPS`);
}
for (const type of Object.keys(VEHICLE_TYPES)) {
  const car = simulate(30, type);
  assert.ok(car.speed > 0 && car.speed < car.spec.maxSpeed, type);
  assert.ok(Number.isFinite(car.model.root.position.y));
}
const wreck = createCar();
wreck.health = 0;
for (let i = 0; i < 120; i++) wreck.step(1 / 120, reverse, flat);
assert.equal(wreck.speed, 0, 'wreck cannot reverse');
const reversing = createCar();
for (let i = 0; i < 20; i++) reversing.step(1 / 120, reverse, flat);
assert.equal(reversing.speed, 0, 'reverse delay');
for (let i = 0; i < 100; i++) reversing.step(1 / 120, reverse, flat);
assert.ok(reversing.forwardSpeed < 0);
const jumper = createCar();
jumper.setPose(-150, 350, 0, 0.13);
jumper.vz = 18;
const rampWorld = { ...flat, heightAt: (x, z) => rampHeight(x, z, 0.13) };
let airborne = false, landed = false, highest = 0;
for (let i = 0; i < 1200; i++) {
  jumper.step(1 / 120, forward, rampWorld);
  airborne ||= !jumper.grounded;
  landed ||= airborne && jumper.grounded && jumper.z > 372;
  highest = Math.max(highest, jumper.y);
}
assert.ok(airborne && landed && highest > 1, 'ramp takeoff and landing');
const rolled = createCar();
rolled.hit(40, 0, 0, 1, 0);
for (let i = 0; i < 300; i++) rolled.step(1 / 120, null, flat);
assert.ok(Number.isFinite(rolled.chassisRoll));
rolled.setPose(0, 0, 0);
assert.equal(rolled.chassisRoll, 0, 'recovery resets orientation');
const manager = new VehicleManager(scene, flat);
const caughtUp = manager.spawn('sedan', 0, 0, 0);
manager.update(20, caughtUp, forward);
assert.ok(caughtUp.z < 1 && manager.accumulator < 1 / 120, 'bounded catch-up');
const a = manager.spawn('sedan', 10, 0, 0);
const b = manager.spawn('van', 11.7, 0, 0);
a.vx = 12;
const energy = car => car.spec.mass * (car.speed ** 2 + (car.spec.L ** 2 / 12 + 0.3) * car.angVel ** 2) / 2;
const beforeEnergy = energy(a) + energy(b);
manager.collidePair(a, b);
assert.ok(energy(a) + energy(b) <= beforeEnergy + 0.01, 'collision does not generate energy');

const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);
const rig = new CameraRig(camera);
for (let i = 0; i < 240; i++) rig.update(1 / 60, 5000, new THREE.Vector3(), null, { dist: 8, followYaw: 0, speed: -10, vehicle: true });
assert.ok(Math.abs(Math.abs(rig.yaw) - Math.PI) < 0.01, 'reverse camera');
const weather = new Weather(scene, { ...flat, group: new THREE.Group() });
weather.configure('rain', 'low');
for (let i = 0; i < 600; i++) weather.update(1 / 60, i / 60, camera);
assert.ok(weather.wetness > 0.3 && weather.amount > 0.5);
assert.equal(weather.geometry.drawRange.count, 360);
assert.ok(weather.positions.every(Number.isFinite));
const player = new Player(scene);
player.setPosition(0, 0, 0);
const input = { axis: () => 0, down: () => false, hit: key => key === 'Space' };
player.update(1 / 60, input, 0, flat);
assert.ok(player.pos.y > 0, 'player jumps');
input.hit = () => false;
for (let i = 0; i < 120; i++) player.update(1 / 60, input, 0, flat);
assert.ok(player.grounded && player.pos.y === 0, 'player lands');
const shadows = new GroundShadows(scene);
shadows.update({ camera, vehicles: manager, player, peds: { list: [] }, world: flat });
assert.ok(shadows.mesh.count > 0 && shadows.mesh.count <= 160);

const mission = Object.create(Missions.prototype);
const old = { id: 'old', x: 100, z: 100 };
const unrelated = { id: 'parked', x: 0, z: 0 };
const list = [old, unrelated];
const game = {
  police: { reset() {} }, leaveVehicleInstant() {},
  player: { health: 5, pos: new THREE.Vector3(), setVisible() {} },
  vehicles: {
    list,
    remove(car) { const index = list.indexOf(car); if (index >= 0) list.splice(index, 1); },
    spawn(type, x, z, heading, color) { const car = { type, x, y: 0, z, heading, color }; list.push(car); return car; },
  },
  world: flat, rig: { snap() {} }, ui: { missionTitle() {} }, audio: { play() {} },
};
Object.assign(mission, {
  g: game, playTime: 100, active: null,
  retry: { def: { title: 'First Run' }, vehicles: [old], snap: {
    idx: 2, x: 0, z: 0, heading: 0, health: 80, elapsed: 12, timer: 60, cash: 250,
    cars: { van: { type: 'van', x: 0, z: 0, heading: 0, driven: true, health: 700 } }, cp: 1,
  } },
});
mission.next = () => {};
mission.retryFromCheckpoint();
assert.ok(list.includes(unrelated) && !list.includes(old));
assert.equal(game.player.health, 80);
assert.equal(game.player.vehicle.health, 700);
assert.equal(game.cash, 250);
assert.equal(mission.active.began, 88);
mission.retryFromCheckpoint();
assert.equal(list.length, 2, 'retries do not duplicate cars');
globalThis.localStorage = { getItem: key => key.includes('settings') ? '{"volume":0.4}' : '{"cash":500,"garage":[{"type":"sedan","color":"#fff"}]}' };
assert.equal(loadSettings().weather, 'clear');
assert.equal(loadSettings().volume, 0.4);
assert.equal(loadProgress().garage.length, 1, 'older save remains compatible');
console.log('PASS vehicle models, all nine types, frame rates, reverse, ramps, collisions, recovery, camera, weather, character movement, shadows, checkpoint retries and old saves');

const { buildWorld } = await import('../src/world.js');
const city = await buildWorld(new THREE.Scene(), () => {});
assert.ok(city.colliders.boxes.length > 100);
assert.ok(city.heightAt(-150, 362) > city.heightAt(-150, 354), 'practice ramps are integrated into the actual world');
const cityManager = new VehicleManager(scene, city);
const cityCar = cityManager.spawn('sedan', 0, 0, 0);
for (let i = 0; i < 3600; i++) {
  cityManager.update(1 / 60, cityCar, { ...forward, steer: Math.sin(i / 150) * 0.6, handbrake: i % 300 > 260 });
  assert.ok(Number.isFinite(cityCar.x + cityCar.y + cityCar.z + cityCar.heading));
}
console.log('PASS complete city construction and 60 simulated seconds of driving with real city collisions');

const { Traffic } = await import('../src/traffic.js');
const { Police } = await import('../src/police.js');
const { Pedestrians } = await import('../src/pedestrians.js');
const populationGame = {
  scene, world: city, camera, player, vehicles: cityManager, time: 0,
  playerPosition: () => player.pos,
  ui: { notify() {} }, audio: { play() {} }, arrest() {},
};
player.setPosition(0, 0, 0);
camera.position.set(0, 6, -9);
camera.lookAt(0, 1, 0);
populationGame.peds = new Pedestrians(populationGame);
populationGame.traffic = new Traffic(populationGame);
populationGame.police = new Police(populationGame);
populationGame.police.crime('Test pursuit', 3);
for (let i = 0; i < 1800; i++) {
  populationGame.time += 1 / 60;
  cityManager.update(1 / 60, null, null);
  populationGame.traffic.update(1 / 60);
  populationGame.peds.update(1 / 60);
  populationGame.police.update(1 / 60);
  cityManager.hits.length = 0;
}
assert.ok(populationGame.peds.list.length <= 24);
assert.ok(populationGame.police.roadblocks.length <= 3);
assert.ok(cityManager.list.every(car => Number.isFinite(car.x + car.y + car.z)));
assert.ok(populationGame.peds.list.every(pedestrian => Number.isFinite(pedestrian.pos.x + pedestrian.pos.z)));
console.log('PASS 30 simulated seconds of integrated traffic, pedestrians and police');
