import { describe, expect, it } from "vitest";
import type { FeedRecord } from "../src/shared/types.js";
import {
  activeFlash,
  applyFlashes,
  applyOverrides,
  effectsOfRecord,
  FLIGHT_MS,
  mergeFlashes,
  nextFlashChange,
  pruneOverrides,
  resolveParty,
} from "../src/ui/presence.js";
import { busySnapshot, IDS } from "./ui/fixtures.js";

const NOW = Date.parse("2026-11-19T15:00:00Z");
const snap = busySnapshot(NOW);
const rec = (r: Partial<FeedRecord>): FeedRecord => ({ id: "r1", at: new Date(NOW + 1000).toISOString(), kind: "handoff", ...r });

describe("resolveParty", () => {
  it("maps raw user ids to user:<id> person ids", () => {
    expect(resolveParty({ kind: "user", id: "board-1" }, snap.people)).toBe(IDS.board);
    expect(resolveParty({ kind: "agent", id: IDS.joe }, snap.people)).toBe(IDS.joe);
    expect(resolveParty({ kind: "agent", id: "nobody" }, snap.people)).toBeNull();
    expect(resolveParty(null, snap.people)).toBeNull();
  });
});

describe("effectsOfRecord", () => {
  it("a handoff flies the chip and makes the receiver listen after landing", () => {
    const fx = effectsOfRecord(
      rec({ issueId: "iss-62", identifier: "FRA-62", from: { kind: "agent", id: IDS.jamal }, to: { kind: "agent", id: IDS.giulia }, statusFrom: "todo", statusTo: "todo" }),
      snap.people, snap.tasks, NOW,
    );
    expect(fx.flight).toEqual({ taskId: "iss-62", fromId: IDS.jamal, toId: IDS.giulia });
    expect(fx.override).toMatchObject({ taskId: "iss-62", holderId: IDS.giulia, status: "todo" });
    expect(fx.flashes).toEqual([expect.objectContaining({ personId: IDS.giulia, state: "listening", from: NOW + FLIGHT_MS })]);
    expect(fx.flashes[0]!.label).toContain("FRA-62");
  });

  it("a send-back from review makes the receiver confused", () => {
    const fx = effectsOfRecord(
      rec({ issueId: "iss-57", from: { kind: "agent", id: IDS.laura }, to: { kind: "agent", id: IDS.giulia }, statusFrom: "in_review", statusTo: "in_progress" }),
      snap.people, snap.tasks, NOW, 0,
    );
    expect(fx.flashes[0]).toMatchObject({ personId: IDS.giulia, state: "confused", from: NOW });
  });

  it("only worker-defined regressions count as 'Rimandato' (not parking in backlog/blocked)", () => {
    const people = snap.people;
    const parked = effectsOfRecord(rec({ issueId: "iss-57", from: { kind: "agent", id: IDS.laura }, to: { kind: "agent", id: IDS.giulia }, statusFrom: "in_review", statusTo: "backlog" }), people, snap.tasks, NOW, 0);
    expect(parked.flashes[0]).toMatchObject({ state: "listening", label: "Ha ricevuto FRA-57" });
    const reopened = effectsOfRecord(rec({ kind: "status", issueId: "iss-65", actor: { kind: "agent", id: IDS.joe }, statusFrom: "done", statusTo: "todo" }), people, snap.tasks, NOW, 0);
    expect(reopened.flashes[0]).toMatchObject({ personId: IDS.joe, state: "confused", label: "Rimandato: FRA-65" });
  });

  it("a handoff to a board user shows 'waiting' instead of an agent pose", () => {
    const fx = effectsOfRecord(rec({ issueId: "iss-58", from: { kind: "agent", id: IDS.daniel }, to: { kind: "user", id: "board-1" }, statusTo: "blocked" }), snap.people, snap.tasks, NOW);
    expect(fx.flashes[0]).toMatchObject({ personId: IDS.board, state: "waiting", label: "Da gestire: FRA-58" });
    expect(fx.flight?.toId).toBe(IDS.board);
  });

  it("closing a task makes the holder celebrate and sets progress to 100", () => {
    const fx = effectsOfRecord(rec({ kind: "status", issueId: "iss-57", actor: { kind: "agent", id: IDS.laura }, statusFrom: "in_review", statusTo: "done" }), snap.people, snap.tasks, NOW);
    expect(fx.flashes.map((f) => [f.personId, f.state])).toEqual([[IDS.laura, "success"]]);
    expect(fx.override).toMatchObject({ status: "done", progress: 100 });
    expect(fx.flight).toBeNull();
  });

  it("run events toggle working and clear it when the run ends", () => {
    const start = effectsOfRecord(rec({ kind: "run_started", actor: { kind: "agent", id: IDS.luke } }), snap.people, snap.tasks, NOW);
    expect(start.flashes[0]).toMatchObject({ personId: IDS.luke, state: "working" });
    const end = effectsOfRecord(rec({ kind: "run_finished", actor: { kind: "agent", id: IDS.luke } }), snap.people, snap.tasks, NOW + 5000);
    expect(end.flashes[0]).toMatchObject({ personId: IDS.luke, state: null });
    const merged = mergeFlashes(start.flashes, end.flashes, NOW + 5000);
    expect(merged).toHaveLength(0);
  });

  it("progress events update the percent only", () => {
    const fx = effectsOfRecord(rec({ kind: "progress", issueId: "iss-55", percent: 61.6, actor: { kind: "agent", id: IDS.sofia } }), snap.people, snap.tasks, NOW);
    expect(fx.override).toMatchObject({ taskId: "iss-55", progress: 62 });
    expect(fx.flashes).toHaveLength(0);
  });

  it("a handoff to a party we can't resolve keeps the previous holder; to null means unassigned", () => {
    const unknown = effectsOfRecord(rec({ issueId: "iss-62", from: { kind: "agent", id: IDS.jamal }, to: { kind: "agent", id: "not-on-chart" }, statusTo: "todo" }), snap.people, snap.tasks, NOW);
    expect(unknown.override?.holderId).toBeUndefined();
    expect(unknown.flight).toBeNull();
    const tasks = applyOverrides(snap.tasks, [unknown.override!]);
    expect(tasks.find((t) => t.id === "iss-62")!.holderId).toBe(IDS.jamal);
    const unassigned = effectsOfRecord(rec({ issueId: "iss-62", from: { kind: "agent", id: IDS.jamal }, to: null }), snap.people, snap.tasks, NOW);
    expect(unassigned.override?.holderId).toBeNull();
  });

  it("unknown tasks and people produce no flight and no crash", () => {
    const fx = effectsOfRecord(rec({ issueId: "nope", from: { kind: "agent", id: "x" }, to: { kind: "agent", id: "y" } }), snap.people, snap.tasks, NOW);
    expect(fx).toEqual({ flashes: [], override: null, flight: null });
  });
});

