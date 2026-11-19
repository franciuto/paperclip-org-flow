import { describe, expect, it } from "vitest";
import {
  bouncesByIssue, countBounces, entryFromRecord, isAbove, holderSequences, isStatusRegression, journeyFor, personSignals, pushHistory,
  type HistoryEntry,
} from "../src/worker/history.js";
import type { FeedRecord } from "../src/shared/types.js";

const NOW = Date.parse("2026-11-19T10:00:00.000Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();

let seq = 0;
const h = (over: Partial<HistoryEntry>): HistoryEntry => ({
  id: `h${seq++}`, at: ago(100), kind: "handoff", issueId: "i1", fromId: null, toId: null,
  statusFrom: null, statusTo: null, actorId: null, holderId: null, ...over,
});

describe("entryFromRecord", () => {
  it("maps handoffs with person ids (users prefixed)", () => {
    const rec: FeedRecord = {
      id: "e1", at: ago(1), kind: "handoff", issueId: "i1",
      from: { kind: "agent", id: "a1" }, to: { kind: "user", id: "u1" }, statusFrom: "in_progress", statusTo: "in_review",
    };
    expect(entryFromRecord(rec, "a1")).toMatchObject({ fromId: "a1", toId: "user:u1", holderId: "user:u1" });
  });
  it("status changes keep the holder known before the event", () => {
    const rec: FeedRecord = { id: "e2", at: ago(1), kind: "status", issueId: "i1", statusFrom: "todo", statusTo: "done" };
    expect(entryFromRecord(rec, "a2")?.holderId).toBe("a2");
  });
  it("ignores run and ping records", () => {
    expect(entryFromRecord({ id: "r", at: ago(1), kind: "run_started", issueId: "i1" }, null)).toBeNull();
    expect(entryFromRecord({ id: "p", at: ago(1), kind: "ping" }, null)).toBeNull();
  });
});

describe("pushHistory", () => {
  it("caps at 300, newest first, de-duplicated", () => {
    let list: HistoryEntry[] = [];
    for (let i = 0; i < 305; i++) list = pushHistory(list, h({ id: `x${i}` }));
    expect(list).toHaveLength(300);
    expect(list[0].id).toBe("x304");
    list = pushHistory(list, h({ id: "x304" }));
    expect(list.filter((e) => e.id === "x304")).toHaveLength(1);
  });
});

describe("journeys and bounces", () => {
  const entries = [
    h({ at: ago(500), kind: "created", toId: "A" }),
    h({ at: ago(400), fromId: "A", toId: "B" }),
    h({ at: ago(300), fromId: "B", toId: "A" }),
    h({ at: ago(250), kind: "status", statusFrom: "todo", statusTo: "in_progress", holderId: "A" }),
    h({ at: ago(200), fromId: "A", toId: "B" }),
    h({ at: ago(100), issueId: "i2", fromId: "C", toId: "D" }),
  ];
  it("builds the holder sequence oldest first", () => {
    const seqs = holderSequences(entries);
    expect(seqs.get("i1")!.map((s) => s.personId)).toEqual(["A", "B", "A", "B"]);
    expect(seqs.get("i2")!.map((s) => s.personId)).toEqual(["C", "D"]);
  });
  it("counts A→B→A as one bounce, A→B→A→B as two", () => {
    const seqs = holderSequences(entries);
    expect(countBounces(seqs.get("i1")!.slice(0, 3))).toBe(1);
    expect(countBounces(seqs.get("i1")!)).toBe(2);
    expect(countBounces(seqs.get("i2")!)).toBe(0);
  });
  it("falls back on the current holder and appends missed handoffs", () => {
    expect(journeyFor(undefined, { holderId: "X", createdAt: "c", updatedAt: "u" })).toEqual([{ personId: "X", since: "c" }]);
    expect(journeyFor(undefined, { holderId: null, createdAt: "c", updatedAt: "u" })).toEqual([]);
    const j = journeyFor([{ personId: "A", since: "1" }], { holderId: "Z", createdAt: "c", updatedAt: "u" });
    expect(j.map((s) => s.personId)).toEqual(["A", "Z"]);
  });
});

describe("isStatusRegression", () => {
  it("detects review/done going back", () => {
    expect(isStatusRegression("in_review", "in_progress")).toBe(true);
    expect(isStatusRegression("done", "todo")).toBe(true);
    expect(isStatusRegression("in_progress", "todo")).toBe(false); // normal delegation pattern
    expect(isStatusRegression("in_review", "done")).toBe(false);
    expect(isStatusRegression("in_review", "cancelled")).toBe(false);
    expect(isStatusRegression("in_review", "blocked")).toBe(false);
  });
});

describe("personSignals", () => {
  it("collects received, closed, bounced and 24h stats", () => {
    const entries = [
      h({ at: ago(3000), kind: "created", toId: "A", issueId: "t1" }),
      h({ at: ago(2000), fromId: "A", toId: "B", issueId: "t1", statusFrom: "in_progress", statusTo: "in_review" }),
      h({ at: ago(30), fromId: "B", toId: "A", issueId: "t1" }), // reviewer hands it back down while in review
      h({ at: ago(20), kind: "status", issueId: "t2", statusFrom: "in_progress", statusTo: "done", holderId: "C", actorId: "C" }),
      h({ at: ago(10), kind: "status", issueId: "t3", statusFrom: "in_review", statusTo: "in_progress", holderId: "D" }),
      h({ at: ago(5), issueId: "t4", fromId: "E", toId: "F", statusFrom: "in_progress", statusTo: "done", actorId: "E" }),
      h({ at: ago(26 * 3600), kind: "created", toId: "A", issueId: "old" }),
    ];
    // A reports to B: B handing t1 back DOWN to A (who held it before) is a "sent back".
    const s = personSignals(entries, NOW, (id) => (id === "A" ? "B" : null));
    expect(s.get("A")!.bounced?.issueId).toBe("t1");
    expect(s.get("A")!.received?.at).toBe(ago(30));
    expect(s.get("A")!.stats).toEqual({ received24h: 2, passed24h: 1, closed24h: 0 });
    expect(s.get("B")!.stats.passed24h).toBe(1);
    expect(s.get("C")!.closed?.issueId).toBe("t2");
    expect(s.get("C")!.stats.closed24h).toBe(1);
    expect(s.get("D")!.bounced?.issueId).toBe("t3");
    // handoff + done: the previous holder closed it
    expect(s.get("E")!.closed?.issueId).toBe("t4");
    // the one getting the done task back ("un suo task è stato approvato") also celebrates
    expect(s.get("F")!.closed?.issueId).toBe("t4");
    expect(s.get("F")!.stats.closed24h).toBe(0);
    expect(s.get("A")!.lastActivityAt).toBe(ago(30));
  });
  it("a reviewer agent approving gets the success moment too", () => {
    const s = personSignals([
      h({ at: ago(5), kind: "status", issueId: "t", statusFrom: "in_review", statusTo: "done", holderId: "W", actorId: "R" }),
    ], NOW);
    expect(s.get("W")!.closed).toBeDefined();
    expect(s.get("R")!.closed).toBeDefined();
  });
});

describe("bouncesByIssue / backwards work", () => {
  // Org chart: arold > luke; giulia > martina, sofia
  const chain: Record<string, string | null> = { luke: "arold", martina: "giulia", sofia: "giulia" };
  const managerOf = (id: string) => chain[id] ?? null;

  it("delegate down and return up is normal flow (FRA-20 / FRA-35)", () => {
    const entries = [
      h({ at: ago(500), issueId: "f35", kind: "created", toId: "arold" }),
      h({ at: ago(400), issueId: "f35", fromId: "arold", toId: "luke", statusFrom: "in_progress", statusTo: "todo" }),
      h({ at: ago(60), issueId: "f35", fromId: "luke", toId: "arold", statusFrom: "blocked", statusTo: "todo" }),
    ];
    expect(bouncesByIssue(entries, managerOf).get("f35")).toBeUndefined();
    expect(personSignals(entries, NOW, managerOf).get("arold")!.bounced).toBeUndefined();
  });

  it("A→B→C→A back up the chain is not a bounce (FRA-32)", () => {
    const entries = [
      h({ at: ago(500), issueId: "f32", kind: "created", toId: "giulia" }),
      h({ at: ago(400), issueId: "f32", fromId: "giulia", toId: "martina" }),
      h({ at: ago(300), issueId: "f32", fromId: "martina", toId: "sofia" }),
      h({ at: ago(30), issueId: "f32", fromId: "sofia", toId: "giulia" }),
    ];
    expect(bouncesByIssue(entries, managerOf).get("f32")).toBeUndefined();
    expect(personSignals(entries, NOW, managerOf).get("giulia")!.bounced).toBeUndefined();
  });

  it("escalating up and getting it back down (real FRA-35: Luke → Arold → Luke, blocked → todo) is normal", () => {
    const entries = [
      h({ at: ago(500), issueId: "e", kind: "created", toId: "luke" }),
      h({ at: ago(400), issueId: "e", fromId: "luke", toId: "arold", statusFrom: "in_progress", statusTo: "todo" }),
      h({ at: ago(300), issueId: "e", kind: "status", statusFrom: "in_progress", statusTo: "blocked", holderId: "arold" }),
      h({ at: ago(60), issueId: "e", fromId: "arold", toId: "luke", statusFrom: "blocked", statusTo: "todo" }),
    ];
    expect(bouncesByIssue(entries, managerOf).get("e")).toBeUndefined();
    expect(personSignals(entries, NOW, managerOf).get("luke")!.bounced).toBeUndefined();
  });

  it("parking moves are not rework (in_review → blocked/backlog, real FRA-23 / FRA-6)", () => {
    expect(isStatusRegression("in_review", "blocked")).toBe(false);
    expect(isStatusRegression("in_review", "backlog")).toBe(false);
    expect(isStatusRegression("done", "in_review")).toBe(true);
  });

  it("counts rework after review, reopen, and a reviewer handing back down while in review", () => {
    const entries = [
      h({ at: ago(500), issueId: "b", kind: "created", toId: "luke" }),
      h({ at: ago(400), issueId: "b", fromId: "luke", toId: "arold", statusFrom: "in_progress", statusTo: "in_review" }),
      h({ at: ago(300), issueId: "b", fromId: "arold", toId: "luke", statusFrom: "in_review", statusTo: "in_progress" }),
      h({ at: ago(250), issueId: "b", kind: "status", statusFrom: "in_progress", statusTo: "in_review", holderId: "luke" }),
      h({ at: ago(200), issueId: "b", fromId: "luke", toId: "arold" }),
      h({ at: ago(100), issueId: "b", fromId: "arold", toId: "luke" }),
      h({ at: ago(50), issueId: "b", kind: "status", statusFrom: "done", statusTo: "todo", holderId: "luke" }),
    ];
    expect(bouncesByIssue(entries, managerOf).get("b")).toBe(3);
    expect(personSignals(entries, NOW, managerOf).get("luke")!.bounced?.at).toBe(ago(50));
  });

  it("a first delegation down is not a bounce; the board sending back is", () => {
    const entries = [
      h({ at: ago(500), issueId: "u", kind: "created", toId: "arold" }),
      h({ at: ago(400), issueId: "u", fromId: "arold", toId: "user:u1", statusFrom: "in_progress", statusTo: "in_review" }),
      h({ at: ago(300), issueId: "u", fromId: "user:u1", toId: "arold" }),
    ];
    expect(bouncesByIssue(entries, managerOf).get("u")).toBe(1);
  });

  it("does not count the return on approval (review → done back to the implementer)", () => {
    const entries = [
      h({ at: ago(500), issueId: "r", kind: "created", toId: "luke" }),
      h({ at: ago(400), issueId: "r", fromId: "luke", toId: "arold", statusFrom: "in_progress", statusTo: "in_review" }),
      h({ at: ago(30), issueId: "r", fromId: "arold", toId: "luke", statusFrom: "in_review", statusTo: "done", actorId: "arold" }),
    ];
    expect(bouncesByIssue(entries, managerOf).get("r")).toBeUndefined();
    const s = personSignals(entries, NOW, managerOf);
    expect(s.get("luke")!.bounced).toBeUndefined();
    expect(s.get("luke")!.closed).toBeDefined();
    expect(s.get("arold")!.closed).toBeDefined();
  });

  it("isAbove: chain, board above agents, cycles", () => {
    expect(isAbove("arold", "luke", managerOf)).toBe(true);
    expect(isAbove("luke", "arold", managerOf)).toBe(false);
    expect(isAbove("martina", "sofia", managerOf)).toBe(false);
    expect(isAbove("user:x", "luke", managerOf)).toBe(true);
    expect(isAbove("luke", "user:x", managerOf)).toBe(false);
    expect(isAbove("a", "b", (id) => (id === "a" ? "b" : "a"))).toBe(true);
    expect(isAbove("z", "b", (id) => (id === "a" ? "b" : "a"))).toBe(false);
  });
});
