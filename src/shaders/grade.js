// Final cinematic grade pass: subtle radial chromatic aberration, film grain
// and vignette. Runs in linear space just before OutputPass (which applies
// tone mapping and the sRGB transfer).

export const gradeShader = {
  name: 'AetherGradeShader',
  uniforms: {
    tDiffuse:    { value: null },
    uTime:       { value: 0 },
    uResolution: { value: null }, // THREE.Vector2
    uAberration: { value: 0.0016 },
    uGrain:      { value: 0.05 },
    uVignette:   { value: 0.85 },
    uIntensity:  { value: 0.0 }   // extra exposure/energy from interactions
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
    uniform float uTime;
    uniform vec2  uResolution;
    uniform float uAberration;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uIntensity;

    varying vec2 vUv;

    float hash( vec2 p ) {
      return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453123 );
    }

    void main() {
      vec2 uv = vUv;
      vec2 centered = uv - 0.5;
      float radius = length( centered );

      // Radial chromatic aberration, strongest toward the edges.
      vec2 offset = centered * radius * uAberration;
      vec3 color;
      color.r = texture2D( tDiffuse, uv + offset ).r;
      color.g = texture2D( tDiffuse, uv ).g;
      color.b = texture2D( tDiffuse, uv - offset ).b;

      // Interaction warmth.
      color *= 1.0 + uIntensity * 0.35;
      color += vec3( 0.35, 0.5, 1.0 ) * uIntensity * 0.05;

      // Vignette.
      float vignette = smoothstep( 0.95, 0.22, radius );
      color *= mix( 1.0, vignette, uVignette * 0.55 );

      // Animated film grain, scaled to pixels for a stable grain size.
      vec2 grainUv = uv * uResolution + vec2( uTime * 51.0, uTime * 29.0 );
      float grain = hash( floor( grainUv ) ) - 0.5;
      color += grain * uGrain;

      gl_FragColor = vec4( max( color, 0.0 ), 1.0 );
    }
  `
};
