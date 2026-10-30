// Sound, all synthesised with the Web Audio API (no audio files): engine, tyre
// squeal, crashes, footsteps, sirens, horn, the city and the sea, and UI jingles.
// The audio context can only start after a click or key press, so `unlock()` is
// called from the Play / Continue buttons.

export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.muted = false;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.noise = makeNoise(ctx);

    // engine: two detuned oscillators through a low-pass filter
    this.engGain = gain(ctx, 0, this.master);
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 600;
    this.engFilter.connect(this.engGain);
    this.engA = osc(ctx, 'sawtooth', 50, this.engFilter);
    this.engB = osc(ctx, 'square', 25, gain(ctx, 0.35, this.engFilter));

    // tyre squeal: band-passed noise
    this.skidGain = gain(ctx, 0, this.master);
    const skidF = ctx.createBiquadFilter();
    skidF.type = 'bandpass';
    skidF.frequency.value = 1800;
    skidF.Q.value = 3;
    skidF.connect(this.skidGain);
    loopNoise(ctx, this.noise, skidF);

    // siren: a wailing tone
    this.sirenGain = gain(ctx, 0, this.master);
    this.siren = osc(ctx, 'triangle', 700, this.sirenGain);

    // ambience: low city rumble and waves
    this.cityGain = gain(ctx, 0, this.master);
    const cityF = ctx.createBiquadFilter();
    cityF.type = 'lowpass';
    cityF.frequency.value = 300;
    cityF.connect(this.cityGain);
    loopNoise(ctx, this.noise, cityF);
    this.waveGain = gain(ctx, 0, this.master);
    const waveF = ctx.createBiquadFilter();
    waveF.type = 'lowpass';
    waveF.frequency.value = 900;
    waveF.connect(this.waveGain);
    loopNoise(ctx, this.noise, waveF);

    // horn: two square waves, gated
    this.hornGain = gain(ctx, 0, this.master);
    const hornF = ctx.createBiquadFilter();
    hornF.type = 'lowpass';
    hornF.frequency.value = 1400;
    hornF.connect(this.hornGain);
    osc(ctx, 'square', 392, hornF);
    osc(ctx, 'square', 494, hornF);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // Pause everything (menus) without losing state.
  setActive(on) {
    if (!this.ctx) return;
    if (on && this.ctx.state === 'suspended') this.ctx.resume();
    if (!on && this.ctx.state === 'running') this.ctx.suspend();
  }

  // Continuous sounds, called every frame.
  // car: { speed, maxSpeed, throttle, slip } or null; siren: 0..1 loudness;
  // beach: 0..1 closeness to the sea; horn: bool
  update(t, { car, siren, beach, horn }) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const set = (param, v, tc = 0.06) => param.setTargetAtTime(v, now, tc);
    if (car) {
      // fake gearbox: revs climb through each of five gears
      const frac = Math.min(1, Math.abs(car.speed) / car.maxSpeed);
      const gears = 5;
      const gf = frac * gears;
      const inGear = gf - Math.floor(Math.min(gears - 1, gf));
      const rpm = 0.22 + Math.min(1, inGear) * 0.7 + car.throttle * 0.08;
      const f = 38 + rpm * 120;
      set(this.engA.frequency, f);
      set(this.engB.frequency, f / 2);
      set(this.engFilter.frequency, 380 + rpm * 900 + car.throttle * 600);
      set(this.engGain.gain, 0.09 + car.throttle * 0.07 + frac * 0.05);
      set(this.skidGain.gain, Math.min(0.12, Math.max(0, car.slip - 3.5) * 0.02));
    } else {
      set(this.engGain.gain, 0, 0.15);
      set(this.skidGain.gain, 0);
    }
    set(this.sirenGain.gain, siren * 0.05);
    if (siren > 0) this.siren.frequency.setTargetAtTime(Math.sin(t * 2.6) > 0 ? 960 : 640, now, 0.25);
    set(this.cityGain.gain, 0.05);
    set(this.waveGain.gain, beach * (0.05 + Math.max(0, Math.sin(t * 0.7)) * 0.07), 0.3);
    set(this.hornGain.gain, horn ? 0.07 : 0, 0.02);
  }

  // One-shot sounds. amount scales loudness for crashes and thuds.
  play(name, amount = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    switch (name) {
      case 'crash':
        this.burst(t, 0.6 * amount, 0.5, 900);
        this.thump(t, 70, 0.5 * amount, 0.3);
        break;
      case 'thud':
        this.thump(t, 110, 0.4 * amount, 0.18);
        break;
      case 'step':
        this.burst(t, 0.05 * amount, 0.06, 1600);
        break;
      case 'door':
        this.thump(t, 160, 0.18, 0.08);
        break;
      case 'cash':
        this.tones(t, [880, 1320], 0.07, 0.12, 'triangle');
        break;
      case 'phone':
        this.tones(t, [1046, 1318, 1046, 1318], 0.09, 0.08, 'sine');
        break;
      case 'mission':
        this.tones(t, [392, 523, 659], 0.16, 0.12, 'triangle');
        break;
      case 'passed':
        this.tones(t, [523, 659, 784, 1046], 0.14, 0.16, 'triangle');
        break;
      case 'fail':
        this.tones(t, [392, 330, 262], 0.22, 0.14, 'sawtooth');
        break;
      case 'wanted':
        this.tones(t, [880, 660], 0.12, 0.1, 'square');
        break;
      case 'busted':
        this.tones(t, [440, 330, 220], 0.3, 0.14, 'square');
        break;
      case 'buy':
        this.tones(t, [660, 990], 0.08, 0.12, 'triangle');
        break;
      default:
        break;
    }
  }

  tones(t, freqs, each, vol, type) {
    freqs.forEach((f, i) => {
      const g = gain(this.ctx, 0, this.master);
      const o = osc(this.ctx, type, f, g, false);
      const s = t + i * each;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(vol, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, s + each * 1.6);
      o.start(s);
      o.stop(s + each * 1.7);
    });
  }

  burst(t, vol, len, freq) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = gain(this.ctx, vol, this.master);
    src.connect(f);
    f.connect(g);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.start(t, Math.random() * 1.5);
    src.stop(t + len);
  }

  thump(t, freq, vol, len) {
    const g = gain(this.ctx, 0, this.master);
    const o = osc(this.ctx, 'sine', freq, g, false);
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.4, t + len);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.start(t);
    o.stop(t + len + 0.02);
  }
}

function gain(ctx, v, to) {
  const g = ctx.createGain();
  g.gain.value = v;
  g.connect(to);
  return g;
}

function osc(ctx, type, freq, to, start = true) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.connect(to);
  if (start) o.start();
  return o;
}

function makeNoise(ctx) {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function loopNoise(ctx, buf, to) {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.connect(to);
  s.start();
  return s;
}
