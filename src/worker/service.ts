/**
 * Org Flow worker runtime: per-company caches, event ingestion, snapshot building,
 * bridge handlers and the report_progress tool. Host calls live here; the rules live in
 * the pure modules (feed, history, progress, presence, snapshot, colors).
 *
 * Host facts this file relies on (Paperclip 2026.1023.0):
 * - Event handlers run inside a host invocation scoped to the event's company; the scope stays
 *   valid ~15 min, so the debounced snapshot timer started in an event handler may still call
 *   the host for that company. Calls made after a data/action/tool call has returned are
 *   rejected (stale invocation), so those paths do all their work before returning.
 * - ctx.streams.emit uses the company of the last ctx.streams.open for the channel: we always
 *   open + emit synchronously for the target company.
 * - ctx.issues.list forwards only whitelisted filters (status, limit, offset, …); offset paging
 *   is unreliable on the host, so lists are fetched without limit, one status at a time.
 */

import { randomUUID } from "node:crypto";
import type { PluginContext, PluginEvent, ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import {
  STREAM_CHANNEL,
  type EventsPage, type FeedRecord, type OrgFlowSettings, type Snapshot, type StreamMessage,
} from "../shared/types.js";
import {
  assigneeParty, pageEvents, pushRecent, recordFromIssueEvent, recordFromRunEvent, type Party,
} from "./feed.js";
import { entryFromRecord, pushHistory, HISTORY_MAX, type HistoryEntry } from "./history.js";
import {
  CLOSED_STATUSES, countChildren, isClosedStatus, OPEN_STATUSES, parseChecklist,
  type Checklist, type ChildrenCount, type ReportedProgress,
} from "./progress.js";
import { resolveSettings } from "./settings.js";
import {
  deriveSnapshot, holderOf, snapshotFingerprint, toAgentLite, toIssueLite,
  type AgentLite, type BaseModel, type IssueLite, type RunState,
} from "./snapshot.js";
import {
  isSelfOrSubordinate, looksLikeIdentifier, parseReportProgressParams,
} from "./tool.js";

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

export const SNAPSHOT_DEBOUNCE_MS = 600;
const FEED_MAX = 100;
const AGENTS_TTL_MS = 60_000;
const SETTINGS_TTL_MS = 60_000;
/** Open issues: rebuilt when dirty or older than this. */
const BASE_TTL_MS = 60_000;
/** Closed issues change rarely (and events patch them): refreshed less often. */
const CLOSED_TTL_MS = 5 * 60_000;
/** Parent + children counts; issue events invalidate the affected parent immediately. */
const PARENT_TTL_MS = 5 * 60_000;
/** Unreadable parents (deleted, private, transient error) are retried sooner. */
const PARENT_RETRY_MS = 30_000;
const CHECKLIST_TTL_MS = 10 * 60_000;
/** Time-based states (sleepy, success, …) are recomputed at least this often. */
const DERIVE_TTL_MS = 20_000;
const MAX_PARALLEL = 6;
const REPORTED_MAX_AGE_MS = 30 * 24 * 3_600_000;

const STATE_FEED = "feed";
const STATE_FEED_LEGACY = "recent-feed";
const STATE_HISTORY = "history";
const STATE_REPORTED = "reported-progress";
const STATE_PROGRESS = "progress";

/** issue.updated changes that alter what the snapshot shows. */
const RELEVANT_CHANGES = ["status", "assigneeAgentId", "assigneeUserId", "title", "parentId", "priority", "hiddenAt", "completedAt", "cancelledAt"];

/* ------------------------------------------------------------------ */
/* Runtime state                                                       */
/* ------------------------------------------------------------------ */

interface ParentEntry { at: number; parent: IssueLite | null; children: ChildrenCount; childStatuses: Record<string, string> }

interface CompanyRuntime {
  id: string;
  loaded: boolean;
  loading: Promise<void> | null;
  feed: FeedRecord[];
  history: HistoryEntry[];
  reported: Record<string, ReportedProgress>;
  agents: { at: number; list: AgentLite[] } | null;
  settings: { at: number; value: OrgFlowSettings } | null;
  openIssues: { at: number; list: IssueLite[] } | null;
  closedIssues: { at: number; list: IssueLite[] } | null;
  /** Issues learned from events between two list refreshes (id → latest copy). */
  patched: Map<string, IssueLite>;
  parents: Map<string, ParentEntry>;
  checklists: Map<string, { at: number; value: Checklist | null }>;
  baseDirty: boolean;
  building: Promise<BaseModel> | null;
  base: BaseModel | null;
  runs: RunState;
  lastKnown: Record<string, number>;
  snapshot: Snapshot | null;
  fingerprint: string | null;
  derivedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface OrgFlowService {
  getSnapshot(companyId: string): Promise<Snapshot>;
  getEvents(companyId: string, after?: string | null): Promise<EventsPage>;
  ping(companyId: string): Promise<{ ok: true }>;
  refresh(companyId: string): Promise<Snapshot>;
  handleEvent(ev: PluginEvent): Promise<void>;
  reportProgress(params: unknown, run: ToolRunContext): Promise<ToolResult>;
  onConfigChanged(config: Record<string, unknown>, companyId: string | null): void;
  health(): { status: "ok" | "degraded"; message: string; details: Record<string, unknown> };
  shutdown(): void;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const asDict = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Runs `fn` over `items` with bounded concurrency. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export function createOrgFlowService(ctx: PluginContext, opts: { debounceMs?: number; now?: () => number } = {}): OrgFlowService {
  const debounceMs = opts.debounceMs ?? SNAPSHOT_DEBOUNCE_MS;
  const now = opts.now ?? (() => Date.now());
  const companies = new Map<string, CompanyRuntime>();
  let openedStreamFor: string | null = null;
  let lastEventAt: string | null = null;
  let lastBuildError: { at: number; message: string } | null = null;
  let warnings = 0;

  const warn = (message: string, meta: Record<string, unknown> = {}) => {
    warnings += 1;
    try { ctx.logger.warn(message, meta); } catch { /* logger must never break the flow */ }
  };

  function rt(companyId: string): CompanyRuntime {
    let c = companies.get(companyId);
    if (!c) {
      c = {
        id: companyId, loaded: false, loading: null, feed: [], history: [], reported: {},
        agents: null, settings: null, openIssues: null, closedIssues: null, patched: new Map(),
        parents: new Map(), checklists: new Map(), baseDirty: true, building: null, base: null,
        runs: { active: {}, last: {} }, lastKnown: {}, snapshot: null, fingerprint: null, derivedAt: 0, timer: null,
      };
      companies.set(companyId, c);
    }
    return c;
  }

  const companyKey = (companyId: string, stateKey: string) => ({ scopeKind: "company" as const, scopeId: companyId, stateKey });

  /* ---------------- persistence ---------------- */

  async function ensureLoaded(c: CompanyRuntime): Promise<void> {
    if (c.loaded) return;
    if (!c.loading) {
      c.loading = (async () => {
        const read = async (key: string) => {
          try { return await ctx.state.get(companyKey(c.id, key)); } catch (err) {
            warn("org-flow: lettura dello stato non riuscita", { companyId: c.id, key, error: errMsg(err) });
            return null;
          }
        };
        const [feed, history, reported] = await Promise.all([read(STATE_FEED), read(STATE_HISTORY), read(STATE_REPORTED)]);
        let feedList = Array.isArray(feed) ? (feed as FeedRecord[]) : [];
        if (feedList.length === 0) {
          const legacy = await read(STATE_FEED_LEGACY);
          if (Array.isArray(legacy)) feedList = legacy as FeedRecord[];
        }
        // Merge with anything recorded while loading.
        for (const r of [...feedList].reverse()) if (!c.feed.some((x) => x.id === r.id)) c.feed.push(r);
        c.feed = [...c.feed].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, FEED_MAX);
        if (Array.isArray(history)) {
          const known = new Set(c.history.map((h) => h.id));
          c.history = [...c.history, ...(history as HistoryEntry[]).filter((h) => !known.has(h.id))].slice(0, HISTORY_MAX);
        }
        if (reported && typeof reported === "object") c.reported = { ...(reported as Record<string, ReportedProgress>), ...c.reported };
        c.loaded = true;
      })().finally(() => { c.loading = null; });
    }
    await c.loading;
  }

  async function persist(c: CompanyRuntime, key: string, value: unknown) {
    try { await ctx.state.set(companyKey(c.id, key), value); } catch (err) {
      warn("org-flow: salvataggio dello stato non riuscito", { companyId: c.id, key, error: errMsg(err) });
    }
  }

  /* ---------------- host reads with caching ---------------- */

  async function getSettings(c: CompanyRuntime): Promise<OrgFlowSettings> {
    if (c.settings && now() - c.settings.at < SETTINGS_TTL_MS) return c.settings.value;
    try {
      const raw = await ctx.config.get(c.id);
      c.settings = { at: now(), value: resolveSettings(raw) };
    } catch (err) {
      warn("org-flow: lettura delle impostazioni non riuscita, uso i valori predefiniti", { companyId: c.id, error: errMsg(err) });
      c.settings = { at: now(), value: c.settings?.value ?? resolveSettings({}) };
    }
    return c.settings.value;
  }

  async function getAgents(c: CompanyRuntime): Promise<AgentLite[]> {
    if (c.agents && now() - c.agents.at < AGENTS_TTL_MS) return c.agents.list;
    try {
      const rows = await ctx.agents.list({ companyId: c.id });
      const list = rows.map(toAgentLite).filter((a): a is AgentLite => !!a);
      c.agents = { at: now(), list };
    } catch (err) {
      warn("org-flow: elenco agenti non disponibile", { companyId: c.id, error: errMsg(err) });
      if (!c.agents) return [];
      c.agents.at = now() - AGENTS_TTL_MS / 2; // retry soon, keep the old list meanwhile
    }
    return c.agents!.list;
  }

  async function listByStatus(companyId: string, statuses: readonly string[]): Promise<IssueLite[]> {
    const lists = await Promise.all(statuses.map((status) =>
      ctx.issues.list({ companyId, status: status as never })));
    const out: IssueLite[] = [];
    for (const rows of lists) for (const row of rows) { const i = toIssueLite(row); if (i) out.push(i); }
    return out;
  }

  async function getParent(c: CompanyRuntime, parentId: string): Promise<ParentEntry> {
    const cached = c.parents.get(parentId);
    if (cached && now() - cached.at < PARENT_TTL_MS) return cached;
    let entry: ParentEntry;
    try {
      const tree = await ctx.issues.getSubtree(parentId, c.id, { includeRoot: true });
      const rows = (tree?.issues ?? []).map(toIssueLite).filter((i): i is IssueLite => !!i);
      const parent = rows.find((i) => i.id === parentId) ?? null;
      const childStatuses: Record<string, string> = {};
      for (const i of rows) if (i.parentId === parentId) childStatuses[i.id] = i.status;
      entry = { at: now(), parent, children: countChildren(Object.values(childStatuses)), childStatuses };
    } catch (err) {
      // Deleted or unreadable parent: the children become standalone.
      if (cached) { cached.at = now(); return cached; }
      ctx.logger.debug("org-flow: task padre non leggibile", { companyId: c.id, parentId, error: errMsg(err) });
      entry = { at: now() - PARENT_TTL_MS + PARENT_RETRY_MS, parent: null, children: { done: 0, total: 0 }, childStatuses: {} };
    }
    c.parents.set(parentId, entry);
    return entry;
  }

  async function getChecklist(c: CompanyRuntime, issueId: string): Promise<Checklist | null> {
    const cached = c.checklists.get(issueId);
    if (cached && now() - cached.at < CHECKLIST_TTL_MS) return cached.value;
    let value: Checklist | null = null;
    try {
      const doc = await ctx.issues.documents.get(issueId, "plan", c.id);
      value = parseChecklist(doc?.body ?? null);
    } catch (err) {
      if (cached) { cached.at = now(); return cached.value; }
      ctx.logger.debug("org-flow: documento plan non leggibile", { companyId: c.id, issueId, error: errMsg(err) });
    }
    c.checklists.set(issueId, { at: now(), value });
    return value;
  }

  /* ---------------- base model ---------------- */

  async function buildBase(c: CompanyRuntime): Promise<BaseModel> {
    const t = now();
    const [agents, settings] = await Promise.all([getAgents(c), getSettings(c)]);
    c.baseDirty = false;
    const patchedAtStart = new Map(c.patched);
    const refreshClosed = !c.closedIssues || t - c.closedIssues.at >= CLOSED_TTL_MS;
    const [open, closedListed] = await Promise.all([
      listByStatus(c.id, OPEN_STATUSES),
      refreshClosed ? listByStatus(c.id, CLOSED_STATUSES) : Promise.resolve(c.closedIssues!.list),
    ]);
    const listedAt = now();
    const openIds = new Set(open.map((i) => i.id));

    // Order of precedence: closed list < event patches (when newer) < fresh open list.
    const byId = new Map<string, IssueLite>();
    for (const i of closedListed) if (!openIds.has(i.id)) byId.set(i.id, i);
    for (const [id, p] of patchedAtStart) {
      if (openIds.has(id)) continue;
      const listed = byId.get(id);
      if (listed ? p.updatedAt >= listed.updatedAt : (!refreshClosed && isClosedStatus(p.status))) byId.set(id, p);
    }
    const closed = [...byId.values()].filter((i) => isClosedStatus(i.status));
    for (const i of open) byId.set(i.id, i);
    c.openIssues = { at: listedAt, list: open };
    c.closedIssues = { at: refreshClosed ? listedAt : c.closedIssues!.at, list: closed };
    for (const [id, p] of patchedAtStart) if (c.patched.get(id) === p) c.patched.delete(id);

    const horizon = Math.max(settings.keepClosedHours, 24) * 3_600_000;
    const issues = [...byId.values()].filter((i) => {
      if (!isClosedStatus(i.status)) return true;
      const ct = i.closedAt ? Date.parse(i.closedAt) : NaN;
      return Number.isFinite(ct) && t - ct <= horizon;
    });

    const parentIds = [...new Set(issues.map((i) => i.parentId).filter((p): p is string => !!p))];
    const parentEntries = await mapLimit(parentIds, MAX_PARALLEL, (pid) => getParent(c, pid));
    const parents: Record<string, IssueLite | null> = {};
    const children: Record<string, ChildrenCount> = {};
    parentIds.forEach((pid, idx) => {
      const e = parentEntries[idx];
      parents[pid] = e.parent;
      // Overlay statuses we know are fresher (from this build's lists).
      const statuses = { ...e.childStatuses };
      for (const i of issues) if (i.parentId === pid) statuses[i.id] = i.status;
      children[pid] = countChildren(Object.values(statuses));
    });

    // Checklists only where they can matter: open, not a parent, no reported value.
    const needChecklist = issues.filter((i) => !isClosedStatus(i.status) && !children[i.id] && !c.reported[i.id]);
    const lists = await mapLimit(needChecklist, MAX_PARALLEL, (i) => getChecklist(c, i.id));
    const checklists: Record<string, Checklist | null> = {};
    needChecklist.forEach((i, idx) => { checklists[i.id] = lists[idx]; });

    return { agents, issues, parents, children, checklists, builtAt: new Date(t).toISOString() };
  }

  async function ensureBase(c: CompanyRuntime, force = false): Promise<BaseModel | null> {
    if (c.building) {
      try { await c.building; } catch { /* handled by the builder */ }
    }
    const fresh = c.base && c.openIssues && now() - c.openIssues.at < BASE_TTL_MS;
    if (!force && fresh && !c.baseDirty) return c.base;
    const p = buildBase(c);
    c.building = p;
    try {
      c.base = await p;
      lastBuildError = null;
    } catch (err) {
      c.baseDirty = true;
      lastBuildError = { at: now(), message: errMsg(err) };
      warn("org-flow: costruzione dello snapshot non riuscita, uso i dati precedenti", { companyId: c.id, error: errMsg(err) });
      if (!c.base) {
        const agents = c.agents?.list ?? [];
        c.base = { agents, issues: [...c.patched.values()], parents: {}, children: {}, checklists: {}, builtAt: new Date(now()).toISOString() };
      }
    } finally {
      if (c.building === p) c.building = null;
    }
    return c.base;
  }

  /** Applies an issue copy learned from an event to the cached model (no host call). */
  function patchIssue(c: CompanyRuntime, issue: IssueLite) {
    c.patched.set(issue.id, issue);
    if (c.base) {
      const idx = c.base.issues.findIndex((i) => i.id === issue.id);
      const issues = [...c.base.issues];
      if (idx >= 0) issues[idx] = issue; else issues.push(issue);
      const children = { ...c.base.children };
      if (issue.parentId) {
        const entry = c.parents.get(issue.parentId);
        if (entry) {
          entry.childStatuses[issue.id] = issue.status;
          entry.children = countChildren(Object.values(entry.childStatuses));
          children[issue.parentId] = entry.children;
        }
      }
      c.base = { ...c.base, issues, children };
    }
  }

  function findIssue(c: CompanyRuntime, issueId: string): IssueLite | null {
    return c.patched.get(issueId) ?? c.base?.issues.find((i) => i.id === issueId) ?? c.base?.parents[issueId] ?? null;
  }

  /* ---------------- snapshot ---------------- */

  /**
   * Recomputes the snapshot from the cached model (no host call except settings, cached).
   * The version (generatedAt) changes only when the content changes.
   */
  async function derive(c: CompanyRuntime, cachedSettingsOnly = false): Promise<Snapshot | null> {
    if (!c.base) return null;
    const settings = cachedSettingsOnly && c.settings ? c.settings.value : await getSettings(c);
    const t = now();
    const snap = deriveSnapshot({
      companyId: c.id, base: c.base, history: c.history, feed: c.feed, runs: c.runs,
      reported: c.reported, lastKnown: c.lastKnown, settings, now: t,
    });
    for (const task of snap.tasks) {
      if (task.status !== "blocked" && !isClosedStatus(task.status)) c.lastKnown[task.id] = task.progress;
    }
    const fp = snapshotFingerprint(snap);
    c.derivedAt = t;
    if (c.snapshot && fp === c.fingerprint) return c.snapshot;
    c.snapshot = snap;
    c.fingerprint = fp;
    return snap;
  }

  /** Pure re-derive when the cached snapshot may be outdated by time alone. */
  function deriveIfOld(c: CompanyRuntime): Promise<Snapshot | null> | null {
    if (!c.base || !c.settings) return null;
    if (now() - c.derivedAt < DERIVE_TTL_MS) return null;
    return derive(c, true);
  }

  async function getSnapshot(companyId: string): Promise<Snapshot> {
    const c = rt(companyId);
    await ensureLoaded(c);
    await ensureBase(c);
    const snap = await derive(c);
    return snap as Snapshot;
  }

  /* ---------------- stream ---------------- */

  function emitStream(companyId: string, msg: StreamMessage) {
    try {
      // open + emit in the same tick: emit targets the company of the last open.
      if (openedStreamFor !== companyId) {
        ctx.streams.open(STREAM_CHANNEL, companyId);
        openedStreamFor = companyId;
      }
      ctx.streams.emit(STREAM_CHANNEL, msg);
    } catch (err) {
      warn("org-flow: invio sullo stream non riuscito", { companyId, error: errMsg(err) });
    }
  }

  async function emitSnapshotNow(c: CompanyRuntime, rebuild: boolean) {
    if (rebuild) await ensureBase(c);
    else if (!c.base) await ensureBase(c);
    const snap = await derive(c);
    if (snap) emitStream(c.id, { type: "snapshot", snapshot: snap });
  }

  /** Must only be called from an event handler (see the host facts at the top). */
  function scheduleSnapshot(c: CompanyRuntime) {
    if (c.timer) clearTimeout(c.timer);
    c.timer = setTimeout(() => {
      c.timer = null;
      emitSnapshotNow(c, c.baseDirty).catch((err) => warn("org-flow: snapshot ritardato non riuscito", { companyId: c.id, error: errMsg(err) }));
    }, debounceMs);
  }

  /* ---------------- records ---------------- */

  async function agentName(c: CompanyRuntime, agentId: string): Promise<string | null> {
    const list = await getAgents(c);
    const hit = list.find((a) => a.id === agentId);
    if (hit) return hit.name;
    try {
      const a = await ctx.agents.get(agentId, c.id);
      return a?.name ?? null;
    } catch { return null; }
  }

  async function withName(c: CompanyRuntime, p: Party | undefined): Promise<Party | undefined> {
    if (!p || p.name) return p;
    if (p.kind === "user") return { ...p, name: "Board" };
    const name = await agentName(c, p.id);
    return name ? { ...p, name } : p;
  }

  async function fetchIssue(c: CompanyRuntime, issueId: string): Promise<IssueLite | null> {
    try {
      return toIssueLite(await ctx.issues.get(issueId, c.id));
    } catch (err) {
      warn("org-flow: lettura del task non riuscita", { companyId: c.id, issueId, error: errMsg(err) });
      return null;
    }
  }

  /** Stores the record (feed + history), streams it. Never throws. */
  async function publish(c: CompanyRuntime, rec: FeedRecord, holderBefore: string | null) {
    c.feed = pushRecent(c.feed, rec, FEED_MAX);
    const entry = entryFromRecord(rec, holderBefore);
    if (entry) c.history = pushHistory(c.history, entry);
    lastEventAt = rec.at;
    emitStream(c.id, { type: "event", record: rec });
    await Promise.all([persist(c, STATE_FEED, c.feed), entry ? persist(c, STATE_HISTORY, c.history) : Promise.resolve()]);
  }

  async function onIssueEvent(c: CompanyRuntime, ev: PluginEvent) {
    const p = asDict(ev.payload);
    const issueId = str(p.issueId) ?? (ev.entityType === "issue" ? str(ev.entityId) : null);
    const changes = asDict(p.changes);
    const relevant = ev.eventType === "issue.created" || RELEVANT_CHANGES.some((k) => k in changes);
    const rec = recordFromIssueEvent(ev);
    if (!relevant && !rec) return;

    const known = issueId ? findIssue(c, issueId) : null;
    const holderBefore = known ? holderOf(known) : null;
    let fresh: IssueLite | null = null;
    if (issueId) {
      fresh = await fetchIssue(c, issueId);
      if (fresh) patchIssue(c, fresh);
      else if (known && rec) {
        // Enrichment failed: apply what the event says.
        const patched: IssueLite = { ...known, updatedAt: rec.at };
        if (rec.statusTo) {
          patched.status = rec.statusTo;
          patched.closedAt = isClosedStatus(rec.statusTo) ? rec.at : null;
        }
        if (rec.kind === "handoff") {
          patched.assigneeAgentId = rec.to?.kind === "agent" ? rec.to.id : null;
          patched.assigneeUserId = rec.to?.kind === "user" ? rec.to.id : null;
        }
        patchIssue(c, patched);
      }
      if (known?.parentId) c.parents.delete(known.parentId);
      if (fresh?.parentId) c.parents.delete(fresh.parentId);
    }
    c.baseDirty = true;

    if (rec) {
      try {
        const info = fresh ?? known;
        if (info) {
          rec.identifier = rec.identifier ?? info.identifier;
          rec.title = rec.title ?? info.title;
          rec.parentId = info.parentId;
          if (rec.kind === "created" && !rec.to) rec.to = assigneeParty(info.assigneeAgentId, info.assigneeUserId);
        }
        rec.from = await withName(c, rec.from ?? undefined);
        rec.to = await withName(c, rec.to ?? undefined);
        rec.actor = await withName(c, rec.actor ?? undefined);
      } catch (err) {
        warn("org-flow: arricchimento dell'evento non riuscito", { eventId: ev.eventId, error: errMsg(err) });
      }
      await publish(c, rec, holderBefore);
    }
    scheduleSnapshot(c);
  }

  function setAgentStatus(c: CompanyRuntime, agentId: string, status: string) {
    const patch = (list: AgentLite[]) => list.map((a) => (a.id === agentId && a.status !== "paused" && a.status !== "terminated" ? { ...a, status } : a));
    if (c.agents) c.agents = { ...c.agents, list: patch(c.agents.list) };
    if (c.base) c.base = { ...c.base, agents: patch(c.base.agents) };
  }

  async function onRunEvent(c: CompanyRuntime, ev: PluginEvent) {
    const p = asDict(ev.payload);
    const agentId = str(p.agentId) ?? (ev.actorType === "agent" ? str(ev.actorId) : null);
    const issueId = str(p.issueId);
    const at = ev.occurredAt;
    if (agentId) {
      if (ev.eventType === "agent.run.started") {
        c.runs.active[agentId] = { runId: str(p.runId), issueId, startedAt: str(p.startedAt) ?? at };
        setAgentStatus(c, agentId, "running");
      } else {
        const active = c.runs.active[agentId];
        const runId = str(p.runId);
        if (!active || !runId || !active.runId || active.runId === runId) delete c.runs.active[agentId];
        if (ev.eventType !== "agent.run.cancelled") {
          c.runs.last[agentId] = { at, failed: ev.eventType === "agent.run.failed", issueId };
        }
        if (!c.runs.active[agentId]) setAgentStatus(c, agentId, "idle");
      }
    }
    const rec = recordFromRunEvent(ev);
    if (rec) {
      try {
        rec.actor = await withName(c, rec.actor ?? undefined);
        if (rec.issueId) {
          const info = findIssue(c, rec.issueId) ?? (await fetchIssue(c, rec.issueId));
          if (info) { rec.identifier = info.identifier; rec.title = info.title; rec.parentId = info.parentId; }
        }
      } catch (err) {
        warn("org-flow: arricchimento dell'evento non riuscito", { eventId: ev.eventId, error: errMsg(err) });
      }
      await publish(c, rec, null);
    }
    scheduleSnapshot(c);
  }

  async function handleEvent(ev: PluginEvent): Promise<void> {
    const companyId = str(ev.companyId);
    if (!companyId) return;
    const c = rt(companyId);
    try {
      await ensureLoaded(c);
      switch (ev.eventType) {
        case "issue.created":
        case "issue.updated":
          await onIssueEvent(c, ev);
          break;
        case "agent.run.started":
        case "agent.run.finished":
        case "agent.run.failed":
        case "agent.run.cancelled":
          await onRunEvent(c, ev);
          break;
        case "agent.created":
        case "agent.updated":
        case "agent.status_changed":
        case "agent.error_cleared":
          c.agents = null;
          c.baseDirty = true;
          scheduleSnapshot(c);
          break;
        case "issue.document.created":
        case "issue.document.updated":
        case "issue.document.deleted": {
          const p = asDict(ev.payload);
          const issueId = str(p.issueId) ?? (ev.entityType === "issue" ? str(ev.entityId) : null);
          if (issueId && (!str(p.key) || p.key === "plan")) {
            c.checklists.delete(issueId);
            c.baseDirty = true;
            scheduleSnapshot(c);
          }
          break;
        }
        default:
          break;
      }
    } catch (err) {
      warn("org-flow: gestione dell'evento non riuscita", { eventType: ev.eventType, eventId: ev.eventId, error: errMsg(err) });
    }
  }

  /* ---------------- bridge ---------------- */

  async function getEvents(companyId: string, after?: string | null): Promise<EventsPage> {
    const c = rt(companyId);
    await ensureLoaded(c);
    const pending = deriveIfOld(c);
    if (pending) { try { await pending; } catch { /* keep the previous snapshot version */ } }
    const page = pageEvents(c.feed, after ?? null);
    return { records: page.records, cursor: page.cursor, snapshotAt: c.snapshot?.generatedAt ?? null };
  }

  async function ping(companyId: string): Promise<{ ok: true }> {
    const c = rt(companyId);
    await ensureLoaded(c);
    const rec: FeedRecord = { id: randomUUID(), at: new Date(now()).toISOString(), kind: "ping" };
    await publish(c, rec, null);
    try { await emitSnapshotNow(c, false); } catch (err) { warn("org-flow: snapshot dopo il ping non riuscito", { error: errMsg(err) }); }
    return { ok: true };
  }

  async function refresh(companyId: string): Promise<Snapshot> {
    const c = rt(companyId);
    await ensureLoaded(c);
    c.agents = null;
    c.settings = null;
    c.closedIssues = null;
    c.parents.clear();
    await ensureBase(c, true);
    const snap = (await derive(c)) as Snapshot;
    if (snap) emitStream(c.id, { type: "snapshot", snapshot: snap });
    return snap;
  }

  /* ---------------- tool ---------------- */

  async function resolveIssueRef(c: CompanyRuntime, ref: string): Promise<IssueLite | null> {
    const direct = await (async () => {
      try { return toIssueLite(await ctx.issues.get(ref, c.id)); } catch { return null; }
    })();
    if (direct) return direct;
    if (!looksLikeIdentifier(ref)) return null;
    // The host resolves identifiers in issues.get; this fallback covers other hosts.
    const base = await ensureBase(c);
    const wanted = ref.toUpperCase();
    const hit = base?.issues.find((i) => i.identifier?.toUpperCase() === wanted);
    if (!hit) return null;
    try { return toIssueLite(await ctx.issues.get(hit.id, c.id)) ?? hit; } catch { return hit; }
  }

  async function reportProgress(raw: unknown, run: ToolRunContext): Promise<ToolResult> {
    const parsed = parseReportProgressParams(raw);
    if (!parsed.ok) return { error: parsed.error };
    const { issue: ref, percent, note } = parsed.value;
    const companyId = str(run?.companyId);
    const agentId = str(run?.agentId);
    if (!companyId || !agentId) return { error: "Contesto del run incompleto: impossibile identificare agente e company." };
    const c = rt(companyId);
    await ensureLoaded(c);

    const issue = await resolveIssueRef(c, ref);
    if (!issue) return { error: `Task "${ref}" non trovato in questa company. Usa l'identificatore (es. FRA-62) o l'id del task.` };
    const label = issue.identifier ?? issue.title;
    if (isClosedStatus(issue.status)) {
      return { error: `Il task ${label} è già chiuso (${issue.status}): non serve riportare l'avanzamento.` };
    }
    const agents = await getAgents(c);
    const reportsTo = new Map(agents.map((a) => [a.id, a.reportsTo]));
    if (!isSelfOrSubordinate(agentId, issue.assigneeAgentId, reportsTo)) {
      const holder = issue.assigneeAgentId
        ? (agents.find((a) => a.id === issue.assigneeAgentId)?.name ?? "un altro agente")
        : issue.assigneeUserId ? "il board" : "nessuno";
      return { error: `Puoi riportare l'avanzamento solo sui task assegnati a te o ai tuoi sottoposti: ${label} è assegnato a ${holder}.` };
    }

    const at = new Date(now()).toISOString();
    const value: ReportedProgress = { percent, note, at, agentId };
    // Keep the company index small: forget reports older than REPORTED_MAX_AGE_MS.
    const cutoff = now() - REPORTED_MAX_AGE_MS;
    const kept = Object.entries(c.reported).filter(([, r]) => Date.parse(r.at) >= cutoff);
    c.reported = { ...Object.fromEntries(kept), [issue.id]: value };
    await Promise.all([
      (async () => {
        try { await ctx.state.set({ scopeKind: "issue", scopeId: issue.id, stateKey: STATE_PROGRESS }, value); } catch (err) {
          warn("org-flow: salvataggio dell'avanzamento non riuscito", { issueId: issue.id, error: errMsg(err) });
        }
      })(),
      persist(c, STATE_REPORTED, c.reported),
    ]);
    patchIssue(c, issue);

    const name = agents.find((a) => a.id === agentId)?.name;
    const rec: FeedRecord = {
      id: randomUUID(), at, kind: "progress", issueId: issue.id, identifier: issue.identifier, title: issue.title,
      parentId: issue.parentId, actor: { kind: "agent", id: agentId, ...(name ? { name } : {}) }, percent, note,
    };
    await publish(c, rec, holderOf(issue));
    try { await emitSnapshotNow(c, false); } catch (err) { warn("org-flow: snapshot dopo report_progress non riuscito", { error: errMsg(err) }); }

    const noteText = note ? ` Nota: "${note}".` : "";
    return {
      content: `Avanzamento registrato: ${label} al ${percent}%.${noteText} Il board lo vede ora in Org Flow.`,
      data: { issueId: issue.id, identifier: issue.identifier, percent, note, reportedAt: at },
    };
  }

  /* ---------------- lifecycle ---------------- */

  function onConfigChanged(config: Record<string, unknown>, companyId: string | null) {
    const value = resolveSettings(config);
    if (companyId) {
      const c = rt(companyId);
      c.settings = { at: now(), value };
      c.derivedAt = 0;
    } else {
      for (const c of companies.values()) { c.settings = null; c.derivedAt = 0; }
    }
  }

  function health() {
    const degraded = !!lastBuildError && now() - lastBuildError.at < 5 * 60_000;
    return {
      status: degraded ? ("degraded" as const) : ("ok" as const),
      message: degraded ? `Org Flow attivo, ultimo aggiornamento non riuscito: ${lastBuildError!.message}` : "Org Flow attivo",
      details: { companies: companies.size, lastEventAt, warnings },
    };
  }

  function shutdown() {
    for (const c of companies.values()) if (c.timer) { clearTimeout(c.timer); c.timer = null; }
  }

  return { getSnapshot, getEvents, ping, refresh, handleEvent, reportProgress, onConfigChanged, health, shutdown };
}
