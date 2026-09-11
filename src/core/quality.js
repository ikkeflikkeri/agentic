/**
 * Adaptive quality. Measures rolling FPS and steps between discrete tiers,
 * trading pixel ratio and particle count to hold ~60fps. Hysteresis and a
 * cooldown stop it from oscillating.
 */

const TIERS = [
  { name: 'ultra',  pixelRatio: 1.75, galaxyCount: 140000, nebulaOctaves: 5, bloom: 0.7 },
  { name: 'high',   pixelRatio: 1.5,  galaxyCount: 120000, nebulaOctaves: 5, bloom: 0.68 },
  { name: 'medium', pixelRatio: 1.25, galaxyCount: 85000,  nebulaOctaves: 4, bloom: 0.66 },
  { name: 'low',    pixelRatio: 1.0,  galaxyCount: 52000,  nebulaOctaves: 3, bloom: 0.64 }
];

export class QualityManager {
  constructor(onChange) {
    this.onChange = onChange;
    this.tiers = TIERS;

    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.tierIndex = coarse ? 2 : 0;

    this._frames = 0;
    this._elapsed = 0;
    this._fps = 60;
    this._bad = 0;
    this._good = 0;
    this._cooldown = 0;
  }

  get tier() {
    return this.tiers[this.tierIndex];
  }

  get fps() {
    return this._fps;
  }

  /** Effective pixel ratio, always capped by the device's own DPR. */
  get pixelRatio() {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    return Math.min(dpr, this.tier.pixelRatio);
  }

  apply() {
    if (this.onChange) this.onChange(this.tier, this.pixelRatio);
  }

  update(dt) {
    this._frames++;
    this._elapsed += dt;

    if (this._cooldown > 0) this._cooldown -= dt;

    if (this._elapsed >= 1.0) {
      this._fps = this._frames / this._elapsed;
      this._frames = 0;
      this._elapsed = 0;

      if (this._cooldown <= 0) {
        if (this._fps < 46) {
          this._good = 0;
          this._bad++;
          if (this._bad >= 2 && this.tierIndex < this.tiers.length - 1) {
            this.tierIndex++;
            this._bad = 0;
            this._cooldown = 2.5;
            this.apply();
          }
        } else if (this._fps > 57) {
          this._bad = 0;
          this._good++;
          if (this._good >= 5 && this.tierIndex > 0) {
            this.tierIndex--;
            this._good = 0;
            this._cooldown = 3.5;
            this.apply();
          }
        } else {
          this._bad = 0;
          this._good = 0;
        }
      }
    }
  }
}
