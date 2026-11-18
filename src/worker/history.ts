/**
 * Per-company issue history (created / handoff / status), kept in plugin state (last 300).
 * Journeys, bounces, per-person stats and the time-based presence signals are derived from it.
 * Pure module: no host calls.
 */

import type { FeedRecord, JourneyStep } from "../shared/types.js";
import { personIdOf } from "./feed.js";

export const HISTORY_MAX = 300;

export interface HistoryEntry {
  id: string;
  at: string;
  kind: "created" | "handoff" | "status";
  issueId: string;
  /** Person ids (agent UUID or `user:<id>`). */
  fromId: string | null;
  toId: string | null;
  statusFrom: string | null;
  statusTo: string | null;
  actorId: string | null;
  /** Holder of the issue right after the event. */
  holderId: string | null;
}

/**
 * Feed record → history entry. `holderBefore` is the assignee known before the event:
 * it is the holder for status-only changes (whose payload does not name the assignee).
 */
export function entryFromRecord(rec: FeedRecord, holderBefore: string | null): HistoryEntry | null {
  if (!rec.issueId) return null;
  if (rec.kind !== "created" && rec.kind !== "handoff" && rec.kind !== "status") return null;
  const fromId = personIdOf(rec.from ?? undefined);
  const toId = personIdOf(rec.to ?? undefined);
  const holderId = rec.kind === "status" ? holderBefore : toId;
  return {
    id: rec.id,
    at: rec.at,
    kind: rec.kind,
    issueId: rec.issueId,
    fromId,
    toId,
    statusFrom: rec.statusFrom ?? null,
    statusTo: rec.statusTo ?? null,
    actorId: personIdOf(rec.actor ?? undefined),
    holderId,
  };
}

/** Newest first, de-duplicated by id, capped. */
export function pushHistory(list: HistoryEntry[], entry: HistoryEntry, max = HISTORY_MAX): HistoryEntry[] {
  return [entry, ...list.filter((e) => e.id !== entry.id)].slice(0, max);
}

