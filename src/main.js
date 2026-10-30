// Entry point: sets up rendering, builds the world, and runs the game loop
// and the game states (menu, playing, paused, map, blackout).
import * as THREE from 'three';
import { buildWorld, STREETS_NS, STREETS_EW } from './world.js';
import { buildEnvironment } from './sky.js';
import { setMaxAnisotropy } from './textures.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { CameraRig } from './camera.js';
import { VehicleManager } from './vehicles.js';
import { Minimap } from './minimap.js';
import { CashPickups, VendingMachines, DRINK_PRICE, DRINK_HEAL } from './interactables.js';
import { UI } from './ui.js';
import { Police } from './police.js';
import { Missions } from './missions.js';
import { MISSIONS } from './missionData.js';
import { gpsRoute } from './roads.js';
import { Traffic } from './traffic.js';
import { Pedestrians } from './pedestrians.js';
import { Audio } from './audio.js';
import { Effects } from './effects.js';
import { setVehicleNight } from './vehicles.js';
import { Shops } from './shop.js';
import { loadSettings, saveSettings, loadProgress, saveProgress, clearProgress, hasProgress, DEFAULT_PROGRESS } from './save.js';
import { ROAD_LINES, ROAD_HALF, CITY_NAME } from './config.js';

window.__ctaStarted = true;

const QUALITY = {
  low: { pixelRatio: 0.75, shadows: false, shadowSize: 1024, antialias: false },
  medium: { pixelRatio: 1, shadows: true, shadowSize: 1024, antialias: false },
  high: { pixelRatio: 1.5, shadows: true, shadowSize: 2048, antialias: true },
};

const VEHICLE_STEP = 1 / 120;
const AUTOSAVE_SECONDS = 20;

class Game {
  constructor() {
    this.ui = new UI();
    this.canvas = document.getElementById('game');
    this.state = 'loading';
    this.settings = loadSettings();
    this.cash = 0;
    this.stats = { ...DEFAULT_PROGRESS.stats };
    this.transition = null;
    this.time = 0;
    this.saveTimer = 0;
    this.areaTimer = 0;
    this.area = '';
    this.fps = 60;
    this.mapFrom = 'playing';
    this.exitWarned = 0;
    this.pausedAt = 0;
    this.waypoint = null; // { x, z } set on the full-screen map
    this.nav = null; // what the GPS is currently guiding to
    this.navT = 0;
    this._pp = new THREE.Vector3();
    this.clock = 9; // hours
    this.audio = new Audio();
    this.crashSoundT = 0;
    this.lastStep = 0;
  }

