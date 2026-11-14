// Synthesised sound (Web Audio). No audio files.

export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.listener = { x: 0, y: 0 };
    this.last = {};
    this.ambient = null;
    this.samples = {}; // slot name -> { buffer: [AudioBuffer...], gain, pitch }
    this.sampleDefs = null;
  }

  // Load assets/sfx/sfx.json and decode its files. Called once the AudioContext exists.
  async loadSamples() {
    if (!this.ctx || this.sampleDefs) return;
    this.sampleDefs = {};
    let defs;
    try {
      defs = await (await fetch('assets/sfx/sfx.json')).json();
    } catch {
      return; // no samples: synthesised sounds only
    }
    this.sampleDefs = defs;
    await Promise.all(
      Object.entries(defs.slots || {}).map(async ([slot, d]) => {
        try {
          const buffers = await Promise.all(
            d.files.map(async (f) => this.ctx.decodeAudioData(await (await fetch('assets/sfx/' + f)).arrayBuffer())),
          );
          this.samples[slot] = { buffer: buffers, gain: d.gain, pitch: d.pitch };
        } catch (e) {
          console.warn('sound sample failed to load:', slot, e);
        }
      }),
    );
  }

  // Must be called from a user gesture
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(this.ctx.destination);
    // Shared noise buffer
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Small reverb for a cavernous, industrial space
    this.verb = this.ctx.createConvolver();
    const ir = this.ctx.createBuffer(2, this.ctx.sampleRate * 1.8, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 3);
    }
    this.verb.buffer = ir;
    const vg = this.ctx.createGain();
    vg.gain.value = 0.22;
    this.verb.connect(vg).connect(this.master);
    this.loadSamples();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  out(x, y) {
    const c = this.ctx;
    const g = c.createGain();
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    let vol = 1;
    if (x !== undefined) {
      const dx = x - this.listener.x, dy = y - this.listener.y;
      const d = Math.hypot(dx, dy);
      vol = Math.max(0, 1 - d / 1100);
      if (pan) pan.pan.value = Math.max(-1, Math.min(1, dx / 600));
    }
    g.gain.value = vol;
    if (pan) {
      g.connect(pan);
      pan.connect(this.master);
      pan.connect(this.verb);
    } else {
      g.connect(this.master);
      g.connect(this.verb);
    }
    return { node: g, vol };
  }

  tone(o, { type = 'square', f0 = 440, f1 = f0, dur = 0.1, vol = 0.2, delay = 0 }) {
    const c = this.ctx, t = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(o);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  hiss(o, { dur = 0.2, vol = 0.3, filter = 'lowpass', f0 = 2000, f1 = f0, q = 1, delay = 0 }) {
    const c = this.ctx, t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const bf = c.createBiquadFilter();
    bf.type = filter;
    bf.Q.value = q;
    bf.frequency.setValueAtTime(f0, t);
    bf.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bf).connect(g).connect(o);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  play(name, x, y) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    // Limit repeats of the same sound
    const now = this.ctx.currentTime;
    const minGap = { flame: 0.05, pulse: 0.03, beam: 0.06, eshot: 0.03, spark: 0.03, clink: 0.05 }[name] ?? 0.015;
    if (now - (this.last[name] || 0) < minGap) return;
    this.last[name] = now;
    const { node: o, vol } = this.out(x, y);
    if (vol <= 0.01) return;
    // A recorded sample for this slot (assets/sfx/) replaces the synthesised sound
    const smp = this.samples[name];
    if (smp && smp.buffer) {
      const variants = smp.buffer;
      const src = this.ctx.createBufferSource();
      src.buffer = variants[Math.floor(Math.random() * variants.length)];
      src.playbackRate.value = 1 + (Math.random() * 2 - 1) * (smp.pitch || 0);
      const g = this.ctx.createGain();
      g.gain.value = smp.gain ?? 1;
      src.connect(g).connect(o);
      src.start();
      return;
    }
    const r = () => 0.9 + Math.random() * 0.2;
    switch (name) {
      case 'pulse':
        this.tone(o, { type: 'square', f0: 900 * r(), f1: 180, dur: 0.08, vol: 0.12 });
        this.hiss(o, { dur: 0.05, vol: 0.12, f0: 5000, f1: 800 });
        break;
      case 'coil':
        this.tone(o, { type: 'sawtooth', f0: 2400, f1: 60, dur: 0.35, vol: 0.2 });
        this.tone(o, { type: 'sine', f0: 90, f1: 30, dur: 0.4, vol: 0.4 });
        this.hiss(o, { dur: 0.25, vol: 0.25, filter: 'highpass', f0: 3000, f1: 600 });
        break;
      case 'flame':
        this.hiss(o, { dur: 0.18, vol: 0.18, filter: 'bandpass', f0: 600 * r(), f1: 300, q: 0.7 });
        break;
      case 'beam':
        this.tone(o, { type: 'sawtooth', f0: 140 * r(), f1: 120, dur: 0.07, vol: 0.08 });
        this.tone(o, { type: 'square', f0: 1800 * r(), f1: 1600, dur: 0.05, vol: 0.03 });
        break;
      case 'throw':
        this.tone(o, { type: 'triangle', f0: 300, f1: 900, dur: 0.12, vol: 0.15 });
        break;
      case 'explode':
        this.hiss(o, { dur: 0.9, vol: 0.7, f0: 1200, f1: 60 });
        this.tone(o, { type: 'sine', f0: 110, f1: 25, dur: 0.7, vol: 0.6 });
        break;
      case 'eshot':
        this.tone(o, { type: 'square', f0: 520 * r(), f1: 120, dur: 0.1, vol: 0.08 });
        this.hiss(o, { dur: 0.06, vol: 0.08, f0: 3000, f1: 500 });
        break;
      case 'spit':
        this.hiss(o, { dur: 0.22, vol: 0.2, filter: 'bandpass', f0: 1400, f1: 400, q: 3 });
        break;
      case 'jump':
        this.hiss(o, { dur: 0.08, vol: 0.08, f0: 900, f1: 300 });
        break;
      case 'land':
        this.tone(o, { type: 'sine', f0: 120, f1: 40, dur: 0.12, vol: 0.25 });
        this.hiss(o, { dur: 0.08, vol: 0.12, f0: 700, f1: 200 });
        break;
      case 'dash':
        this.hiss(o, { dur: 0.2, vol: 0.2, filter: 'bandpass', f0: 600, f1: 2600, q: 2 });
        break;
      case 'hurt':
        this.tone(o, { type: 'sawtooth', f0: 180, f1: 70, dur: 0.18, vol: 0.25 });
        this.hiss(o, { dur: 0.1, vol: 0.2, f0: 1500, f1: 300 });
        break;
      case 'die':
        this.hiss(o, { dur: 0.35, vol: 0.4, filter: 'bandpass', f0: 500 * r(), f1: 90, q: 2 });
        this.tone(o, { type: 'sawtooth', f0: 260 * r(), f1: 50, dur: 0.3, vol: 0.18 });
        break;
      case 'mechdie':
        this.hiss(o, { dur: 0.6, vol: 0.5, f0: 3000, f1: 100 });
        this.tone(o, { type: 'square', f0: 400, f1: 30, dur: 0.5, vol: 0.2 });
        break;
      case 'screech':
        this.tone(o, { type: 'sawtooth', f0: 900 * r(), f1: 1500, dur: 0.3, vol: 0.12 });
        this.tone(o, { type: 'square', f0: 1210 * r(), f1: 700, dur: 0.35, vol: 0.08 });
        break;
      case 'hiss':
        this.hiss(o, { dur: 0.3, vol: 0.2, filter: 'highpass', f0: 3000, f1: 5000 });
        break;
      case 'roar':
        this.tone(o, { type: 'sawtooth', f0: 90, f1: 50, dur: 0.8, vol: 0.35 });
        this.hiss(o, { dur: 0.8, vol: 0.3, filter: 'bandpass', f0: 400, f1: 200, q: 1 });
        break;
      case 'rumble':
        this.hiss(o, { dur: 0.6, vol: 0.4, f0: 200, f1: 60 });
        break;
      case 'burst':
        this.hiss(o, { dur: 0.4, vol: 0.4, filter: 'bandpass', f0: 300, f1: 900, q: 1 });
        this.tone(o, { type: 'sine', f0: 70, f1: 40, dur: 0.4, vol: 0.4 });
        break;
      case 'mortar':
        this.tone(o, { type: 'sine', f0: 200, f1: 60, dur: 0.25, vol: 0.4 });
        break;
      case 'empty':
        this.tone(o, { type: 'square', f0: 1200, f1: 1100, dur: 0.03, vol: 0.08 });
        break;
      case 'clink':
        this.tone(o, { type: 'triangle', f0: 2200 * r(), f1: 1800, dur: 0.06, vol: 0.08 });
        break;
      case 'ricochet':
        this.tone(o, { type: 'sine', f0: 3000 * r(), f1: 900, dur: 0.18, vol: 0.06 });
        break;
      case 'pickup':
        this.tone(o, { type: 'square', f0: 660, f1: 660, dur: 0.06, vol: 0.1 });
        this.tone(o, { type: 'square', f0: 990, f1: 990, dur: 0.1, vol: 0.1, delay: 0.06 });
        break;
      case 'weapon':
        [440, 554, 659, 880].forEach((f, i) => this.tone(o, { type: 'square', f0: f, dur: 0.1, vol: 0.1, delay: i * 0.06 }));
        break;
      case 'checkpoint':
        [330, 494, 659].forEach((f, i) => this.tone(o, { type: 'triangle', f0: f, dur: 0.25, vol: 0.15, delay: i * 0.1 }));
        break;
      case 'revive':
        [262, 392, 523, 784].forEach((f, i) => this.tone(o, { type: 'triangle', f0: f, dur: 0.2, vol: 0.15, delay: i * 0.07 }));
        break;
      case 'down':
        [400, 300, 200].forEach((f, i) => this.tone(o, { type: 'sawtooth', f0: f, f1: f * 0.9, dur: 0.25, vol: 0.12, delay: i * 0.18 }));
        break;
      case 'alarm':
        for (let i = 0; i < 4; i++) this.tone(o, { type: 'square', f0: 660, f1: 440, dur: 0.35, vol: 0.1, delay: i * 0.4 });
        break;
      case 'gate':
        this.tone(o, { type: 'sawtooth', f0: 60, f1: 40, dur: 0.6, vol: 0.3 });
        this.hiss(o, { dur: 0.5, vol: 0.25, f0: 600, f1: 200 });
        break;
      case 'heartbeat':
        this.tone(o, { type: 'sine', f0: 70, f1: 40, dur: 0.12, vol: 0.5 });
        this.tone(o, { type: 'sine', f0: 60, f1: 35, dur: 0.12, vol: 0.4, delay: 0.18 });
        break;
      case 'ui':
        this.tone(o, { type: 'square', f0: 880, f1: 880, dur: 0.04, vol: 0.06 });
        break;
      case 'crate':
        this.hiss(o, { dur: 0.3, vol: 0.3, f0: 2500, f1: 300 });
        this.tone(o, { type: 'square', f0: 140, f1: 60, dur: 0.2, vol: 0.15 });
        break;
      case 'debris':
        this.hiss(o, { dur: 0.4, vol: 0.35, f0: 900, f1: 120 });
        break;
    }
  }

  // Looping zone ambience: low drone plus filtered noise (rain, wind or dripping hum)
  setAmbient(zone) {
    if (!this.ctx) return;
    this.stopAmbient();
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.5, c.currentTime + 3);
    g.connect(this.master);
    const nodes = [];
    const base = { upper: 55, lower: 49, underbelly: 41, caverns: 36.7, depths: 32.7 }[zone.key] || 45;
    for (const [mul, type, vol] of [[1, 'sawtooth', 0.05], [1.5, 'sine', 0.06], [2.01, 'triangle', 0.03]]) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = base * mul;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 300;
      const og = c.createGain();
      og.gain.value = vol;
      // slow movement
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.1;
      const lg = c.createGain();
      lg.gain.value = 120;
      lfo.connect(lg).connect(lp.frequency);
      o.connect(lp).connect(og).connect(g);
      o.start();
      lfo.start();
      nodes.push(o, lfo);
    }
    const n = c.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    // Rain (megacity zones) or a low hum (underground). Rain is band-limited so it reads as
    // distant rainfall rather than hiss, and kept quiet under the effects.
    const nf = c.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = zone.rain ? 1400 : 400;
    nf.Q.value = zone.rain ? 0.6 : 0.8;
    const ng = c.createGain();
    ng.gain.value = zone.rain ? 0.05 : 0.025;
    n.connect(nf).connect(ng).connect(g);
    n.start();
    nodes.push(n);
    this.ambient = { g, nodes };
  }

  stopAmbient() {
    if (!this.ambient) return;
    const { g, nodes } = this.ambient;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + 1);
    nodes.forEach((n) => n.stop(t + 1.1));
    this.ambient = null;
  }
}
