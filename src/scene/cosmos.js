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
  constructor(scene) {
    this.scene = scene;

    this.nebula = new Nebula(2600);
    this.starfield = new Starfield(14000);
    this.galaxy = new Galaxy(140000);
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

  /** Seed a cluster + shockwave at a world point. */
  seedAt(worldPoint, count = 340) {
    this.galaxy.seedBurst(worldPoint);
    this.clusters.seed(worldPoint, count);
    this._burstColor.setHSL(0.56 + Math.random() * 0.12, 0.7, 0.72);
    this.bursts.spawn(worldPoint, this._burstColor);
    this._energy = Math.min(1.5, this._energy + 0.8);
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
    this.nebula.update(elapsed);
    this.starfield.update(elapsed);
    this.galaxy.update(elapsed);
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
