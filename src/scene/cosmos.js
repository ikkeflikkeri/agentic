import * as THREE from 'three';
import { Galaxy } from './galaxy.js';
import { Starfield } from './starfield.js';
import { Nebula } from './nebula.js';
import { BurstField } from './burst.js';
import { ClusterField, CLUSTER_LIFE } from './cluster.js';

const GALACTIC_PLANE = new THREE.Vector3(0, 1, 0);

// Lifecycle tuning: a mature cluster may collapse into a supernova that
// re-seeds a smaller generation nearby, so the universe keeps itself alive.
const SUPERNOVA_AGE = CLUSTER_LIFE * 0.8;
const SUPERNOVA_CHANCE = 0.6;
const MAX_CELLS = 48;
const MAX_LOGGED_SEEDS = 64;

/**
 * Composes the whole universe and owns the interaction entry point.
 */
export class Cosmos {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.reducedMotion = options.reducedMotion === true;

    // Continuous background motion runs at a fraction of speed (or off) when
    // the visitor prefers reduced motion.
    this._animTime = 0;
    this._timeScale = this.reducedMotion ? 0.12 : 1.0;

    this.nebula = new Nebula(2600);
    this.starfield = new Starfield(14000);
    this.galaxy = new Galaxy(140000, { reducedMotion: this.reducedMotion });
    this.clusters = new ClusterField(9000);
    this.bursts = new BurstField();

    this.group = new THREE.Group();
    this.group.add(this.nebula.mesh);
    this.group.add(this.starfield.points);
    this.group.add(this.clusters.points);
    this.group.add(this.galaxy.points);
    this.group.add(this.bursts.group);
    scene.add(this.group);

    this._raycaster = new THREE.Raycaster();
    this._plane = new THREE.Plane(GALACTIC_PLANE, 0);
    this._hit = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._burstColor = new THREE.Color();

    this._energy = 0;
    this._lastSeed = 0;
    this._lastBurst = -10;
    this._lastElapsed = 0;

