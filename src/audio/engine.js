/**
 * engine.js
 * ---------------------------------------------------------------------------
 * Pure Web Audio API generative ambient soundscape.
 *
 * Zero dependencies, no build step, no external assets. Designed to sit behind
 * a Three.js cosmic scene as an evolving, cinematic backdrop:
 *
 *   - a warm pad whose voices glide between slowly morphing chords
 *   - a subtle low drone
 *   - airy shimmer / high noise texture
 *   - occasional soft bell accents
 *   - a `burst()` accent for "something just happened" moments
 *
 * Public API (see createAudioEngine):
 *   init()             -> Promise<boolean>  (call from a user gesture)
 *   setIntensity(0..1) -> smooth, click-free modulation
 *   burst()            -> short accent
 *   setMuted(bool)
 *   isReady()
 *   dispose()
 *
 * Every method is a safe no-op before init() and after dispose(); none of them
 * throw. Tab visibility suspends/resumes the context so a hidden tab is silent
 * and does not accumulate scheduled events.
 * ---------------------------------------------------------------------------
 */

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function pick(arr) {
  return arr[(Math.random() * arr.length) | 0];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Minor-pentatonic-leaning palette. The pad chord roots live in the A2..A3
// register, bells an octave or three above so accents always sit on top.
const PAD_ROOTS = [45, 48, 50, 52, 55, 57]; // A2 C3 D3 E3 G3 A3
const PAD_CHORDS = [
  [0, 7, 12, 19], // open fifth + octave
  [0, 3, 7, 10],  // minor 7
  [0, 5, 7, 12],  // sus4
  [0, 3, 10, 15], // minor add
  [0, 7, 10, 14], // 9th colour
  [0, 5, 12, 17], // sus2 spread
  [0, 4, 7, 11],  // major 7 shimmer
];

const BELL_NOTES = [69, 72, 74, 76, 79, 81, 84, 86, 88]; // A4..E6

export function createAudioEngine(options = {}) {
  const cfg = {
    masterGain: clamp(options.masterGain ?? 0.22, 0, 1),
    intensity: clamp(options.intensity ?? 0.5, 0, 1),
    muted: options.muted === true,
    accents: options.accents !== false,
    onReadyChange:
      typeof options.onReadyChange === 'function' ? options.onReadyChange : null,
  };

  // ---- lifecycle state -----------------------------------------------------
  let ctx = null;
  let ready = false;
  let disposed = false;
  let muted = cfg.muted;
  let intensity = cfg.intensity;
  let initPromise = null;
  let wasRunningBeforeHide = false;

  // ---- graph nodes ---------------------------------------------------------
  let master = null;
  let limiter = null;
  let padBus = null;
  let padFilter = null;
  let droneBus = null;
  let droneFilter = null;
  let shimmerBus = null;
  let shimmerFilter = null;

  const voices = []; // pad voices
  const sources = []; // long-lived oscillators / sources
  let timers = [];
  let nextChordAt = 0;
  let nextBellAt = 0;
  let noiseBuffer = null;
  let bloomBuffer = null;

  // =========================================================================
  // Graph construction
  // =========================================================================

  function makeNoiseBuffer(seconds = 2) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function buildGraph() {
    // Master -> safety limiter -> speakers. A compressor as the final stage
    // means the generative layers can breathe without ever clipping.
    master = ctx.createGain();
    master.gain.value = muted ? 0 : cfg.masterGain;

    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 12;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.28;

    master.connect(limiter);
    limiter.connect(ctx.destination);

    buildDrone();
    buildPad();
    buildShimmer();
  }

  function buildDrone() {
    droneBus = ctx.createGain();
    droneBus.gain.value = 0; // set by applyIntensity

    droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 150;
    droneFilter.Q.value = 0.4;

    droneBus.connect(droneFilter);
    droneFilter.connect(master);

    const specs = [
      { f: 55.0, type: 'sine', gain: 0.5, detune: 0 },
      { f: 55.0, type: 'sine', gain: 0.34, detune: 6 },
      { f: 82.41, type: 'sine', gain: 0.22, detune: -5 },
      { f: 110.0, type: 'triangle', gain: 0.06, detune: 3 },
    ];
    for (const s of specs) {
      const osc = ctx.createOscillator();
      osc.type = s.type;
      osc.frequency.value = s.f;
      osc.detune.value = s.detune;
      const g = ctx.createGain();
      g.gain.value = s.gain;
      osc.connect(g);
      g.connect(droneBus);
      osc.start();
      sources.push(osc);
    }

    // Very slow filter drift so the drone never sits perfectly still.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.017;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 40;
    lfo.connect(lfoGain);
    lfoGain.connect(droneFilter.frequency);
    lfo.start();
    sources.push(lfo);
  }

  function buildPad() {
    padBus = ctx.createGain();
    padBus.gain.value = 0;

    padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 900;
    padFilter.Q.value = 0.6;

    padFilter.connect(padBus);
    padBus.connect(master);

    // Slow cutoff drift adds life on top of the intensity-driven base cutoff.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain);
    lfoGain.connect(padFilter.frequency);
    lfo.start();
    sources.push(lfo);

    const PAD_VOICES = 4;
    for (let i = 0; i < PAD_VOICES; i += 1) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(padFilter);

      const a = ctx.createOscillator();
      a.type = 'sawtooth';
      a.frequency.value = 220;
      a.detune.value = -7 - i * 2;

      const b = ctx.createOscillator();
      b.type = 'sawtooth';
      b.frequency.value = 220;
      b.detune.value = 7 + i * 2;

      a.connect(gain);
      b.connect(gain);
      a.start();
      b.start();
      sources.push(a, b);

      voices.push({ osc: [a, b], gain });
    }
  }

  function buildShimmer() {
    shimmerBus = ctx.createGain();
    shimmerBus.gain.value = 0;

    // Tremolo makes the noise texture feel like moving air, not static hiss.
    const trem = ctx.createGain();
    trem.gain.value = 0.7;

    shimmerFilter = ctx.createBiquadFilter();
    shimmerFilter.type = 'bandpass';
    shimmerFilter.frequency.value = 3800;
    shimmerFilter.Q.value = 0.7;

    shimmerBus.connect(trem);
    trem.connect(shimmerFilter);
    shimmerFilter.connect(master);

    noiseBuffer = makeNoiseBuffer(2);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    noise.connect(shimmerBus);
    noise.start();
    sources.push(noise);

    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.031;
    const sweepGain = ctx.createGain();
    sweepGain.gain.value = 1800;
    sweep.connect(sweepGain);
    sweepGain.connect(shimmerFilter.frequency);
    sweep.start();
    sources.push(sweep);

    const tremLfo = ctx.createOscillator();
    tremLfo.frequency.value = 0.11;
    const tremDepth = ctx.createGain();
    tremDepth.gain.value = 0.3;
    tremLfo.connect(tremDepth);
    tremDepth.connect(trem.gain);
    tremLfo.start();
    sources.push(tremLfo);
  }

  // =========================================================================
  // Generative scheduling
  // =========================================================================

  function changeChord(immediate = false) {
    if (!ctx || ctx.state !== 'running' || !voices.length) return;
    const t = ctx.currentTime;
    const root = pick(PAD_ROOTS);
    const notes = pick(PAD_CHORDS).map((interval) => root + interval);

    for (let i = 0; i < voices.length; i += 1) {
      const midi = notes[i % notes.length] + (i >= notes.length ? 12 : 0);
      const freq = midiToFreq(midi);
      const glide = immediate ? 0.35 : rand(5, 9);
      for (const osc of voices[i].osc) {
        osc.frequency.cancelScheduledValues(t);
        osc.frequency.setTargetAtTime(freq, t, glide / 3);
      }
      // Gently stagger voice levels so the chord breathes.
      const level = immediate ? 0.1 : 0.09 + Math.random() * 0.05;
      voices[i].gain.gain.setTargetAtTime(level, t, immediate ? 0.3 : 2.5);
    }
  }

  function playBell(time, velocity = 1, notes = null) {
    if (!ctx || disposed) return;
    const t = Math.max(time ?? ctx.currentTime + 0.02, ctx.currentTime);
    const midis = notes && notes.length ? notes : [pick(BELL_NOTES)];
    // Keep the peak strictly positive: exponentialRampToValueAtTime must never
    // start or end on exactly zero.
    const peak = Math.max(0.0005, clamp(velocity, 0, 2) * 0.16);

    for (const midi of midis) {
      const f0 = midiToFreq(midi);

      const out = ctx.createGain();
      out.gain.setValueAtTime(0.0001, t);
      out.gain.linearRampToValueAtTime(peak, t + 0.006);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);

      const pan = typeof ctx.createStereoPanner === 'function'
        ? ctx.createStereoPanner()
        : null;
      if (pan) {
        pan.pan.value = rand(-0.7, 0.7);
        out.connect(pan);
        pan.connect(master);
      } else {
        out.connect(master);
      }

      // Inharmonic partial stack = soft bell rather than pure sine beep.
      const partials = [
        { mult: 1.0, gain: 0.9, decay: 3.4 },
        { mult: 2.0, gain: 0.34, decay: 2.2 },
        { mult: 2.99, gain: 0.16, decay: 1.4 },
        { mult: 4.21, gain: 0.08, decay: 0.9 },
        { mult: 5.43, gain: 0.04, decay: 0.6 },
      ];
      for (const p of partials) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f0 * p.mult;

        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(p.gain, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + p.decay);

        osc.connect(g);
        g.connect(out);
        osc.start(t);
        osc.stop(t + 3.8);
        osc.onended = () => {
          try { osc.disconnect(); g.disconnect(); } catch (e) { /* ignore */ }
        };
      }

      // Tear the small per-note subgraph down once it is silent.
      setTimeout(() => {
        try { out.disconnect(); if (pan) pan.disconnect(); } catch (e) { /* ignore */ }
      }, 4200);
    }
  }

  function playBloom(time, velocity = 1) {
    if (!ctx || disposed) return;
    const t = Math.max(time, ctx.currentTime);
    if (!bloomBuffer) bloomBuffer = makeNoiseBuffer(1.5);

    const src = ctx.createBufferSource();
    src.buffer = bloomBuffer;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.exponentialRampToValueAtTime(5200, t + 0.6);
    bp.frequency.exponentialRampToValueAtTime(1400, t + 1.8);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, 0.09 * clamp(velocity, 0, 2)), t + 0.18);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.0);

    src.connect(bp);
    bp.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + 2.2);
    src.onended = () => {
      try { src.disconnect(); bp.disconnect(); g.disconnect(); } catch (e) { /* ignore */ }
    };
  }

  function tick() {
    if (!ctx || disposed || ctx.state !== 'running') return;
    const now = ctx.currentTime;

    if (now >= nextChordAt) {
      changeChord(false);
      nextChordAt = now + rand(16, 30);
    }

    if (cfg.accents && now >= nextBellAt) {
      const vel = (0.4 + intensity * 0.5) * rand(0.6, 1);
      playBell(now + 0.06, vel);
      nextBellAt = now + rand(8, 20) * lerp(1.4, 0.7, intensity);
    }
  }

  function startScheduler() {
    if (timers.length) return;
    nextChordAt = ctx.currentTime + rand(0.5, 2);
    nextBellAt = ctx.currentTime + rand(4, 9);
    timers.push(setInterval(tick, 250));
  }

  function stopScheduler() {
    for (const id of timers) clearInterval(id);
    timers = [];
  }

  // =========================================================================
  // Parameter application
  // =========================================================================

  function applyIntensity(value, timeConstant = 1.5) {
    if (!ctx) return;
    const t = ctx.currentTime;
    padFilter.frequency.setTargetAtTime(lerp(320, 2300, value), t, timeConstant);
    padBus.gain.setTargetAtTime(lerp(0.30, 0.62, value), t, timeConstant);
    droneBus.gain.setTargetAtTime(lerp(0.34, 0.58, value), t, timeConstant);
    shimmerBus.gain.setTargetAtTime(lerp(0.012, 0.11, value), t, timeConstant);
  }

  function applyMute() {
    if (!ctx || !master) return;
    master.gain.setTargetAtTime(
      muted ? 0 : cfg.masterGain,
      ctx.currentTime,
      0.08
    );
  }

  // =========================================================================
  // Event handlers
  // =========================================================================

  function handleStateChange() {
    const now = !!(ctx && ctx.state === 'running' && !disposed);
    if (now !== ready) {
      ready = now;
      if (cfg.onReadyChange) cfg.onReadyChange(ready);
    }
  }

  function onVisibility() {
    if (!ctx || disposed) return;
    if (typeof document !== 'undefined' && document.hidden) {
      wasRunningBeforeHide = ctx.state === 'running';
      if (wasRunningBeforeHide) ctx.suspend().catch(() => {});
    } else if (wasRunningBeforeHide) {
      wasRunningBeforeHide = false;
      ctx.resume().catch(() => {});
    }
  }

  // =========================================================================
  // Public API
  // =========================================================================

  function init() {
    if (disposed) return Promise.resolve(false);
    if (ready) return Promise.resolve(true);
    if (initPromise) return initPromise;

    const AC =
      typeof window !== 'undefined'
        ? window.AudioContext || window.webkitAudioContext
        : null;
    if (!AC) return Promise.resolve(false);

    initPromise = (async () => {
      try {
        ctx = new AC();
        buildGraph();
        applyIntensity(intensity, 0.05);
        applyMute();
        changeChord(true);
        ctx.onstatechange = handleStateChange;
        startScheduler();
        if (typeof document !== 'undefined') {
          document.addEventListener('visibilitychange', onVisibility);
        }
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        handleStateChange();
        return ready;
      } catch (err) {
        // Autoplay rejection, no audio device, etc. Surface but never throw.
        if (typeof console !== 'undefined') {
          console.warn('[audio] init failed:', err);
        }
        return false;
      } finally {
        initPromise = null;
      }
    })();

    return initPromise;
  }

  function setIntensity(value) {
    intensity = clamp(Number(value) || 0, 0, 1);
    if (ctx && !disposed) applyIntensity(intensity);
  }

  function burst() {
    if (!ctx || disposed || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.02;
    const root = pick(BELL_NOTES);
    playBell(t, 0.9 + intensity * 0.5, [root, root + 7, root + 12]);
    playBloom(t, 0.5 + intensity * 0.4);
  }

  function setMuted(value) {
    muted = !!value;
    if (ctx && !disposed) applyMute();
  }

  function isReady() {
    return ready && !disposed;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    ready = false;
    stopScheduler();

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility);
    }

    const current = ctx;
    ctx = null;
    if (current) {
      current.onstatechange = null;
      try {
        const p = current.close();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) {
        /* ignore */
      }
    }

    for (const source of sources) {
      try { source.stop(); } catch (e) { /* ignore */ }
      try { source.disconnect(); } catch (e) { /* ignore */ }
    }
    sources.length = 0;
    voices.length = 0;
    master = null;
    limiter = null;
    padBus = null;
    padFilter = null;
    droneBus = null;
    droneFilter = null;
    shimmerBus = null;
    shimmerFilter = null;

    if (cfg.onReadyChange) cfg.onReadyChange(false);
  }

  return {
    init,
    setIntensity,
    burst,
    setMuted,
    isReady,
    dispose,
  };
}

export default createAudioEngine;
