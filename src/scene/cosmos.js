import * as THREE from 'three';
import { Galaxy } from './galaxy.js';
import { Starfield } from './starfield.js';
import { Nebula } from './nebula.js';
import { BurstField } from './burst.js';
import { ClusterField } from './cluster.js';

const GALACTIC_PLANE = new THREE.Vector3(0, 1, 0);

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
   */
  seedAt(worldPoint, count = 340) {
    this.galaxy.seedBurst(worldPoint);
    this.clusters.seed(worldPoint, count);

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

    const target = Math.max(this.galaxy.getEnergy(), this.clusters.getEnergy());
    this._energy += (target - this._energy) * Math.min(1, dt * 3.0);
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
