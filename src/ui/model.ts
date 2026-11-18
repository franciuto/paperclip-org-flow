/**
 * Derived view data (pure): group ordering, tasks held by each person, live counts,
 * connection health. Kept out of the components so it can be unit-tested.
 */
import { STANDALONE_GROUP_ID, type FeedRecord, type GroupView, type PersonView, type TaskView } from "../shared/types.js";
import { isClosedStatus, naturalCompare } from "./format.js";

export function isGroupDone(g: GroupView): boolean {
  if (g.status && isClosedStatus(g.status)) return true;
  return g.childrenTotal > 0 && g.childrenDone >= g.childrenTotal;
}

/** Open groups first (by identifier), then completed ones, the standalone bucket last. */
export function sortGroups(groups: GroupView[]): GroupView[] {
  const rank = (g: GroupView) => (g.id === STANDALONE_GROUP_ID ? 2 : isGroupDone(g) ? 1 : 0);
  return [...groups].sort(
    (a, b) => rank(a) - rank(b) || naturalCompare(a.identifier ?? a.title, b.identifier ?? b.title),
  );
}

const STATUS_RANK: Record<string, number> = { in_progress: 0, in_review: 1, blocked: 2, todo: 3, backlog: 4 };

export function isOpenTask(t: TaskView): boolean {
  return !isClosedStatus(t.status) && !t.closedAt;
}

/** Open tasks per holder, sorted by parent group order, then status, then identifier. */
export function heldByPerson(tasks: TaskView[], groupOrder: string[], hidden: ReadonlySet<string> = new Set()): Map<string, TaskView[]> {
  const gi = new Map(groupOrder.map((id, i) => [id, i]));
  const map = new Map<string, TaskView[]>();
  for (const t of tasks) {
    if (!t.holderId || !isOpenTask(t) || hidden.has(t.id)) continue;
    const list = map.get(t.holderId) ?? [];
    list.push(t);
    map.set(t.holderId, list);
  }
  for (const list of map.values()) {
    list.sort(
      (a, b) =>
        (gi.get(a.groupId) ?? 999) - (gi.get(b.groupId) ?? 999) ||
        (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
        naturalCompare(a.identifier ?? a.title, b.identifier ?? b.title),
    );
  }
  return map;
}

export interface LiveCounts {
  working: number;
  thinking: number;
  sleepy: number;
  waiting: number; // open tasks held by human users
  open: number;
}

export function liveCounts(people: PersonView[], tasks: TaskView[]): LiveCounts {
  const agents = people.filter((p) => p.kind === "agent");
  const users = new Set(people.filter((p) => p.kind === "user").map((p) => p.id));
  const open = tasks.filter(isOpenTask);
  return {
    working: agents.filter((p) => p.state === "working").length,
    thinking: agents.filter((p) => p.state === "thinking").length,
    sleepy: agents.filter((p) => p.state === "sleepy").length,
    waiting: open.filter((t) => t.holderId && users.has(t.holderId)).length,
    open: open.length,
  };
}

/** People who held the task at some point (for the selection halo). */
export function touchedBy(task: TaskView | null | undefined): Set<string> {
  const s = new Set<string>();
  if (!task) return s;
  for (const j of task.journey) s.add(j.personId);
  if (task.holderId) s.add(task.holderId);
  return s;
}

export function recentlyClosed(tasks: TaskView[], limit = 6): TaskView[] {
  return tasks
    .filter((t) => t.closedAt)
    .sort((a, b) => Date.parse(b.closedAt!) - Date.parse(a.closedAt!))
    .slice(0, limit);
}

/** Open groups that still have work (for the strip and the widget). */
export function activeGroups(groups: GroupView[]): GroupView[] {
  return sortGroups(groups).filter((g) => !isGroupDone(g) || g.holderIds.length > 0);
}

export type ConnectionState = "live" | "connecting" | "offline";

export interface ConnectionInput {
  streamConnected: boolean;
  lastOkAt: number | null;
  failures: number;
  nowMs: number;
  pollMs: number;
}

/**
 * Health of the live updates. The stream bridge may be missing on the host (501), so polling is
 * the primary channel: "live" while polls succeed, "connecting" before the first success or after
 * a failure, "offline" after 3 consecutive failures.
 */
export function connectionState(i: ConnectionInput): ConnectionState {
  if (i.streamConnected) return "live";
  if (i.failures >= 3) return "offline";
  if (i.lastOkAt === null || i.failures > 0) return "connecting";
  if (i.nowMs - i.lastOkAt > Math.max(15_000, i.pollMs * 4)) return "connecting";
  return "live";
}

export const CONNECTION_LABEL: Record<ConnectionState, string> = {
  live: "Live",
  connecting: "Connessione…",
  offline: "Non raggiungibile",
};

/** Merge feed lists (any order), de-duplicated by id, newest first, capped. */
export function mergeFeed(...lists: FeedRecord[][]): FeedRecord[] {
  const seen = new Set<string>();
  const out: FeedRecord[] = [];
  for (const list of lists) {
    for (const r of list) {
      if (!r || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 100);
}
