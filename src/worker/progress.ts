/**
 * Pure progress logic: checklist parsing, status estimate and the resolution order
 * reported > children (parent tasks) > checklist > status.
 */

import type { ProgressSource } from "../shared/types.js";

/** Estimate from the issue status (spec: "Stima dallo stato"). `blocked` is handled separately. */
export const STATUS_ESTIMATE: Readonly<Record<string, number>> = {
  backlog: 0,
  todo: 5,
  in_progress: 40,
  in_review: 85,
  done: 100,
  cancelled: 0,
};

const BLOCKED_DEFAULT = 40;

export const OPEN_STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked"] as const;
export const CLOSED_STATUSES = ["done", "cancelled"] as const;

export function isClosedStatus(status: string | null | undefined): boolean {
  return status === "done" || status === "cancelled";
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** blocked → last known value or 40; unknown statuses → last known value or 0. */
export function estimateFromStatus(status: string, lastKnown?: number | null): number {
  if (status === "blocked") return clampPercent(lastKnown ?? BLOCKED_DEFAULT);
  const known = STATUS_ESTIMATE[status];
  if (known !== undefined) return known;
  return clampPercent(lastKnown ?? 0);
}

export interface Checklist { done: number; total: number }

// "- [x] item", "* [ ] item", "+ [X] item", "1. [x] item" (leading spaces allowed for nesting).
const CHECKBOX_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]/;

/** Counts markdown checkboxes in a document body. Null when there is no checkbox at all. */
export function parseChecklist(body: string | null | undefined): Checklist | null {
  if (!body) return null;
  let done = 0;
  let total = 0;
  let inFence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = CHECKBOX_RE.exec(line);
    if (!m) continue;
    total += 1;
    if (m[1] !== " ") done += 1;
  }
  return total > 0 ? { done, total } : null;
}

export interface ChildrenCount { done: number; total: number }

/** done / total children, cancelled excluded. */
export function countChildren(statuses: Iterable<string>): ChildrenCount {
  let done = 0;
  let total = 0;
  for (const s of statuses) {
    if (s === "cancelled") continue;
    total += 1;
    if (s === "done") done += 1;
  }
  return { done, total };
}

export function ratioPercent(done: number, total: number): number {
  return total > 0 ? clampPercent((done / total) * 100) : 0;
}

export interface ReportedProgress { percent: number; note: string | null; at: string; agentId?: string | null }

export interface ProgressInput {
  status: string;
  reported?: ReportedProgress | null;
  children?: ChildrenCount | null;
  checklist?: Checklist | null;
  lastKnown?: number | null;
}

export interface ProgressResult { progress: number; source: ProgressSource; note: string | null }

/**
 * Resolution order: done → 100; reported by the agent; children (when the task is a parent);
 * checklist of the `plan` document; estimate from the status.
 */
export function resolveProgress(input: ProgressInput): ProgressResult {
  const note = input.reported?.note ?? null;
  if (input.status === "done") return { progress: 100, source: "status", note: null };
  if (input.reported && Number.isFinite(input.reported.percent)) {
    return { progress: clampPercent(input.reported.percent), source: "reported", note };
  }
  if (input.children && input.children.total > 0) {
    return { progress: ratioPercent(input.children.done, input.children.total), source: "children", note: null };
  }
  if (input.checklist && input.checklist.total > 0) {
    return { progress: ratioPercent(input.checklist.done, input.checklist.total), source: "checklist", note: null };
  }
  return { progress: estimateFromStatus(input.status, input.lastKnown), source: "status", note: null };
}
