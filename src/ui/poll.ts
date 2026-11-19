/**
 * Pure helpers for live polling and accessibility (no React):
 * - RequestGate: at most one request in flight, triggers coalesced, a ceiling after which a stuck
 *   request is retried (the host's refresh() cancels the previous request without aborting it,
 *   so firing on a fixed timer can starve forever if replies are slower than the interval);
 * - watchCursor: detects a cursor that stopped producing records although the worker moves on
 *   (e.g. worker restarted with a new history) and asks for a reset;
 * - announcer: throttles screen-reader announcements;
 * - rovingNext: arrow-key navigation over a flat list of focusable items.
 */

export const POLL_CEILING_MS = 15_000;

export class RequestGate {
  inFlight = false;
  since = 0;
  pending = false;

  constructor(readonly ceilingMs = POLL_CEILING_MS) {}

  /** Mark a request as started (also used for requests the host fires on its own). */
  start(now: number): void {
    this.inFlight = true;
    this.since = now;
    this.pending = false;
  }

  /** True when the request in flight is older than the ceiling (treat it as lost). */
  stuck(now: number): boolean {
    return this.inFlight && now - this.since >= this.ceilingMs;
  }

  /** Ask for a request. Returns true when the caller should fire it now; otherwise it is coalesced. */
  request(now: number): boolean {
    if (this.inFlight && !this.stuck(now)) {
      this.pending = true;
      return false;
    }
    this.start(now);
    return true;
  }

  /** The request settled. Returns true when a coalesced request should be fired now. */
  settle(now: number): boolean {
    this.inFlight = false;
    if (!this.pending) return false;
    this.start(now);
    return true;
  }
}

export interface CursorWatch {
  emptyStreak: number;
  lastSnapshotAt: string | null;
}

export const CURSOR_RESET_AFTER = 5;

export function initialCursorWatch(): CursorWatch {
  return { emptyStreak: 0, lastSnapshotAt: null };
}

/**
 * Feed one successful events page. If CURSOR_RESET_AFTER consecutive pages return no records
 * while `snapshotAt` keeps changing, the cursor is probably stale: reset it (records are
 * de-duplicated by id, so re-reading the latest ones is harmless).
 */
export function watchCursor(w: CursorWatch, page: { records: unknown[]; snapshotAt: string | null }): { watch: CursorWatch; reset: boolean } {
  if (page.records.length) return { watch: { emptyStreak: 0, lastSnapshotAt: page.snapshotAt }, reset: false };
  const moved = !!page.snapshotAt && w.lastSnapshotAt !== null && page.snapshotAt !== w.lastSnapshotAt;
  const streak = moved ? w.emptyStreak + 1 : w.emptyStreak;
  if (streak >= CURSOR_RESET_AFTER) return { watch: { emptyStreak: 0, lastSnapshotAt: page.snapshotAt }, reset: true };
  return { watch: { emptyStreak: streak, lastSnapshotAt: page.snapshotAt ?? w.lastSnapshotAt }, reset: false };
}

export interface Announcer {
  lastAt: number | null;
  queued: string | null;
}

/** Offer a message: emitted now if the gap since the last one has passed, otherwise queued (latest wins). */
export function announce(a: Announcer, text: string, now: number, gapMs: number): { state: Announcer; emit: string | null } {
  if (a.lastAt === null || now - a.lastAt >= gapMs) return { state: { lastAt: now, queued: null }, emit: text };
  return { state: { ...a, queued: text }, emit: null };
}

/** Emit the queued message once the gap has passed. */
export function flushAnnouncer(a: Announcer, now: number, gapMs: number): { state: Announcer; emit: string | null } {
  if (!a.queued || (a.lastAt !== null && now - a.lastAt < gapMs)) return { state: a, emit: null };
  return { state: { lastAt: now, queued: null }, emit: a.queued };
}

/** Next focus key for an arrow/Home/End key over a flat ordered list; null when the key is not handled. */
export function rovingNext(keys: string[], current: string | null, key: string): string | null {
  if (!keys.length) return null;
  const i = current ? keys.indexOf(current) : -1;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return keys[Math.min(keys.length - 1, i + 1)] ?? keys[0]!;
    case "ArrowLeft":
    case "ArrowUp":
      return keys[Math.max(0, i - 1)] ?? keys[0]!;
    case "Home":
      return keys[0]!;
    case "End":
      return keys[keys.length - 1]!;
    default:
      return null;
  }
}
