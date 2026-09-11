// Newly seeded star cluster. A pooled particle system where each point carries
// its own emission time; the shader blooms it outward, curls it into a slow
// orbit and fades it over a long lifetime. Points before their start time are
// culled off-screen.

export const clusterVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uLife;

  // position carries the emission origin; aVelocity the outward launch.
  attribute vec3  aVelocity;
  attribute vec3  aColor;
  attribute float aSeed;
  attribute float aSize;
  attribute float aStart;
  attribute float aDir;

  varying vec3  vColor;
  varying float vFade;

  void main() {
    float age = uTime - aStart;

    if ( aStart < -100.0 || age < 0.0 || age > uLife ) {
      gl_Position  = vec4( 2.0, 2.0, 2.0, 1.0 );
      gl_PointSize = 0.0;
      vColor = vec3( 0.0 );
      vFade  = 0.0;
      return;
    }

    // Ease-out expansion, then a slow orbit around the cluster centre.
    float k   = 1.0 - exp( - age * 0.75 );
    vec3  rel = aVelocity * k / 0.75;

    float angle = age * 0.65 * aDir + aSeed * 6.2831;
    float ca = cos( angle );
    float sa = sin( angle );
    rel.xz = mat2( ca, -sa, sa, ca ) * rel.xz;

    vec3 p = position + rel;

    vec4 mvPosition = modelViewMatrix * vec4( p, 1.0 );
    gl_Position = projectionMatrix * mvPosition;

    float tw = 0.55 + 0.45 * sin( uTime * 3.2 + aSeed * 53.0 );
    float fadeIn  = smoothstep( 0.0, 0.4, age );
    float fadeOut = 1.0 - smoothstep( uLife - 4.0, uLife, age );
    vFade = fadeIn * fadeOut * tw;

    gl_PointSize = clamp(
      uSize * ( 0.4 + aSize ) * tw * ( 430.0 / max( -mvPosition.z, 0.1 ) ) * uPixelRatio,
      0.6, 18.0
    );
    vColor = aColor;
  }
`;

export const clusterFragmentShader = /* glsl */ `
  varying vec3  vColor;
  varying float vFade;

  void main() {
    vec2  c     = gl_PointCoord - 0.5;
    float dist  = length( c );
    float alpha = smoothstep( 0.5, 0.0, dist );
    alpha = pow( alpha, 2.0 );

    gl_FragColor = vec4( vColor * ( 0.7 + 0.6 * vFade ), alpha * vFade );
  }
`;
