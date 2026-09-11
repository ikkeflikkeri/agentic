import * as THREE from 'three';
import { starfieldVertexShader, starfieldFragmentShader } from '../shaders/starfield.js';

/**
 * Deep-field starfield: a wide shell of twinkling points that gives the scene
 * parallax and depth behind the galaxy.
 */
export class Starfield {
  constructor(count = 14000) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    const twinkles = new Float32Array(count);

    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      // Uniform distribution on a spherical shell.
      const u = Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const radius = 700 + Math.pow(Math.random(), 0.7) * 1300;
      positions[i3] = Math.cos(theta) * s * radius;
      positions[i3 + 1] = u * radius;
      positions[i3 + 2] = Math.sin(theta) * s * radius;

      // Mostly cool white with occasional warm and blue stars.
      const roll = Math.random();
      if (roll > 0.93) color.setRGB(1.0, 0.82, 0.62);
      else if (roll > 0.84) color.setRGB(0.68, 0.82, 1.0);
      else color.setRGB(0.85, 0.9, 1.0);
      const dim = 0.45 + Math.random() * 0.55;
      colors[i3] = color.r * dim;
      colors[i3 + 1] = color.g * dim;
      colors[i3 + 2] = color.b * dim;

      seeds[i] = Math.random();
      sizes[i] = 0.4 + Math.pow(Math.random(), 2.0) * 1.6;
      twinkles[i] = Math.random();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkles, 1));

    this.uniforms = {
      uTime: { value: 0 },
      uSize: { value: 1.0 },
      uPixelRatio: { value: 1 }
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: starfieldVertexShader,
      fragmentShader: starfieldFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 0;
  }

  setPixelRatio(pr) {
    this.uniforms.uPixelRatio.value = pr;
  }

  update(elapsed) {
    this.uniforms.uTime.value = elapsed;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
