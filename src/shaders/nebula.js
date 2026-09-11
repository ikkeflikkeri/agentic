// Volumetric-feeling nebula backdrop.
// A huge inverted sphere; the fragment shader domains-warps 3D value noise
// along the view direction to fake layered, parallaxing gas clouds plus a
// faint procedural star dusting. Detail is driven by uOctaves for adaptive
// quality.

export const nebulaVertexShader = /* glsl */ `
  varying vec3 vDir;

  void main() {
    vDir = normalize( position );
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

export const nebulaFragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform int   uOctaves;
  uniform float uIntensity;

  varying vec3 vDir;

  float hash( vec3 p ) {
    p = fract( p * 0.3183099 + vec3( 0.71, 0.113, 0.419 ) );
    p *= 17.0;
    return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
  }

  float noise( vec3 x ) {
    vec3 i = floor( x );
    vec3 f = fract( x );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( mix( hash( i + vec3( 0.0, 0.0, 0.0 ) ), hash( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ),
           mix( hash( i + vec3( 0.0, 1.0, 0.0 ) ), hash( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ), f.y ),
      mix( mix( hash( i + vec3( 0.0, 0.0, 1.0 ) ), hash( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ),
           mix( hash( i + vec3( 0.0, 1.0, 1.0 ) ), hash( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ), f.y ),
      f.z );
  }

  float fbm( vec3 p ) {
    float amp = 0.5;
    float sum = 0.0;
    for ( int i = 0; i < 5; i ++ ) {
      if ( i >= uOctaves ) break;
      sum += amp * noise( p );
      p *= 2.03;
      amp *= 0.5;
    }
    return sum;
  }

  void main() {
    vec3 dir = normalize( vDir );

    // Galactic band: gas concentrates toward the horizontal plane.
    float band = exp( - pow( dir.y * 2.35, 2.0 ) );
    float bandSoft = exp( - pow( dir.y * 1.1, 2.0 ) );

    // Domain-warped fbm for billowy, layered clouds.
    vec3 q = dir * 2.3;
    float warp = fbm( q + vec3( 0.0, uTime * 0.018, 0.0 ) );
    float n    = fbm( q + warp * 1.7 + vec3( uTime * 0.012, 0.0, uTime * 0.008 ) );

    float clouds = smoothstep( 0.30, 0.92, n );
    float wisps  = smoothstep( 0.55, 1.0, n );
    float dust   = smoothstep( 0.6, 1.0, fbm( dir * 6.0 + warp * 2.0 ) );

    // Palette: near-black indigo with restrained violet/teal wisps so the
    // galaxy itself stays the brightest thing on screen.
    vec3 deep   = vec3( 0.012, 0.020, 0.055 );
    vec3 violet = vec3( 0.26, 0.09, 0.46 );
    vec3 teal   = vec3( 0.05, 0.36, 0.40 );

    vec3 color = deep;
    color += violet * clouds * 0.27;
    color += violet * smoothstep( 0.5, 1.0, n ) * 0.17;
    color += teal * band * clouds * 0.16;
    color += vec3( 0.55, 0.32, 0.95 ) * pow( wisps, 3.0 ) * 0.11;
    color *= 0.30 + bandSoft * 0.82;

    // Faint embedded stars.
    float star = pow( noise( dir * 220.0 ), 46.0 );
    color += star * vec3( 0.8, 0.86, 1.0 ) * 0.9;

    color *= uIntensity;
    gl_FragColor = vec4( color, 1.0 );
  }
`;
