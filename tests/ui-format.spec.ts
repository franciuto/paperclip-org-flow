import { describe, expect, it } from "vitest";
import {
  clampPercent,
  clockTime,
  estimateTextWidth,
  firstName,
  formatDuration,
  initials,
  naturalCompare,
  plural,
  poseUrl,
  relativeTime,
  statusLabel,
  taskCode,
  truncateToWidth,
} from "../src/ui/format.js";
import { activeGroups, connectionState, heldByPerson, liveCounts, mergeFeed, recentlyClosed, sortGroups, touchedBy } from "../src/ui/model.js";
import { busySnapshot, IDS, quietSnapshot } from "./ui/fixtures.js";

const NOW = Date.parse("2026-11-19T15:00:00Z");

describe("format", () => {
  it("formats durations in Italian", () => {
    expect(formatDuration(20_000)).toBe("meno di 1 min");
    expect(formatDuration(7 * 60_000)).toBe("7 min");
    expect(formatDuration(125 * 60_000)).toBe("2 h 5 min");
    expect(formatDuration(120 * 60_000)).toBe("2 h");
    expect(formatDuration(26 * 3600_000)).toBe("1 g 2 h");
  });

  it("formats relative times", () => {
    const at = (ms: number) => new Date(NOW - ms).toISOString();
    expect(relativeTime(at(10_000), NOW)).toBe("adesso");
    expect(relativeTime(at(5 * 60_000), NOW)).toBe("5 min fa");
    expect(relativeTime(at(3 * 3600_000), NOW)).toBe("3 h fa");
    expect(relativeTime(at(30 * 3600_000), NOW)).toBe("ieri");
    expect(relativeTime(at(80 * 3600_000), NOW)).toBe("3 g fa");
    expect(relativeTime(null, NOW)).toBe("—");
    expect(relativeTime("not a date", NOW)).toBe("—");
  });

  it("labels statuses and falls back gracefully", () => {
    expect(statusLabel("in_review")).toBe("In revisione");
    expect(statusLabel("weird_state")).toBe("weird state");
    expect(statusLabel(null)).toBe("—");
  });

  it("small helpers", () => {
    expect(plural(1, "task", "task")).toBe("1 task");
    expect(plural(3, "evento", "eventi")).toBe("3 eventi");
    expect(firstName("Giulia Bennett")).toBe("Giulia");
    expect(initials("Arold Fletcher")).toBe("AF");
    expect(initials("Joe")).toBe("J");
    expect(clockTime(new Date(2026, 10, 19, 9, 5).toISOString())).toBe("09:05");
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(null)).toBe(0);
    expect(naturalCompare("FRA-9", "FRA-62")).toBeLessThan(0);
    expect(poseUrl("cherry-pop", "sleepy")).toBe("/api/agent-avatars/cap-v1/cherry-pop/sleepy.png?size=128&scale=1");
    expect(taskCode({ identifier: null, title: "Una cosa lunga", id: "x" })).toBe("Una co…");
  });

  it("truncates text to a width estimate", () => {
    const long = "Infrastructure Manager - Home and much more";
    const t = truncateToWidth(long, 100, 10.5);
    expect(t.endsWith("…")).toBe(true);
    expect(estimateTextWidth(t, 10.5)).toBeLessThanOrEqual(100);
    expect(truncateToWidth("Luke", 100, 10.5)).toBe("Luke");
  });
});

describe("model", () => {
  const s = busySnapshot(NOW);

  it("sorts groups: open by identifier, standalone last", () => {
    const ids = sortGroups(s.groups).map((g) => g.identifier ?? g.id);
    expect(ids[0]).toBe("FRA-50");
    expect(ids[ids.length - 1]).toBe("standalone");
  });

  it("collects held tasks per person in group order, hiding flying ones", () => {
    const order = sortGroups(s.groups).map((g) => g.id);
    const held = heldByPerson(s.tasks, order);
    expect(held.get(IDS.daniel)!.map((t) => t.identifier)).toEqual(["FRA-58", "FRA-66", "FRA-68", "FRA-61", "FRA-67"]);
    expect(held.get(IDS.joe)).toBeUndefined(); // FRA-65 is closed
    const hidden = heldByPerson(s.tasks, order, new Set(["iss-58"]));
    expect(hidden.get(IDS.daniel)!.map((t) => t.identifier)).not.toContain("FRA-58");
  });

  it("counts working/reviewing/sleeping agents and tasks waiting for the board", () => {
    expect(liveCounts(s.people, s.tasks)).toEqual({ working: 4, thinking: 1, sleepy: 2, waiting: 1, open: 13 });
  });

  it("touchedBy includes everyone on the journey", () => {
    const t = s.tasks.find((x) => x.identifier === "FRA-59")!;
    expect([...touchedBy(t)]).toEqual(expect.arrayContaining([IDS.board, IDS.laura, IDS.jamal, IDS.arold, IDS.luke]));
    expect(touchedBy(null).size).toBe(0);
  });

  it("quiet snapshot: no active groups, recently closed newest first", () => {
    const q = quietSnapshot(NOW);
    expect(activeGroups(q.groups)).toHaveLength(0);
    expect(recentlyClosed(q.tasks).map((t) => t.identifier)).toEqual(["FRA-41", "FRA-42", "FRA-43", "FRA-44", "FRA-45"]);
  });

  it("merges feeds without duplicates, newest first", () => {
    const a = { id: "a", at: "2026-11-19T10:00:00Z", kind: "ping" as const };
    const b = { id: "b", at: "2026-11-19T11:00:00Z", kind: "ping" as const };
    expect(mergeFeed([a], [b, a]).map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("connection state reflects polling health, not the stream", () => {
    const base = { streamConnected: false, lastOkAt: NOW - 1000, failures: 0, nowMs: NOW, pollMs: 3000 };
    expect(connectionState(base)).toBe("live");
    expect(connectionState({ ...base, lastOkAt: null })).toBe("connecting");
    expect(connectionState({ ...base, failures: 1 })).toBe("connecting");
    expect(connectionState({ ...base, failures: 3 })).toBe("offline");
    expect(connectionState({ ...base, lastOkAt: NOW - 60_000 })).toBe("connecting");
    expect(connectionState({ ...base, streamConnected: true, failures: 5 })).toBe("live");
  });
});
