/**
 * Minimal cinematic HUD: fades away after a few seconds, returns while the
 * visitor is moving the pointer, and stays out of the way otherwise.
 */
export class HUD {
  constructor() {
    this.el = document.getElementById('hud');
    this.veil = document.getElementById('veil');
    this.fpsEl = document.getElementById('stat-fps');
    this.countEl = document.getElementById('stat-count');
    this.audioBtn = document.getElementById('audio-toggle');
    this.toastEl = document.getElementById('toast');

    this.visible = true;
    this._hideTimer = null;
    this._toastTimer = null;
    this._lastStats = 0;
  }

  start(autoHideMs = 6500) {
    // Fade the cinematic vignette veil away once the scene is on screen.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.veil?.classList.add('live'));
    });
    this._scheduleHide(autoHideMs);
  }

  _scheduleHide(ms) {
    if (this._hideTimer) clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => this.hide(), ms);
  }

  hide() {
    if (!this.el || !this.visible) return;
    this.visible = false;
    this.el.classList.add('idle');
  }

  reveal() {
    if (!this.el) return;
    if (!this.visible) {
      this.visible = true;
      this.el.classList.remove('idle');
    }
    this._scheduleHide(3200);
  }

  /** Called on pointer activity to bring the HUD back for a moment. */
  notifyActivity() {
    this.reveal();
  }

  /**
   * Reflect audio state on the toggle button. `available` is false while the
   * engine module is still loading or failed to load.
   */
  setAudioState(muted, available) {
    if (!this.audioBtn) return;
    this.audioBtn.classList.toggle('muted', !available || muted);
    this.audioBtn.textContent = !available || muted ? 'sound off' : 'sound on';
    this.audioBtn.setAttribute('aria-pressed', String(available && !muted));
    this.audioBtn.setAttribute('aria-label',
      (!available || muted) ? 'Turn ambient sound on' : 'Turn ambient sound off');
  }

  /** Brief centred message that fades away. */
  toast(message, ms = 2600) {
    if (!this.toastEl) return;
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    this.reveal();
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.toastEl.classList.remove('show');
    }, ms);
  }

  update(elapsed, fps, count) {
    if (elapsed - this._lastStats < 0.4) return;
    this._lastStats = elapsed;
    if (this.fpsEl) this.fpsEl.textContent = Math.round(fps);
    if (this.countEl) this.countEl.textContent = count.toLocaleString('en-US');
  }

  showFallback() {
    this.hide();
    const fallback = document.getElementById('fallback');
    if (fallback) fallback.classList.add('show');
    if (this.veil) this.veil.classList.add('live');
  }
}
