/**
 * Snapshot assembly. Pure: takes the cached host data (BaseModel) plus the worker's own
 * history/run tracking and produces the Snapshot of the data contract.
 */

import type {
  FeedRecord, GroupView, OrgFlowSettings, PersonView, Snapshot, TaskView,
} from "../shared/types.js";
import { STANDALONE_COLOR, STANDALONE_GROUP_ID } from "../shared/types.js";
import { colorForGroup } from "./colors.js";
import { computeDepartments } from "./departments.js";
import { bouncesByIssue, holderSequences, journeyFor, personSignals, type HistoryEntry } from "./history.js";
import { computePresence, type PresenceSignal, type PresenceTask } from "./presence.js";
import {
  countChildren, isClosedStatus, ratioPercent, resolveProgress,
  type Checklist, type ChildrenCount, type ReportedProgress,
} from "./progress.js";

/* ------------------------------------------------------------------ */
/* Lightweight copies of host entities                                 */
/* ------------------------------------------------------------------ */

export interface AgentLite {
  id: string;
  name: string;
  title: string | null;
  role: string | null;
  reportsTo: string | null;
  status: string;
  paletteId: string | null;
  customAvatarAssetId: string | null;
  lastHeartbeatAt: string | null;
  pausedAt: string | null;
}

export interface IssueLite {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
  priority: string | null;
  parentId: string | null;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  /** Running heartbeat run attached to the issue by the host (issues.list → activeRun). */
  activeRun: { agentId: string; startedAt: string | null } | null;
}

type Dict = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function toIso(v: unknown): string | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString() : null;
  if (typeof v === "string" && v) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t).toISOString() : v;
  }
  return null;
}

export function toAgentLite(raw: unknown): AgentLite | null {
  const a = (raw && typeof raw === "object" ? raw : null) as Dict | null;
  const id = a && str(a.id);
  if (!a || !id) return null;
  const appearance = (a.appearance && typeof a.appearance === "object" ? a.appearance : {}) as Dict;
  return {
    id,
    name: str(a.name) ?? "Agente",
    title: str(a.title),
    role: str(a.role),
    reportsTo: str(a.reportsTo),
    status: str(a.status) ?? "idle",
    paletteId: str(appearance.paletteId),
    customAvatarAssetId: str(appearance.customAvatarAssetId),
    lastHeartbeatAt: toIso(a.lastHeartbeatAt),
    pausedAt: toIso(a.pausedAt),
  };
}

export function toIssueLite(raw: unknown): IssueLite | null {
  const i = (raw && typeof raw === "object" ? raw : null) as Dict | null;
  const id = i && str(i.id);
  if (!i || !id) return null;
  const status = str(i.status) ?? "todo";
  const updatedAt = toIso(i.updatedAt) ?? toIso(i.createdAt) ?? new Date(0).toISOString();
  const createdAt = toIso(i.createdAt) ?? updatedAt;
  let closedAt: string | null = null;
  if (status === "done") closedAt = toIso(i.completedAt) ?? updatedAt;
  else if (status === "cancelled") closedAt = toIso(i.cancelledAt) ?? updatedAt;
  const run = (i.activeRun && typeof i.activeRun === "object" ? i.activeRun : null) as Dict | null;
  const runAgent = run && str(run.agentId);
  return {
    id,
    identifier: str(i.identifier),
    title: str(i.title) ?? "(senza titolo)",
    status,
    priority: str(i.priority),
    parentId: str(i.parentId),
    assigneeAgentId: str(i.assigneeAgentId),
    assigneeUserId: str(i.assigneeUserId),
    createdAt,
    updatedAt,
    closedAt,
    activeRun: run && runAgent && str(run.status) === "running" ? { agentId: runAgent, startedAt: toIso(run.startedAt) } : null,
  };
}

