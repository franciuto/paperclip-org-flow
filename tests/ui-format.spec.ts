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
  statusRegression,
  taskCode,
  truncateToWidth,
} from "../src/ui/format.js";
import { activeGroups, connectionState, displayLabel, heldByPerson, liveCounts, mergeFeed, recentlyClosed, sortGroups, touchedBy } from "../src/ui/model.js";
import { busySnapshot, IDS, quietSnapshot } from "./ui/fixtures.js";

const NOW = Date.parse("2026-11-19T15:00:00Z");

describe("format", () => {
  it("formats durations in English", () => {
    expect(formatDuration(20_000)).toBe("less than 1 min");
    expect(formatDuration(7 * 60_000)).toBe("7 min");
    expect(formatDuration(125 * 60_000)).toBe("2 h 5 min");
    expect(formatDuration(120 * 60_000)).toBe("2 h");
    expect(formatDuration(26 * 3600_000)).toBe("1 d 2 h");
  });

  it("formats relative times", () => {
    const at = (ms: number) => new Date(NOW - ms).toISOString();
    expect(relativeTime(at(10_000), NOW)).toBe("now");
    expect(relativeTime(at(5 * 60_000), NOW)).toBe("5 min ago");
    expect(relativeTime(at(3 * 3600_000), NOW)).toBe("3 h ago");
    expect(relativeTime(at(30 * 3600_000), NOW)).toBe("yesterday");
    expect(relativeTime(at(80 * 3600_000), NOW)).toBe("3 d ago");
    expect(relativeTime(null, NOW)).toBe("—");
    expect(relativeTime("not a date", NOW)).toBe("—");
  });

  it("labels statuses and falls back gracefully", () => {
    expect(statusLabel("in_review")).toBe("In review");
    expect(statusLabel("weird_state")).toBe("weird state");
    expect(statusLabel(null)).toBe("—");
  });

  it("small helpers", () => {
    expect(plural(1, "task", "task")).toBe("1 task");
    expect(plural(3, "event", "events")).toBe("3 events");
    expect(firstName("Giulia Bennett")).toBe("Giulia");
    expect(initials("Arold Fletcher")).toBe("AF");
    expect(initials("Joe")).toBe("J");
    expect(clockTime(new Date(2026, 10, 19, 9, 5).toISOString())).toBe("09:05");
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(null)).toBe(0);
    expect(naturalCompare("ACME-9", "ACME-62")).toBeLessThan(0);
    expect(poseUrl("cherry-pop", "sleepy")).toBe("/api/agent-avatars/cap-v1/cherry-pop/sleepy.png?size=128&scale=1");
    expect(taskCode({ identifier: null, title: "A long thing here", id: "x" })).toBe("A long…");
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
    expect(ids[0]).toBe("ACME-50");
    expect(ids[ids.length - 1]).toBe("standalone");
  });

  it("collects held tasks per person in group order, hiding flying ones", () => {
    const order = sortGroups(s.groups).map((g) => g.id);
    const held = heldByPerson(s.tasks, order);
    expect(held.get(IDS.daniel)!.map((t) => t.identifier)).toEqual(["ACME-58", "ACME-66", "ACME-68", "ACME-61", "ACME-67"]);
    expect(held.get(IDS.joe)).toBeUndefined(); // ACME-65 is closed
    const hidden = heldByPerson(s.tasks, order, new Set(["iss-58"]));
    expect(hidden.get(IDS.daniel)!.map((t) => t.identifier)).not.toContain("ACME-58");
  });

  it("counts working/reviewing/sleeping agents and tasks waiting for the board", () => {
    expect(liveCounts(s.people, s.tasks)).toEqual({ working: 4, thinking: 1, sleepy: 2, tasksWaitingForUsers: 1, open: 13 });
  });

  it("touchedBy includes everyone on the journey", () => {
    const t = s.tasks.find((x) => x.identifier === "ACME-59")!;
    expect([...touchedBy(t)]).toEqual(expect.arrayContaining([IDS.board, IDS.laura, IDS.jamal, IDS.arold, IDS.luke]));
    expect(touchedBy(null).size).toBe(0);
  });

  it("quiet snapshot: no active groups, recently closed newest first", () => {
    const q = quietSnapshot(NOW);
    expect(activeGroups(q.groups)).toHaveLength(0);
    expect(recentlyClosed(q.tasks).map((t) => t.identifier)).toEqual(["ACME-41", "ACME-42", "ACME-43", "ACME-44", "ACME-45"]);
  });

  it("adds the sleep duration to the worker's plain 'Asleep' label", () => {
    const since = new Date(NOW - 125 * 60_000).toISOString();
    expect(displayLabel({ state: "sleepy", stateLabel: "Asleep", stateSince: since }, NOW)).toBe("Asleep for 2 h 5 min");
    expect(displayLabel({ state: "sleepy", stateLabel: "Asleep", stateSince: new Date(NOW - 5000).toISOString() }, NOW)).toBe("Asleep");
    expect(displayLabel({ state: "sleepy", stateLabel: "Asleep", stateSince: null }, NOW)).toBe("Asleep");
    expect(displayLabel({ state: "working", stateLabel: "Working on ACME-1 · 40%", stateSince: since }, NOW)).toBe("Working on ACME-1 · 40%");
  });

  it("statusRegression mirrors the worker's rule", () => {
    expect(statusRegression("in_review", "in_progress")).toBe("rework");
    expect(statusRegression("in_review", "todo")).toBe("rework");
    expect(statusRegression("done", "in_review")).toBe("reopen");
    expect(statusRegression("done", "todo")).toBe("reopen");
    for (const [a, b] of [["in_review", "backlog"], ["in_review", "blocked"], ["in_review", "done"], ["in_progress", "todo"], ["done", "cancelled"], ["blocked", "todo"], [null, "todo"]] as const) {
      expect(statusRegression(a, b), `${a} → ${b}`).toBeNull();
    }
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
