// Deep-field starfield shader. Cheaper than the galaxy shader: no ripples,
// just slow parallax drift, twinkle and size attenuation.

export const starfieldVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;

  attribute float aSeed;
  attribute float aSize;
  attribute float aTwinkle;
  attribute vec3  aColor;

  varying vec3  vColor;
  varying float vTwinkle;

  void main() {
    vec3 p = position;
    // Gentle drift so the background never feels static.
    p.x += sin( uTime * 0.03 + aSeed * 60.0 ) * 2.5;
    p.y += cos( uTime * 0.026 + aSeed * 41.0 ) * 2.0;

    vec4 mvPosition = modelViewMatrix * vec4( p, 1.0 );
    gl_Position = projectionMatrix * mvPosition;

    float tw = 0.45 + 0.55 * sin( uTime * ( 0.7 + aTwinkle * 1.4 ) + aSeed * 91.0 );
    gl_PointSize = clamp( uSize * aSize * ( 0.6 + tw ) * ( 900.0 / max( -mvPosition.z, 0.1 ) ) * uPixelRatio, 0.5, 6.0 );

    vColor   = aColor;
    vTwinkle = tw;
  }
`;

export const starfieldFragmentShader = /* glsl */ `
  varying vec3  vColor;
  varying float vTwinkle;

  void main() {
    vec2  c     = gl_PointCoord - 0.5;
    float dist  = length( c );
    float alpha = smoothstep( 0.5, 0.0, dist );
    alpha = pow( alpha, 2.4 );

    gl_FragColor = vec4( vColor * ( 0.55 + 0.75 * vTwinkle ), alpha * ( 0.5 + 0.5 * vTwinkle ) );
  }
`;