describe("flashes", () => {
  it("apply only while active and are replaced by newer ones", () => {
    const a = { personId: IDS.joe, state: "listening" as const, label: "Ha ricevuto FRA-1", from: NOW, until: NOW + 4000 };
    const b = { personId: IDS.joe, state: "success" as const, label: "Fatto!", from: NOW + 1000, until: NOW + 5000 };
    const list = mergeFlashes([a], [b], NOW + 1000);
    expect(list).toEqual([b]);
    expect(activeFlash(list, IDS.joe, NOW + 500)).toBeNull();
    const people = applyFlashes(snap.people, list, NOW + 2000);
    expect(people.find((p) => p.id === IDS.joe)).toMatchObject({ state: "success", stateLabel: "Fatto!" });
    expect(applyFlashes(snap.people, list, NOW + 6000).find((p) => p.id === IDS.joe)!.state).toBe("sleepy");
    expect(nextFlashChange(list, NOW)).toBe(NOW + 1000);
    expect(nextFlashChange(list, NOW + 9000)).toBeNull();
  });

  it("drops expired flashes on merge", () => {
    const old = { personId: IDS.joe, state: "listening" as const, label: "", from: NOW - 9000, until: NOW - 1 };
    expect(mergeFlashes([old], [], NOW)).toEqual([]);
  });
});

describe("task overrides", () => {
  it("move the task until a newer snapshot arrives, then are pruned", () => {
    const at = new Date(NOW + 1000).toISOString();
    const o = { taskId: "iss-62", holderId: IDS.giulia, status: "in_progress", at, expires: NOW + 45_000 };
    const tasks = applyOverrides(snap.tasks, [o]);
    const t = tasks.find((x) => x.id === "iss-62")!;
    expect(t.holderId).toBe(IDS.giulia);
    expect(t.status).toBe("in_progress");
    expect(t.journey[t.journey.length - 1]).toEqual({ personId: IDS.giulia, since: at });
    // the original array is untouched
    expect(snap.tasks.find((x) => x.id === "iss-62")!.holderId).toBe(IDS.jamal);
    expect(pruneOverrides([o], snap.generatedAt, NOW)).toHaveLength(1);
    expect(pruneOverrides([o], new Date(NOW + 1500).toISOString(), NOW)).toHaveLength(0);
    expect(pruneOverrides([o], null, NOW + 50_000)).toHaveLength(0);
  });
});
