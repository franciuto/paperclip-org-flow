import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";
import {
  ACTION_PING, ACTION_REFRESH, DATA_EVENTS, DATA_SNAPSHOT, STREAM_CHANNEL, TOOL_REPORT_PROGRESS,
  type EventsPage, type FeedRecord, type Snapshot, type StreamMessage,
} from "../src/shared/types.js";

const CO = "co-1";
const CO2 = "co-2";
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();

const agent = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, companyId: CO, name, status: "idle", reportsTo: null, role: "general", title: null,
  appearance: { paletteId: "cherry-pop", schemaVersion: 1, characterVersion: "cap-v1" }, lastHeartbeatAt: null, ...over,
});
const issue = (id: string, over: Record<string, unknown> = {}) => ({
  id, companyId: CO, identifier: id.toUpperCase(), title: `Task ${id}`, status: "todo", priority: "medium",
  parentId: null, assigneeAgentId: null, assigneeUserId: null, createdAt: iso(3_600_000), updatedAt: iso(600_000), ...over,
});

interface Emitted { channel: string; company: string | undefined; msg: StreamMessage }

function setup(opts: { config?: Record<string, unknown>; extraCaps?: string[] } = {}) {
  const harness = createTestHarness({
    manifest,
    ...(opts.config ? { config: opts.config } : {}),
    ...(opts.extraCaps ? { capabilities: [...manifest.capabilities, ...opts.extraCaps] as never } : {}),
  });
  const emitted: Emitted[] = [];
  const opened: Array<{ channel: string; company: string }> = [];
  // Model the SDK: emit goes to the company of the last open() for the channel.
  const current = new Map<string, string>();
  const streams = harness.ctx.streams;
  streams.open = (channel: string, companyId: string) => { current.set(channel, companyId); opened.push({ channel, company: companyId }); };
  streams.emit = (channel: string, event: unknown) => { emitted.push({ channel, company: current.get(channel), msg: event as StreamMessage }); };
  return { harness, emitted, opened };
}

const events = (e: Emitted[]) => e.filter((x) => x.msg.type === "event").map((x) => (x.msg as { record: FeedRecord }).record);
const snapshots = (e: Emitted[]) => e.filter((x) => x.msg.type === "snapshot").map((x) => (x.msg as { snapshot: Snapshot }).snapshot);

