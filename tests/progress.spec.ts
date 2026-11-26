import { describe, expect, it } from "vitest";
import {
  countChildren, estimateFromStatus, parseChecklist, resolveProgress,
} from "../src/worker/progress.js";

describe("estimateFromStatus", () => {
  it("maps statuses to estimates", () => {
    expect(estimateFromStatus("backlog")).toBe(0);
    expect(estimateFromStatus("todo")).toBe(5);
    expect(estimateFromStatus("in_progress")).toBe(40);
    expect(estimateFromStatus("in_review")).toBe(85);
    expect(estimateFromStatus("done")).toBe(100);
  });
  it("blocked keeps the last known value or 40", () => {
    expect(estimateFromStatus("blocked")).toBe(40);
    expect(estimateFromStatus("blocked", 70)).toBe(70);
  });
  it("unknown statuses fall back to last known or 0", () => {
    expect(estimateFromStatus("waiting_on_moon")).toBe(0);
    expect(estimateFromStatus("waiting_on_moon", 33)).toBe(33);
  });
});

describe("parseChecklist", () => {
  it("counts checked and total boxes in several list styles", () => {
    const body = [
      "# Plan",
      "- [x] analysis",
      "- [X] draft",
      "* [ ] review",
      "  + [ ] sub-item",
      "1. [x] numbered",
      "- not a checkbox",
      "[x] without a list does not count",
    ].join("\n");
    expect(parseChecklist(body)).toEqual({ done: 3, total: 5 });
  });
  it("ignores boxes inside code fences", () => {
    expect(parseChecklist("```\n- [x] code\n```\n- [ ] real")).toEqual({ done: 0, total: 1 });
  });
  it("returns null without boxes or body", () => {
    expect(parseChecklist("solo testo")).toBeNull();
    expect(parseChecklist("")).toBeNull();
    expect(parseChecklist(null)).toBeNull();
  });
});

describe("countChildren", () => {
  it("excludes cancelled children", () => {
    expect(countChildren(["done", "done", "cancelled", "todo"])).toEqual({ done: 2, total: 3 });
  });
  it("handles only cancelled children", () => {
    expect(countChildren(["cancelled"])).toEqual({ done: 0, total: 0 });
  });
});

describe("resolveProgress", () => {
  const checklist = { done: 1, total: 4 };
  it("prefers the reported value", () => {
    expect(resolveProgress({ status: "in_progress", reported: { percent: 62, note: "quasi", at: "x" }, checklist }))
      .toEqual({ progress: 62, source: "reported", note: "quasi" });
  });
  it("uses children for parent tasks, then the checklist, then the status", () => {
    expect(resolveProgress({ status: "in_progress", children: { done: 1, total: 3 }, checklist }).source).toBe("children");
    expect(resolveProgress({ status: "in_progress", children: { done: 1, total: 3 } }).progress).toBe(33);
    expect(resolveProgress({ status: "in_progress", checklist })).toEqual({ progress: 25, source: "checklist", note: null });
    expect(resolveProgress({ status: "in_review" })).toEqual({ progress: 85, source: "status", note: null });
  });
  it("done is always 100", () => {
    expect(resolveProgress({ status: "done", reported: { percent: 40, note: null, at: "x" } }).progress).toBe(100);
  });
  it("clamps reported values", () => {
    expect(resolveProgress({ status: "todo", reported: { percent: 140, note: null, at: "x" } }).progress).toBe(100);
  });
  it("blocked uses the last known value", () => {
    expect(resolveProgress({ status: "blocked", lastKnown: 55 }).progress).toBe(55);
  });
});
