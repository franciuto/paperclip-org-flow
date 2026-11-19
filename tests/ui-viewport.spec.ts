import { describe, expect, it } from "vitest";
import { fillHeight, fitScale, isSectionOpen, loadSections, MAX_CHART_SCALE, MIN_CHART_SCALE, MIN_STAGE_HEIGHT, parseSections, saveSections, SECTIONS_KEY } from "../src/ui/viewport.js";

describe("fitScale", () => {
  it("fits both width and height (contain), within bounds", () => {
    expect(fitScale(1000, 500, 1500, 500).scale).toBeCloseTo(1); // height-limited
    expect(fitScale(1000, 500, 800, 1000).scale).toBeCloseTo(0.8); // width-limited
    expect(fitScale(400, 200, 2000, 2000).scale).toBe(MAX_CHART_SCALE);
  });
  it("never goes below the readable minimum: phones scroll horizontally instead", () => {
    const f = fitScale(1400, 900, 360, 600);
    expect(f.scale).toBe(MIN_CHART_SCALE);
    expect(f.overflowX).toBe(true);
  });
  it("handles a box not measured yet", () => {
    expect(fitScale(1000, 500, 0, 0)).toEqual({ scale: 1, overflowX: false, overflowY: false });
  });
});

describe("fillHeight", () => {
  it("fills the viewport below the box top, with a minimum", () => {
    expect(fillHeight(1000, 120)).toBe(1000 - 120 - 16);
    expect(fillHeight(500, 200)).toBe(MIN_STAGE_HEIGHT);
    expect(fillHeight(NaN, 0)).toBe(MIN_STAGE_HEIGHT);
  });
});

describe("collapsible sections storage", () => {
  it("parses only booleans and defaults to open", () => {
    expect(parseSections('{"feed":false,"kpi":"x"}')).toEqual({ feed: false });
    expect(parseSections("not json")).toEqual({});
    expect(parseSections("[1,2]")).toEqual({});
    expect(isSectionOpen({ feed: false }, "feed")).toBe(false);
    expect(isSectionOpen({}, "kpi")).toBe(true);
  });
  it("survives a storage that throws", () => {
    const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadSections(bad)).toEqual({});
    expect(() => saveSections(bad, { feed: true })).not.toThrow();
    const mem = new Map<string, string>();
    const ok = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    saveSections(ok, { parents: false });
    expect(mem.get(SECTIONS_KEY)).toBe('{"parents":false}');
    expect(loadSections(ok)).toEqual({ parents: false });
  });
});