describe("org-flow worker", () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    ctx = setup();
    ctx.harness.seed({
      agents: [
        agent("ag-laura", "Laura"),
        agent("ag-giulia", "Giulia Bennett", { reportsTo: "ag-laura" }),
        agent("ag-sofia", "Sofia Carter", { reportsTo: "ag-giulia" }),
        agent("ag-old", "Vecchio", { status: "terminated" }),
      ] as never,
      issues: [
        issue("p1", { title: "Newsletter di dicembre", status: "in_progress", assigneeAgentId: "ag-giulia" }),
        issue("fra-34", { title: "Logo per la newsletter", parentId: "p1", assigneeAgentId: "ag-giulia" }),
        issue("fra-35", { parentId: "p1", status: "done", assigneeAgentId: "ag-sofia", completedAt: iso(3_600_000) }),
        issue("fra-36", { parentId: "p1", status: "cancelled", cancelledAt: iso(60_000) }),
        issue("fra-40", { status: "in_review", assigneeUserId: "user-1" }),
        issue("orphan", { parentId: "deleted-parent", assigneeAgentId: "ag-sofia" }),
      ] as never,
    });
    await plugin.definition.setup(ctx.harness.ctx);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds the snapshot for a company", async () => {
    const s = await ctx.harness.getData<Snapshot>(DATA_SNAPSHOT, { companyId: CO });
    expect(s.companyId).toBe(CO);
    expect(s.people.map((p) => p.id).sort()).toEqual(["ag-giulia", "ag-laura", "ag-sofia", "user:user-1"]);
    const giulia = s.people.find((p) => p.id === "ag-giulia")!;
    expect(giulia).toMatchObject({ reportsTo: "ag-laura", paletteId: "cherry-pop", agentStatus: "idle" });
    const board = s.people.find((p) => p.id === "user:user-1")!;
    expect(board).toMatchObject({ kind: "user", name: "Board", state: "waiting", stateLabel: "Da gestire: FRA-40" });
    const group = s.groups.find((g) => g.id === "p1")!;
    expect(group).toMatchObject({ title: "Newsletter di dicembre", childrenTotal: 2, childrenDone: 1, progress: 50 });
    expect(s.tasks.find((t) => t.id === "orphan")).toMatchObject({ groupId: "standalone", parentId: null });
    expect(s.tasks.find((t) => t.id === "p1")).toMatchObject({ groupId: "p1", progressSource: "children" });
    expect(s.settings).toEqual({ sleepAfterMinutes: 15, keepClosedHours: 24, enableSimulation: true });
  });

  it("returns null / empty pages without a company", async () => {
    expect(await ctx.harness.getData(DATA_SNAPSHOT, {})).toBeNull();
    expect(await ctx.harness.getData(DATA_EVENTS, {})).toEqual({ records: [], cursor: null, snapshotAt: null });
  });

  it("streams a handoff immediately, then a debounced snapshot", async () => {
    ctx.harness.seed({ issues: [issue("fra-34", { title: "Logo per la newsletter", parentId: "p1", assigneeAgentId: "ag-sofia", updatedAt: iso() })] as never });
    await ctx.harness.emit("issue.updated", {
      identifier: "FRA-34",
      changes: { assigneeAgentId: { from: "ag-giulia", to: "ag-sofia" }, status: { from: "todo", to: "in_progress" } },
    }, { companyId: CO, entityId: "fra-34", entityType: "issue", eventId: "ev-1", actorType: "agent", actorId: "ag-giulia", occurredAt: iso() });

    expect(ctx.emitted).toHaveLength(1);
    const rec = events(ctx.emitted)[0];
    expect(ctx.emitted[0]).toMatchObject({ channel: STREAM_CHANNEL, company: CO });
    expect(rec).toMatchObject({
      kind: "handoff", identifier: "FRA-34", title: "Logo per la newsletter", parentId: "p1",
      from: { kind: "agent", id: "ag-giulia", name: "Giulia Bennett" }, to: { kind: "agent", id: "ag-sofia", name: "Sofia Carter" },
    });

    await vi.advanceTimersByTimeAsync(700);
    const snaps = snapshots(ctx.emitted);
    expect(snaps).toHaveLength(1);
    const sofia = snaps[0].people.find((p) => p.id === "ag-sofia")!;
    expect(sofia).toMatchObject({ state: "listening", stateLabel: "Ha ricevuto FRA-34" });
    expect(snaps[0].tasks.find((t) => t.id === "fra-34")!.journey.map((j) => j.personId)).toEqual(["ag-giulia", "ag-sofia"]);
    expect(snaps[0].feed[0].id).toBe("ev-1");
  });

  it("debounces bursts into a single snapshot", async () => {
    for (let i = 0; i < 3; i++) {
      await ctx.harness.emit("agent.run.started", { agentId: "ag-sofia", runId: `r${i}` }, { companyId: CO, eventId: `run-${i}` });
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(snapshots(ctx.emitted)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(700);
    expect(snapshots(ctx.emitted)).toHaveLength(1);
    expect(events(ctx.emitted)).toHaveLength(3);
  });

  it("ignores irrelevant issue updates", async () => {
    await ctx.harness.emit("issue.updated", { changes: { executionRunId: { from: null, to: "r" } } }, { companyId: CO, entityId: "fra-34", entityType: "issue" });
    await vi.advanceTimersByTimeAsync(700);
    expect(ctx.emitted).toHaveLength(0);
  });

  it("enriches issue.created with the assignee from the issue", async () => {
    ctx.harness.seed({ issues: [issue("fra-50", { assigneeAgentId: "ag-sofia", createdAt: iso(), updatedAt: iso() })] as never });
    await ctx.harness.emit("issue.created", { title: "Task fra-50", identifier: "FRA-50", status: "todo" },
      { companyId: CO, entityId: "fra-50", entityType: "issue", eventId: "ev-c", actorType: "user", actorId: "user-1", occurredAt: iso() });
    expect(events(ctx.emitted)[0]).toMatchObject({
      kind: "created", to: { kind: "agent", id: "ag-sofia", name: "Sofia Carter" }, actor: { kind: "user", id: "user-1", name: "Board" },
    });
  });

  it("never drops an event when enrichment fails", async () => {
    ctx.harness.ctx.issues.get = async () => { throw new Error("boom"); };
    await ctx.harness.emit("issue.updated", { changes: { status: { from: "todo", to: "in_progress" } } },
      { companyId: CO, entityId: "fra-34", entityType: "issue", eventId: "ev-x" });
    expect(events(ctx.emitted).map((r) => r.id)).toEqual(["ev-x"]);
    expect(ctx.harness.logs.some((l) => l.level === "warn")).toBe(true);
  });

  it("tracks runs: started → working, failed → confused", async () => {
    await ctx.harness.emit("agent.run.started", { agentId: "ag-sofia", runId: "r1", issueId: "orphan" }, { companyId: CO, eventId: "run-1", occurredAt: iso() });
    let s = await ctx.harness.getData<Snapshot>(DATA_SNAPSHOT, { companyId: CO });
    expect(s.people.find((p) => p.id === "ag-sofia")).toMatchObject({ state: "working", stateLabel: "Lavora su ORPHAN · 5%", activeTaskId: "orphan" });
    expect(s.counts.working).toBe(1);
    expect(events(ctx.emitted)[0]).toMatchObject({ kind: "run_started", identifier: "ORPHAN", actor: { name: "Sofia Carter" } });

    await ctx.harness.emit("agent.run.failed", { agentId: "ag-sofia", runId: "r1", issueId: "orphan" }, { companyId: CO, eventId: "run-2", occurredAt: iso() });
    s = await ctx.harness.performAction<Snapshot>(ACTION_REFRESH, { companyId: CO }, { companyId: CO });
    expect(s.people.find((p) => p.id === "ag-sofia")).toMatchObject({ state: "confused" });
  });

  it("serves incremental events oldest first with a cursor and a stable snapshotAt", async () => {
    await ctx.harness.getData(DATA_SNAPSHOT, { companyId: CO });
    for (let i = 0; i < 3; i++) {
      await ctx.harness.emit("agent.run.finished", { agentId: "ag-laura", runId: `r${i}` }, { companyId: CO, eventId: `e${i}`, occurredAt: iso(10_000 - i * 1000) });
    }
    await vi.advanceTimersByTimeAsync(700);
    const first = await ctx.harness.getData<EventsPage>(DATA_EVENTS, { companyId: CO });
    expect(first.records.map((r) => r.id)).toEqual(["e0", "e1", "e2"]);
    expect(first.cursor).toBe(first.records[2].at);
    const snap = snapshots(ctx.emitted).at(-1)!;
    expect(first.snapshotAt).toBe(snap.generatedAt);

    const none = await ctx.harness.getData<EventsPage>(DATA_EVENTS, { companyId: CO, after: first.cursor });
    expect(none).toEqual({ records: [], cursor: first.cursor, snapshotAt: first.snapshotAt });

    await ctx.harness.performAction(ACTION_PING, { companyId: CO }, { companyId: CO });
    const next = await ctx.harness.getData<EventsPage>(DATA_EVENTS, { companyId: CO, after: first.cursor });
    expect(next.records.map((r) => r.kind)).toEqual(["ping"]);

    // Same content → same version, even when asked again.
    const s1 = await ctx.harness.getData<Snapshot>(DATA_SNAPSHOT, { companyId: CO });
    const s2 = await ctx.harness.getData<Snapshot>(DATA_SNAPSHOT, { companyId: CO });
    expect(s2.generatedAt).toBe(s1.generatedAt);
  });

  it("ping pushes a record and a snapshot through the same path", async () => {
    const res = await ctx.harness.performAction<{ ok: boolean }>(ACTION_PING, { companyId: CO }, { companyId: CO });
    expect(res.ok).toBe(true);
    expect(ctx.emitted.map((e) => e.msg.type)).toEqual(["event", "snapshot"]);
    expect(events(ctx.emitted)[0].kind).toBe("ping");
    expect(snapshots(ctx.emitted)[0].feed[0].kind).toBe("ping");
  });

  it("persists feed and history in plugin state across worker restarts", async () => {
    await ctx.harness.emit("issue.updated", { changes: { assigneeAgentId: { from: "ag-giulia", to: "ag-sofia" } } },
      { companyId: CO, entityId: "fra-34", entityType: "issue", eventId: "ev-p", occurredAt: iso() });
    const feed = ctx.harness.getState({ scopeKind: "company", scopeId: CO, stateKey: "feed" }) as FeedRecord[];
    const history = ctx.harness.getState({ scopeKind: "company", scopeId: CO, stateKey: "history" }) as unknown[];
    expect(feed.map((r) => r.id)).toEqual(["ev-p"]);
    expect(history).toHaveLength(1);

    // A new worker on the same state sees the old feed.
    const again = setup();
    again.harness.seed({ agents: [agent("ag-sofia", "Sofia Carter")] as never });
    await again.harness.ctx.state.set({ scopeKind: "company", scopeId: CO, stateKey: "feed" }, feed);
    await plugin.definition.setup(again.harness.ctx);
    const page = await again.harness.getData<EventsPage>(DATA_EVENTS, { companyId: CO });
    expect(page.records.map((r) => r.id)).toEqual(["ev-p"]);
  });

  it("keeps companies apart on the stream", async () => {
    ctx.harness.seed({
      agents: [{ ...agent("ag-b", "Bruno"), companyId: CO2 }] as never,
      issues: [{ ...issue("b-1"), companyId: CO2, assigneeAgentId: "ag-b" }] as never,
    });
    await ctx.harness.emit("agent.run.started", { agentId: "ag-sofia", runId: "a" }, { companyId: CO, eventId: "a1" });
    await ctx.harness.emit("agent.run.started", { agentId: "ag-b", runId: "b" }, { companyId: CO2, eventId: "b1" });
    await ctx.harness.emit("agent.run.finished", { agentId: "ag-sofia", runId: "a" }, { companyId: CO, eventId: "a2" });
    await vi.advanceTimersByTimeAsync(700);

    for (const e of ctx.emitted) {
      if (e.msg.type === "snapshot") expect(e.company).toBe(e.msg.snapshot.companyId);
      else expect(e.company).toBe(e.msg.record.id.startsWith("a") ? CO : CO2);
    }
    const snapA = snapshots(ctx.emitted).find((s) => s.companyId === CO)!;
    const snapB = snapshots(ctx.emitted).find((s) => s.companyId === CO2)!;
    expect(snapA.people.some((p) => p.id === "ag-b")).toBe(false);
    expect(snapB.people.map((p) => p.id)).toEqual(["ag-b"]);
    expect(snapB.feed.map((r) => r.id)).toEqual(["b1"]);

    const pageA = await ctx.harness.getData<EventsPage>(DATA_EVENTS, { companyId: CO });
    expect(pageA.records.map((r) => r.id).sort()).toEqual(["a1", "a2"]);
  });

  it("reacts to agent.updated (e.g. paused) by reloading agents", async () => {
    await ctx.harness.getData(DATA_SNAPSHOT, { companyId: CO });
    ctx.harness.seed({ agents: [agent("ag-laura", "Laura", { status: "paused" })] as never });
    await ctx.harness.emit("agent.updated", {}, { companyId: CO, entityId: "ag-laura", entityType: "agent" });
    await vi.advanceTimersByTimeAsync(700);
    const s = snapshots(ctx.emitted).at(-1)!;
    expect(s.people.find((p) => p.id === "ag-laura")).toMatchObject({ state: "paused", stateLabel: "In pausa" });
  });

  describe("report_progress tool", () => {
    it("records progress for the assignee and updates the snapshot", async () => {
      const res = await ctx.harness.executeTool<{ content?: string; error?: string; data?: unknown }>(
        TOOL_REPORT_PROGRESS, { issue: "fra-34", percent: 60, note: "bozze pronte" }, { agentId: "ag-giulia", companyId: CO });
      expect(res.error).toBeUndefined();
      expect(res.content).toContain("FRA-34 al 60%");
      expect(ctx.harness.getState({ scopeKind: "issue", scopeId: "fra-34", stateKey: "progress" })).toMatchObject({ percent: 60, note: "bozze pronte", agentId: "ag-giulia" });
      expect(events(ctx.emitted)[0]).toMatchObject({ kind: "progress", percent: 60, note: "bozze pronte", identifier: "FRA-34", actor: { id: "ag-giulia", name: "Giulia Bennett" } });
      const snap = snapshots(ctx.emitted).at(-1)!;
      expect(snap.tasks.find((t) => t.id === "fra-34")).toMatchObject({ progress: 60, progressSource: "reported", progressNote: "bozze pronte" });
    });

    it("resolves identifiers (FRA-34) even when issues.get does not", async () => {
      const res = await ctx.harness.executeTool<{ content?: string; error?: string }>(
        TOOL_REPORT_PROGRESS, { issue: "FRA-34", percent: 20 }, { agentId: "ag-giulia", companyId: CO });
      expect(res.error).toBeUndefined();
    });

    it("allows a manager to report for a subordinate's task", async () => {
      const res = await ctx.harness.executeTool<{ error?: string }>(
        TOOL_REPORT_PROGRESS, { issue: "orphan", percent: 30 }, { agentId: "ag-laura", companyId: CO });
      expect(res.error).toBeUndefined();
    });

    it("rejects tasks of others, closed tasks, unknown tasks and bad input", async () => {
      const other = await ctx.harness.executeTool<{ error?: string }>(TOOL_REPORT_PROGRESS, { issue: "fra-34", percent: 10 }, { agentId: "ag-sofia", companyId: CO });
      expect(other.error).toContain("assegnato a Giulia Bennett");
      const board = await ctx.harness.executeTool<{ error?: string }>(TOOL_REPORT_PROGRESS, { issue: "fra-40", percent: 10 }, { agentId: "ag-laura", companyId: CO });
      expect(board.error).toContain("board");
      const closed = await ctx.harness.executeTool<{ error?: string }>(TOOL_REPORT_PROGRESS, { issue: "fra-35", percent: 10 }, { agentId: "ag-sofia", companyId: CO });
      expect(closed.error).toContain("già chiuso");
      const missing = await ctx.harness.executeTool<{ error?: string }>(TOOL_REPORT_PROGRESS, { issue: "FRA-999", percent: 10 }, { agentId: "ag-sofia", companyId: CO });
      expect(missing.error).toContain("non trovato");
      const bad = await ctx.harness.executeTool<{ error?: string }>(TOOL_REPORT_PROGRESS, { issue: "fra-34", percent: 150 }, { agentId: "ag-giulia", companyId: CO });
      expect(bad.error).toContain("0 e 100");
      const foreign = await ctx.harness.executeTool<{ error?: string }>(TOOL_REPORT_PROGRESS, { issue: "fra-34", percent: 10 }, { agentId: "ag-giulia", companyId: CO2 });
      expect(foreign.error).toContain("non trovato");
      expect(events(ctx.emitted)).toHaveLength(0);
    });
  });

  it("health reports ok", async () => {
    const h = await plugin.definition.onHealth!();
    expect(h.status).toBe("ok");
  });
});