export function holderOf(i: Pick<IssueLite, "assigneeAgentId" | "assigneeUserId">): string | null {
  if (i.assigneeAgentId) return i.assigneeAgentId;
  if (i.assigneeUserId) return `user:${i.assigneeUserId}`;
  return null;
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export interface BaseModel {
  agents: AgentLite[];
  /** Open issues + issues closed in the last max(keepClosedHours, 24) hours. */
  issues: IssueLite[];
  /** Parent id → parent issue; null when the parent cannot be read (deleted / private). */
  parents: Record<string, IssueLite | null>;
  /** Parent id → children counts over ALL its children (not only the visible window). */
  children: Record<string, ChildrenCount>;
  /** Issue id → checklist of its `plan` document (null: none). */
  checklists: Record<string, Checklist | null>;
  builtAt: string;
}

export interface ActiveRun { runId: string | null; issueId: string | null; startedAt: string }
export interface LastRun { at: string; failed: boolean; issueId: string | null }
export interface RunState {
  active: Record<string, ActiveRun>;
  last: Record<string, LastRun>;
}

export interface DeriveInput {
  companyId: string;
  base: BaseModel;
  history: HistoryEntry[];
  /** Newest first. */
  feed: FeedRecord[];
  runs: RunState;
  reported: Record<string, ReportedProgress>;
  /** Last non-blocked progress per issue (for the blocked estimate). */
  lastKnown: Record<string, number>;
  settings: OrgFlowSettings;
  now: number;
}

/** Runs without an end event for longer than this are considered lost. */
export const STALE_RUN_MS = 6 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const FEED_IN_SNAPSHOT = 100;

const OPEN_ORDER: Record<string, number> = { in_progress: 0, in_review: 1, blocked: 2, todo: 3, backlog: 4 };

function shortRef(i: Pick<IssueLite, "identifier" | "title">): string {
  if (i.identifier) return i.identifier;
  const t = i.title.trim();
  return t.length > 28 ? `${t.slice(0, 27)}…` : t;
}

function maxIso(...values: Array<string | null | undefined>): string | null {
  let out: string | null = null;
  for (const v of values) if (v && (!out || v > out)) out = v;
  return out;
}

/* ------------------------------------------------------------------ */
/* Derivation                                                          */
/* ------------------------------------------------------------------ */

export function deriveSnapshot(input: DeriveInput): Snapshot {
  const { base, settings, now } = input;
  const keepMs = settings.keepClosedHours * HOUR_MS;

  const visible = base.issues.filter((i) => {
    if (!isClosedStatus(i.status)) return true;
    const t = i.closedAt ? Date.parse(i.closedAt) : NaN;
    return Number.isFinite(t) && now - t <= keepMs;
  });
  const closed24h = base.issues.filter((i) => {
    if (i.status !== "done" || !i.closedAt) return false;
    const t = Date.parse(i.closedAt);
    return Number.isFinite(t) && now - t <= 24 * HOUR_MS;
  }).length;

  const byId = new Map<string, IssueLite>();
  for (const i of base.issues) byId.set(i.id, i);
  const refOf = (issueId: string | null | undefined): string | null => {
    if (!issueId) return null;
    const i = byId.get(issueId) ?? base.parents[issueId] ?? null;
    if (i) return shortRef(i);
    const rec = input.feed.find((r) => r.issueId === issueId && (r.identifier || r.title));
    return rec ? (rec.identifier ?? rec.title ?? null) : null;
  };

  // Which visible tasks are parents of other visible tasks (or have known children).
  const parentIdsInView = new Set<string>();
  for (const i of visible) if (i.parentId) parentIdsInView.add(i.parentId);
  const isParent = (id: string) => parentIdsInView.has(id) || (base.children[id]?.total ?? 0) > 0;
  const parentReadable = (pid: string) => byId.has(pid) || !!base.parents[pid];

  /* Tasks */
  const managers = new Map(base.agents.map((a) => [a.id, a.reportsTo]));
  const managerOf = (id: string) => managers.get(id) ?? null;
  const sequences = holderSequences(input.history);
  const bounceCounts = bouncesByIssue(input.history, managerOf);
  const tasks: TaskView[] = visible.map((i) => {
    const holderId = holderOf(i);
    const children = isParent(i.id)
      ? (base.children[i.id] ?? countChildren(visible.filter((c) => c.parentId === i.id).map((c) => c.status)))
      : null;
    const p = resolveProgress({
      status: i.status,
      reported: input.reported[i.id] ?? null,
      children,
      checklist: base.checklists[i.id] ?? null,
      lastKnown: input.lastKnown[i.id] ?? null,
    });
    const parentId = i.parentId && parentReadable(i.parentId) ? i.parentId : null;
    const groupId = parentId ?? (isParent(i.id) ? i.id : STANDALONE_GROUP_ID);
    const journey = journeyFor(sequences.get(i.id), { holderId, createdAt: i.createdAt, updatedAt: i.updatedAt });
    return {
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      status: i.status,
      priority: i.priority,
      holderId,
      parentId,
      groupId,
      progress: p.progress,
      progressSource: p.source,
      progressNote: p.note,
      updatedAt: i.updatedAt,
      bounces: bounceCounts.get(i.id) ?? 0,
      journey,
      closedAt: i.closedAt,
    };
  });

  /* Groups */
  const groupTasks = new Map<string, TaskView[]>();
  for (const t of tasks) {
    const list = groupTasks.get(t.groupId) ?? [];
    list.push(t);
    groupTasks.set(t.groupId, list);
  }
  const groups: GroupView[] = [];
  for (const [gid, list] of groupTasks) {
    const openHolders = [...new Set(list.filter((t) => !isClosedStatus(t.status) && t.holderId).map((t) => t.holderId as string))];
    const lastUpdate = maxIso(...list.map((t) => t.updatedAt));
    if (gid === STANDALONE_GROUP_ID) {
      const counts = countChildren(list.map((t) => t.status));
      groups.push({
        id: STANDALONE_GROUP_ID, identifier: null, title: "Task singoli", color: STANDALONE_COLOR, status: null,
        progress: ratioPercent(counts.done, counts.total), childrenTotal: counts.total, childrenDone: counts.done,
        holderIds: openHolders, updatedAt: lastUpdate,
      });
      continue;
    }
    const parent = byId.get(gid) ?? base.parents[gid] ?? null;
    const counts = base.children[gid] ?? countChildren(list.filter((t) => t.id !== gid).map((t) => t.status));
    groups.push({
      id: gid,
      identifier: parent?.identifier ?? null,
      title: parent?.title ?? "Task padre",
      color: colorForGroup(gid),
      status: parent?.status ?? null,
      progress: parent?.status === "done" ? 100 : ratioPercent(counts.done, counts.total),
      childrenTotal: counts.total,
      childrenDone: counts.done,
      holderIds: openHolders,
      updatedAt: maxIso(lastUpdate, parent?.updatedAt),
    });
  }
  groups.sort((a, b) => {
    if (a.id === STANDALONE_GROUP_ID) return 1;
    if (b.id === STANDALONE_GROUP_ID) return -1;
    const ao = a.status && isClosedStatus(a.status) ? 1 : 0;
    const bo = b.status && isClosedStatus(b.status) ? 1 : 0;
    if (ao !== bo) return ao - bo;
    return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  });

  /* People */
  const holders = new Set(tasks.map((t) => t.holderId).filter((h): h is string => !!h));
  const agents = base.agents.filter((a) => a.status !== "terminated" || holders.has(a.id));
  const agentIds = new Set(agents.map((a) => a.id));
  const { departments, departmentOf } = computeDepartments(
    agents.filter((a) => a.status !== "terminated"),
    settings.departmentNames ?? [],
  );
  const userIds = [...holders].filter((h) => h.startsWith("user:")).sort();

  const signals = personSignals(input.history, now, managerOf);
  const lastRunFromFeed = new Map<string, LastRun>();
  const runActivity = new Map<string, string>();
  for (const r of input.feed) {
    if (r.actor?.kind !== "agent") continue;
    if (r.kind === "run_started" || r.kind === "run_finished" || r.kind === "run_failed" || r.kind === "progress") {
      runActivity.set(r.actor.id, maxIso(runActivity.get(r.actor.id), r.at) as string);
    }
    if (r.kind === "run_finished" || r.kind === "run_failed") {
      const prev = lastRunFromFeed.get(r.actor.id);
      if (!prev || r.at > prev.at) lastRunFromFeed.set(r.actor.id, { at: r.at, failed: r.kind === "run_failed", issueId: r.issueId ?? null });
    }
  }
  const seededRuns = new Map<string, ActiveRun>();
  for (const i of base.issues) {
    if (i.activeRun && !seededRuns.has(i.activeRun.agentId)) {
      seededRuns.set(i.activeRun.agentId, { runId: null, issueId: i.id, startedAt: i.activeRun.startedAt ?? i.updatedAt });
    }
  }

  const heldBy = new Map<string, PresenceTask[]>();
  const sortedOpen = tasks
    .filter((t) => !isClosedStatus(t.status) && t.holderId)
    .sort((a, b) => (OPEN_ORDER[a.status] ?? 5) - (OPEN_ORDER[b.status] ?? 5) || b.updatedAt.localeCompare(a.updatedAt));
  for (const t of sortedOpen) {
    const list = heldBy.get(t.holderId as string) ?? [];
    list.push({ id: t.id, ref: shortRef({ identifier: t.identifier, title: t.title }), status: t.status, progress: t.progress });
    heldBy.set(t.holderId as string, list);
  }

  const sig = (s: { at: string; issueId: string } | undefined | null): PresenceSignal | null =>
    s ? { at: s.at, taskId: s.issueId, ref: refOf(s.issueId) } : null;

  const people: PersonView[] = [];
  for (const a of agents) {
    const s = signals.get(a.id);
    const tracked = input.runs.last[a.id];
    const fromFeed = lastRunFromFeed.get(a.id);
    const lastRun = tracked && (!fromFeed || tracked.at >= fromFeed.at) ? tracked : (fromFeed ?? null);
    // Host-reported run (from the issue list) only counts when no newer run end is known.
    const seeded = seededRuns.get(a.id);
    const seededValid = seeded && !(lastRun && lastRun.at >= seeded.startedAt) ? seeded : null;
    let active: ActiveRun | null = input.runs.active[a.id] ?? seededValid;
    if (active && now - Date.parse(active.startedAt) > STALE_RUN_MS) active = null;
    const lastActivityAt = maxIso(s?.lastActivityAt, runActivity.get(a.id), active?.startedAt, lastRun?.at, a.lastHeartbeatAt);
    const presence = computePresence({
      kind: "agent",
      agentStatus: a.status,
      pausedAt: a.pausedAt,
      heldOpen: heldBy.get(a.id) ?? [],
      activeRun: active ? { at: active.startedAt, taskId: active.issueId, ref: refOf(active.issueId) } : null,
      lastRun: lastRun ? { at: lastRun.at, taskId: lastRun.issueId, ref: refOf(lastRun.issueId), failed: lastRun.failed } : null,
      received: sig(s?.received),
      closed: sig(s?.closed),
      bounced: sig(s?.bounced),
      lastActivityAt,
    }, now, settings.sleepAfterMinutes);
    people.push({
      id: a.id,
      departmentId: departmentOf.get(a.id) ?? null,
      kind: "agent",
      name: a.name,
      title: a.title,
      role: a.role,
      reportsTo: a.reportsTo && agentIds.has(a.reportsTo) && a.reportsTo !== a.id ? a.reportsTo : null,
      paletteId: a.paletteId,
      customAvatarUrl: a.customAvatarAssetId ? `/api/assets/${a.customAvatarAssetId}/content` : null,
      agentStatus: a.status,
      state: presence.state,
      stateLabel: presence.label,
      stateSince: presence.since,
      activeTaskId: presence.activeTaskId,
      lastActivityAt,
      stats: s?.stats ?? { received24h: 0, passed24h: 0, closed24h: 0 },
    });
  }
  userIds.forEach((uid, index) => {
    const s = signals.get(uid);
    const presence = computePresence({
      kind: "user", agentStatus: null, heldOpen: heldBy.get(uid) ?? [], activeRun: null, lastRun: null,
      received: null, closed: null, bounced: null, lastActivityAt: s?.lastActivityAt ?? null,
    }, now, settings.sleepAfterMinutes);
    people.push({
      id: uid,
      departmentId: null,
      kind: "user",
      name: index === 0 ? "Board" : `Board ${index + 1}`,
      title: null,
      role: null,
      reportsTo: null,
      paletteId: null,
      customAvatarUrl: null,
      agentStatus: null,
      state: presence.state,
      stateLabel: presence.label,
      stateSince: presence.since,
      activeTaskId: presence.activeTaskId,
      lastActivityAt: s?.lastActivityAt ?? null,
      stats: s?.stats ?? { received24h: 0, passed24h: 0, closed24h: 0 },
    });
  });

  const countState = (st: string) => people.filter((p) => p.state === st).length;
  return {
    companyId: input.companyId,
    generatedAt: new Date(now).toISOString(),
    people,
    tasks,
    groups,
    feed: input.feed.slice(0, FEED_IN_SNAPSHOT),
    settings,
    departments,
    counts: {
      working: countState("working"),
      thinking: countState("thinking"),
      sleepy: countState("sleepy"),
      waiting: countState("waiting"),
      open: tasks.filter((t) => !isClosedStatus(t.status)).length,
      closed24h,
    },
  };
}

/** Fingerprint of the content, ignoring generatedAt: unchanged content keeps its version. */
export function snapshotFingerprint(s: Snapshot): string {
  return JSON.stringify({ ...s, generatedAt: "" });
}
