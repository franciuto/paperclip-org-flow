import { describe, expect, it } from "vitest";
import { pageEvents, personIdOf, pushRecent, recordFromIssueEvent, recordFromRunEvent, type DomainEventLike, type FeedRecord } from "../src/worker/feed.js";

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
  // stored newest first
  const list = Array.from({ length: 70 }, (_, i) => mk(`r${i}`, i)).reverse();

  it("without cursor returns the latest 20, oldest first", () => {
    const page = pageEvents(list);
    expect(page.records).toHaveLength(20);
    expect(page.records[0].id).toBe("r50");
    expect(page.records[19].id).toBe("r69");
    expect(page.cursor).toBe(at(69));
  });

  it("with cursor returns newer records oldest first, max 50", () => {
    const page = pageEvents(list, at(5));
    expect(page.records).toHaveLength(50);
    expect(page.records[0].id).toBe("r6");
    expect(page.cursor).toBe(at(55));
    const next = pageEvents(list, page.cursor);
    expect(next.records.map((r) => r.id)).toEqual(Array.from({ length: 14 }, (_, i) => `r${56 + i}`));
  });

  it("echoes the cursor when nothing is new", () => {
    expect(pageEvents(list, at(69))).toEqual({ records: [], cursor: at(69) });
    expect(pageEvents([], null)).toEqual({ records: [], cursor: null });
  });

  it("never splits records sharing the boundary timestamp", () => {
    const same = Array.from({ length: 55 }, (_, i) => mk(`s${i}`, 1));
    const page = pageEvents(same, at(0));
    expect(page.records).toHaveLength(55);
  });
});

describe("personIdOf", () => {
  it("prefixes users", () => {
    expect(personIdOf({ kind: "agent", id: "a" })).toBe("a");
    expect(personIdOf({ kind: "user", id: "u" })).toBe("user:u");
    expect(personIdOf(null as never)).toBeNull();
  });
});
