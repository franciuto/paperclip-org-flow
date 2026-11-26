import { describe, expect, it } from "vitest";
import type { Snapshot } from "../src/shared/types.js";
import { createSimulation, simulationSnapshot, stepSimulation } from "../src/ui/simulator.js";
import { busySnapshot, IDS, quietSnapshot } from "./ui/fixtures.js";

const NOW = Date.parse("2026-11-19T15:00:00Z");

function run(base: Snapshot, ticks: number, seed = 7) {
  const s = createSimulation(base, { seed, nowMs: NOW });
  const records = [] as ReturnType<typeof stepSimulation>;
  for (let i = 0; i < ticks; i++) records.push(...stepSimulation(s));
  return { s, records, snap: simulationSnapshot(s) };
}

describe("simulator", () => {
  it("uses the real people and invents tasks and groups", () => {
    const { snap } = run(quietSnapshot(NOW), 0);
    expect(snap.people.map((p) => p.id)).toEqual(quietSnapshot(NOW).people.map((p) => p.id));
    expect(snap.groups.length).toBe(4);
    expect(snap.tasks.length).toBeGreaterThanOrEqual(8);
    expect(snap.tasks.every((t) => t.identifier!.startsWith("SIM-"))).toBe(true);
    // seeded history: something in progress, something in review, something waiting for the board
    const statuses = new Set(snap.tasks.map((t) => t.status));
    expect(statuses).toContain("in_progress");
    expect(statuses).toContain("in_review");
    expect(snap.feed.length).toBeGreaterThan(10);
  });

  it("is deterministic for a given seed", () => {
    const a = run(busySnapshot(NOW), 40, 11);
    const b = run(busySnapshot(NOW), 40, 11);
    expect(a.records.map((r) => [r.kind, r.identifier, r.statusTo])).toEqual(b.records.map((r) => [r.kind, r.identifier, r.statusTo]));
  });

  it("moves tasks only along the chain of command and closes some", () => {
    const base = busySnapshot(NOW);
    const parent = new Map(base.people.map((p) => [p.id, p.reportsTo]));
    const { records, snap } = run(base, 150);
    const handoffs = records.filter((r) => r.kind === "handoff");
    expect(handoffs.length).toBeGreaterThan(10);
    for (const h of handoffs) {
      const from = h.from!.id;
      const to = h.to!.id;
      const linked = parent.get(to) === from || parent.get(from) === to || from === IDS.board || to === IDS.board || (parent.get(to) === null && from === IDS.board);
      expect(linked, `${h.identifier}: ${from} → ${to}`).toBe(true);
    }
    expect(records.some((r) => r.kind === "status" && r.statusTo === "done")).toBe(true);
    expect(records.some((r) => r.kind === "created")).toBe(true);
    // records come oldest first, with increasing timestamps
    for (let i = 1; i < records.length; i++) expect(Date.parse(records[i]!.at)).toBeGreaterThanOrEqual(Date.parse(records[i - 1]!.at));
    // percentages always within 0..100, closed tasks at 100
    for (const t of snap.tasks) {
      expect(t.progress).toBeGreaterThanOrEqual(0);
      expect(t.progress).toBeLessThanOrEqual(100);
      if (t.closedAt) expect(t.progress).toBe(100);
    }
  });

  it("derives visual states: working with a percent, sleeping when idle long enough", () => {
    const { snap } = run(busySnapshot(NOW), 30);
    const working = snap.people.filter((p) => p.state === "working");
    expect(working.length).toBeGreaterThan(0);
    for (const p of working) expect(p.stateLabel).toMatch(/^Working on SIM-\d+ · \d+%$/);
    for (const p of snap.people.filter((x) => x.state === "sleepy")) expect(p.stateLabel).toBe("Asleep");
    for (const p of snap.people.filter((x) => x.state === "thinking")) expect(p.stateLabel).toMatch(/^Reviewing SIM-\d+$/);
    expect(snap.counts.working).toBe(working.length);
  });

  it("adds a fake board when the company has no human user", () => {
    const base = busySnapshot(NOW);
    base.people = base.people.filter((p) => p.kind !== "user");
    const { snap, records } = run(base, 20);
    expect(snap.people.filter((p) => p.kind === "user")).toHaveLength(1);
    expect(records.length).toBeGreaterThan(0);
  });

  it("does nothing (and does not crash) without agents", () => {
    const base = busySnapshot(NOW);
    base.people = base.people.filter((p) => p.kind === "user");
    const { snap, records } = run(base, 10);
    expect(records).toHaveLength(0);
    expect(snap.tasks).toHaveLength(0);
  });

  it("keeps running for a long time with a bounded feed and replaces finished groups", () => {
    const { snap, s } = run(busySnapshot(NOW), 1500, 3);
    expect(snap.feed.length).toBeLessThanOrEqual(100);
    expect(s.seq.group).toBeGreaterThan(5);
    expect(snap.tasks.filter((t) => !t.closedAt).length).toBeLessThanOrEqual(14);
  });
});
