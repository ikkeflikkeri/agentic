import * as THREE from 'three';
import { nebulaVertexShader, nebulaFragmentShader } from '../shaders/nebula.js';

/**
 * Backdrop nebula: an enormous inside-out sphere rendered with a domain-warped
 * fbm shader, giving the impression of volumetric gas the camera flies through.
 */
export class Nebula {
  constructor(radius = 900) {
    const geometry = new THREE.SphereGeometry(radius, 48, 32);

    this.uniforms = {
      uTime: { value: 0 },
      uOctaves: { value: 5 },
      uIntensity: { value: 1.0 }
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: nebulaVertexShader,
      fragmentShader: nebulaFragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      transparent: false
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  /** Lower octave count on weak GPUs, courtesy of the quality manager. */
  setOctaves(octaves) {
    this.uniforms.uOctaves.value = Math.max(2, Math.min(5, octaves | 0));
  }

  setIntensity(value) {
    this.uniforms.uIntensity.value = value;
  }

  update(elapsed) {
    this.uniforms.uTime.value = elapsed;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
