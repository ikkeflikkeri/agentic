/**
 * Optional audio hook.
 *
 * `src/audio/engine.js` provides a generative Web Audio soundscape via
 * `createAudioEngine()`. This bridge imports it dynamically and exposes a tiny,
 * failure-proof surface for the render loop:
 *
 *   enable()          -> call from a user gesture (Web Audio autoplay policy)
 *   setIntensity(0..1) -> forwarded every frame from scene energy
 *   burst()           -> short accent whenever the visitor seeds a cluster
 *   setMuted(bool)
 *   dispose()
 *
 * If the engine is missing, blocked, or throws at any point, the import rejects
 * quietly and the visual experience is unaffected.
 */

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

let api = null;
let enabled = false;

export function hasAudio() {
  return api !== null;
}

/**
 * Attempt to attach to the optional audio engine.
 * @param {() => number} [getEnergy] callback returning current 0..1 energy
 * @returns {Promise<object|null>} the bridge, or null when audio is unavailable
 */
export async function initAudio(getEnergy) {
  if (api) return api;

  try {
    const mod = await import('./engine.js');

    const factory =
      typeof mod.createAudioEngine === 'function'
        ? mod.createAudioEngine
        : typeof mod.default === 'function'
          ? mod.default
          : null;

    if (!factory) return null;

    const engine = factory();

    api = {
      get energy() {
        return getEnergy ? clamp01(getEnergy()) : 0;
      },

      /** Must be invoked from a user gesture; safe to call repeatedly. */
      enable() {
        if (enabled) return;
        enabled = true;
        try {
          const result = engine.init?.();
          if (result && typeof result.catch === 'function') result.catch(() => {});
        } catch {
          /* audio must never break the visuals */
        }
      },

      setIntensity(value) {
        try {
          engine.setIntensity?.(clamp01(value));
        } catch {
          /* ignore */
        }
      },

      burst() {
        try {
          engine.burst?.();
        } catch {
          /* ignore */
        }
      },

      setMuted(value) {
        try {
          engine.setMuted?.(!!value);
        } catch {
          /* ignore */
        }
      },

      isReady() {
        try {
          return !!engine.isReady?.();
        } catch {
          return false;
        }
      },

      dispose() {
        try {
          engine.dispose?.();
        } catch {
          /* ignore */
        }
        api = null;
        enabled = false;
      }
    };

    return api;
  } catch {
    // No engine present, or it failed to load; stay silent and keep rendering.
    return null;
  }
}