describe("org-flow worker — settings and plan checklist", () => {
  afterEach(() => vi.useRealTimers());

  it("reads settings from config and the plan checklist from documents", async () => {
    const { harness } = setup({ config: { sleepAfterMinutes: 5, keepClosedHours: 2, enableSimulation: false }, extraCaps: ["issue.documents.write"] });
    harness.seed({
      agents: [agent("ag-a", "Anna")] as never,
      issues: [
        issue("t1", { status: "in_progress", assigneeAgentId: "ag-a" }),
        issue("old", { status: "done", assigneeAgentId: "ag-a", completedAt: iso(3 * 3_600_000) }),
      ] as never,
    });
    await harness.ctx.issues.documents.upsert({ issueId: "t1", key: "plan", companyId: CO, body: "- [x] uno\n- [ ] due\n- [x] tre\n- [x] quattro" });
    await plugin.definition.setup(harness.ctx);
    const s = await harness.getData<Snapshot>(DATA_SNAPSHOT, { companyId: CO });
    expect(s.settings).toEqual({ sleepAfterMinutes: 5, keepClosedHours: 2, enableSimulation: false });
    expect(s.tasks.map((t) => t.id)).toEqual(["t1"]);
    expect(s.tasks[0]).toMatchObject({ progress: 75, progressSource: "checklist" });
    expect(s.counts.closed24h).toBe(1);
  });

  it("validates config through onValidateConfig", async () => {
    expect(await plugin.definition.onValidateConfig!({ sleepAfterMinutes: 10 })).toMatchObject({ ok: true });
    expect(await plugin.definition.onValidateConfig!({ sleepAfterMinutes: -3 })).toMatchObject({ ok: false });
  });
});