    // Universe memory: user-planted seeds (for share links) and "cells" that
    // age and may collapse into supernovae.
    this.seedLog = [];
    this._cells = [];
    /** Optional hook, set by the app: (position) => void on each supernova. */
    this.onSupernova = null;
  }

  /**
   * Convert a normalized device coordinate into a point on the galactic plane.
   * Falls back to a point along the view ray if the plane is behind the camera.
   */
  projectToPlane(ndc, camera) {
    this._raycaster.setFromCamera(ndc, camera);
    const hit = this._raycaster.ray.intersectPlane(this._plane, this._hit);
    if (hit) return this._hit.clone();

    this._raycaster.ray.at(90, this._hit);
    this._hit.y = 0;
    return this._hit.clone();
  }

  /**
   * Seed a cluster + shockwave at a world point. Rapid repeats share one
   * shockwave (throttled) so stacked additive quads cannot saturate to white.
   * @param {THREE.Vector3} worldPoint
   * @param {number} count
   * @param {{share?: boolean, cascade?: boolean}} [opts] `share: false` skips
   *   the share-log entry; `cascade: false` marks seeds restored from a shared
   *   URL so they do not immediately explode into supernovae.
   */
  seedAt(worldPoint, count = 340, opts = {}) {
    this.galaxy.seedBurst(worldPoint);
    this.clusters.seed(worldPoint, count);

    if (opts.share !== false) {
      this.seedLog.push({ x: worldPoint.x, z: worldPoint.z, count });
      if (this.seedLog.length > MAX_LOGGED_SEEDS) this.seedLog.shift();
    }

    // Every seed becomes a living cell that may one day go supernova.
    this._cells.push({
      pos: worldPoint.clone(),
      born: this._lastElapsed,
      count,
      silent: opts.cascade === false,
      // Pseudorandom jitter is fine here: it staggers visual timing only.
      due: this._lastElapsed + SUPERNOVA_AGE + Math.random() * 4.0 // NOSONAR: non-security visual timing
    });
    if (this._cells.length > MAX_CELLS) this._cells.shift();

    if (this._lastElapsed - this._lastBurst > 0.16) {
      this._lastBurst = this._lastElapsed;
      this._burstColor.setHSL(0.56 + Math.random() * 0.12, 0.7, 0.72);
      this.bursts.spawn(worldPoint, this._burstColor);
    }

    // Cap accumulated energy so bloom does not spike on repeated seeding.
    this._energy = Math.min(1.0, this._energy + 0.5);
  }

  /** Throttled seeding used while dragging so we do not spawn every frame. */
  seedIfReady(worldPoint, elapsed, interval = 0.14) {
    if (elapsed - this._lastSeed < interval) return false;
    this._lastSeed = elapsed;
    this.seedAt(worldPoint, 200);
    return true;
  }

  setQuality({ galaxyCount, nebulaOctaves, pixelRatio, particleSize }) {
    if (galaxyCount != null) this.galaxy.setCount(galaxyCount);
    if (nebulaOctaves != null) this.nebula.setOctaves(nebulaOctaves);
    if (pixelRatio != null) {
      this.galaxy.setPixelRatio(pixelRatio);
      this.starfield.setPixelRatio(pixelRatio);
      this.clusters.setPixelRatio(pixelRatio);
    }
    if (particleSize != null) this.galaxy.uniforms.uSize.value = particleSize;
  }

  update(dt, elapsed) {
    this._lastElapsed = elapsed;
    this._animTime += dt * this._timeScale;

    // Continuous backdrop motion uses the scaled clock; discrete effects
    // (clusters, shockwaves) keep the real clock so they stay snappy.
    this.nebula.update(this._animTime);
    this.starfield.update(this._animTime);
    this.galaxy.update(this._animTime);
    this.clusters.update(dt, elapsed);
    this.bursts.update(elapsed);

    this._updateLifecycle(elapsed);

    const target = Math.max(this.galaxy.getEnergy(), this.clusters.getEnergy());
    this._energy += (target - this._energy) * Math.min(1, dt * 3.0);
  }

  /**
   * Age every seeded cluster; mature ones may collapse into a supernova —
   * a golden shockwave plus a smaller second-generation cluster nearby.
   */
  _updateLifecycle(elapsed) {
    if (this._cells.length === 0) return;

    const survivors = [];
    for (const cell of this._cells) {
      if (elapsed < cell.due) {
        survivors.push(cell);
        continue;
      }

      cell.collapsed = true;

      // Seeds restored from a shared URL stay quiet: they replay the shared
      // layout without instantly exploding.
      const mayExplode = !this.reducedMotion && !cell.silent;
      // Pseudorandomness below only varies visuals; no security use.
      if (mayExplode && Math.random() < SUPERNOVA_CHANCE) { // NOSONAR: cosmetic randomness
        const color = this._burstColor.setHSL(0.09 + Math.random() * 0.04, 0.85, 0.7); // NOSONAR: cosmetic
        this.bursts.spawn(cell.pos, color);
        this.galaxy.seedBurst(cell.pos);

        // Second generation: smaller, slightly offset, not share-logged.
        const offset = new THREE.Vector3(
          (Math.random() - 0.5) * 14, // NOSONAR: cosmetic
          0,
          (Math.random() - 0.5) * 14 // NOSONAR: cosmetic
        ).add(cell.pos);
        this.seedAt(offset, Math.min(180, Math.max(60, Math.trunc(cell.count * 0.3))), { share: false });
        this._energy = Math.min(1.0, this._energy + 0.35);
        this.onSupernova?.(cell.pos);
      }
      // Collapsed cells are dropped either way; the chain continues via the
      // second-generation cell pushed above.
    }

    // Keep only cells that have not reached their due date; re-seeds pushed
    // during the loop above are picked up next frame.
    this._cells = survivors;
  }

  getEnergy() {
    return Math.max(this._energy, this.clusters.getEnergy());
  }

  dispose() {
    this.nebula.dispose();
    this.starfield.dispose();
    this.galaxy.dispose();
    this.clusters.dispose();
    this.bursts.dispose();
  }
}
