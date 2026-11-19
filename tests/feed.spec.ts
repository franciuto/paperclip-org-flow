import { describe, expect, it } from "vitest";
import { makeCursor, pageEvents, personIdOf, pushRecent, recordFromIssueEvent, recordFromRunEvent, type DomainEventLike, type FeedRecord } from "../src/worker/feed.js";

const ev = (eventType: string, payload: unknown, extra: Partial<DomainEventLike> = {}): DomainEventLike => ({
  eventId: "e1",
  eventType,
  occurredAt: "2026-11-19T10:00:00.000Z",
  entityId: "iss-1",
  entityType: "issue",
  payload,
  ...extra,
});

describe("recordFromIssueEvent", () => {
  it("turns an agent-to-agent reassignment into a handoff", () => {
    const rec = recordFromIssueEvent(ev("issue.updated", {
      identifier: "FRA-34",
      title: "Logo",
      changes: {
        assigneeAgentId: { from: "giulia", to: "sofia" },
        status: { from: "todo", to: "in_progress" },
      },
    }, { actorType: "agent", actorId: "giulia" }));
    expect(rec).toMatchObject({
      kind: "handoff",
      issueId: "iss-1",
      identifier: "FRA-34",
      from: { kind: "agent", id: "giulia" },
      to: { kind: "agent", id: "sofia" },
      statusFrom: "todo",
      statusTo: "in_progress",
      actor: { kind: "agent", id: "giulia" },
    });
  });

  it("handles a handoff from an agent to a board user", () => {
    const rec = recordFromIssueEvent(ev("issue.updated", {
      changes: {
        assigneeAgentId: { from: "luke", to: null },
        assigneeUserId: { from: null, to: "user-1" },
      },
    }));
    expect(rec?.from).toEqual({ kind: "agent", id: "luke" });
    expect(rec?.to).toEqual({ kind: "user", id: "user-1" });
  });

  it("records a status-only change", () => {
    const rec = recordFromIssueEvent(ev("issue.updated", { changes: { status: { from: "in_progress", to: "in_review" } } }));
    expect(rec).toMatchObject({ kind: "status", statusFrom: "in_progress", statusTo: "in_review" });
    expect(rec?.from).toBeUndefined();
  });

  it("ignores updates that change neither assignee nor status", () => {
    expect(recordFromIssueEvent(ev("issue.updated", { changes: { executionRunId: { from: null, to: "r1" } } }))).toBeNull();
    expect(recordFromIssueEvent(ev("issue.updated", { changes: { status: { from: "todo", to: "todo" } } }))).toBeNull();
  });

  it("records a created issue with its assignee", () => {
    const rec = recordFromIssueEvent(ev("issue.created", { identifier: "FRA-40", assigneeAgentId: "laura", status: "todo" }));
    expect(rec).toMatchObject({ kind: "created", identifier: "FRA-40", to: { kind: "agent", id: "laura" }, statusTo: "todo" });
  });
});

describe("recordFromRunEvent", () => {
  it("maps run lifecycle events", () => {
    const rec = recordFromRunEvent(ev("agent.run.started", { agentId: "daniel", issueId: "iss-9", runId: "r1" }, { entityType: "heartbeat_run" }));
    expect(rec).toMatchObject({ kind: "run_started", issueId: "iss-9", actor: { kind: "agent", id: "daniel" } });
    expect(recordFromRunEvent(ev("agent.run.failed", { agentId: "daniel" }))?.kind).toBe("run_failed");
    expect(recordFromRunEvent(ev("agent.run.cancelled", { agentId: "daniel" }))).toBeNull();
  });
});

describe("pushRecent", () => {
  it("keeps newest first, de-duplicates and caps", () => {
    const mk = (id: string): FeedRecord => ({ id, at: "", kind: "ping" });
    let list: FeedRecord[] = [mk("a"), mk("b")];
    list = pushRecent(list, mk("b"), 3);
    expect(list.map((r) => r.id)).toEqual(["b", "a"]);
    list = pushRecent(pushRecent(list, mk("c"), 3), mk("d"), 3);
    expect(list.map((r) => r.id)).toEqual(["d", "c", "b"]);
  });
});

describe("pageEvents", () => {
  const at = (n: number) => new Date(Date.UTC(2026, 10, 19, 10, 0, n)).toISOString();
  const mk = (id: string, n: number): FeedRecord => ({ id, at: at(n), kind: "ping" });
  const E = "run1";
  // seq i ↔ record r{i}
  const items = Array.from({ length: 70 }, (_, i) => ({ seq: i + 1, record: mk(`r${i}`, i) }));

  it("without cursor returns the latest 20, oldest first, with a seq cursor", () => {
    const page = pageEvents(items, null, E);
    expect(page.records).toHaveLength(20);
    expect(page.records[0].id).toBe("r50");
    expect(page.records[19].id).toBe("r69");
    expect(page.cursor).toBe("seq:run1:70");
  });

  it("pages forward by sequence, max 50", () => {
    const page = pageEvents(items, makeCursor(E, 6), E);
    expect(page.records).toHaveLength(50);
    expect(page.records[0].id).toBe("r6");
    expect(page.cursor).toBe("seq:run1:56");
    const next = pageEvents(items, page.cursor, E);
    expect(next.records.map((r) => r.id)).toEqual(Array.from({ length: 14 }, (_, i) => `r${56 + i}`));
    expect(pageEvents(items, next.cursor, E)).toEqual({ records: [], cursor: "seq:run1:70" });
  });

  it("does not skip records published out of `at` order", () => {
    // r-late has an older timestamp but was published after the cursor was handed out.
    const first = [{ seq: 1, record: mk("a", 10) }, { seq: 2, record: mk("b", 20) }];
    const page = pageEvents(first, null, E);
    const later = [...first, { seq: 3, record: mk("late", 15) }];
    expect(pageEvents(later, page.cursor, E).records.map((r) => r.id)).toEqual(["late"]);
  });

  it("accepts legacy ISO cursors with a 15 s overlap and switches to seq", () => {
    const page = pageEvents(items, at(65), E);
    // at > 65 s − 15 s → r51…r69 (the UI de-duplicates the overlap by id)
    expect(page.records.map((r) => r.id)).toEqual(Array.from({ length: 19 }, (_, i) => `r${51 + i}`));
    expect(page.cursor).toBe("seq:run1:70");
  });

  it("after a worker restart (other epoch) or a cursor ahead of the head: latest 20", () => {
    const stale = pageEvents(items, "seq:old:999", E);
    expect(stale.records).toHaveLength(20);
    expect(stale.records[19].id).toBe("r69");
    expect(stale.cursor).toBe("seq:run1:70");
    const ahead = pageEvents(items, makeCursor(E, 500), E);
    expect(ahead.records).toHaveLength(20);
    expect(ahead.cursor).toBe("seq:run1:70");
  });

  it("handles an empty feed", () => {
    expect(pageEvents([], null, E)).toEqual({ records: [], cursor: null });
    expect(pageEvents([], makeCursor(E, 0), E)).toEqual({ records: [], cursor: "seq:run1:0" });
    expect(pageEvents([], makeCursor(E, 4), E)).toEqual({ records: [], cursor: null });
  });
});

describe("personIdOf", () => {
  it("prefixes users", () => {
    expect(personIdOf({ kind: "agent", id: "a" })).toBe("a");
    expect(personIdOf({ kind: "user", id: "u" })).toBe("user:u");
    expect(personIdOf(null as never)).toBeNull();
  });
});
