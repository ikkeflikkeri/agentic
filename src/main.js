import { App, webglAvailable } from './core/app.js';

function showFallback() {
  const fallback = document.getElementById('fallback');
  if (fallback) fallback.classList.add('show');
  const veil = document.getElementById('veil');
  if (veil) veil.classList.add('live');
  const hud = document.getElementById('hud');
  if (hud) hud.classList.add('idle');
}

try {
  if (!webglAvailable()) {
    showFallback();
  } else {
    const app = new App();
    app.start();
  }
} catch (error) {
  // The site must degrade gracefully rather than present a broken canvas.
  console.error('AETHER could not initialise WebGL.', error);
  showFallback();
}
