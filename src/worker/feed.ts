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

/** agent.run.* → record. */
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

/** Newest first, de-duplicated by id, capped at `max`. */
export function pushRecent(list: FeedRecord[], rec: FeedRecord, max = 100): FeedRecord[] {
  return [rec, ...list.filter((r) => r.id !== rec.id)].slice(0, max);
}
