/**
 * Pure presence logic: visual state + short Italian label for each person.
 * Rules are evaluated in the order of the spec table; the first that applies wins.
 */

import type { VisualState } from "../shared/types.js";

export const RECEIVED_WINDOW_MS = 60_000;
export const CLOSED_WINDOW_MS = 90_000;
export const BOUNCE_WINDOW_MS = 2 * 60_000;
export const RUN_FAILED_WINDOW_MS = 10 * 60_000;

export interface PresenceTask {
  id: string;
  /** Identifier (FRA-62) or a short title. */
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
    if (held.length === 0) return { state: "idle", label: "Nessun task", since: input.lastActivityAt, activeTaskId: null };
    const first = held[0];
    const label = held.length === 1 ? `Da gestire: ${first.ref}` : `${held.length} task da gestire`;
    return { state: "waiting", label, since: null, activeTaskId: first.id };
  }

  const status = input.agentStatus;
  if (status === "terminated") return { state: "paused", label: "Non più attivo", since: null, activeTaskId: null };
  if (status === "paused") return { state: "paused", label: "In pausa", since: input.pausedAt ?? null, activeTaskId: null };

  // confused
  if (status === "error") {
    return { state: "confused", label: "In errore", since: null, activeTaskId: input.lastRun?.taskId ?? null };
  }
  if (input.lastRun?.failed && within(input.lastRun, RUN_FAILED_WINDOW_MS, now)) {
    return { state: "confused", label: withRef("Run fallito", input.lastRun.ref ? `· ${input.lastRun.ref}` : null), since: input.lastRun.at, activeTaskId: input.lastRun.taskId };
  }
  if (within(input.bounced, BOUNCE_WINDOW_MS, now)) {
    const b = input.bounced!;
    return { state: "confused", label: withRef("Rimandato:", b.ref), since: b.at, activeTaskId: b.taskId };
  }

  if (within(input.closed, CLOSED_WINDOW_MS, now)) {
    const c = input.closed!;
    return { state: "success", label: withRef("Ha chiuso", c.ref), since: c.at, activeTaskId: c.taskId };
  }
  if (within(input.received, RECEIVED_WINDOW_MS, now)) {
    const r = input.received!;
    return { state: "listening", label: withRef("Ha ricevuto", r.ref), since: r.at, activeTaskId: r.taskId };
  }

  // working
  if (input.activeRun || status === "running") {
    const runTask = input.activeRun?.taskId ? held.find((t) => t.id === input.activeRun!.taskId) : undefined;
    const task = runTask ?? pickTask(held, "in_progress");
    const label = task ? `Lavora su ${pct(task)}` : input.activeRun?.ref ? `Lavora su ${input.activeRun.ref}` : "Al lavoro";
    return { state: "working", label, since: input.activeRun?.at ?? null, activeTaskId: task?.id ?? input.activeRun?.taskId ?? null };
  }

  const review = pickTask(held, "in_review");
  if (review) return { state: "thinking", label: `Revisiona ${review.ref}`, since: null, activeTaskId: review.id };

  if (held.length > 0) {
    const inProgress = pickTask(held, "in_progress");
    const blocked = pickTask(held, "blocked");
    let label: string;
    let task: PresenceTask;
    if (held.length === 1) {
      task = held[0];
      label = task.status === "in_progress" ? `In corso: ${pct(task)}`
        : task.status === "blocked" ? `Bloccato: ${task.ref}`
        : `Da fare: ${task.ref}`;
    } else {
      task = inProgress ?? blocked ?? held[0];
      label = `${held.length} task da fare`;
    }
    return { state: "idle", label, since: null, activeTaskId: task.id };
  }

  const last = input.lastActivityAt ? Date.parse(input.lastActivityAt) : NaN;
  const sleepMs = Math.max(0, sleepAfterMinutes) * 60_000;
  if (!Number.isFinite(last) || now - last >= sleepMs) {
    return { state: "sleepy", label: "Dorme", since: input.lastActivityAt, activeTaskId: null };
  }
  return { state: "idle", label: "Libero", since: input.lastActivityAt, activeTaskId: null };
}
