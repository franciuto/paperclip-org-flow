/**
 * Stable group colours. Same id → same colour across snapshots, workers and restarts.
 * Mid lightness and moderate chroma keep the colour readable on light and dark backgrounds.
 */

import { STANDALONE_COLOR, STANDALONE_GROUP_ID } from "../shared/types.js";

/** FNV-1a 32-bit hash. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Number of distinct hues; neighbours are 360/HUE_STEPS degrees apart. */
const HUE_STEPS = 24;
/** Golden-ratio walk over the hue buckets so consecutive hash values land far apart. */
const GOLDEN = 0.618033988749895;

export function hueForId(id: string): number {
  const bucket = hashString(id) % HUE_STEPS;
  const hue = ((bucket * GOLDEN) % 1) * 360;
  return Math.round(hue);
}

export function colorForGroup(id: string): string {
  if (!id || id === STANDALONE_GROUP_ID) return STANDALONE_COLOR;
  const hue = hueForId(id);
  // Yellows/greens look washed out at the same lightness: darken them slightly.
  const lightness = hue >= 70 && hue <= 160 ? 64 : 68;
  return `oklch(${lightness}% 0.15 ${hue})`;
}
