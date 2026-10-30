// Settings and progress stored in localStorage. Every access is wrapped so the
// game still runs when storage is blocked (private windows, strict school devices).

const SETTINGS_KEY = 'cta.settings.v1';
const PROGRESS_KEY = 'cta.progress.v1';

export const DEFAULT_SETTINGS = {
  quality: 'medium', // low | medium | high
  drawDistance: 800,
  fov: 70,
  sensitivity: 1,
  invertY: false,
  showFps: false,
  autoCenter: true,
};

export const DEFAULT_PROGRESS = {
  cash: 250,
  health: 100,
  x: null,
  z: null,
  heading: 0,
  stats: { pickups: 0, distanceDriven: 0 },
  missions: [], // ids of completed missions
};

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...(read(SETTINGS_KEY) || {}) };
}

export function saveSettings(s) {
  return write(SETTINGS_KEY, s);
}

export function hasProgress() {
  return read(PROGRESS_KEY) !== null;
}

export function loadProgress() {
  const p = read(PROGRESS_KEY) || {};
  return { ...DEFAULT_PROGRESS, ...p, stats: { ...DEFAULT_PROGRESS.stats, ...(p.stats || {}) } };
}

export function saveProgress(p) {
  return write(PROGRESS_KEY, { ...p, savedAt: Date.now() });
}

export function clearProgress() {
  try {
    localStorage.removeItem(PROGRESS_KEY);
  } catch {
    // ignore
  }
}