export function oldestFirst(list: HistoryEntry[]): HistoryEntry[] {
  return [...list].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

const STATUS_RANK: Record<string, number> = { backlog: 0, todo: 1, in_progress: 2, blocked: 2, in_review: 3, done: 4 };

/** in_review/done went back to an earlier stage (rework requested). */
export function isStatusRegression(from: string | null, to: string | null): boolean {
  if (!from || !to || to === "cancelled") return false;
  if (from !== "in_review" && from !== "done") return false;
  const rf = STATUS_RANK[from];
  const rt = STATUS_RANK[to];
  return rf !== undefined && rt !== undefined && rt < rf;
}

/** Who closed the task: the previous holder on a handoff+done, the holder otherwise. */
export function closerOf(e: HistoryEntry): string | null {
  return e.kind === "handoff" ? (e.fromId ?? e.toId) : e.holderId;
}

/**
 * Holder sequence per issue from history (oldest first). Consecutive duplicates are merged,
 * unassignments (null) are skipped.
 */
export function holderSequences(entries: HistoryEntry[]): Map<string, JourneyStep[]> {
  const out = new Map<string, JourneyStep[]>();
  for (const e of oldestFirst(entries)) {
    if (e.kind === "status") continue;
    let steps = out.get(e.issueId);
    if (!steps) { steps = []; out.set(e.issueId, steps); }
    if (e.kind === "handoff" && steps.length === 0 && e.fromId) steps.push({ personId: e.fromId, since: e.at });
    if (e.toId && steps[steps.length - 1]?.personId !== e.toId) steps.push({ personId: e.toId, since: e.at });
  }
  return out;
}

/**
 * Journey for one issue. Falls back on the current holder when history knows nothing,
 * and appends the current holder when history missed the last handoff.
 */
export function journeyFor(
  fromHistory: JourneyStep[] | undefined,
  current: { holderId: string | null; createdAt: string; updatedAt: string },
): JourneyStep[] {
  const steps = fromHistory ? [...fromHistory] : [];
  if (steps.length === 0) {
    return current.holderId ? [{ personId: current.holderId, since: current.createdAt }] : [];
  }
  if (current.holderId && steps[steps.length - 1].personId !== current.holderId) {
    steps.push({ personId: current.holderId, since: current.updatedAt });
  }
  return steps;
}

/**
 * Bounces per issue from history: a handoff back to the holder before the current one
 * (A→B→A counts 1). Returns on approval (status → done) do not count.
 */
export function bouncesByIssue(entries: HistoryEntry[]): Map<string, number> {
  const seqs = new Map<string, string[]>();
  const out = new Map<string, number>();
  for (const e of oldestFirst(entries)) {
    if (e.kind === "status" || !e.toId) continue;
    let seq = seqs.get(e.issueId);
    if (!seq) { seq = []; seqs.set(e.issueId, seq); }
    if (e.kind === "handoff" && seq.length === 0 && e.fromId) seq.push(e.fromId);
    const last = seq[seq.length - 1];
    if (last === e.toId) continue;
    if (e.kind === "handoff" && seq.length >= 2 && seq[seq.length - 2] === e.toId && e.statusTo !== "done") {
      out.set(e.issueId, (out.get(e.issueId) ?? 0) + 1);
    }
    seq.push(e.toId);
  }
  return out;
}

/** A→B→A counts 1; A→B→A→B counts 2 (on a plain holder sequence). */
export function countBounces(steps: JourneyStep[]): number {
  let n = 0;
  for (let i = 2; i < steps.length; i++) {
    if (steps[i].personId === steps[i - 2].personId && steps[i].personId !== steps[i - 1].personId) n += 1;
  }
  return n;
}

export interface Signal { at: string; issueId: string }

export interface PersonSignals {
  received?: Signal;
  closed?: Signal;
  bounced?: Signal;
  lastActivityAt?: string;
  stats: { received24h: number; passed24h: number; closed24h: number };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function later(a: Signal | undefined, b: Signal): Signal {
  return !a || b.at > a.at ? b : a;
}

/**
 * Walks the history once and returns, per person: the latest "received", "closed" and
 * "sent back" signals, last activity and 24 h stats.
 */
export function personSignals(entries: HistoryEntry[], now: number): Map<string, PersonSignals> {
  const out = new Map<string, PersonSignals>();
  const get = (id: string): PersonSignals => {
    let s = out.get(id);
    if (!s) { s = { stats: { received24h: 0, passed24h: 0, closed24h: 0 } }; out.set(id, s); }
    return s;
  };
  const touch = (id: string | null, at: string) => {
    if (!id) return;
    const s = get(id);
    if (!s.lastActivityAt || at > s.lastActivityAt) s.lastActivityAt = at;
  };
  const priorHolders = new Map<string, Set<string>>();
  for (const e of oldestFirst(entries)) {
    const t = Date.parse(e.at);
    const recent = Number.isFinite(t) && now - t <= DAY_MS;
    const sig: Signal = { at: e.at, issueId: e.issueId };
    touch(e.fromId, e.at);
    touch(e.toId, e.at);
    touch(e.actorId, e.at);
    if (e.kind === "status") touch(e.holderId, e.at);

    let holders = priorHolders.get(e.issueId);
    if (!holders) { holders = new Set(); priorHolders.set(e.issueId, holders); }

    if ((e.kind === "created" || e.kind === "handoff") && e.toId) {
      const s = get(e.toId);
      s.received = later(s.received, sig);
      if (recent) s.stats.received24h += 1;
      // Sent back to someone who already held it (A→B→A). A task returned on approval
      // (Paperclip's returnAssignee, status → done) is not a bounce.
      if (e.kind === "handoff" && holders.has(e.toId) && e.fromId !== e.toId && e.statusTo !== "done") {
        s.bounced = later(s.bounced, sig);
      }
    }
    if (e.kind === "handoff" && e.fromId && recent) get(e.fromId).stats.passed24h += 1;

    if (isStatusRegression(e.statusFrom, e.statusTo)) {
      const target = e.kind === "status" ? e.holderId : e.toId;
      if (target) { const s = get(target); s.bounced = later(s.bounced, sig); }
    }

    if (e.statusTo === "done" && e.statusFrom !== "done") {
      const closer = closerOf(e);
      if (closer) {
        const s = get(closer);
        s.closed = later(s.closed, sig);
        if (recent) s.stats.closed24h += 1;
      }
      // Whoever gets the done task back ("un suo task è stato approvato") and an agent
      // approving a review also get the "success" moment.
      for (const extra of [e.kind === "handoff" ? e.toId : null, e.actorId]) {
        if (!extra || extra === closer || extra.startsWith("user:")) continue;
        const s = get(extra);
        s.closed = later(s.closed, sig);
      }
    }

    if (e.fromId) holders.add(e.fromId);
    if (e.toId) holders.add(e.toId);
  }
  return out;
}
