/**
 * Plugin settings: JSON Schema for the manifest, defaults and validation.
 */

import type { OrgFlowSettings } from "../shared/types.js";

export const DEFAULT_SETTINGS: OrgFlowSettings = {
  sleepAfterMinutes: 15,
  keepClosedHours: 24,
  enableSimulation: true,
};

const LIMITS = {
  sleepAfterMinutes: { min: 1, max: 1440 },
  keepClosedHours: { min: 0, max: 720 },
} as const;

export const INSTANCE_CONFIG_SCHEMA = {
  type: "object",
  properties: {
    sleepAfterMinutes: {
      type: "integer",
      title: "Minuti prima di \"dorme\"",
      description: "Un agente senza task aperti e senza attività da questo numero di minuti viene mostrato addormentato.",
      default: DEFAULT_SETTINGS.sleepAfterMinutes,
      minimum: LIMITS.sleepAfterMinutes.min,
      maximum: LIMITS.sleepAfterMinutes.max,
    },
    keepClosedHours: {
      type: "integer",
      title: "Ore di visibilità dei task chiusi",
      description: "Per quante ore i task chiusi (fatti o annullati) restano visibili nell'organigramma.",
      default: DEFAULT_SETTINGS.keepClosedHours,
      minimum: LIMITS.keepClosedHours.min,
      maximum: LIMITS.keepClosedHours.max,
    },
    enableSimulation: {
      type: "boolean",
      title: "Mostra l'interruttore \"Simulazione\"",
      description: "Permette di avviare dalla pagina una simulazione con dati finti (non scrive nulla su Paperclip).",
      default: DEFAULT_SETTINGS.enableSimulation,
    },
  },
} as const;

function intIn(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Raw config → settings with defaults; invalid values fall back to the default. */
export function resolveSettings(raw: Record<string, unknown> | null | undefined): OrgFlowSettings {
  const r = raw ?? {};
  const sleep = intIn(r.sleepAfterMinutes, LIMITS.sleepAfterMinutes.min, LIMITS.sleepAfterMinutes.max);
  const keep = intIn(r.keepClosedHours, LIMITS.keepClosedHours.min, LIMITS.keepClosedHours.max);
  return {
    sleepAfterMinutes: sleep ?? DEFAULT_SETTINGS.sleepAfterMinutes,
    keepClosedHours: keep ?? DEFAULT_SETTINGS.keepClosedHours,
    enableSimulation: typeof r.enableSimulation === "boolean" ? r.enableSimulation : DEFAULT_SETTINGS.enableSimulation,
  };
}

export function validateSettings(raw: Record<string, unknown> | null | undefined): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const r = raw ?? {};
  const checkInt = (key: "sleepAfterMinutes" | "keepClosedHours") => {
    const v = r[key];
    if (v === undefined || v === null) return;
    const { min, max } = LIMITS[key];
    if (typeof v !== "number" || !Number.isInteger(v)) errors.push(`${key} deve essere un numero intero.`);
    else if (v < min || v > max) errors.push(`${key} deve essere tra ${min} e ${max}.`);
  };
  checkInt("sleepAfterMinutes");
  checkInt("keepClosedHours");
  if (r.enableSimulation !== undefined && typeof r.enableSimulation !== "boolean") errors.push("enableSimulation deve essere vero o falso.");
  for (const key of Object.keys(r)) {
    if (!(key in INSTANCE_CONFIG_SCHEMA.properties)) warnings.push(`Impostazione sconosciuta ignorata: ${key}.`);
  }
  return { ok: errors.length === 0, errors, warnings };
}
