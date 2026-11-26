/**
 * `report_progress` agent tool: declaration (shared with the manifest) and pure input validation.
 */

import { TOOL_REPORT_PROGRESS } from "../shared/types.js";

export const NOTE_MAX = 200;

export const REPORT_PROGRESS_TOOL = {
  name: TOOL_REPORT_PROGRESS,
  displayName: "Report progress",
  description:
    "Tells the board the completion percentage of a task you own; it shows up immediately in the live Org Flow org chart. " +
    "Call it when you complete a significant step (roughly every 20-25%) or when your estimate changes, with a short note on what you did or what is left. " +
    "Only valid for tasks assigned to you (or to your subordinates). It does not change the task status in Paperclip: to close it use the normal status change, there is no need to report 100%.",
  parametersSchema: {
    type: "object",
    additionalProperties: false,
    required: ["issue", "percent"],
    properties: {
      issue: {
        type: "string",
        description: "The task: an identifier such as ACME-62, or an id (UUID).",
        minLength: 1,
      },
      percent: {
        type: "integer",
        minimum: 0,
        maximum: 100,
        description: "Estimated completion percentage, from 0 to 100.",
      },
      note: {
        type: "string",
        maxLength: NOTE_MAX,
        description: "Optional, max 200 characters: what was done or what is left.",
      },
    },
  },
} as const;

export interface ReportProgressParams { issue: string; percent: number; note: string | null }

export type ParseResult = { ok: true; value: ReportProgressParams } | { ok: false; error: string };

/** Validates the raw tool parameters. Accepts numeric strings for `percent` (agents sometimes quote numbers). */
export function parseReportProgressParams(raw: unknown): ParseResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Missing parameters: issue (e.g. ACME-62) and percent (0-100) are required." };
  }
  const p = raw as Record<string, unknown>;
  const issue = typeof p.issue === "string" ? p.issue.trim() : "";
  if (!issue) return { ok: false, error: "Missing issue parameter: give the task identifier (e.g. ACME-62) or its id." };

  const rawPercent = typeof p.percent === "string" && p.percent.trim() !== "" ? Number(p.percent.trim().replace(/%$/, "")) : p.percent;
  if (typeof rawPercent !== "number" || !Number.isFinite(rawPercent)) {
    return { ok: false, error: "Invalid percent parameter: it must be a number from 0 to 100." };
  }
  if (rawPercent < 0 || rawPercent > 100) {
    return { ok: false, error: `Percent parameter out of range (${rawPercent}): it must be between 0 and 100.` };
  }

  let note: string | null = null;
  if (p.note !== undefined && p.note !== null) {
    if (typeof p.note !== "string") return { ok: false, error: "Invalid note parameter: it must be text." };
    const trimmed = p.note.trim();
    if (trimmed.length > NOTE_MAX) {
      return { ok: false, error: `The note is too long (${trimmed.length} characters): maximum ${NOTE_MAX}.` };
    }
    note = trimmed || null;
  }
  return { ok: true, value: { issue, percent: Math.round(rawPercent), note } };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

export function looksLikeUuid(v: string): boolean { return UUID_RE.test(v); }
export function looksLikeIdentifier(v: string): boolean { return IDENTIFIER_RE.test(v); }

/** True when `assigneeId` is `callerId` or reports (directly or not) to `callerId`. */
export function isSelfOrSubordinate(
  callerId: string,
  assigneeId: string | null,
  reportsTo: ReadonlyMap<string, string | null>,
): boolean {
  let cur = assigneeId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === callerId) return true;
    seen.add(cur);
    cur = reportsTo.get(cur) ?? null;
  }
  return false;
}
