/**
 * Pure presence logic: visual state + short label for each person.
 * Rules are evaluated in the order of the table in docs/states-and-percentages.md; the first that applies wins.
 */

import type { VisualState } from "../shared/types.js";

export const RECEIVED_WINDOW_MS = 60_000;
export const CLOSED_WINDOW_MS = 90_000;
export const BOUNCE_WINDOW_MS = 2 * 60_000;
export const RUN_FAILED_WINDOW_MS = 10 * 60_000;

export interface PresenceTask {
  id: string;
  /** Identifier (ACME-62) or a short title. */
  ref: string;
  status: string;
  progress: number;
}

export interface PresenceSignal { at: string; taskId: string | null; ref: string | null }

export interface PresenceInput {
  kind: "agent" | "user";
  /** Raw Paperclip agent status; null for users. */
  agentStatus: string | null;
  pausedAt?: string | null;
  /** Open tasks currently held (backlog, todo, in_progress, in_review, blocked, unknown open statuses). */
  heldOpen: PresenceTask[];
  /** Run in progress, if any. */
  activeRun: PresenceSignal | null;
  /** Outcome of the most recent finished run. */
  lastRun: (PresenceSignal & { failed: boolean }) | null;
  received: PresenceSignal | null;
  closed: PresenceSignal | null;
  bounced: PresenceSignal | null;
  lastActivityAt: string | null;
}

export interface PresenceResult {
  state: VisualState;
  label: string;
  since: string | null;
  activeTaskId: string | null;
}

function within(sig: { at: string } | null | undefined, windowMs: number, now: number): boolean {
  if (!sig) return false;
  const t = Date.parse(sig.at);
  return Number.isFinite(t) && now - t <= windowMs && now - t >= -60_000;
}

const withRef = (prefix: string, ref: string | null) => (ref ? `${prefix} ${ref}` : prefix);

const pct = (t: PresenceTask) => `${t.ref} · ${Math.round(t.progress)}%`;

function pickTask(tasks: PresenceTask[], status: string): PresenceTask | undefined {
  return tasks.find((t) => t.status === status);
}

export function computePresence(input: PresenceInput, now: number, sleepAfterMinutes: number): PresenceResult {
  const held = input.heldOpen;

  if (input.kind === "user") {
    if (held.length === 0) return { state: "idle", label: "No tasks", since: input.lastActivityAt, activeTaskId: null };
    const first = held[0];
    const label = held.length === 1 ? `To handle: ${first.ref}` : `${held.length} tasks to handle`;
    return { state: "waiting", label, since: null, activeTaskId: first.id };
  }

  const status = input.agentStatus;
  if (status === "terminated") return { state: "paused", label: "No longer active", since: null, activeTaskId: null };
  if (status === "paused") return { state: "paused", label: "Paused", since: input.pausedAt ?? null, activeTaskId: null };

  // confused
  if (status === "error") {
    return { state: "confused", label: "Error", since: null, activeTaskId: input.lastRun?.taskId ?? null };
  }
  if (input.lastRun?.failed && within(input.lastRun, RUN_FAILED_WINDOW_MS, now)) {
    return { state: "confused", label: withRef("Run failed", input.lastRun.ref ? `· ${input.lastRun.ref}` : null), since: input.lastRun.at, activeTaskId: input.lastRun.taskId };
  }
  if (within(input.bounced, BOUNCE_WINDOW_MS, now)) {
    const b = input.bounced!;
    return { state: "confused", label: withRef("Sent back:", b.ref), since: b.at, activeTaskId: b.taskId };
  }

  if (within(input.closed, CLOSED_WINDOW_MS, now)) {
    const c = input.closed!;
    return { state: "success", label: withRef("Closed", c.ref), since: c.at, activeTaskId: c.taskId };
  }
  if (within(input.received, RECEIVED_WINDOW_MS, now)) {
    const r = input.received!;
    return { state: "listening", label: withRef("Received", r.ref), since: r.at, activeTaskId: r.taskId };
  }

  // working
  if (input.activeRun || status === "running") {
    const runTask = input.activeRun?.taskId ? held.find((t) => t.id === input.activeRun!.taskId) : undefined;
    const task = runTask ?? pickTask(held, "in_progress");
    const label = task ? `Working on ${pct(task)}` : input.activeRun?.ref ? `Working on ${input.activeRun.ref}` : "Working";
    return { state: "working", label, since: input.activeRun?.at ?? null, activeTaskId: task?.id ?? input.activeRun?.taskId ?? null };
  }

  const review = pickTask(held, "in_review");
  if (review) return { state: "thinking", label: `Reviewing ${review.ref}`, since: null, activeTaskId: review.id };

  if (held.length > 0) {
    const inProgress = pickTask(held, "in_progress");
    const blocked = pickTask(held, "blocked");
    let label: string;
    let task: PresenceTask;
    if (held.length === 1) {
      task = held[0];
      label = task.status === "in_progress" ? `In progress: ${pct(task)}`
        : task.status === "blocked" ? `Blocked: ${task.ref}`
        : `To do: ${task.ref}`;
    } else {
      task = inProgress ?? blocked ?? held[0];
      label = `${held.length} tasks to do`;
    }
    return { state: "idle", label, since: null, activeTaskId: task.id };
  }

  const last = input.lastActivityAt ? Date.parse(input.lastActivityAt) : NaN;
  const sleepMs = Math.max(0, sleepAfterMinutes) * 60_000;
  if (!Number.isFinite(last) || now - last >= sleepMs) {
    return { state: "sleepy", label: "Asleep", since: input.lastActivityAt, activeTaskId: null };
  }
  return { state: "idle", label: "Idle", since: input.lastActivityAt, activeTaskId: null };
}
