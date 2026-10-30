// Sound, all synthesised with the Web Audio API (no audio files): engine, tyre
// squeal, crashes, footsteps, sirens, horn, the city and the sea, birds and
// district ambience, and UI jingles.
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
  update(t, { car, siren, beach, horn, area, night = 0, dt = 0 }) {
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
    const busy = area === 'Downtown' || area === 'Midtown' ? 1 : area === 'Palm Park' || area === 'Northside Hills' ? 0.35 : 0.65;
    set(this.cityGain.gain, 0.025 + busy * 0.04 * (1 - night * 0.4), 0.8);
    if (dt > 0) this.ambience(dt, area, night, beach);
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
      case 'alarm':
        this.tones(t, [1480, 1180], 0.11, 0.06 * amount, 'square');
        break;
      case 'flutter':
        // a flock taking off: a rush of wingbeats
        for (let i = 0; i < 7; i++) this.burst(t + i * 0.05 + Math.random() * 0.03, 0.05, 0.07, 2400);
        break;
      case 'checkpoint':
        this.tones(t, [784, 1175], 0.06, 0.11, 'triangle');
        break;
      case 'buy':
        this.tones(t, [660, 990], 0.08, 0.12, 'triangle');
        break;
      default:
        break;
    }
  }

  // Occasional sounds that make each part of town sound different: birdsong in
  // the park and the quiet streets, crickets there at night, gulls on the
  // beach, far-off horns and sirens downtown.
  ambience(dt, area, night, beach) {
    const t = this.ctx.currentTime;
    const leafy = area === 'Palm Park' ? 1 : area === 'Northside Hills' ? 0.7 : area === 'Harbour West' || area === 'Eastgate' ? 0.35 : 0.08;
    const busy = area === 'Downtown' ? 1 : area === 'Midtown' ? 0.6 : 0.15;
    const day = 1 - night;
    const roll = (perSecond) => Math.random() < perSecond * dt;
    if (roll(0.5 * leafy * day)) this.birdsong(t);
    if (roll(0.7 * leafy * night)) this.crickets(t);
    if (roll(0.35 * beach * day)) this.gull(t);
    if (roll(0.12 * busy)) this.distantHorn(t);
    if (roll(0.012 * busy)) this.distantSiren(t);
  }

  birdsong(t) {
    const base = 2600 + Math.random() * 1800;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const s = t + i * (0.09 + Math.random() * 0.05);
      this.sweep(s, base * (1 + Math.random() * 0.15), base * (1.25 + Math.random() * 0.3), 0.06, 0.012, 'sine');
    }
  }

  crickets(t) {
    const f = 4200 + Math.random() * 600;
    for (let i = 0; i < 6; i++) this.sweep(t + i * 0.045, f, f, 0.025, 0.006, 'sine');
  }

  gull(t) {
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const s = t + i * 0.32;
      this.sweep(s, 1500 + Math.random() * 200, 900, 0.26, 0.018, 'sawtooth', 1900);
    }
  }

  distantHorn(t) {
    const len = 0.2 + Math.random() * 0.45;
    const f = 330 + Math.random() * 120;
    this.sweep(t, f, f, len, 0.012, 'square', 700);
    this.sweep(t, f * 1.26, f * 1.26, len, 0.008, 'square', 700);
  }

  distantSiren(t) {
    for (let i = 0; i < 4; i++) this.sweep(t + i * 0.7, 620, 900, 0.7, 0.006, 'triangle', 1500);
  }

  // A tone gliding from f0 to f1, through a low-pass filter when one is given.
  sweep(t, f0, f1, len, vol, type, lowpass) {
    const g = gain(this.ctx, 0, this.master);
    let to = g;
    if (lowpass) {
      to = this.ctx.createBiquadFilter();
      to.type = 'lowpass';
      to.frequency.value = lowpass;
      to.connect(g);
    }
    const o = osc(this.ctx, type, f0, to, false);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + len);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.02, len * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0005, t + len);
    o.start(t);
    o.stop(t + len + 0.02);
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
