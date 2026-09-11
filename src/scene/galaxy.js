import * as THREE from 'three';
import { galaxyVertexShader, galaxyFragmentShader, MAX_RIPPLES } from '../shaders/galaxy.js';

const GALAXY_MAX_RADIUS = 66;
const ARM_COUNT = 2;

function gaussian() {
  // Box–Muller, clamped so we never emit absurd outliers.
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(-1, Math.min(1, g / 3));
}

function mixColor(a, b, t, out) {
  return out.copy(a).lerp(b, t);
}

/**
 * The main GPU galaxy: a single Points draw call with ~140k particles whose
 * motion, colour, twinkle and interactive ripples are computed in the vertex
 * shader from cylindrical coordinates.
 */
export class Galaxy {
  constructor(maxCount = 140000, options = {}) {
    this.maxCount = maxCount;
    this.reducedMotion = options.reducedMotion === true;

    const positions = new Float32Array(maxCount * 3); // radius, angle, height
    const colors = new Float32Array(maxCount * 3);
    const seeds = new Float32Array(maxCount);
    const sizes = new Float32Array(maxCount);
    const twinkles = new Float32Array(maxCount);

    const inner = new THREE.Color(1.0, 0.82, 0.52);
    const mid = new THREE.Color(0.66, 0.76, 1.0);
    const outer = new THREE.Color(0.42, 0.32, 0.94);
    const tmpA = new THREE.Color();
    const tmpB = new THREE.Color();

    const BULGE_SHARE = 0.16;

    for (let i = 0; i < maxCount; i++) {
      const i3 = i * 3;

      let radius;
      let angle;
      let height;
      let bulge = false;

      if (Math.random() < BULGE_SHARE) {
        // Warm central bulge, roughly spheroidal.
        bulge = true;
        radius = Math.pow(Math.random(), 1.5) * 17;
        angle = Math.random() * Math.PI * 2;
        height = gaussian() * 2.1 * (1 - radius / 26);
      } else {
        // Two logarithmic spiral arms plus a diffuse halo.
        const t = Math.pow(Math.random(), 0.6);
        radius = 9 + t * (GALAXY_MAX_RADIUS - 9);

        const inArm = Math.random() > 0.3;
        const arm = Math.floor(Math.random() * ARM_COUNT);
        const armAngle = arm * Math.PI + Math.log(radius / 6) * 2.05;
        const spread = inArm ? 0.1 + 0.7 / radius : 0.5 + 1.3 / radius;
        angle = armAngle + gaussian() * spread;
        height = gaussian() * (inArm ? 0.85 : 1.6);
      }

      positions[i3] = radius;
      positions[i3 + 1] = angle;
      positions[i3 + 2] = height;

      // Colour gradient: warm core -> blue mid -> violet rim.
      const rn = Math.min(1, radius / GALAXY_MAX_RADIUS);
      if (rn < 0.35) {
        mixColor(inner, mid, rn / 0.35, tmpA);
      } else {
        mixColor(mid, outer, (rn - 0.35) / 0.65, tmpA);
      }
      const shade = (bulge ? 0.4 : 0.58) * (0.9 + Math.random() * 0.2);
      tmpB.setRGB(tmpA.r * shade, tmpA.g * shade, tmpA.b * shade);
      // A few rare hot blue stars.
      if (Math.random() > 0.985) tmpB.setRGB(0.6, 0.72, 0.95);

      colors[i3] = tmpB.r;
      colors[i3 + 1] = tmpB.g;
      colors[i3 + 2] = tmpB.b;

      seeds[i] = Math.random();
      sizes[i] = 0.18 + Math.pow(Math.random(), 3.0) * 1.5;
      twinkles[i] = Math.random();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkles, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), GALAXY_MAX_RADIUS * 2);

    const ripplePos = [];
    for (let i = 0; i < MAX_RIPPLES; i++) ripplePos.push(new THREE.Vector3(0, -9999, 0));

    this.uniforms = {
      uTime: { value: 0 },
      uSize: { value: 0.68 },
      uPixelRatio: { value: 1 },
      uSpin: { value: 1.0 },
      uOpacity: { value: 0.7 },
      uRipplePos: { value: ripplePos },
      uRippleStart: { value: new Float32Array(MAX_RIPPLES).fill(-1000) },
      uRippleSpeed: { value: new Float32Array(MAX_RIPPLES) },
      uRippleStrength: { value: new Float32Array(MAX_RIPPLES) }
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: galaxyVertexShader,
      fragmentShader: galaxyFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 1;

    this._rippleIndex = 0;
    this._time = 0;
    this._count = maxCount;
    geometry.setDrawRange(0, maxCount);
  }

  /** Emit an expanding ripple + energy flash at a world position. */
  seedBurst(worldPoint) {
    const i = this._rippleIndex % MAX_RIPPLES;
    this._rippleIndex++;

    const damp = this.reducedMotion ? 0.45 : 1.0;
    this.uniforms.uRipplePos.value[i].copy(worldPoint);
    this.uniforms.uRippleStart.value[i] = this._time;
    this.uniforms.uRippleSpeed.value[i] = (8.5 + Math.random() * 3.5) * damp;
    this.uniforms.uRippleStrength.value[i] = (1.15 + Math.random() * 0.4) * damp;
    this.material.uniformsNeedUpdate = true;
  }

  /** Adaptive quality: restrict how many of the allocated points are drawn. */
  setCount(count) {
    this._count = Math.max(1000, Math.min(this.maxCount, Math.floor(count)));
    this.points.geometry.setDrawRange(0, this._count);
  }

  getCount() {
    return this._count;
  }

  setPixelRatio(pr) {
    this.uniforms.uPixelRatio.value = pr;
  }

  update(elapsed) {
    this._time = elapsed;
    this.uniforms.uTime.value = elapsed;
  }

  /** 0..1-ish transient energy, used to drive the audio hook and grade pass. */
  getEnergy() {
    let energy = 0;
    const start = this.uniforms.uRippleStart.value;
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const age = this._time - start[i];
      if (age >= 0 && age < 4.5) energy += Math.exp(-age * 1.2);
    }
    return Math.min(1, energy);
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
