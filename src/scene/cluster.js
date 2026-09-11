import * as THREE from 'three';
import { clusterVertexShader, clusterFragmentShader } from '../shaders/cluster.js';

export const CLUSTER_LIFE = 12.0;

/**
 * Pooled stars that are literally seeded by the visitor: every pointer burst
 * claims a slice of the pool, launches it outward from the hit point and lets
 * it curl into a slowly orbiting, fading cluster.
 */
export class ClusterField {
  constructor(capacity = 9000) {
    this.capacity = capacity;
    this._cursor = 0;
    this._time = 0;
    this._spawnEnergy = 0;

    const positions = new Float32Array(capacity * 3);
    const velocities = new Float32Array(capacity * 3);
    const colors = new Float32Array(capacity * 3);
    const seeds = new Float32Array(capacity);
    const sizes = new Float32Array(capacity);
    const starts = new Float32Array(capacity).fill(-1000);
    const dirs = new Float32Array(capacity);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aStart', new THREE.BufferAttribute(starts, 1));
    geometry.setAttribute('aDir', new THREE.BufferAttribute(dirs, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 5000);

    this.geometry = geometry;
    this.positionAttr = geometry.getAttribute('position');
    this.velocityAttr = geometry.getAttribute('aVelocity');
    this.colorAttr = geometry.getAttribute('aColor');
    this.seedAttr = geometry.getAttribute('aSeed');
    this.sizeAttr = geometry.getAttribute('aSize');
    this.startAttr = geometry.getAttribute('aStart');
    this.dirAttr = geometry.getAttribute('aDir');

    this.uniforms = {
      uTime: { value: 0 },
      uSize: { value: 1.25 },
      uPixelRatio: { value: 1 },
      uLife: { value: CLUSTER_LIFE }
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: clusterVertexShader,
      fragmentShader: clusterFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /** Seed `count` new stars around a world position at the current time. */
  seed(origin, count = 340) {
    const n = Math.min(count, this.capacity);
    const white = new THREE.Color(0.85, 0.92, 1.0);
    const gold = new THREE.Color(1.0, 0.8, 0.5);
    const violet = new THREE.Color(0.65, 0.5, 1.0);
    const color = new THREE.Color();

    for (let k = 0; k < n; k++) {
      const idx = this._cursor;
      this._cursor = (this._cursor + 1) % this.capacity;
      const i3 = idx * 3;

      // Start in a tiny sphere so the bloom visibly grows from a point.
      const ox = (Math.random() - 0.5) * 0.6;
      const oy = (Math.random() - 0.5) * 0.35;
      const oz = (Math.random() - 0.5) * 0.6;
      this.positionAttr.array[i3] = origin.x + ox;
      this.positionAttr.array[i3 + 1] = origin.y + oy;
      this.positionAttr.array[i3 + 2] = origin.z + oz;

      // Launch mostly radially in the galactic plane with some vertical fan.
      const theta = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.pow(Math.random(), 1.6) * 6.5;
      this.velocityAttr.array[i3] = Math.cos(theta) * speed;
      this.velocityAttr.array[i3 + 1] = (Math.random() - 0.5) * speed * 0.55;
      this.velocityAttr.array[i3 + 2] = Math.sin(theta) * speed;

      const roll = Math.random();
      if (roll > 0.82) color.copy(gold);
      else if (roll > 0.6) color.copy(violet);
      else color.copy(white);
      const bright = 0.65 + Math.random() * 0.5;
      this.colorAttr.array[i3] = color.r * bright;
      this.colorAttr.array[i3 + 1] = color.g * bright;
      this.colorAttr.array[i3 + 2] = color.b * bright;

      this.seedAttr.array[idx] = Math.random();
      this.sizeAttr.array[idx] = 0.35 + Math.pow(Math.random(), 2.0) * 1.5;
      this.startAttr.array[idx] = this._time + Math.random() * 0.14;
      this.dirAttr.array[idx] = (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random());
    }

    this.positionAttr.needsUpdate = true;
    this.velocityAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.seedAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.startAttr.needsUpdate = true;
    this.dirAttr.needsUpdate = true;

    this._spawnEnergy = Math.min(1.4, this._spawnEnergy + 0.75);
  }

  seedAt(worldPoint, count) {
    this.seed(worldPoint, count);
  }

  setPixelRatio(pr) {
    this.uniforms.uPixelRatio.value = pr;
  }

  update(dt, elapsed) {
    this._time = elapsed;
    this.uniforms.uTime.value = elapsed;
    this._spawnEnergy *= Math.exp(-dt * 1.4);
  }

  getEnergy() {
    return Math.min(1, this._spawnEnergy);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
