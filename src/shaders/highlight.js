// Pre-bloom highlight compression.
// Runs immediately after the scene render, before UnrealBloom. Values below
// the knee pass through untouched (dim stars keep their contrast); brighter
// values are rolled off onto a soft shoulder so heavy additive accumulation
// from repeated seeding cannot clip into a hard white block. The bloom pass
// then sees a graceful, bounded signal.

export const highlightShader = {
  name: 'AetherHighlightShader',
  uniforms: {
    tDiffuse: { value: null },
    uKnee: { value: 0.72 },
    uSoftness: { value: 0.9 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uKnee;
    uniform float uSoftness;

    varying vec2 vUv;

    void main() {
      vec3 color = texture2D( tDiffuse, vUv ).rgb;

      float peak = max( color.r, max( color.g, color.b ) );
      float compressed = peak;
      if ( peak > uKnee ) {
        float over = peak - uKnee;
        compressed = uKnee + over / ( 1.0 + over * uSoftness );
      }
      float scale = peak > 0.0001 ? compressed / peak : 1.0;

      gl_FragColor = vec4( color * scale, 1.0 );
    }
  `
};
