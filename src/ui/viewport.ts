/**
 * Pure helpers for the full-page layout (no React, no DOM):
 * - fitScale: scale the org chart to fit its box (width AND height), within readable bounds;
 * - fillHeight: height of the chart box so it fills the visible viewport under the header;
 * - section open/closed state persisted in localStorage.
 */

export const MIN_CHART_SCALE = 0.74; // below this text gets too small: scroll instead
export const MAX_CHART_SCALE = 1.35;
export const MIN_STAGE_HEIGHT = 480;

/**
 * Scale for a layout of lw×lh inside a box of bw×bh: "contain" (preserve aspect ratio), clamped to
 * [min, max]. When the clamp wins over the width, the box scrolls horizontally (phones).
 */
export function fitScale(lw: number, lh: number, bw: number, bh: number, min = MIN_CHART_SCALE, max = MAX_CHART_SCALE): { scale: number; overflowX: boolean; overflowY: boolean } {
  if (!(lw > 0) || !(lh > 0) || !(bw > 0)) return { scale: 1, overflowX: false, overflowY: false };
  const byW = bw / lw;
  const byH = bh > 0 ? bh / lh : byW;
  const scale = Math.min(max, Math.max(min, Math.min(byW, byH)));
  return { scale, overflowX: lw * scale > bw + 0.5, overflowY: bh > 0 && lh * scale > bh + 0.5 };
}

/**
 * Height for the chart box: what is left of the visible viewport below the box's top edge
 * (minus a bottom margin), never less than `min`. `offsetTop` is the box's top relative to the
 * top of the scrolling viewport when scrolled to the top.
 */
export function fillHeight(viewportHeight: number, offsetTop: number, margin = 16, min = MIN_STAGE_HEIGHT): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return min;
  return Math.max(min, Math.round(viewportHeight - Math.max(0, offsetTop) - margin));
}

export const SECTIONS_KEY = "org-flow:sections";
export type SectionState = Record<string, boolean>;

/** Parse the stored section state; anything invalid → {} (all sections use their default). */
export function parseSections(raw: string | null | undefined): SectionState {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: SectionState = {};
    for (const [k, b] of Object.entries(v as Record<string, unknown>)) if (typeof b === "boolean") out[k] = b;
    return out;
  } catch {
    return {};
  }
}

export function isSectionOpen(state: SectionState, id: string, def = true): boolean {
  return state[id] ?? def;
}

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** localStorage may be missing or throw (private mode, sandboxed iframe): never let it break the page. */
export function loadSections(store: KV | null | undefined): SectionState {
  try {
    return parseSections(store?.getItem(SECTIONS_KEY));
  } catch {
    return {};
  }
}

export function saveSections(store: KV | null | undefined, state: SectionState): void {
  try {
    store?.setItem(SECTIONS_KEY, JSON.stringify(state));
  } catch {
    /* ignore: the state just won't be remembered */
  }
}
