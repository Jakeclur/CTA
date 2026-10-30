// Frame timing: the performance overlay numbers, dynamic resolution (lowers the
// render resolution when frames run slow and raises it again when there is
// headroom), and the statistics for the benchmark drive.

const TARGET = 1 / 60; // aim for 60 frames per second
const HISTORY = 120;

export class PerfMonitor {
  constructor() {
    this.times = new Float32Array(HISTORY);
    this.count = 0;
    this.head = 0;
    this.scale = 1; // fraction of the preset's resolution
    this.minScale = 0.6;
    this.adaptT = 0;
    this.goodT = 0;
    this.ceiling = 1; // a scale that recently proved too slow is not retried for a while
    this.ceilingT = 0;
  }

  // dt = real seconds since the last frame (not clamped)
  frame(dt) {
    this.times[this.head] = dt;
    this.head = (this.head + 1) % HISTORY;
    this.count = Math.min(HISTORY, this.count + 1);
  }

  recent(k) {
    const n = Math.min(k, this.count);
    const out = [];
    for (let i = 1; i <= n; i++) out.push(this.times[(this.head - i + HISTORY) % HISTORY]);
    return out;
  }

  average(k = 30) {
    const r = this.recent(k);
    return r.length ? r.reduce((a, b) => a + b, 0) / r.length : TARGET;
  }

  worst(k = 60) {
    return Math.max(0, ...this.recent(k));
  }

  reset() {
    this.count = 0;
    this.head = 0;
    this.goodT = 0;
    this.adaptT = 0;
  }

  // Dynamic resolution. Returns a new scale when it changes, otherwise null.
  adapt(dt) {
    this.adaptT += dt;
    if (this.ceilingT > 0) this.ceilingT -= dt;
    else this.ceiling = 1;
    if (this.adaptT < 0.5 || this.count < 30) return null;
    this.adaptT = 0;
    const a = this.average(30);
    if (a > TARGET * 1.15 && this.scale > this.minScale) {
      // too slow: drop resolution, more when far behind
      this.ceiling = this.scale;
      this.ceilingT = 20;
      this.scale = Math.max(this.minScale, this.scale - (a > TARGET * 1.6 ? 0.1 : 0.05));
      this.goodT = 0;
      this.reset();
      return this.scale;
    }
    if (a < TARGET * 1.05) {
      this.goodT += 0.5;
      const cap = Math.min(1, this.ceiling - 0.05);
      if (this.goodT >= 3 && this.scale < cap - 0.001) {
        this.scale = Math.min(cap, this.scale + 0.05);
        this.goodT = 0;
        this.reset();
        return this.scale;
      }
    } else this.goodT = 0;
    return null;
  }
}

// Summary of a list of frame times (seconds): average fps and the "1% low"
// (the frame rate of the slowest 1% of frames), which shows stutter.
export function frameStats(times) {
  if (!times.length) return { fps: 0, low: 0, worstMs: 0 };
  const total = times.reduce((a, b) => a + b, 0);
  const sorted = [...times].sort((a, b) => b - a);
  const slowest = sorted.slice(0, Math.max(1, Math.floor(times.length / 100)));
  const slowAvg = slowest.reduce((a, b) => a + b, 0) / slowest.length;
  return { fps: times.length / total, low: 1 / slowAvg, worstMs: sorted[0] * 1000 };
}
