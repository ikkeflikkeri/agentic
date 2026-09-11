// Galaxy particle shader.
// Each point stores cylindrical coordinates (radius / angle / height) so the
// vertex shader can apply differential rotation, breathing motion, twinkle and
// interactive ripple displacement entirely on the GPU.

export const MAX_RIPPLES = 6;

export const galaxyVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uSpin;
  uniform float uOpacity;

  uniform vec3  uRipplePos[ ${MAX_RIPPLES} ];
  uniform float uRippleStart[ ${MAX_RIPPLES} ];
  uniform float uRippleSpeed[ ${MAX_RIPPLES} ];
  uniform float uRippleStrength[ ${MAX_RIPPLES} ];

  // position carries cylindrical coordinates: x = radius, y = angle, z = height.
  attribute float aSeed;
  attribute float aSize;
  attribute vec3  aColor;
  attribute float aTwinkle;

  varying vec3  vColor;
  varying float vEnergy;
  varying float vTwinkle;

  void main() {
    float radius = position.x;
    float angle  = position.y + uTime * uSpin * ( 0.08 + 0.5 / ( radius + 3.0 ) );
    float height = position.z * ( 0.35 + radius * 0.06 );

    vec3 p;
    p.x = cos( angle ) * radius;
    p.z = sin( angle ) * radius;
    p.y = height + sin( uTime * 0.7 + aSeed * 31.0 ) * 0.14;

    // Interactive ripples: an expanding gaussian ring pushes and ignites points.
    float energy = 0.0;
    for ( int i = 0; i < ${MAX_RIPPLES}; i ++ ) {
      float start = uRippleStart[ i ];
      if ( start < -100.0 ) continue;
      float age = uTime - start;
      if ( age < 0.0 || age > 4.5 ) continue;

      vec3  d     = p - uRipplePos[ i ];
      float dist  = length( d );
      float front = age * uRippleSpeed[ i ];
      float ring  = exp( - abs( dist - front ) * 2.1 );
      float decay = exp( - age * 0.95 );
      float w     = ring * decay * uRippleStrength[ i ];

      p += ( d / max( dist, 0.0001 ) ) * w * ( 1.3 + energy * 0.8 );
      energy += w;
    }
    energy = clamp( energy, 0.0, 3.0 );

    vec4 mvPosition = modelViewMatrix * vec4( p, 1.0 );
    gl_Position = projectionMatrix * mvPosition;

    // Fade particles that pass very close to the camera so additive overlap
    // never blows the frame out to white.
    float depth    = max( -mvPosition.z, 0.1 );
    float nearFade = smoothstep( 7.0, 34.0, depth );

    float tw   = 0.5 + 0.5 * sin( uTime * ( 0.9 + aTwinkle ) + aSeed * 47.0 );
    float size = uSize * ( 0.55 + aSize ) * ( 0.7 + 0.6 * tw );
    gl_PointSize = clamp( size * ( 240.0 / depth ) * uPixelRatio * nearFade, 0.6, 11.0 );

    // Dim the very core so additive overlap cannot clip the whole centre to
    // white; the outer arms stay at full brightness.
    float coreDim = mix( 0.5, 1.0, smoothstep( 2.0, 24.0, radius ) );

    vColor   = aColor * ( 0.65 + 0.55 * tw ) * nearFade * coreDim;
    vEnergy  = energy;
    vTwinkle = tw;
  }
`;

export const galaxyFragmentShader = /* glsl */ `
  uniform float uOpacity;

  varying vec3  vColor;
  varying float vEnergy;
  varying float vTwinkle;

  void main() {
    vec2  c     = gl_PointCoord - 0.5;
    float dist  = length( c );
    float alpha = smoothstep( 0.5, 0.0, dist );
    alpha = pow( alpha, 2.0 );

    vec3 color = vColor + vEnergy * vec3( 0.55, 0.8, 1.0 ) * 1.1;
    color *= 0.82 + 0.45 * vTwinkle;

    gl_FragColor = vec4( color * uOpacity, alpha * uOpacity );
  }
`;
