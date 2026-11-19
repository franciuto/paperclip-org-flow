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

/**
 * The work went back to an earlier working stage: review → rework (todo/in_progress) or a
 * closed task reopened (done → todo/in_progress/in_review). Parking moves (backlog, blocked)
 * and cancellations are not rework.
 */
export function isStatusRegression(from: string | null, to: string | null): boolean {
  if (!from || !to) return false;
  if (from === "in_review") return to === "todo" || to === "in_progress";
  if (from === "done") return to === "todo" || to === "in_progress" || to === "in_review";
  return false;
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

/** Manager of a person (agents: reportsTo), or null. */
export type ManagerOf = (personId: string) => string | null;

export const noChain: ManagerOf = () => null;

/**
 * True when `upper` is above `lower` in the org chart. Board users are above every agent.
 */
export function isAbove(upper: string, lower: string, managerOf: ManagerOf): boolean {
  if (upper === lower) return false;
  const upperIsUser = upper.startsWith("user:");
  if (lower.startsWith("user:")) return false;
  if (upperIsUser) return true;
  const seen = new Set<string>();
  let cur = managerOf(lower);
  while (cur && !seen.has(cur)) {
    if (cur === upper) return true;
    seen.add(cur);
    cur = managerOf(cur);
  }
  return false;
}

/**
 * Events that send the work backwards, keyed by entry id → person who gets it back:
 * - the status regresses (see isStatusRegression: rework after review, or reopen);
 * - while in review, the task is handed back DOWN the chain to someone who already held it
 *   (a reviewer returning it without changing the status).
 * Delegating down and returning up (for review, for help, when blocked or done) is normal
 * flow, and so is handing a task back down after an escalation (e.g. blocked → todo) or the
 * return on approval (status → done).
 */
export function backwardsTargets(entries: HistoryEntry[], managerOf: ManagerOf = noChain): Map<string, string> {
  const out = new Map<string, string>();
  const holders = new Map<string, Set<string>>();
  const statusOf = new Map<string, string>();
  for (const e of oldestFirst(entries)) {
    let held = holders.get(e.issueId);
    if (!held) { held = new Set(); holders.set(e.issueId, held); }
    const statusBefore = e.statusFrom ?? statusOf.get(e.issueId) ?? null;
    const statusAfter = e.statusTo ?? statusBefore;
    if (isStatusRegression(e.statusFrom, e.statusTo)) {
      const target = e.kind === "status" ? e.holderId : e.toId;
      if (target) out.set(e.id, target);
    } else if (
      e.kind === "handoff" && e.fromId && e.toId && statusBefore === "in_review" && statusAfter === "in_review"
      && held.has(e.toId) && isAbove(e.fromId, e.toId, managerOf)
    ) {
      out.set(e.id, e.toId);
    }
    if (statusAfter) statusOf.set(e.issueId, statusAfter);
    if (e.fromId) held.add(e.fromId);
    if (e.toId) held.add(e.toId);
    if (e.holderId) held.add(e.holderId);
  }
  return out;
}

/** Bounces per issue: number of events that sent the work backwards (see backwardsTargets). */
export function bouncesByIssue(entries: HistoryEntry[], managerOf: ManagerOf = noChain): Map<string, number> {
  const back = backwardsTargets(entries, managerOf);
  const out = new Map<string, number>();
  for (const e of entries) if (back.has(e.id)) out.set(e.issueId, (out.get(e.issueId) ?? 0) + 1);
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
export function personSignals(entries: HistoryEntry[], now: number, managerOf: ManagerOf = noChain): Map<string, PersonSignals> {
  const back = backwardsTargets(entries, managerOf);
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
  for (const e of oldestFirst(entries)) {
    const t = Date.parse(e.at);
    const recent = Number.isFinite(t) && now - t <= DAY_MS;
    const sig: Signal = { at: e.at, issueId: e.issueId };
    touch(e.fromId, e.at);
    touch(e.toId, e.at);
    touch(e.actorId, e.at);
    if (e.kind === "status") touch(e.holderId, e.at);

    if ((e.kind === "created" || e.kind === "handoff") && e.toId) {
      const s = get(e.toId);
      s.received = later(s.received, sig);
      if (recent) s.stats.received24h += 1;
    }
    if (e.kind === "handoff" && e.fromId && recent) get(e.fromId).stats.passed24h += 1;

    const backTo = back.get(e.id);
    if (backTo) { const s = get(backTo); s.bounced = later(s.bounced, sig); }

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
  }
  return out;
}