  async init() {
    const q = QUALITY[this.settings.quality] || QUALITY.medium;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: q.antialias, powerPreference: 'high-performance' });
    } catch (e) {
      window.__ctaFail('WebGL is not available. Turn on hardware acceleration in your browser settings, or try another browser.');
      return;
    }
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    setMaxAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.3, 1500);
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.ui.setLoading(0.02, 'Mixing the sky');
    this.env = buildEnvironment(this.scene, r);
    this.world = await buildWorld(this.scene, (p, t) => this.ui.setLoading(p, t));

    this.ui.setLoading(0.78, 'Parking cars');
    await new Promise((res) => requestAnimationFrame(res));
    this.vehicles = new VehicleManager(this.scene, this.world);
    const placed = [];
    for (const s of this.world.spots.parking) {
      if (placed.some((p) => Math.hypot(p.x - s.x, p.z - s.z) < 6)) continue;
      placed.push(s);
      const v = this.vehicles.spawn(s.type, s.x, s.z, s.heading, s.color);
      if (s.starter) this.starter = v;
    }

    this.ui.setLoading(0.86, 'Dressing the locals');
    this.player = new Player(this.scene);
    this.player.setVisible(false);
    this.pickups = new CashPickups(this.scene, this.world.spots.pickups);
    this.vending = new VendingMachines(this.scene, this.world.spots.vending, this.world.heightAt);
    this.vending.addColliders(this.world.colliders);

    this.ui.setLoading(0.92, 'Drawing the map');
    this.minimap = new Minimap(this.world, document.getElementById('minimap'), document.getElementById('bigmap-canvas'));

    this.input = new Input(this.canvas);
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.input.dragging) this.pause();
    };
    this.rig = new CameraRig(this.camera);
    this.police = new Police(this);
    this.police.onLevelChange = (level, before, reason) => this.onWantedChange(level, before, reason);
    this.missions = new Missions(this, MISSIONS);
    this.shops = new Shops(this);
    this.traffic = new Traffic(this);
    this.peds = new Pedestrians(this);
    this.effects = new Effects(this.scene);
    // one headlight beam for the player's car; always in the scene so turning it
    // on at dusk does not force every material to recompile
    this.headlight = new THREE.SpotLight('#fff3d6', 0, 60, 0.5, 0.6, 1.2);
    this.scene.add(this.headlight, this.headlight.target);
    this.bindBigMap();

    this.ui.bindSettings(this.settings, (s) => this.applySettings(s));
    this.applySettings(this.settings);
    this.wireUi();

    this.ui.setLoading(0.97, 'Warming up shaders');
    await new Promise((res) => requestAnimationFrame(res));
    this.renderer.compile(this.scene, this.camera);

    this.ui.setLoading(1, 'Ready');
    window.__ctaReady = true;
    this.toMenu();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  resize() {
    if (!this.renderer) return;
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    if (this.effects) this.effects.setViewport(this.renderer.domElement.height, this.settings.fov);
    if (this.state === 'map') this.drawBigMap();
  }

  applySettings(s) {
    const q = QUALITY[s.quality] || QUALITY.medium;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    if (this.renderer.shadowMap.enabled !== q.shadows) {
      this.renderer.shadowMap.enabled = q.shadows;
      this.scene.traverse((o) => {
        if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true));
      });
    }
    this.env.setQuality({ shadows: q.shadows, shadowSize: q.shadowSize, drawDistance: s.drawDistance });
    this.camera.far = s.drawDistance + 400;
    this.camera.updateProjectionMatrix();
    this.rig.baseFov = s.fov;
    this.rig.sensitivity = s.sensitivity;
    this.rig.invertY = s.invertY;
    this.rig.autoCenter = s.autoCenter;
    if (!s.showFps) this.ui.setFps(false);
    this.traffic.setDensity(s.traffic);
    this.peds.setDensity(s.traffic);
    this.audio.setVolume(s.volume);
    this.effects.setViewport(this.renderer.domElement.height, s.fov);
    saveSettings(s);
  }

  wireUi() {
    const ui = this.ui;
    ui.on('play', () => {
      this.audio.unlock();
      clearProgress();
      this.startGame(loadProgress(), true);
    });
    ui.on('continue', () => {
      this.audio.unlock();
      this.startGame(loadProgress(), false);
    });
    ui.on('resume', () => this.resume());
    ui.on('map', () => this.openMap('paused'));
    ui.on('quit', () => {
      this.saveNow();
      this.toMenu();
    });
    ui.on('reset', () => {
      clearProgress();
      ui.setContinueAvailable(false);
      if (this.state === 'paused') {
        this.cash = DEFAULT_PROGRESS.cash;
        this.player.health = 100;
        if (this.missions.active) this.missions.cleanup();
        this.missions.load([]);
        this.shops.load([]);
      }
      ui.notify('Progress reset', 'Cash, missions and position were cleared.', 'warn');
    });
    ui.on('missions', () => this.showMissions());
    ui.on('shopAction', (run) => {
      run();
      const data = this.shops.open(this.shopAt);
      if (data) ui.renderShop(data, this.cash);
    });
    ui.on('closeShop', () => this.resume());
    ui.on('abandon', () => {
      this.missions.abandon();
      this.resume();
    });
    ui.on('startMission', (id) => {
      const def = MISSIONS.find((d) => d.id === id);
      this.resume();
      if (def) this.missions.start(def);
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        if (this.state === 'playing') this.pause();
        else if (this.state === 'map') this.closeMap();
        else if (this.state === 'paused') {
          // the Esc that released the mouse already paused the game: ignore its echo
          if (performance.now() - this.pausedAt < 400) return;
          if (ui.current === 'pause' || ui.current === 'shop') this.resume();
          else ui.show('pause');
        } else if (this.state === 'menu' && ui.current !== 'menu') ui.show('menu');
      } else if (e.code === 'KeyM') {
        if (this.state === 'map') this.closeMap();
      }
    });
  }

  // ---------------------------------------------------------------- states

  toMenu() {
    if (this.player.vehicle) this.leaveVehicleInstant();
    if (this.missions.active) this.missions.cleanup();
    this.police.reset();
    this.traffic.clear();
    this.peds.clear();
    this.audio.setActive(false);
    this.waypoint = null;
    this.state = 'menu';
    this.input.enabled = false;
    this.input.releaseLock();
    this.player.setVisible(false);
    this.ui.showHud(false);
    this.ui.setContinueAvailable(hasProgress());
    this.ui.show('menu');
  }

  startGame(progress, fresh) {
    const w = this.world;
    this.cash = progress.cash;
    this.player.health = progress.health > 0 ? progress.health : 100;
    this.stats = { ...progress.stats };
    this.missions.load(progress.missions);
    this.clock = progress.clock ?? 9;
    for (const v of [...this.vehicles.list]) if (v.ownedId) this.vehicles.remove(v);
    this.shops.load(progress.garage);
    this.traffic.clear();
    this.peds.clear();
    this.audio.setActive(true);
    this.missions.playTime = 0;
    this.missions.autoDone.clear();
    this.police.reset();
    this.waypoint = null;
    let x = w.spawn.x;
    let z = w.spawn.z;
    let heading = w.spawn.heading;
    if (!fresh && progress.x !== null && this.isFreeSpot(progress.x, progress.z)) {
      x = progress.x;
      z = progress.z;
      heading = progress.heading || 0;
    }
    this.player.setPosition(x, w.heightAt(x, z), z, heading);
    this.player.setVisible(true);
    this.rig.snap(new THREE.Vector3(x, w.heightAt(x, z) + 1.55, z), heading);
    this.rig.pitch = 0.22;
    this.area = '';
    this.state = 'playing';
    this.ui.hideScreens();
    this.ui.showHud(true);
    this.input.reset();
    this.input.enabled = true;
    this.input.requestLock();
    this.saveTimer = 0;
    if (fresh) {
      this.ui.notify(`Welcome to ${CITY_NAME}`, 'Walk up to a car and press E to drive. Press M for the map.');
      setTimeout(() => this.state === 'playing' && this.ui.notify('Tip', 'Cash bundles are hidden around the city. Grab them on foot or in a car.', 'money'), 5200);
    } else {
      this.ui.notify('Welcome back', 'Your cash and position were restored.');
    }
    this.saveNow();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.pausedAt = performance.now();
    this.input.enabled = false;
    this.input.reset();
    this.input.releaseLock();
    this.ui.show('pause');
    this.audio.setActive(false);
    this.saveNow();
  }

  resume() {
    this.state = 'playing';
    this.audio.setActive(true);
    this.ui.hideScreens();
    this.input.reset();
    this.input.enabled = true;
    this.input.requestLock();
  }

  openMap(from) {
    this.mapFrom = from;
    this.state = 'map';
    this.input.enabled = false;
    this.input.reset();
    this.input.releaseLock();
    this.ui.show('bigmap');
    this.audio.setActive(false);
    this.drawBigMap();
  }

  closeMap() {
    if (this.mapFrom === 'paused') {
      this.state = 'paused';
      this.ui.show('pause');
    } else this.resume();
  }

  drawBigMap() {
    const p = this.player.vehicle || this.player;
    const x = this.player.vehicle ? p.x : p.pos.x;
    const z = this.player.vehicle ? p.z : p.pos.z;
    const h = this.player.vehicle ? p.heading : p.facing;
    // wait one frame so the canvas has its final CSS size
    const navs = [];
    const m = this.missions.navTarget;
    if (m) navs.push({ ...m, color: '#ffd23f', route: gpsRoute(x, z, m.x, m.z) });
    if (this.waypoint) navs.push({ ...this.waypoint, color: '#c084fc', route: m ? null : gpsRoute(x, z, this.waypoint.x, this.waypoint.z) });
    requestAnimationFrame(() => this.minimap.drawBig(x, z, h, STREETS_NS, STREETS_EW, ROAD_LINES, navs));
  }

  saveNow() {
    if (this.state === 'menu' || this.state === 'loading') return;
    const v = this.player.vehicle;
    saveProgress({
      cash: this.cash,
      health: this.player.health,
      x: v ? v.x : this.player.pos.x,
      z: v ? v.z : this.player.pos.z,
      heading: v ? v.heading : this.player.facing,
      stats: this.stats,
      missions: this.missions.serialize(),
      clock: this.clock,
      garage: this.shops.serialize(),
    });
  }

  isFreeSpot(x, z, ignore) {
    const p = { x, z };
    this.world.colliders.resolveCircle(p, 0.45, this.world.heightAt(x, z) + 0.2, 1.6);
    if (Math.hypot(p.x - x, p.z - z) > 0.01) return false;
    return this.vehicles.isFree(x, z, 0.45, ignore);
  }

  // ---------------------------------------------------------------- vehicles

  tryEnter() {
    const v = this.vehicles.nearestEnterable(this.player.pos, 2.6);
    if (!v) return false;
    if (v.speed > 3) {
      this.ui.notify('Too fast', 'Wait for the car to stop first.', 'warn');
      return true;
    }
    this.transition = { type: 'enter', t: 0, v, from: this.player.pos.clone(), door: v.doorPoint(new THREE.Vector3(), 0.55) };
    v.doorTarget = 1;
    return true;
  }

  tryExit() {
    const v = this.player.vehicle;
    const kmh = v.speed * 3.6;
    if (kmh > 25) {
      if (this.time - this.exitWarned > 2) {
        this.ui.notify('Slow down', 'You need to be below 25 km/h to get out.', 'warn');
        this.exitWarned = this.time;
      }
      return;
    }
    // try the driver's side, then the passenger side, then behind and in front
    const s = v.spec;
    const c = Math.cos(v.heading);
    const sn = Math.sin(v.heading);
    const fx = sn;
    const fz = c;
    const local = [
      [-(s.W / 2 + 0.75), v.model.doorZ],
      [s.W / 2 + 0.75, v.model.doorZ],
      [0, -(s.L / 2 + 0.9)],
      [0, s.L / 2 + 0.9],
      [-(s.W / 2 + 0.75), -s.L / 2],
      [s.W / 2 + 0.75, s.L / 2],
    ];
    for (const [lx, lz] of local) {
      const x = v.x + lx * c + lz * fx;
      const z = v.z - lx * sn + lz * fz;
      if (this.isFreeSpot(x, z, v)) {
        this.transition = { type: 'exit', t: 0, v, to: new THREE.Vector3(x, this.world.heightAt(x, z), z) };
        v.doorTarget = 1;
        return;
      }
    }
    this.ui.notify('Blocked', 'There is no room to get out here.', 'warn');
  }

  updateTransition(dt) {
    const tr = this.transition;
    tr.t += dt;
    const p = this.player;
    const v = tr.v;
    if (tr.type === 'enter') {
      if (tr.t < 0.3) {
        const k = tr.t / 0.3;
        p.pos.lerpVectors(tr.from, tr.door, k);
        p.pos.y = this.world.heightAt(p.pos.x, p.pos.z);
        p.facing = Math.atan2(v.x - p.pos.x, v.z - p.pos.z);
        p.mesh.position.copy(p.pos);
        p.mesh.rotation.y = p.facing;
        p.animate(dt, 2.5);
      } else if (!p.vehicle) {
        p.vehicle = v;
        v.driver = p;
        v.asleep = false;
        p.setVisible(false);
        if (v.type === 'police') {
          this.police.release(v);
          this.police.crime('Stealing a police car', 2);
        } else if (this.traffic.release(v)) {
          // the driver jumps out and runs
          const d = v.doorPoint(new THREE.Vector3(), 1.4);
          this.peds.spawnFleeing(d.x, d.z, v.x, v.z);
          this.police.crime('Carjacking', 1);
        }
        this.audio.play('door');
        v.ctrl = null;
        this.ui.notify(v.name, VEHICLE_HINT, '');
      }
      if (tr.t > 0.45) v.doorTarget = 0;
      if (tr.t > 0.7) this.transition = null;
    } else {
      if (tr.t > 0.22 && p.vehicle) {
        p.vehicle = null;
        v.driver = null;
        p.setPosition(tr.to.x, tr.to.y, tr.to.z, v.heading);
        p.setVisible(true);
      }
      if (tr.t > 0.5) v.doorTarget = 0;
      if (tr.t > 0.7) {
        this.transition = null;
        this.rig.pitch = Math.max(this.rig.pitch, 0.2);
      }
    }
  }

  leaveVehicleInstant() {
    const v = this.player.vehicle;
    if (!v) return;
    v.driver = null;
    v.doorTarget = 0;
    this.player.vehicle = null;
    this.transition = null;
  }

  // ---------------------------------------------------------------- frame

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.fps = this.fps * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;

    if (this.state === 'playing' || this.state === 'blackout') this.updatePlaying(dt, now);
    else if (this.state === 'menu') this.updateMenu(dt);
    // paused / map: the world is frozen but keeps rendering behind the menus

    this.updateTimeOfDay(dt);
    this.world.update(dt, this.time);
    this.effects.update(this.state === 'playing' || this.state === 'menu' || this.state === 'blackout' ? dt : 0);
    const focus = this.state === 'menu' ? MENU_FOCUS : this.player.vehicle ? this.player.vehicle.model.root.position : this.player.pos;
    this.env.update(dt, this.time, this.camera, focus);
    this.renderer.render(this.scene, this.camera);
    if (this.settings.showFps && this.state !== 'menu') this.ui.setFps(true, this.fps);
    this.input.endFrame();
  }

  updateMenu(dt) {
    const a = this.time * 0.04 + 0.6;
    const r = 300;
    this.camera.position.set(Math.sin(a) * r, 95 + Math.sin(this.time * 0.1) * 15, Math.cos(a) * r + 40);
    this.camera.lookAt(0, 30, 40);
    if (this.camera.fov !== this.settings.fov) {
      this.camera.fov = this.settings.fov;
      this.camera.updateProjectionMatrix();
    }
    this.vehicles.update(dt, null, null);
    this.vehicles.hits.length = 0;
  }

  updatePlaying(dt, now) {
    const input = this.input;
    const p = this.player;
    const w = this.world;
    const live = this.state === 'playing';

    const [mdx, mdy] = input.consumeMouse();
    if (live) this.rig.look(mdx, mdy, now);

    if (live && input.hit('KeyM')) {
      this.openMap('playing');
      return;
    }

    // ---- simulation
    let ctrl = null;
    const v = p.vehicle;
    if (v && live && !this.transition) {
      ctrl = {
        throttle: input.down('KeyW') || input.down('ArrowUp') ? 1 : 0,
        brake: input.down('KeyS') || input.down('ArrowDown') ? 1 : 0,
        steer: (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0) - (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0),
        handbrake: input.down('Space'),
      };
    }
    const steps = Math.max(1, Math.ceil(dt / VEHICLE_STEP));
    let impact = 0;
    for (let i = 0; i < steps; i++) impact = Math.max(impact, this.vehicles.update(dt / steps, v, ctrl));

    if (this.transition) this.updateTransition(dt);
    else if (v) {
      p.pos.set(v.x, v.y, v.z);
      this.stats.distanceDriven += v.speed * dt;
      if (live && input.hit('KeyE')) this.tryExit();
      if (live && input.hit('KeyF')) this.useShop();
      if (live && input.hit('KeyC')) {
        this.rig.yaw = v.heading;
        this.rig.pitch = 0.18;
        this.rig.lastLook = 0;
      }
    } else if (live) {
      p.update(dt, input, this.rig.yaw, w, (pos, r) => this.vehicles.pushOut(pos, r));
      if (input.hit('KeyE')) this.tryEnter();
      if (input.hit('KeyF') && !this.useShop()) this.useNearby();
    }

    // crash damage while driving
    if (p.vehicle && impact > 9 && live) {
      const dmg = (impact - 9) * 2.2;
      p.health -= dmg;
      this.rig.shake = Math.min(0.5, impact * 0.025);
      if (p.health <= 0) this.blackout();
    } else if (p.vehicle && impact > 4) {
      this.rig.shake = Math.min(0.3, impact * 0.02);
    }

    // ---- crimes from collisions
    if (live) this.checkHits();

    // ---- police and missions
    if (live) {
      this.police.update(dt);
      this.missions.update(dt);
      this.traffic.update(dt);
      this.shops.update(this.time);
      this.peds.update(dt);
    }
    this.updateEffectsAndSound(dt, impact, ctrl, live);

    // ---- pickups and prompts
    const got = this.pickups.update(dt, this.time, p.pos, !!p.vehicle, w.heightAt);
    if (got > 0) {
      this.cash += got;
      this.stats.pickups++;
      this.ui.notify(`+$${got}`, 'Cash picked up', 'money');
      this.audio.play('cash');
    }
    this.updatePrompt();

    // ---- camera
    const cv = p.vehicle;
    if (cv) {
      const root = cv.model.root.position;
      this.rig.update(dt, now, new THREE.Vector3(root.x, root.y + cv.spec.H + 0.5, root.z), w.colliders, {
        dist: cv.spec.L * 1.15 + 3.6, followYaw: cv.heading, speed: cv.speed, vehicle: true,
      });
    } else {
      this.rig.update(dt, now, new THREE.Vector3(p.pos.x, p.pos.y + 1.55, p.pos.z), w.colliders, {
        dist: 4.6, speed: 0, extraRay: (...a) => this.vehicles.raycast(...a),
      });
    }

    // ---- HUD
    this.ui.setCash(this.cash);
    this.ui.setHealth(p.health);
    if (cv) this.ui.setSpeed(Math.abs(cv.forwardSpeed) * 3.6, cv.name, cv.spec.maxSpeed * 3.6);
    else this.ui.setSpeed(null);
    const heading = cv ? cv.heading : p.facing;
    this.ui.setWanted(this.police.level, this.police.searching);
    this.updateNav(dt);
    const blips = this.police.units.map((u) => ({ x: u.v.x, z: u.v.z, color: Math.floor(this.time * 4) % 2 ? '#ef4444' : '#3b82f6' }));
    this.minimap.draw(p.pos.x, p.pos.z, heading, this.rig.yaw, this.nav, blips);
    this.ui.setLookHint(live && !input.locked && now - input.lastMouseMove > 4000);

    this.areaTimer -= dt;
    if (this.areaTimer <= 0) {
      this.areaTimer = 0.5;
      const area = w.areaAt(p.pos.x, p.pos.z);
      if (area !== this.area) {
        this.area = area;
        this.ui.showArea(area);
      }
      this.ui.setStreet(streetAt(p.pos.x, p.pos.z) || area);
    }

    this.saveTimer += dt;
    if (live && this.saveTimer > AUTOSAVE_SECONDS) {
      this.saveTimer = 0;
      this.saveNow();
    }
  }

  updatePrompt() {
    const p = this.player;
    if (this.state !== 'playing' || this.transition) return this.ui.setPrompt(null);
    const shop = this.shops.nearby();
    if (shop) return this.ui.setPrompt(this.shops.prompt(shop));
    if (p.vehicle) return this.ui.setPrompt(null);
    const v = this.vehicles.nearestEnterable(p.pos, 2.6);
    if (v) return this.ui.setPrompt(`<kbd>E</kbd> Enter ${v.name}`);
    const m = this.vending.nearest(p.pos);
    if (m) return this.ui.setPrompt(`<kbd>F</kbd> Buy a Sunset Cola ($${DRINK_PRICE}) · restores health`);
    this.ui.setPrompt(null);
  }

  // Opens the shop the player is standing in. Returns false when there is none.
  useShop() {
    const m = this.shops.nearby();
    if (!m) return false;
    const v = this.player.vehicle;
    if (v && v.speed > 2) {
      this.ui.notify('Stop first', 'Come to a stop inside the bay.', 'warn');
      return true;
    }
    this.shopAt = m;
    const data = this.shops.open(m);
    if (!data) return true; // the garage stored the car straight away
    this.state = 'paused';
    this.pausedAt = performance.now();
    this.input.enabled = false;
    this.input.reset();
    this.input.releaseLock();
    this.audio.setActive(false);
    this.ui.renderShop(data, this.cash);
    this.ui.show('shop');
    return true;
  }

  useNearby() {
    const m = this.vending.nearest(this.player.pos);
    if (!m) return;
    if (this.cash < DRINK_PRICE) {
      this.ui.notify('Not enough cash', `A drink costs $${DRINK_PRICE}.`, 'warn');
    } else if (this.player.health >= 100) {
      this.ui.notify('Not thirsty', 'Your health is already full.', '');
    } else {
      this.cash -= DRINK_PRICE;
      this.player.health = Math.min(100, this.player.health + DRINK_HEAL);
      this.ui.notify('Sunset Cola', `+${DRINK_HEAL} health. Taste the coast.`, 'money');
    }
  }

  blackout() {
    this.state = 'blackout';
    this.input.enabled = false;
    this.input.reset();
    this.ui.blackout(true);
    this.missions.fail('You blacked out');
    this.police.reset();
    setTimeout(() => {
      this.leaveVehicleInstant();
      const r = this.world.respawn;
      this.player.setPosition(r.x, this.world.heightAt(r.x, r.z), r.z, r.heading);
      this.player.setVisible(true);
      this.player.health = 100;
      const fee = Math.min(this.cash, 100);
      this.cash -= fee;
      this.rig.snap(new THREE.Vector3(r.x, 1.7, r.z), r.heading);
      this.ui.blackout(false);
      this.state = 'playing';
      this.input.enabled = true;
      this.ui.notify('Hospital bill', `You paid $${fee} for treatment.`, 'warn');
      this.saveNow();
    }, 2600);
  }

  // Time of day: the clock runs at one game hour per real minute while playing.
  updateTimeOfDay(dt) {
    if (this.state === 'playing') this.clock = (this.clock + dt / 60) % 24;
    const mode = this.settings.timeMode;
    const hours = this.state === 'menu' ? 17.6 : mode === 'day' ? 13 : mode === 'night' ? 22.5 : this.clock;
    if (hours === this.shownHours) return;
    this.shownHours = hours;
    this.env.setTime(hours);
    const k = this.env.night;
    this.world.setNight(k);
    setVehicleNight(k);
    this.effects.setTint(k);
    this.nightK = k;
  }

  updateEffectsAndSound(dt, impact, ctrl, live) {
    const p = this.player;
    const pv = p.vehicle;
    const pos = this.playerPosition();
    // tyre smoke from any sliding car nearby
    for (const v of this.vehicles.list) {
      if (v.asleep || v.speed < 2) continue;
      if (Math.abs(v.x - pos.x) > 90 || Math.abs(v.z - pos.z) > 90) continue;
      this.effects.tyreSmoke(v, dt);
    }
    this.vehicles.hits.length = 0;
    // headlight beam
    const hl = this.headlight;
    if (pv && this.nightK > 0.3) {
      const f = Math.sin(pv.heading);
      const c = Math.cos(pv.heading);
      hl.intensity = 60 * this.nightK;
      hl.position.set(pv.x + f * (pv.spec.L / 2), pv.y + 0.8, pv.z + c * (pv.spec.L / 2));
      hl.target.position.set(pv.x + f * 25, pv.y - 1, pv.z + c * 25);
    } else hl.intensity = 0;

    // crash sounds
    this.crashSoundT -= dt;
    if (pv && impact > 3 && this.crashSoundT <= 0) {
      this.crashSoundT = 0.25;
      this.audio.play('crash', Math.min(1, impact / 15));
      if (impact > 6) this.effects.crash(pv.x, pv.y, pv.z, impact);
    }
    // footsteps
    if (!pv && p.stepCount !== this.lastStep) {
      this.lastStep = p.stepCount;
      this.audio.play('step', p.runBlend > 0.5 ? 1.4 : 1);
    }
    // nearest siren
    let siren = 0;
    for (const u of this.police.units) {
      if (!u.v.siren) continue;
      const d = Math.hypot(u.v.x - pos.x, u.v.z - pos.z);
      siren = Math.max(siren, 1 - Math.min(1, d / 150));
    }
    const horn = live && !!pv && this.input.down('KeyH');
    if (horn && !this.horning) {
      // a horn blast makes nearby pedestrians jump out of the way
      for (const q of this.peds.list) if (Math.hypot(q.pos.x - pos.x, q.pos.z - pos.z) < 12) this.peds.flee(q, pos.x, pos.z, 2);
    }
    this.horning = horn;
    this.audio.update(this.time, {
      car: pv ? { speed: pv.forwardSpeed, maxSpeed: pv.spec.maxSpeed, throttle: ctrl ? ctrl.throttle : 0, slip: pv.slip } : null,
      siren,
      beach: Math.max(0, Math.min(1, (pos.z - 280) / 80)),
      horn,
    });
  }

  // Busted: taken to the police station and fined.
  arrest(level) {
    if (this.state !== 'playing') return;
    this.state = 'blackout';
    this.input.enabled = false;
    this.input.reset();
    const fine = Math.min(this.cash, 150 * level);
    this.audio.play('busted');
    this.ui.blackout(true, 'BUSTED', `Booked at the Police Station. The fine was $${fine}.`);
    this.missions.fail('You were busted');
    this.police.reset();
    setTimeout(() => {
      this.leaveVehicleInstant();
      const r = this.world.policeRespawn;
      this.player.setPosition(r.x, this.world.heightAt(r.x, r.z), r.z, r.heading);
      this.player.setVisible(true);
      this.cash -= fine;
      this.rig.snap(new THREE.Vector3(r.x, this.world.heightAt(r.x, r.z) + 1.55, r.z), r.heading);
      this.ui.blackout(false);
      this.state = 'playing';
      this.input.enabled = true;
      this.ui.notify('Released', `You paid a $${fine} fine.`, 'warn');
      this.saveNow();
    }, 2600);
  }

  // Where the player is: their car if they are driving.
  playerPosition() {
    const v = this.player.vehicle;
    if (v) return this._pp.set(v.x, v.y, v.z);
    return this._pp.copy(this.player.pos);
  }

  onWantedChange(level, before, reason) {
    if (level > before) {
      this.audio.play('wanted');
      this.ui.notify(`Wanted: ${'★'.repeat(level)}`, reason || 'The police are after you.', 'warn');
    } else if (level === 0 && reason === 'lost') {
      this.ui.notify('You lost them', 'The police have stopped looking for you.', 'money');
    }
  }

  // Car-to-car hits the player caused this frame
  checkHits() {
    const pv = this.player.vehicle;
    for (const h of this.vehicles.hits) {
      if (h.impact > 5) {
        this.traffic.shock(h.a, h.impact);
        this.traffic.shock(h.b, h.impact);
        const near = Math.hypot(h.a.x - this._pp.x, h.a.z - this._pp.z) < 120;
        if (near) this.effects.crash((h.a.x + h.b.x) / 2, h.a.y, (h.a.z + h.b.z) / 2, h.impact);
      }
    }
    if (!pv) return;
    for (const h of this.vehicles.hits) {
      const other = h.a === pv ? h.b : h.b === pv ? h.a : null;
      if (!other) continue;
      if (other.role === 'police' && h.impact > 2) this.police.crime('Ramming a police car', 2);
      else if (other.role === 'traffic' && h.impact > 9) this.police.crime('Reckless driving', 1);
    }
  }

  // GPS: mission objectives win over the player's own waypoint
  updateNav(dt) {
    const pos = this.playerPosition();
    if (this.waypoint && Math.hypot(pos.x - this.waypoint.x, pos.z - this.waypoint.z) < 12) {
      this.waypoint = null;
      this.ui.notify('Arrived', 'Waypoint reached.', '');
    }
    const m = this.missions.navTarget;
    const t = m ? { x: m.x, z: m.z, color: '#ffd23f' } : this.waypoint ? { ...this.waypoint, color: '#c084fc' } : null;
    if (!t) {
      this.nav = null;
      return;
    }
    this.navT -= dt;
    const moved = !this.nav || Math.hypot(this.nav.x - t.x, this.nav.z - t.z) > 2;
    if (moved || this.navT <= 0) {
      this.navT = 1;
      this.nav = { ...t, route: gpsRoute(pos.x, pos.z, t.x, t.z) };
    } else if (this.nav.route) {
      this.nav.route[0] = [pos.x, pos.z];
    }
  }

  bindBigMap() {
    const c = document.getElementById('bigmap-canvas');
    c.addEventListener('click', (e) => {
      if (this.state !== 'map') return;
      const r = c.getBoundingClientRect();
      const w = this.minimap.bigToWorld(e.clientX - r.left, e.clientY - r.top);
      if (!w || Math.abs(w.x) > 340 || w.z < -340 || w.z > 345) return;
      this.waypoint = w;
      this.drawBigMap();
    });
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.state !== 'map') return;
      this.waypoint = null;
      this.drawBigMap();
    });
  }

  showMissions() {
    const ms = this.missions;
    const list = MISSIONS.map((d) => {
      const done = ms.completed.has(d.id);
      const active = ms.active?.def === d;
      const avail = ms.isAvailable(d);
      const status = active ? 'active' : done ? 'done' : avail ? 'available' : 'locked';
      const req = (d.requires || []).map((id) => MISSIONS.find((x) => x.id === id)?.title).join(', ');
      return {
        id: d.id,
        title: d.title,
        summary: d.summary,
        where: d.start && !done ? `Start: ${d.where}.` : '',
        lockedText: `Finish ${req} first.`,
        status,
        canReplay: !ms.active && avail && (done || !d.start),
      };
    });
    this.ui.renderMissions(list, !!ms.active);
    this.ui.show('missions');
  }
}

const MENU_FOCUS = new THREE.Vector3(0, 0, 40);
const VEHICLE_HINT = 'W/S drive and brake, A/D steer, Space handbrake, H horn, E to get out.';

// Name of the street the point is on (or null)
function streetAt(x, z) {
  let best = null;
  let bd = ROAD_HALF + 2;
  ROAD_LINES.forEach((c, i) => {
    const dx = Math.abs(x - c);
    if (dx < bd && Math.abs(z) <= ROAD_LINES[ROAD_LINES.length - 1] + ROAD_HALF) {
      bd = dx;
      best = STREETS_NS[i];
    }
    const dz = Math.abs(z - c);
    if (dz < bd && Math.abs(x) <= ROAD_LINES[ROAD_LINES.length - 1] + ROAD_HALF) {
      bd = dz;
      best = STREETS_EW[i];
    }
  });
  return best;
}

const game = new Game();
window.__game = game; // handy for debugging in the browser console
game.init().catch((e) => {
  console.error(e);
  window.__ctaFail(`The game failed to start: ${e.message}`);
});
