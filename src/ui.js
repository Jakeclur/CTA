// DOM user interface: screens (loading, menu, pause, settings, controls, map),
// the HUD and notifications.
import { formatMoney } from './utils.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.screens = ['loading', 'menu', 'pause', 'settings', 'controls', 'bigmap'];
    this.current = 'loading';
    this.returnTo = 'menu';
    this.handlers = {};
    this.hud = $('hud');
    this.cashEl = $('cash');
    this.healthEl = $('health-fill');
    this.promptEl = $('prompt');
    this.speedo = $('speedo');
    this.speedVal = $('speed-value');
    this.speedArc = $('speedo-arc');
    this.vehName = $('vehicle-name');
    this.fpsEl = $('fps');
    this.areaEl = $('area-banner');
    this.streetEl = $('street');
    this.lookHint = $('look-hint');
    this.notes = $('notifications');
    this.lastCash = null;
    this.lastPrompt = null;
    this.areaTimer = null;

    const click = (id, fn) => $(id).addEventListener('click', () => fn());
    click('btn-play', () => this.emit('play'));
    click('btn-continue', () => this.emit('continue'));
    click('btn-settings', () => this.openSettings('menu'));
    click('btn-controls', () => this.openControls('menu'));
    click('btn-resume', () => this.emit('resume'));
    click('btn-map', () => this.emit('map'));
    click('btn-psettings', () => this.openSettings('pause'));
    click('btn-pcontrols', () => this.openControls('pause'));
    click('btn-quit', () => this.emit('quit'));
    click('btn-settings-back', () => this.show(this.returnTo));
    click('btn-controls-back', () => this.show(this.returnTo));
    click('btn-reset', () => {
      if (confirm('Reset your cash and saved position? Settings are kept.')) this.emit('reset');
    });
  }

  on(name, fn) {
    this.handlers[name] = fn;
  }

  emit(name, arg) {
    if (this.handlers[name]) this.handlers[name](arg);
  }

  show(name) {
    this.current = name;
    for (const s of this.screens) $(s).classList.toggle('show', s === name);
    // keyboard users can reach the first button of each screen
    const first = name && $(name)?.querySelector('button');
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 50);
  }

  hideScreens() {
    this.current = null;
    for (const s of this.screens) $(s).classList.remove('show');
  }

  openSettings(from) {
    this.returnTo = from;
    this.show('settings');
  }

  openControls(from) {
    this.returnTo = from;
    this.show('controls');
  }

  setLoading(p, text) {
    $('loadfill').style.width = `${Math.round(p * 100)}%`;
    if (text) $('loadtext').textContent = text;
  }

  setContinueAvailable(v) {
    $('btn-continue').hidden = !v;
    $('btn-play').textContent = v ? 'New game' : 'Play';
    $('btn-play').classList.toggle('primary', !v);
  }

  // ---------------------------------------------------------- settings form
  bindSettings(settings, onChange) {
    const q = $('set-quality');
    const draw = $('set-draw');
    const fov = $('set-fov');
    const sens = $('set-sens');
    const inv = $('set-invert');
    const auto = $('set-autocenter');
    const fps = $('set-fps');
    const sync = () => {
      q.value = settings.quality;
      draw.value = settings.drawDistance;
      fov.value = settings.fov;
      sens.value = settings.sensitivity;
      inv.checked = settings.invertY;
      auto.checked = settings.autoCenter;
      fps.checked = settings.showFps;
      $('out-draw').textContent = `${settings.drawDistance} m`;
      $('out-fov').textContent = `${settings.fov}°`;
      $('out-sens').textContent = `${Number(settings.sensitivity).toFixed(1)}x`;
    };
    const read = () => {
      settings.quality = q.value;
      settings.drawDistance = Number(draw.value);
      settings.fov = Number(fov.value);
      settings.sensitivity = Number(sens.value);
      settings.invertY = inv.checked;
      settings.autoCenter = auto.checked;
      settings.showFps = fps.checked;
      sync();
      onChange(settings);
    };
    for (const el of [q, draw, fov, sens, inv, auto, fps]) el.addEventListener('input', read);
    sync();
  }

  // ---------------------------------------------------------- HUD
  showHud(v) {
    this.hud.hidden = !v;
  }

  setCash(n) {
    if (n === this.lastCash) return;
    const up = this.lastCash !== null && n > this.lastCash;
    this.lastCash = n;
    this.cashEl.textContent = formatMoney(n);
    if (up) {
      this.cashEl.classList.add('bump');
      setTimeout(() => this.cashEl.classList.remove('bump'), 220);
    }
  }

  setHealth(h) {
    const pct = Math.max(0, Math.min(100, h));
    this.healthEl.style.width = `${pct}%`;
    this.healthEl.classList.toggle('low', pct < 30);
  }

  setPrompt(html) {
    if (html === this.lastPrompt) return;
    this.lastPrompt = html;
    if (!html) {
      this.promptEl.hidden = true;
      return;
    }
    this.promptEl.innerHTML = html;
    this.promptEl.hidden = false;
  }

  setSpeed(kmh, name, max) {
    if (kmh === null) {
      this.speedo.hidden = true;
      return;
    }
    this.speedo.hidden = false;
    this.speedVal.textContent = Math.round(kmh);
    const frac = Math.min(1, kmh / max);
    this.speedArc.style.strokeDasharray = `${(235.6 * frac).toFixed(1)} 314.2`;
    this.speedArc.style.stroke = frac > 0.85 ? '#ff4f7b' : '#ffb547';
    this.vehName.textContent = name;
  }

  setFps(show, fps) {
    this.fpsEl.hidden = !show;
    if (show) this.fpsEl.textContent = `${Math.round(fps)} fps`;
  }

  setStreet(name) {
    if (this.streetEl.textContent !== name) this.streetEl.textContent = name;
  }

  setLookHint(v) {
    this.lookHint.hidden = !v;
  }

  showArea(name) {
    this.areaEl.textContent = name;
    this.areaEl.classList.add('show');
    clearTimeout(this.areaTimer);
    this.areaTimer = setTimeout(() => this.areaEl.classList.remove('show'), 2800);
  }

  notify(title, text, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    const b = document.createElement('b');
    b.textContent = title;
    const s = document.createElement('span');
    s.textContent = text;
    el.append(b, s);
    this.notes.prepend(el);
    while (this.notes.children.length > 4) this.notes.lastChild.remove();
    setTimeout(() => el.classList.add('out'), 4600);
    setTimeout(() => el.remove(), 5000);
  }

  blackout(v) {
    $('blackout').classList.toggle('show', v);
  }
}
