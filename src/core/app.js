import * as THREE from 'three';
import { Cosmos } from '../scene/cosmos.js';
import { CameraRig } from '../scene/cameraRig.js';
import { PostFX } from './postfx.js';
import { QualityManager } from './quality.js';
import { HUD } from '../ui/hud.js';
import { initAudio } from '../audio/bridge.js';

export function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl2') || canvas.getContext('webgl'))
    );
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

    this.cosmos = new Cosmos(this.scene);
    this.rig = new CameraRig(this.camera);
    this.postfx = new PostFX(this.renderer, this.scene, this.camera, size);

    this.quality = new QualityManager((tier, pr) => this._applyQuality(tier, pr));
    this._applyQuality(this.quality.tier, this.quality.pixelRatio);

    this._boundResize = () => this._onResize();
    this._bindEvents();

    // Optional audio: resolves to null when no engine module is present.
    initAudio(() => this.cosmos.getEnergy())
      .then((bridge) => {
        this._audio = bridge;
      })
      .catch(() => {
        this._audio = null;
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
    window.addEventListener('resize', this._boundResize, { passive: true });
    window.addEventListener('orientationchange', this._boundResize, { passive: true });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.paused = true;
      } else {
        this.paused = false;
        this._last = performance.now() / 1000;
      }
    });

    this.canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    window.addEventListener('pointermove', (e) => this._onPointerMove(e), { passive: true });
    window.addEventListener('pointerup', (e) => this._onPointerUp(e), { passive: true });
    window.addEventListener('pointercancel', (e) => this._onPointerUp(e), { passive: true });
    this.canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('keydown', (e) => this._onKeyDown(e));
  }

  _onResize() {
    if (this._resizePending) return;
    this._resizePending = true;
    requestAnimationFrame(() => {
      this._resizePending = false;
      const { width, height } = this._size();
      const pr = this.quality.pixelRatio;

      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();

      this.postfx.setPixelRatio(pr);
      this.postfx.setSize(width, height);
    });
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
  }

  _onKeyDown(e) {
    const step = 0.05;
    switch (e.key) {
      case ' ':
      case 'Enter':
        e.preventDefault();
        this.hud.notifyActivity();
        this.rig.skipIntro();
        this.cosmos.seedAt(this.cosmos.projectToPlane(new THREE.Vector2(0, 0), this.camera), 420);
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
    window.removeEventListener('resize', this._boundResize);
    window.removeEventListener('orientationchange', this._boundResize);
    this.cosmos.dispose();
    this.postfx.dispose();
    this.renderer.dispose();
  }
}
