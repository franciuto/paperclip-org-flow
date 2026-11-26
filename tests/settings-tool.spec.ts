import { describe, expect, it } from "vitest";
import { resolveSettings, validateSettings } from "../src/worker/settings.js";
import { isSelfOrSubordinate, parseReportProgressParams } from "../src/worker/tool.js";

describe("settings", () => {
  it("applies defaults", () => {
    expect(resolveSettings({})).toEqual({ sleepAfterMinutes: 15, keepClosedHours: 24, enableSimulation: true, departmentNames: [] });
    expect(resolveSettings(null)).toEqual({ sleepAfterMinutes: 15, keepClosedHours: 24, enableSimulation: true, departmentNames: [] });
  });
  it("reads, clamps and falls back on invalid values", () => {
    expect(resolveSettings({ sleepAfterMinutes: 30, keepClosedHours: 0, enableSimulation: false }))
      .toEqual({ sleepAfterMinutes: 30, keepClosedHours: 0, enableSimulation: false, departmentNames: [] });
    expect(resolveSettings({ sleepAfterMinutes: "abc", keepClosedHours: 99999, enableSimulation: "yes" }))
      .toEqual({ sleepAfterMinutes: 15, keepClosedHours: 720, enableSimulation: true, departmentNames: [] });
    expect(resolveSettings({ sleepAfterMinutes: "20" }).sleepAfterMinutes).toBe(20);
  });
  it("validates with Italian messages", () => {
    expect(validateSettings({ sleepAfterMinutes: 10 })).toEqual({ ok: true, errors: [], warnings: [] });
    const bad = validateSettings({ sleepAfterMinutes: 0, keepClosedHours: 1.5, enableSimulation: "x", foo: 1 });
    expect(bad.ok).toBe(false);
    expect(bad.errors).toHaveLength(3);
    expect(bad.warnings[0]).toContain("foo");
  });
});

describe("parseReportProgressParams", () => {
  it("accepts valid input and trims the note", () => {
    expect(parseReportProgressParams({ issue: " ACME-62 ", percent: 40, note: "  finished the first block " }))
      .toEqual({ ok: true, value: { issue: "ACME-62", percent: 40, note: "finished the first block" } });
  });
  it("accepts numeric strings and rounds", () => {
    expect(parseReportProgressParams({ issue: "ACME-1", percent: "55%" })).toMatchObject({ ok: true, value: { percent: 55 } });
    expect(parseReportProgressParams({ issue: "ACME-1", percent: 33.6 })).toMatchObject({ ok: true, value: { percent: 34 } });
  });
  it("rejects bad input with clear messages", () => {
    expect(parseReportProgressParams(null)).toMatchObject({ ok: false });
    expect(parseReportProgressParams({ percent: 10 })).toMatchObject({ ok: false });
    expect(parseReportProgressParams({ issue: "ACME-1", percent: 101 })).toMatchObject({ ok: false });
    expect(parseReportProgressParams({ issue: "ACME-1", percent: -1 })).toMatchObject({ ok: false });
    expect(parseReportProgressParams({ issue: "ACME-1", percent: "tanto" })).toMatchObject({ ok: false });
    expect(parseReportProgressParams({ issue: "ACME-1", percent: 10, note: 5 })).toMatchObject({ ok: false });
    const long = parseReportProgressParams({ issue: "ACME-1", percent: 10, note: "x".repeat(201) });
    expect(long).toMatchObject({ ok: false });
    if (!long.ok) expect(long.error).toContain("200");
    expect(parseReportProgressParams({ issue: "ACME-1", percent: 10, note: "x".repeat(200) }).ok).toBe(true);
  });
});

describe("isSelfOrSubordinate", () => {
  const chain = new Map<string, string | null>([["ceo", null], ["lead", "ceo"], ["dev", "lead"], ["other", null], ["loop1", "loop2"], ["loop2", "loop1"]]);
  it("allows self and the whole chain below", () => {
    expect(isSelfOrSubordinate("dev", "dev", chain)).toBe(true);
    expect(isSelfOrSubordinate("lead", "dev", chain)).toBe(true);
    expect(isSelfOrSubordinate("ceo", "dev", chain)).toBe(true);
  });
  it("denies peers, managers, unassigned and survives cycles", () => {
    expect(isSelfOrSubordinate("dev", "lead", chain)).toBe(false);
    expect(isSelfOrSubordinate("other", "dev", chain)).toBe(false);
    expect(isSelfOrSubordinate("dev", null, chain)).toBe(false);
    expect(isSelfOrSubordinate("ceo", "loop1", chain)).toBe(false);
  });
});
