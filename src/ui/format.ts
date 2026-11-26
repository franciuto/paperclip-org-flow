/**
 * Formatting helpers for the Org Flow UI. Pure functions, no React, no DOM.
 * Every user-facing string is English.
 */
import type { Pose, ProgressSource } from "../shared/types.js";

export const STATUS_LABEL: Record<string, string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

export function statusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return STATUS_LABEL[status] ?? status.replace(/_/g, " ");
}

export function isClosedStatus(status: string | null | undefined): boolean {
  return status === "done" || status === "cancelled";
}

/**
 * Same rule as the worker's isStatusRegression (src/worker/history.ts), so "Sent back" means the
 * same thing everywhere: review → rework (todo/in_progress) or a closed task reopened
 * (done → todo/in_progress/in_review). Parking moves (backlog, blocked) and cancellations are not.
 * (The worker also counts a task in review handed back DOWN the chain to a previous holder; that
 * needs history, so the UI relies on the worker's snapshot state/`bounces` for it.)
 */
export function statusRegression(from: string | null | undefined, to: string | null | undefined): "rework" | "reopen" | null {
  if (!from || !to) return null;
  if (from === "in_review") return to === "todo" || to === "in_progress" ? "rework" : null;
  if (from === "done") return to === "todo" || to === "in_progress" || to === "in_review" ? "reopen" : null;
  return null;
}

/** CSS custom property holding the colour of a status (defined in styles.ts). */
export function statusColorVar(status: string | null | undefined): string {
  switch (status) {
    case "todo":
    case "backlog":
      return "var(--of-st-todo)";
    case "in_progress":
      return "var(--of-st-progress)";
    case "in_review":
      return "var(--of-st-review)";
    case "blocked":
      return "var(--of-st-blocked)";
    case "done":
      return "var(--of-st-done)";
    default:
      return "var(--of-muted-fg)";
  }
}

export const SOURCE_LABEL: Record<ProgressSource, string> = {
  reported: "reported by the agent",
  checklist: "from the plan checklist",
  children: "from closed child tasks",
  status: "estimated from status",
};

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Compact duration: "less than 1 min", "7 min", "2 h 5 min", "3 d 4 h". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < MIN) return "less than 1 min";
  if (ms < HOUR) return `${Math.floor(ms / MIN)} min`;
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR);
    const m = Math.floor((ms % HOUR) / MIN);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / HOUR);
  return h ? `${d} d ${h} h` : `${d} d`;
}

/** Relative time in the past: "now", "3 min ago", "2 h ago", "yesterday", "4 d ago". */
export function relativeTime(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const diff = nowMs - t;
  if (diff < 45_000) return "now";
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MIN))} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  if (diff < 2 * DAY) return "yesterday";
  return `${Math.floor(diff / DAY)} d ago`;
}

/** "14:05" in local time. */
export function clockTime(iso: string | number | null | undefined): string {
  if (iso == null) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Full local date and time, for tooltips. */
export function fullDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}, ${clockTime(d.getTime())}`;
}

export function firstName(name: string): string {
  const n = name.trim();
  return n.split(/\s+/)[0] || n;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const a = parts[0]![0] ?? "";
  const b = parts.length > 1 ? parts[parts.length - 1]![0] ?? "" : "";
  return (a + b).toUpperCase();
}

/**
 * Rough text width estimate (px) for Inter-like sans fonts. Used by the layout to size
 * columns from their content without measuring the DOM (keeps the layout pure/testable).
 */
export function estimateTextWidth(text: string, fontSize: number, bold = false): number {
  let units = 0;
  for (const ch of text) {
    if (/[il.,:;'!|ìíI1 ]/.test(ch)) units += 0.3;
    else if (/[mwMW@]/.test(ch)) units += 0.86;
    else if (/[A-Z]/.test(ch)) units += 0.66;
    else if (/[0-9]/.test(ch)) units += 0.58;
    else if (ch === "·" || ch === "-") units += 0.36;
    else units += 0.54;
  }
  return units * fontSize * (bold ? 1.06 : 1);
}

/** Monospace width estimate (px). */
export function estimateMonoWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.61;
}

/** Truncates `text` with an ellipsis so that its estimated width fits `maxWidth`. */
export function truncateToWidth(text: string, maxWidth: number, fontSize: number, bold = false): string {
  if (estimateTextWidth(text, fontSize, bold) <= maxWidth) return text;
  const chars = [...text];
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = chars.slice(0, mid).join("").trimEnd() + "…";
    if (estimateTextWidth(candidate, fontSize, bold) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return chars.slice(0, lo).join("").trimEnd() + "…";
}

/** Mix a colour with the page background (works in light and dark themes). */
export function tint(color: string, pct: number): string {
  return `color-mix(in oklch, ${color} ${pct}%, var(--of-bg))`;
}

export function poseUrl(paletteId: string, pose: Pose): string {
  return `/api/agent-avatars/cap-v1/${encodeURIComponent(paletteId)}/${pose}.png?size=128&scale=1`;
}

/** Short code shown on chips: the identifier, or the first letters of the title. */
export function taskCode(task: { identifier: string | null; title: string; id: string }): string {
  if (task.identifier) return task.identifier;
  const t = task.title.trim();
  return t ? (t.length > 7 ? t.slice(0, 6) + "…" : t) : task.id.slice(0, 6);
}

/** Natural compare for identifiers like ACME-9 < ACME-62. */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

export function clampPercent(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
