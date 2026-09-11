import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { gradeShader } from '../shaders/grade.js';
import { highlightShader } from '../shaders/highlight.js';

/**
 * Builds the post-processing chain:
 *   scene -> UnrealBloom -> film grade (grain/vignette/aberration) -> output
 */
export class PostFX {
  constructor(renderer, scene, camera, size, options = {}) {
    this.renderer = renderer;
    this.reducedMotion = options.reducedMotion === true;
    this.composer = new EffectComposer(renderer);

    this.renderPass = new RenderPass(scene, camera);
    this.highlightPass = new ShaderPass(highlightShader);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.width, size.height),
      0.68, // strength
      0.6,  // radius
      0.8   // threshold
    );

    this.gradePass = new ShaderPass(gradeShader);
    this.gradePass.uniforms.uResolution.value = new THREE.Vector2(size.width, size.height);

    this.outputPass = new OutputPass();

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.highlightPass); // bounds brightness before bloom
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.gradePass);
    this.composer.addPass(this.outputPass);

    this._baseBloom = 0.68;
    this.gradePass.uniforms.uGrain.value = this.reducedMotion ? 0.012 : 0.05;
  }

  update(elapsed, energy) {
    this.gradePass.uniforms.uTime.value = elapsed;
    this.gradePass.uniforms.uIntensity.value = energy;
    // Bloom breathes slightly with interaction energy.
    this.bloomPass.strength = this._baseBloom + energy * 0.55;
  }

  render(dt) {
    this.composer.render(dt);
  }

  setPixelRatio(pr) {
    this.composer.setPixelRatio(pr);
  }

  setSize(width, height) {
    this.composer.setSize(width, height);
    this.gradePass.uniforms.uResolution.value.set(width, height);
  }

  setBloomStrength(value) {
    this._baseBloom = value;
  }

  dispose() {
    this.composer.dispose();
  }
}
