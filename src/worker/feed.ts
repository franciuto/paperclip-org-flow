/**
 * Pure logic: turns Paperclip domain events into feed records.
 * No host calls here, so it can be tested without a Paperclip instance.
 */

import type { FeedKind, FeedRecord, Party } from "../shared/types.js";
export type { FeedKind, FeedRecord, Party };

/** Minimal shape of a host event that this module reads. */
export interface DomainEventLike {
  eventId: string;
  eventType: string;
  occurredAt: string;
  actorId?: string;
  actorType?: string;
  entityId?: string;
  entityType?: string;
  payload: unknown;
}

type Change = { from?: string | null; to?: string | null } | undefined;
type Dict = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const asDict = (v: unknown): Dict => (v && typeof v === "object" ? (v as Dict) : {});
const changed = (c: Change) => !!c && (c.from ?? null) !== (c.to ?? null);

function party(agentId: unknown, userId: unknown): Party {
  const a = str(agentId);
  if (a) return { kind: "agent", id: a };
  const u = str(userId);
  if (u) return { kind: "user", id: u };
  return null;
}

function actorOf(ev: DomainEventLike): Party {
  if (ev.actorType === "agent" && ev.actorId) return { kind: "agent", id: ev.actorId };
  if (ev.actorType === "user" && ev.actorId) return { kind: "user", id: ev.actorId };
  return null;
}

/** issue.created / issue.updated → record, or null when nothing relevant changed. */
export function recordFromIssueEvent(ev: DomainEventLike): FeedRecord | null {
  const p = asDict(ev.payload);
  const base = {
    id: ev.eventId,
    at: ev.occurredAt,
    issueId: str(p.issueId) ?? (ev.entityType === "issue" ? str(ev.entityId) : null),
    identifier: str(p.identifier),
    title: str(p.title),
    actor: actorOf(ev),
  };

  if (ev.eventType === "issue.created") {
    return { ...base, kind: "created", to: party(p.assigneeAgentId, p.assigneeUserId), statusTo: str(p.status) };
  }
  if (ev.eventType !== "issue.updated") return null;

  const changes = asDict(p.changes);
  const a = changes.assigneeAgentId as Change;
  const u = changes.assigneeUserId as Change;
  const s = changes.status as Change;
  const assigneeChanged = changed(a) || changed(u);
  const statusChanged = changed(s);
  if (!assigneeChanged && !statusChanged) return null;

  const rec: FeedRecord = {
    ...base,
    kind: assigneeChanged ? "handoff" : "status",
    statusFrom: statusChanged ? str(s?.from) : null,
    statusTo: statusChanged ? str(s?.to) : null,
  };
  if (assigneeChanged) {
    rec.from = party(a?.from, u?.from);
    rec.to = party(a?.to, u?.to);
  }
  return rec;
}

/** agent.run.* → record. Cancelled runs produce no record (they only end run tracking). */
export function recordFromRunEvent(ev: DomainEventLike): FeedRecord | null {
  const kinds: Record<string, FeedKind> = {
    "agent.run.started": "run_started",
    "agent.run.finished": "run_finished",
    "agent.run.failed": "run_failed",
  };
  const kind = kinds[ev.eventType];
  if (!kind) return null;
  const p = asDict(ev.payload);
  const agent = str(p.agentId) ?? (ev.actorType === "agent" ? str(ev.actorId) : null);
  return {
    id: ev.eventId,
    at: ev.occurredAt,
    kind,
    issueId: str(p.issueId),
    actor: agent ? { kind: "agent", id: agent } : null,
  };
}

/** Person id used in the snapshot: agent UUID, or `user:<userId>` for board users. */
export function personIdOf(p: Party | undefined): string | null {
  if (!p) return null;
  return p.kind === "agent" ? p.id : `user:${p.id}`;
}

/** Party for an issue assignee pair. */
export function assigneeParty(agentId: string | null | undefined, userId: string | null | undefined): Party {
  return party(agentId, userId);
}

/** Newest first, de-duplicated by id, capped at `max`. */
export function pushRecent(list: FeedRecord[], rec: FeedRecord, max = 100): FeedRecord[] {
  return [rec, ...list.filter((r) => r.id !== rec.id)].slice(0, max);
}

export interface EventsPageResult { records: FeedRecord[]; cursor: string | null }

/** A feed record with its per-company publish sequence number (monotonic, assigned at publish). */
export interface SeqRecord { seq: number; record: FeedRecord }

const DEFAULT_PAGE = 20;
const MAX_PAGE = 50;
/** Overlap applied to legacy ISO cursors: records are not published in `at` order. */
export const ISO_CURSOR_OVERLAP_MS = 15_000;

export function makeCursor(epoch: string, seq: number): string {
  return `seq:${epoch}:${seq}`;
}

type Cursor = { kind: "none" } | { kind: "seq"; seq: number } | { kind: "stale" } | { kind: "iso"; at: string };

export function parseCursor(after: string | null | undefined, epoch: string): Cursor {
  if (!after) return { kind: "none" };
  const m = /^seq:([^:]+):(\d+)$/.exec(after);
  if (m) return m[1] === epoch ? { kind: "seq", seq: Number(m[2]) } : { kind: "stale" };
  const t = Date.parse(after);
  if (Number.isFinite(t)) return { kind: "iso", at: new Date(t - ISO_CURSOR_OVERLAP_MS).toISOString() };
  return { kind: "none" };
}

/**
 * Incremental page for polling, ordered by publish sequence (oldest first).
 * - cursor `seq:<epoch>:<n>` (what this function returns): records published after it, max 50;
 * - cursor from another worker run (epoch changed after a restart) or ahead of the current
 *   head: treated as no cursor (the latest 20) — the UI de-duplicates by id;
 * - legacy ISO cursor: records with `at` > cursor − 15 s (overlap), max 50;
 * - no cursor: the latest 20.
 * The returned cursor is the sequence of the newest record returned, or the current head.
 */
export function pageEvents(items: SeqRecord[], after: string | null | undefined, epoch: string): EventsPageResult {
  const ordered = [...items].sort((a, b) => a.seq - b.seq);
  const head = ordered.length > 0 ? ordered[ordered.length - 1].seq : 0;
  let c = parseCursor(after, epoch);
  if (c.kind === "stale" || (c.kind === "seq" && c.seq > head)) c = { kind: "none" };
  let picked: SeqRecord[];
  if (c.kind === "seq") picked = ordered.filter((x) => x.seq > c.seq).slice(0, MAX_PAGE);
  else if (c.kind === "iso") picked = ordered.filter((x) => x.record.at > c.at).slice(0, MAX_PAGE);
  else picked = ordered.slice(-DEFAULT_PAGE);
  const last = picked.length > 0 ? picked[picked.length - 1].seq : c.kind === "seq" ? Math.max(c.seq, head) : head;
  const cursor = ordered.length > 0 || c.kind === "seq" ? makeCursor(epoch, last) : c.kind === "iso" ? (after ?? null) : null;
  return { records: picked.map((x) => x.record), cursor };
}
