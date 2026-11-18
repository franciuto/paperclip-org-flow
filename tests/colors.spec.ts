import { describe, expect, it } from "vitest";
import { colorForGroup, hueForId } from "../src/worker/colors.js";
import { STANDALONE_COLOR } from "../src/shared/types.js";

describe("colorForGroup", () => {
  it("is stable for the same id", () => {
    const id = "5fa4208e-3669-41aa-bc5c-8f91d3c56e2b";
    expect(colorForGroup(id)).toBe(colorForGroup(id));
    expect(colorForGroup(id)).toMatch(/^oklch\(\d+% 0\.15 \d+\)$/);
  });
  it("uses the neutral colour for standalone", () => {
    expect(colorForGroup("standalone")).toBe(STANDALONE_COLOR);
    expect(colorForGroup("")).toBe(STANDALONE_COLOR);
  });
  it("spreads hues across many ids", () => {
    const hues = new Set<number>();
    for (let i = 0; i < 200; i++) hues.add(hueForId(`issue-${i}`));
    expect(hues.size).toBeGreaterThanOrEqual(18);
    for (const h of hues) expect(h).toBeGreaterThanOrEqual(0);
    for (const h of hues) expect(h).toBeLessThan(360);
  });
  it("keeps lightness in a band readable on light and dark themes", () => {
    for (let i = 0; i < 50; i++) {
      const l = Number(/oklch\((\d+)%/.exec(colorForGroup(`g${i}`))![1]);
      expect(l).toBeGreaterThanOrEqual(60);
      expect(l).toBeLessThanOrEqual(72);
    }
  });
});
