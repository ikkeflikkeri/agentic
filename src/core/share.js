/**
 * Encode/decode a shareable universe layout for the URL hash.
 *
 * Format: `#u=v1.<base64url>` where the payload is a compact byte packing of
 * every user-planted seed:
 *
 *   [ version:u8 ][ n:u8 ] then n × { x:i16, z:i16, count:u8 }
 *
 * Coordinates are stored in half-units (world / 2, little-endian, clamped to
 * ±32 764 ≈ the scene scale) and `count` in units of 8 stars. One seed costs
 * 5 bytes, so even a dense universe shares as a short URL.
 */

const PREFIX = '#u=v1.';
const COORD_SCALE = 2;
const COUNT_UNIT = 8;
const MAX_SEEDS = 64;

const I16_MAX = 32764;

function clampInt(value, min, max) {
  const n = Math.round(Number(value) || 0);
  return n < min ? min : n > max ? max : n;
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Encode a seed list into a hash payload (without the leading '#').
 * @param {{x: number, z: number, count: number}[]} seeds
 * @returns {string|null} e.g. `v1.AQ...`, or null when there is nothing to share
 */
export function encodeSeeds(seeds) {
  if (!Array.isArray(seeds) || seeds.length === 0) return null;
  const list = seeds.slice(0, MAX_SEEDS);

  const bytes = new Uint8Array(2 + list.length * 5);
  const view = new DataView(bytes.buffer);
  bytes[0] = 1; // version
  bytes[1] = list.length;

  list.forEach((seed, i) => {
    const o = 2 + i * 5;
    view.setInt16(o, clampInt(seed.x / COORD_SCALE, -I16_MAX, I16_MAX), true);
    view.setInt16(o + 2, clampInt(seed.z / COORD_SCALE, -I16_MAX, I16_MAX), true);
    bytes[o + 4] = clampInt(seed.count / COUNT_UNIT, 1, 255);
  });

  return `v1.${base64UrlEncode(bytes)}`;
}

/**
 * Decode a hash fragment (e.g. `#u=v1.AQ...`) into seed positions.
 * @param {string} hash full location hash, or a bare `u=...` payload
 * @returns {{x: number, z: number, count: number}[]|null} null when absent/invalid
 */
export function decodeSeeds(hash) {
  if (typeof hash !== 'string') return null;

  let payload = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!payload.startsWith('u=')) return null;
  payload = payload.slice(2);
  if (!payload.startsWith('v1.')) return null;

  let bytes;
  try {
    bytes = base64UrlDecode(payload.slice(3));
  } catch {
    return null;
  }

  if (bytes.length < 2 || bytes[0] !== 1) return null;
  const n = bytes[1];
  if (bytes.length !== 2 + n * 5) return null;

  const view = new DataView(bytes.buffer);
  const seeds = [];
  for (let i = 0; i < n; i++) {
    const o = 2 + i * 5;
    seeds.push({
      x: view.getInt16(o, true) * COORD_SCALE,
      z: view.getInt16(o + 2, true) * COORD_SCALE,
      count: bytes[o + 4] * COUNT_UNIT
    });
  }
  return seeds;
}

/**
 * Build a full share URL for the given seeds, replacing any previous hash.
 * @param {{x: number, z: number, count: number}[]} seeds
 * @returns {string|null}
 */
export function buildShareUrl(seeds) {
  const payload = encodeSeeds(seeds);
  if (!payload) return null;
  const base = `${location.origin}${location.pathname}`;
  return `${base}#u=${payload}`;
}
