/**
 * Optional audio hook.
 *
 * A sibling worker may contribute `src/audio/engine.js`. If that module is
 * present this bridge imports it dynamically and forwards an intensity signal
 * (0..1) derived from scene energy. If it is absent — or fails for any reason —
 * the import rejects quietly and the visual experience continues unaffected.
 */

let bridge = null;

export function hasAudio() {
  return bridge !== null;
}

/**
 * Attempt to attach to the optional audio engine.
 * @param {() => number} getEnergy callback returning current 0..1 energy
 * @returns {Promise<object|null>} the bridge, or null when audio is unavailable
 */
export async function initAudio(getEnergy) {
  if (bridge) return bridge;

  try {
    // Resolved at runtime; throws cleanly when the module does not exist.
    const mod = await import(/* @vite-ignore */ './engine.js');
    if (!mod) return null;

    let engine = null;
    if (typeof mod.createEngine === 'function') engine = mod.createEngine();
    else if (mod.default && typeof mod.default.setIntensity === 'function') engine = mod.default;
    else if (mod.engine) engine = mod.engine;

    if (!engine || typeof engine.setIntensity !== 'function') return null;

    // Engines that need a user gesture expose start/resume; failures are safe.
    try {
      await engine.start?.();
      await engine.resume?.();
    } catch {
      /* audio may require a gesture; ignore */
    }

    bridge = {
      setIntensity(value) {
        try {
          engine.setIntensity(Math.max(0, Math.min(1, value)));
        } catch {
          /* never let audio break the render loop */
        }
      },
      getEnergy,
      dispose() {
        try {
          engine.dispose?.();
          engine.stop?.();
        } catch {
          /* ignore */
        }
        bridge = null;
      }
    };

    return bridge;
  } catch {
    // No engine present; stay silent and keep rendering.
    return null;
  }
}
