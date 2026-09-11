import * as THREE from 'three';
import { Cosmos } from '../scene/cosmos.js';
import { CameraRig } from '../scene/cameraRig.js';
import { PostFX } from './postfx.js';
import { QualityManager } from './quality.js';
import { HUD } from '../ui/hud.js';
import { initAudio } from '../audio/bridge.js';
import { decodeSeeds, buildShareUrl } from './share.js';

export function webglAvailable() {
  let context = null;
  try {
    const canvas = document.createElement('canvas');
    context = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return !!(window.WebGLRenderingContext && context);
  } catch {
    return false;
  } finally {
    // Release the probe context so it does not count against the page limit.
    try {
      context?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      /* ignore */
    }
  }
}

function prefersReducedMotion() {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Owns the renderer, scene, camera rig, post chain, quality manager and input.
 */
export class App {
  constructor() {
    this.canvas = document.getElementById('stage');
    this.hud = new HUD();

    this.paused = false;
    this.elapsed = 0;
    this._last = performance.now() / 1000;
    this._running = false;
    this._raf = 0;

    this._pointers = new Map();
    this._seeding = false;
    this._lookMode = false;
    this._lookId = null;
    this._resizePending = false;
    this._audio = null;
    this._audioEnabled = false;
    this._lastHudActivity = 0;
    this.reducedMotion = prefersReducedMotion();

    // Audio preference survives reloads; the engine still needs a gesture to
    // actually start, the toggle only records intent.
    this._audioMuted = (() => {
      try { return localStorage.getItem('aether-muted') === '1'; } catch { return false; }
    })();
    // Seeds restored from a shared URL are staged here and planted over the
    // first seconds of the intro so the sky assembles cinematically.
    this._scheduledSeeds = this._readSharedSeeds();

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setClearColor(0x03040a, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;

    const size = this._size();
    this.renderer.setSize(size.width, size.height, false);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, size.width / size.height, 0.5, 9000);

    this.cosmos = new Cosmos(this.scene, { reducedMotion: this.reducedMotion });
    this.rig = new CameraRig(this.camera, { reducedMotion: this.reducedMotion });
    this.postfx = new PostFX(this.renderer, this.scene, this.camera, size, {
      reducedMotion: this.reducedMotion
    });

    this.quality = new QualityManager((tier, pr) => this._applyQuality(tier, pr));
    this._applyQuality(this.quality.tier, this.quality.pixelRatio);

    this._boundResize = () => this._onResize();
    this._bindEvents();

    if (this.hud.audioBtn) this.hud.audioBtn.addEventListener('click', () => this._toggleAudio());
    this.hud.setAudioState(this._audioMuted, false); // engine not ready yet

    // Supernovae ring the soundscape bell so collapse moments are audible.
    this.cosmos.onSupernova = () => this._audio?.burst?.();

    // Optional audio: resolves to null when no engine module is present.
    initAudio(() => this.cosmos.getEnergy())
      .then((bridge) => {
        this._audio = bridge;
        // If the visitor already interacted before the import resolved, start now.
        if (this._audioEnabled) bridge?.enable?.();
        this._audio?.setMuted?.(this._audioMuted);
        this.hud.setAudioState(this._audioMuted, !!bridge);
      })
      .catch(() => {
        this._audio = null;
        this.hud.setAudioState(true, false);
      });

    this.hud.start();
  }

  _size() {
    return {
      width: Math.max(1, window.innerWidth),
      height: Math.max(1, window.innerHeight)
    };
  }

  _applyQuality(tier, pixelRatio) {
    const { width, height } = this._size();

    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.postfx.setPixelRatio(pixelRatio);
    this.postfx.setSize(width, height);
    this.postfx.setBloomStrength(tier.bloom);

    this.cosmos.setQuality({
      galaxyCount: tier.galaxyCount,
      nebulaOctaves: tier.nebulaOctaves,
      pixelRatio,
      particleSize: 0.68
    });
  }

  _bindEvents() {
    const handlers = (this._handlers = {
      resize: this._boundResize,
      visibility: () => {
        if (document.hidden) {
          this.paused = true;
        } else {
          this.paused = false;
          this._last = performance.now() / 1000;
        }
      },
      pointerdown: (e) => this._onPointerDown(e),
      pointermove: (e) => this._onPointerMove(e),
      pointerup: (e) => this._onPointerUp(e),
      pointercancel: (e) => this._onPointerUp(e),
      wheel: (e) => this._onWheel(e),
      contextmenu: (e) => e.preventDefault(),
      keydown: (e) => this._onKeyDown(e)
    });

    window.addEventListener('resize', handlers.resize, { passive: true });
    window.addEventListener('orientationchange', handlers.resize, { passive: true });
    document.addEventListener('visibilitychange', handlers.visibility);
    this.canvas.addEventListener('pointerdown', handlers.pointerdown);
    window.addEventListener('pointermove', handlers.pointermove, { passive: true });
    window.addEventListener('pointerup', handlers.pointerup, { passive: true });
    window.addEventListener('pointercancel', handlers.pointercancel, { passive: true });
    this.canvas.addEventListener('wheel', handlers.wheel, { passive: false });
    this.canvas.addEventListener('contextmenu', handlers.contextmenu);
    // keydown on window so shortcuts and look keys work before the canvas has
    // ever been clicked (page keydown bubbles from any focused element; there
    // are no text inputs on the page).
    window.addEventListener('keydown', handlers.keydown);
  }

  _onResize() {
    if (this._resizePending) return;
    this._resizePending = true;

    // rAF is paused while the page is hidden, so apply synchronously then.
    const apply = () => {
      this._resizePending = false;
      const { width, height } = this._size();
      const pr = this.quality.pixelRatio;

      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();

      this.postfx.setPixelRatio(pr);
      this.postfx.setSize(width, height);
    };

    if (document.hidden) apply();
    else requestAnimationFrame(apply);
  }

  _ndc(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * 2 - 1,
      y: -((clientY - rect.top) / rect.height) * 2 + 1
    };
  }

  _seedAtClient(clientX, clientY, count) {
    const ndc = this._ndc(clientX, clientY);
    const point = this.cosmos.projectToPlane(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    this.cosmos.seedAt(point, count);
    this._audio?.burst?.();
  }

  /**
   * Web Audio needs a user gesture. Called on every gesture; the bridge
   * de-duplicates and retries if an earlier init attempt failed.
   */
  _enableAudio() {
    this._audioEnabled = true;
    this._audio?.enable?.();
    this._audio?.setMuted?.(this._audioMuted);
  }

  /** Toggle the ambient soundscape; persists the preference. */
  _toggleAudio() {
    this._audioMuted = !this._audioMuted;
    try { localStorage.setItem('aether-muted', this._audioMuted ? '1' : '0'); } catch { /* ignore */ }
    if (!this._audioMuted) this._enableAudio();
    this._audio?.setMuted?.(this._audioMuted);
    this.hud.setAudioState(this._audioMuted, !!this._audio);
    this.hud.toast(this._audioMuted ? 'sound off' : 'sound on');
  }

  /** Read a `#u=…` hash into seed positions, tolerating garbage. */
  _readSharedSeeds() {
    let seeds = null;
    try { seeds = decodeSeeds(location.hash); } catch { seeds = null; }
    if (!Array.isArray(seeds) || seeds.length === 0) return [];

    // Clean the address bar once decoded so reloading starts a fresh sky.
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }

    return seeds.map((seed, i) => ({
      at: 1.6 + i * 0.7,
      point: new THREE.Vector3(seed.x, 0, seed.z),
      count: seed.count
    }));
  }

  /** Copy a share URL that replays every user-planted seed. */
  _shareUniverse() {
    const url = buildShareUrl(this.cosmos.seedLog);
    if (!url) {
      this.hud.toast('seed some stars first');
      return;
    }
    const payload = url.slice(url.indexOf('#'));
    const done = () => this.hud.toast('universe link copied');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(done, () => this._shareViaAddressBar(payload));
    } else {
      this._shareViaAddressBar(payload);
    }
  }

  /**
   * Clipboard-unavailable fallback: put the share hash in the address bar so
   * the visitor can copy the URL from there.
   */
  _shareViaAddressBar(payload) {
    try {
      history.replaceState(null, '', location.pathname + location.search + payload);
    } catch { /* ignore */ }
    this.hud.toast('could not copy — link is in the address bar');
  }

  _onKeyDown(e) {
    const step = 0.05;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case ' ':
      case 'Enter':
        e.preventDefault();
        this.hud.notifyActivity();
        this._enableAudio();
        this.rig.skipIntro();
        this.cosmos.seedAt(this.cosmos.projectToPlane(new THREE.Vector2(0, 0), this.camera), 420);
        this._audio?.burst?.();
        break;
      case 's':
      case 'S':
        this._shareUniverse();
        break;
      case 'm':
      case 'M':
        this._toggleAudio();
        break;
      case 'ArrowLeft':
        this.rig.look(step, 0);
        break;
      case 'ArrowRight':
        this.rig.look(-step, 0);
        break;
      case 'ArrowUp':
        this.rig.look(0, step);
        break;
      case 'ArrowDown':
        this.rig.look(0, -step);
        break;
      default:
        break;
    }
  }

  _onPointerDown(e) {
    this.hud.notifyActivity();
    this._enableAudio();
    this.rig.skipIntro();
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._pointers.size >= 2 || e.button === 2) {
      this._lookMode = true;
      this._seeding = false;
      this._lookId = e.pointerId;
    } else if (e.button === 0) {
      this._seeding = true;
      this._seedAtClient(e.clientX, e.clientY, 420);
    }

    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
  }

  _onPointerMove(e) {
    const ndc = this._ndc(e.clientX, e.clientY);
    this.rig.setPointer(ndc.x, ndc.y);

    // Hovering should bring the HUD back; throttle so it is not touched on
    // every single move event.
    const now = performance.now();
    if (now - this._lastHudActivity > 250) {
      this._lastHudActivity = now;
      this.hud.notifyActivity();
    }

    const prev = this._pointers.get(e.pointerId);
    if (!prev) return;

    if (this._lookMode && e.pointerId === this._lookId) {
      const ROT = 0.0032;
      this.rig.look((e.clientX - prev.x) * ROT, (e.clientY - prev.y) * ROT);
    } else if (this._seeding) {
      const ndcNow = this._ndc(e.clientX, e.clientY);
      const point = this.cosmos.projectToPlane(new THREE.Vector2(ndcNow.x, ndcNow.y), this.camera);
      this.cosmos.seedIfReady(point, this.elapsed, 0.13);
    }

    prev.x = e.clientX;
    prev.y = e.clientY;
  }

  _onPointerUp(e) {
    this._pointers.delete(e.pointerId);

    if (e.pointerId === this._lookId) {
      this._lookId = null;
      this._lookMode = false;
    }

    if (this._pointers.size === 0) {
      this._seeding = false;
      this._lookMode = false;
    }
  }

  _onWheel(e) {
    e.preventDefault();
    this.rig.zoom(e.deltaY * 0.02);
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._last = performance.now() / 1000;
    this._tick = this._tick.bind(this);
    this._raf = requestAnimationFrame(this._tick);
  }

  _tick() {
    if (!this._running) return;
    this._raf = requestAnimationFrame(this._tick);

    if (this.paused) {
      this._last = performance.now() / 1000;
      return;
    }

    const now = performance.now() / 1000;
    let dt = now - this._last;
    this._last = now;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;
    this.elapsed += dt;

    this.rig.update(dt);
    this.cosmos.update(dt, this.elapsed);

    // Replay a shared universe: plant its seeds cinematically over the intro.
    while (this._scheduledSeeds.length > 0 && this._scheduledSeeds[0].at <= this.elapsed) {
      const next = this._scheduledSeeds.shift();
      this.cosmos.seedAt(next.point, next.count, { share: false, cascade: false });
      this._audio?.burst?.();
    }

    const energy = this.cosmos.getEnergy();
    this.postfx.update(this.elapsed, energy);
    if (this._audio) this._audio.setIntensity(energy);

    this.postfx.render(dt);
    this.quality.update(dt);
    this.hud.update(this.elapsed, this.quality.fps, this.cosmos.galaxy.getCount());
  }

  dispose() {
    this._running = false;
    cancelAnimationFrame(this._raf);

    const h = this._handlers;
    if (h) {
      window.removeEventListener('resize', h.resize);
      window.removeEventListener('orientationchange', h.resize);
      document.removeEventListener('visibilitychange', h.visibility);
      this.canvas.removeEventListener('pointerdown', h.pointerdown);
      window.removeEventListener('pointermove', h.pointermove);
      window.removeEventListener('pointerup', h.pointerup);
      window.removeEventListener('pointercancel', h.pointercancel);
      this.canvas.removeEventListener('wheel', h.wheel);
      this.canvas.removeEventListener('contextmenu', h.contextmenu);
      window.removeEventListener('keydown', h.keydown);
      this._handlers = null;
    }

    this._audio?.dispose?.();
    this._audio = null;
    this.cosmos.dispose();
    this.postfx.dispose();
    this.renderer.dispose();
  }
}
