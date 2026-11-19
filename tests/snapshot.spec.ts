import { describe, expect, it } from "vitest";
import {
  deriveSnapshot, snapshotFingerprint, toAgentLite, toIssueLite,
  type AgentLite, type BaseModel, type DeriveInput, type IssueLite,
} from "../src/worker/snapshot.js";
import { DEFAULT_SETTINGS } from "../src/worker/settings.js";
import { STANDALONE_COLOR } from "../src/shared/types.js";

const NOW = Date.parse("2026-11-19T10:00:00.000Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();

const agent = (id: string, over: Partial<AgentLite> = {}): AgentLite => ({
  id, name: id.toUpperCase(), title: null, role: "general", reportsTo: null, status: "idle",
  paletteId: "cherry-pop", customAvatarAssetId: null, lastHeartbeatAt: null, pausedAt: null, ...over,
});
const issue = (id: string, over: Partial<IssueLite> = {}): IssueLite => ({
  id, identifier: id.toUpperCase(), title: `Task ${id}`, status: "todo", priority: "medium", parentId: null,
  assigneeAgentId: null, assigneeUserId: null, createdAt: ago(7200), updatedAt: ago(600), closedAt: null, activeRun: null, ...over,
});
const baseModel = (over: Partial<BaseModel> = {}): BaseModel => ({
  agents: [], issues: [], parents: {}, children: {}, checklists: {}, builtAt: ago(0), ...over,
});
const input = (base: BaseModel, over: Partial<DeriveInput> = {}): DeriveInput => ({
  companyId: "co", base, history: [], feed: [], runs: { active: {}, last: {} }, reported: {}, lastKnown: {},
  settings: DEFAULT_SETTINGS, now: NOW, ...over,
});

describe("deriveSnapshot", () => {
  it("works with no agents and no issues", () => {
    const s = deriveSnapshot(input(baseModel()));
    expect(s.people).toEqual([]);
    expect(s.tasks).toEqual([]);
    expect(s.groups).toEqual([]);
    expect(s.counts).toEqual({ working: 0, thinking: 0, sleepy: 0, waiting: 0, open: 0, closed24h: 0 });
    expect(s.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("groups children by parent, excludes cancelled from the parent percentage", () => {
    const parent = issue("p1", { status: "in_progress", assigneeAgentId: "lead" });
    const base = baseModel({
      agents: [agent("lead"), agent("dev", { reportsTo: "lead" })],
      issues: [
        parent,
        issue("c1", { parentId: "p1", status: "done", assigneeAgentId: "dev", closedAt: ago(3600) }),
        issue("c2", { parentId: "p1", status: "in_progress", assigneeAgentId: "dev" }),
        issue("c3", { parentId: "p1", status: "cancelled", closedAt: ago(60) }),
        issue("s1", { status: "todo", assigneeAgentId: "dev" }),
      ],
      children: { p1: { done: 1, total: 2 } },
    });
    const s = deriveSnapshot(input(base));
    const g = s.groups.find((x) => x.id === "p1")!;
    expect(g).toMatchObject({ identifier: "P1", childrenTotal: 2, childrenDone: 1, progress: 50, status: "in_progress" });
    expect(g.color).toMatch(/^oklch/);
    expect(g.holderIds.sort()).toEqual(["dev", "lead"]);
    const p1 = s.tasks.find((t) => t.id === "p1")!;
    expect(p1).toMatchObject({ groupId: "p1", progressSource: "children", progress: 50 });
    expect(s.tasks.find((t) => t.id === "c2")).toMatchObject({ groupId: "p1", parentId: "p1", progress: 40, progressSource: "status" });
    const standalone = s.groups.find((x) => x.id === "standalone")!;
    expect(standalone).toMatchObject({ color: STANDALONE_COLOR, childrenTotal: 1 });
    expect(s.groups[s.groups.length - 1].id).toBe("standalone");
    expect(s.counts.open).toBe(3);
    expect(s.counts.closed24h).toBe(1);
    const dev = s.people.find((p) => p.id === "dev")!;
    expect(dev).toMatchObject({ reportsTo: "lead", state: "idle", stateLabel: "2 task da fare", activeTaskId: "c2" });
  });

  it("children of an unreadable (deleted) parent become standalone", () => {
    const base = baseModel({
      agents: [agent("a")],
      issues: [issue("c1", { parentId: "gone", assigneeAgentId: "a" })],
      parents: { gone: null },
    });
    const s = deriveSnapshot(input(base));
    expect(s.tasks[0]).toMatchObject({ groupId: "standalone", parentId: null });
    expect(s.groups.map((g) => g.id)).toEqual(["standalone"]);
  });

  it("hides tasks closed before keepClosedHours", () => {
    const base = baseModel({
      issues: [
        issue("old", { status: "done", closedAt: ago(30 * 3600) }),
        issue("recent", { status: "done", closedAt: ago(2 * 3600) }),
      ],
    });
    expect(deriveSnapshot(input(base)).tasks.map((t) => t.id)).toEqual(["recent"]);
    const short = deriveSnapshot(input(base, { settings: { ...DEFAULT_SETTINGS, keepClosedHours: 1 } }));
    expect(short.tasks).toEqual([]);
    expect(short.counts.closed24h).toBe(1);
  });

  it("board users holding tasks become people with user: ids", () => {
    const base = baseModel({
      issues: [
        issue("r1", { status: "in_review", assigneeUserId: "u1" }),
        issue("r2", { status: "todo", assigneeUserId: "u2" }),
      ],
    });
    const s = deriveSnapshot(input(base));
    expect(s.people.map((p) => [p.id, p.name, p.kind, p.state])).toEqual([
      ["user:u1", "Board", "user", "waiting"],
      ["user:u2", "Board 2", "user", "waiting"],
    ]);
    expect(s.tasks[0].holderId).toBe("user:u1");
    expect(s.counts.waiting).toBe(2);
  });

  it("keeps unknown statuses as open tasks with a 0 estimate", () => {
    const s = deriveSnapshot(input(baseModel({ agents: [agent("a")], issues: [issue("x", { status: "triage", assigneeAgentId: "a" })] })));
    expect(s.tasks[0]).toMatchObject({ status: "triage", progress: 0, progressSource: "status" });
    expect(s.people[0].state).toBe("idle");
  });

  it("drops terminated agents unless they still hold a task; nulls reportsTo to missing managers", () => {
    const base = baseModel({
      agents: [agent("gone", { status: "terminated" }), agent("old", { status: "terminated" }), agent("kid", { reportsTo: "old" })],
      issues: [issue("t", { assigneeAgentId: "gone" })],
    });
    const s = deriveSnapshot(input(base));
    expect(s.people.map((p) => p.id).sort()).toEqual(["gone", "kid"]);
    expect(s.people.find((p) => p.id === "kid")!.reportsTo).toBeNull();
    expect(s.people.find((p) => p.id === "gone")!.stateLabel).toBe("Non più attivo");
  });

  it("uses reported progress and the plan checklist", () => {
    const base = baseModel({
      agents: [agent("a")],
      issues: [issue("r", { status: "in_progress", assigneeAgentId: "a" }), issue("c", { status: "in_progress", assigneeAgentId: "a" })],
      checklists: { c: { done: 3, total: 4 } },
    });
    const s = deriveSnapshot(input(base, { reported: { r: { percent: 70, note: "test ok", at: ago(10) } } }));
    expect(s.tasks.find((t) => t.id === "r")).toMatchObject({ progress: 70, progressSource: "reported", progressNote: "test ok" });
    expect(s.tasks.find((t) => t.id === "c")).toMatchObject({ progress: 75, progressSource: "checklist" });
  });

  it("presence: tracked run → working; host-seeded run ignored once a newer run end is known", () => {
    const base = baseModel({
      agents: [agent("a"), agent("b")],
      issues: [
        issue("t1", { status: "in_progress", assigneeAgentId: "a" }),
        issue("t2", { status: "in_progress", assigneeAgentId: "b", activeRun: { agentId: "b", startedAt: ago(300) } }),
      ],
    });
    const s = deriveSnapshot(input(base, { runs: { active: { a: { runId: "r", issueId: "t1", startedAt: ago(30) } }, last: {} } }));
    expect(s.people.find((p) => p.id === "a")).toMatchObject({ state: "working", stateLabel: "Lavora su T1 · 40%" });
    expect(s.people.find((p) => p.id === "b")!.state).toBe("working");
    const s2 = deriveSnapshot(input(base, { runs: { active: {}, last: { b: { at: ago(100), failed: false, issueId: "t2" } } } }));
    expect(s2.people.find((p) => p.id === "b")!.state).toBe("idle");
  });

  it("presence: run failure from the persisted feed → confused", () => {
    const base = baseModel({ agents: [agent("a")] });
    const s = deriveSnapshot(input(base, {
      feed: [{ id: "f", at: ago(60), kind: "run_failed", actor: { kind: "agent", id: "a" }, issueId: null }],
    }));
    expect(s.people[0]).toMatchObject({ state: "confused", stateLabel: "Run fallito" });
  });

  it("presence: idle agent without activity becomes sleepy; journeys and bounces from history", () => {
    const base = baseModel({
      agents: [agent("a", { reportsTo: "b" }), agent("b")],
      issues: [issue("t", { status: "todo", assigneeAgentId: "a" })],
    });
    const history = [
      { id: "1", at: ago(900), kind: "created" as const, issueId: "t", fromId: null, toId: "a", statusFrom: null, statusTo: "todo", actorId: null, holderId: "a" },
      { id: "2", at: ago(800), kind: "handoff" as const, issueId: "t", fromId: "a", toId: "b", statusFrom: "in_progress", statusTo: "in_review", actorId: "a", holderId: "b" },
      { id: "3", at: ago(700), kind: "handoff" as const, issueId: "t", fromId: "b", toId: "a", statusFrom: "in_review", statusTo: "todo", actorId: "b", holderId: "a" },
    ];
    const s = deriveSnapshot(input(base, { history }));
    const t = s.tasks[0];
    expect(t.journey.map((j) => j.personId)).toEqual(["a", "b", "a"]);
    expect(t.bounces).toBe(1);
    expect(s.people.find((p) => p.id === "b")!.state).toBe("idle"); // active 700 s ago < 15 min
    const later = deriveSnapshot(input(base, { history, now: NOW + 20 * 60_000 }));
    expect(later.people.find((p) => p.id === "b")!.state).toBe("sleepy");
    expect(later.counts.sleepy).toBe(1);
  });

  it("returning up the chain is not a bounce and does not confuse the manager", () => {
    const base = baseModel({
      agents: [agent("boss"), agent("dev", { reportsTo: "boss" })],
      issues: [issue("t", { status: "todo", assigneeAgentId: "boss" })],
    });
    const history = [
      { id: "1", at: ago(900), kind: "created" as const, issueId: "t", fromId: null, toId: "boss", statusFrom: null, statusTo: "todo", actorId: null, holderId: "boss" },
      { id: "2", at: ago(800), kind: "handoff" as const, issueId: "t", fromId: "boss", toId: "dev", statusFrom: null, statusTo: null, actorId: "boss", holderId: "dev" },
      { id: "3", at: ago(30), kind: "handoff" as const, issueId: "t", fromId: "dev", toId: "boss", statusFrom: "blocked", statusTo: "todo", actorId: "dev", holderId: "boss" },
    ];
    const s = deriveSnapshot(input(base, { history }));
    expect(s.tasks[0].bounces).toBe(0);
    expect(s.people.find((p) => p.id === "boss")).toMatchObject({ state: "listening" });
  });

  it("feed in the snapshot is newest first, max 100", () => {
    const feed = Array.from({ length: 120 }, (_, i) => ({ id: `f${i}`, at: ago(i), kind: "ping" as const }));
    const s = deriveSnapshot(input(baseModel(), { feed }));
    expect(s.feed).toHaveLength(100);
    expect(s.feed[0].id).toBe("f0");
  });

  it("fingerprint ignores generatedAt", () => {
    const a = deriveSnapshot(input(baseModel()));
    const b = { ...a, generatedAt: "other" };
    expect(snapshotFingerprint(a)).toBe(snapshotFingerprint(b));
  });
});

describe("host mappers", () => {
  it("maps agents with appearance and avatar", () => {
    const a = toAgentLite({
      id: "x", name: "Laura", role: "ceo", title: "", status: "idle", reportsTo: null,
      appearance: { paletteId: "cherry-pop", customAvatarAssetId: "asset-1" }, lastHeartbeatAt: new Date(NOW),
    })!;
    // Empty title falls back to Paperclip's own role label (AGENT_ROLE_LABELS).
    expect(a).toMatchObject({ paletteId: "cherry-pop", customAvatarAssetId: "asset-1", title: "CEO", lastHeartbeatAt: ago(0) });
    expect(toAgentLite({ id: "y", name: "Giulia", role: "designer", title: "Graphic Team Lead" })!.title).toBe("Graphic Team Lead");
    expect(toAgentLite({ id: "z", name: "Ugo", role: "something-new", title: null })!.title).toBeNull();
    expect(toAgentLite({ id: "w", name: "Ada", role: null, title: null })!.title).toBeNull();
    expect(toAgentLite(null)).toBeNull();
  });
  it("maps issues with closedAt and a running active run", () => {
    const i = toIssueLite({
      id: "i", identifier: "FRA-1", title: "T", status: "done", completedAt: new Date(NOW), updatedAt: new Date(NOW),
      createdAt: new Date(NOW - 1000), activeRun: { agentId: "a", status: "queued" },
    })!;
    expect(i).toMatchObject({ closedAt: ago(0), activeRun: null });
    const r = toIssueLite({ id: "j", status: "in_progress", updatedAt: ago(5), activeRun: { agentId: "a", status: "running", startedAt: ago(4) } })!;
    expect(r.activeRun).toEqual({ agentId: "a", startedAt: ago(4) });
  });
});
