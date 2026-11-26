/**
 * Chip placement under a person: 2 per row, at most 4 slots. With more than 4 tasks the
 * 4th slot becomes a "+n more" label. Pure; coordinates are relative to the node centre.
 */

export const CHIP_H = 18;
export const CHIP_GAP = 4;
export const CHIP_FONT = 9.5;
export const MAX_CHIP_SLOTS = 4;

export interface ChipSlot {
  x: number; // left edge, relative to node centre
  y: number; // top edge, relative to the chip block top
}

export interface ChipPlacement {
  slots: ChipSlot[];               // one per visible task, in order
  more: (ChipSlot & { count: number }) | null;
  width: number;
  height: number;
}

/** Chip geometry (px, at scale 1): glyph area, gap between code and percent, right padding. */
export const CHIP_CODE_X = 17.5;
export const CHIP_TEXT_GAP = 6;
export const CHIP_PAD_R = 5;
export const MAX_CHIP_W = 140;
/** Conservative monospace advance (em): DejaVu/Liberation Mono ≈ .60, SF Mono ≈ .61; bold may be a bit wider. */
const MONO_EM = 0.62;

export function chipCodeWidth(code: string): number {
  return code.length * CHIP_FONT * MONO_EM;
}
export function chipPercentWidth(): number {
  return "100%".length * CHIP_FONT * MONO_EM * 1.04; // the percent is bold
}

/** Chip width sized from the longest code shown (glyph + code + gap + "100%" + padding). */
export function chipWidthFor(codes: string[]): number {
  const longest = codes.reduce((m, c) => Math.max(m, chipCodeWidth(c)), chipCodeWidth("ACME-00"));
  return Math.ceil(Math.min(MAX_CHIP_W, CHIP_CODE_X + longest + CHIP_TEXT_GAP + chipPercentWidth() + CHIP_PAD_R));
}

/** Room left for the code inside a chip of width `w` (the renderer squeezes longer codes into it). */
export function chipCodeRoom(w: number): number {
  return Math.max(10, w - CHIP_CODE_X - CHIP_TEXT_GAP - chipPercentWidth() - CHIP_PAD_R);
}

export function placeChips(count: number, chipW: number, chipH = CHIP_H, gap = CHIP_GAP): ChipPlacement {
  const n = Math.max(0, Math.floor(count));
  if (!n) return { slots: [], more: null, width: 0, height: 0 };
  const overflow = n > MAX_CHIP_SLOTS;
  const visible = overflow ? MAX_CHIP_SLOTS - 1 : n;
  const used = overflow ? MAX_CHIP_SLOTS : n; // slots occupied (the "more" label takes one)
  const rows = Math.ceil(used / 2);
  const slotAt = (i: number): ChipSlot => {
    const row = Math.floor(i / 2);
    const inRow = Math.min(2, used - row * 2);
    const rowW = inRow * chipW + (inRow - 1) * gap;
    const col = i % 2;
    return { x: -rowW / 2 + col * (chipW + gap), y: row * (chipH + gap) };
  };
  const slots: ChipSlot[] = [];
  for (let i = 0; i < visible; i++) slots.push(slotAt(i));
  const more = overflow ? { ...slotAt(MAX_CHIP_SLOTS - 1), count: n - visible } : null;
  return {
    slots,
    more,
    width: used >= 2 ? 2 * chipW + gap : chipW,
    height: rows * chipH + (rows - 1) * gap,
  };
}
