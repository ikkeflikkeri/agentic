import * as THREE from 'three';
import { burstVertexShader, burstFragmentShader } from '../shaders/burst.js';

const POOL_SIZE = 8;
const LIFE = 1.7;

/**
 * A small pool of additive shockwave quads. Each seeded cluster triggers one:
 * a hot core flash that expands into a ring lying in the galactic plane.
 */
export class BurstField {
  constructor(sharedGeometry) {
    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    this._time = 0;
    this._index = 0;
    this._effects = [];

    const geometry = sharedGeometry || new THREE.PlaneGeometry(1, 1);

    for (let i = 0; i < POOL_SIZE; i++) {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uProgress: { value: 0 },
          uColor: { value: new THREE.Color(0.6, 0.8, 1.0) },
          uOpacity: { value: 0 }
        },
        vertexShader: burstVertexShader,
        fragmentShader: burstFragmentShader,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      this.group.add(mesh);

      this._effects.push({ mesh, material, start: -1000, active: false });
    }
  }

  spawn(point, color) {
    const effect = this._effects[this._index % POOL_SIZE];
    this._index++;

    effect.start = this._time;
    effect.active = true;
    effect.mesh.position.copy(point);
    effect.mesh.visible = true;
    if (color) effect.material.uniforms.uColor.value.copy(color);
  }

  update(elapsed) {
    this._time = elapsed;

    for (const effect of this._effects) {
      if (!effect.active) continue;
      const age = elapsed - effect.start;
      const progress = age / LIFE;

      if (progress >= 1) {
        effect.active = false;
        effect.mesh.visible = false;
        effect.material.uniforms.uOpacity.value = 0;
        continue;
      }

      const eased = 1 - Math.pow(1 - progress, 2.2);
      const scale = 2.5 + eased * 42;
      effect.mesh.scale.set(scale, scale, 1);
      effect.material.uniforms.uProgress.value = eased;
      effect.material.uniforms.uOpacity.value = Math.min(1, (1 - progress) * 1.0);
    }
  }

  dispose() {
    for (const effect of this._effects) {
      effect.material.dispose();
    }
  }
}
