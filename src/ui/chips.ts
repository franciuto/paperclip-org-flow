/**
 * Chip placement under a person: 2 per row, at most 4 slots. With more than 4 tasks the
 * 4th slot becomes a "+n altri" label. Pure; coordinates are relative to the node centre.
 */
import { estimateMonoWidth } from "./format.js";

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

/** Chip width sized from the longest code shown (glyph + code + percent). */
export function chipWidthFor(codes: string[]): number {
  const longest = codes.reduce((m, c) => Math.max(m, estimateMonoWidth(c, CHIP_FONT)), estimateMonoWidth("FRA-00", CHIP_FONT));
  const pct = estimateMonoWidth("100%", CHIP_FONT);
  // 17px glyph area + code + 6px gap + percent + 5px right padding
  return Math.ceil(Math.min(132, 17 + longest + 6 + pct + 5));
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
