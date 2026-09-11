// Energy bloom / shockwave emitted when the visitor seeds a cluster.
// A single quad lying in the galactic plane: an expanding ring plus a hot
// core flash.

export const burstVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

export const burstFragmentShader = /* glsl */ `
  uniform float uProgress;
  uniform vec3  uColor;
  uniform float uOpacity;

  varying vec2 vUv;

  void main() {
    vec2  c = vUv - 0.5;
    float r = length( c ) * 2.0;

    float ring = exp( - pow( ( r - uProgress ) * 5.5, 2.0 ) );
    ring *= 1.0 - smoothstep( 0.65, 1.0, r );
    float core = exp( - r * r * 9.0 ) * ( 1.0 - uProgress );

    float alpha = ( ring * 0.9 + core * 1.35 ) * ( 1.0 - uProgress ) * uOpacity;
    if ( alpha < 0.002 ) discard;

    vec3 color = uColor * ( 1.0 + core * 1.6 );
    gl_FragColor = vec4( color, alpha );
  }
`;
