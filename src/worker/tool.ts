/**
 * `report_progress` agent tool: declaration (shared with the manifest) and pure input validation.
 */

import { TOOL_REPORT_PROGRESS } from "../shared/types.js";

export const NOTE_MAX = 200;

export const REPORT_PROGRESS_TOOL = {
  name: TOOL_REPORT_PROGRESS,
  displayName: "Riporta avanzamento",
  description:
    "Comunica al board la percentuale di completamento di un task che hai in carico; compare subito nell'organigramma live di Org Flow. " +
    "Chiamalo quando completi un passo significativo (indicativamente ogni 20-25%) o quando la tua stima cambia, con una nota breve su cosa hai fatto o cosa manca. " +
    "Vale solo per task assegnati a te (o ai tuoi sottoposti). Non cambia lo stato del task in Paperclip: per chiuderlo usa il normale cambio di stato, non serve riportare 100%.",
  parametersSchema: {
    type: "object",
    additionalProperties: false,
    required: ["issue", "percent"],
    properties: {
      issue: {
        type: "string",
        description: "Il task: identificatore come FRA-62 oppure id (UUID).",
        minLength: 1,
      },
      percent: {
        type: "integer",
        minimum: 0,
        maximum: 100,
        description: "Percentuale di completamento stimata, da 0 a 100.",
      },
      note: {
        type: "string",
        maxLength: NOTE_MAX,
        description: "Facoltativa, max 200 caratteri: cosa è stato fatto o cosa manca.",
      },
    },
  },
} as const;

export interface ReportProgressParams { issue: string; percent: number; note: string | null }

export type ParseResult = { ok: true; value: ReportProgressParams } | { ok: false; error: string };

/** Validates the raw tool parameters. Accepts numeric strings for `percent` (agents sometimes quote numbers). */
export function parseReportProgressParams(raw: unknown): ParseResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Parametri mancanti: servono issue (es. FRA-62) e percent (0-100)." };
  }
  const p = raw as Record<string, unknown>;
  const issue = typeof p.issue === "string" ? p.issue.trim() : "";
  if (!issue) return { ok: false, error: "Parametro issue mancante: indica l'identificatore del task (es. FRA-62) o il suo id." };

  const rawPercent = typeof p.percent === "string" && p.percent.trim() !== "" ? Number(p.percent.trim().replace(/%$/, "")) : p.percent;
  if (typeof rawPercent !== "number" || !Number.isFinite(rawPercent)) {
    return { ok: false, error: "Parametro percent non valido: deve essere un numero da 0 a 100." };
  }
  if (rawPercent < 0 || rawPercent > 100) {
    return { ok: false, error: `Parametro percent fuori intervallo (${rawPercent}): deve essere tra 0 e 100.` };
  }

  let note: string | null = null;
  if (p.note !== undefined && p.note !== null) {
    if (typeof p.note !== "string") return { ok: false, error: "Parametro note non valido: deve essere un testo." };
    const trimmed = p.note.trim();
    if (trimmed.length > NOTE_MAX) {
      return { ok: false, error: `La nota è troppo lunga (${trimmed.length} caratteri): massimo ${NOTE_MAX}.` };
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
