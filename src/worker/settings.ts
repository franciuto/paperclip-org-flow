/**
 * Plugin settings: JSON Schema for the manifest, defaults and validation.
 */

import type { OrgFlowSettings } from "../shared/types.js";

export const DEFAULT_SETTINGS: OrgFlowSettings = {
  sleepAfterMinutes: 15,
  keepClosedHours: 24,
  enableSimulation: true,
  departmentNames: [],
};

const DEPARTMENT_NAME_MAX = 60;

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
    departmentNames: {
      type: "array",
      title: "Nomi dei reparti",
      description: "Facoltativo. Un reparto è il gruppo sotto ogni riporto diretto del vertice (es. del CEO); il nome si ricava da titolo e ruolo del responsabile. Qui puoi sostituirlo: indica il responsabile (nome o id dell'agente) e il nome da mostrare.",
      default: [],
      items: {
        type: "object",
        required: ["lead", "name"],
        properties: {
          lead: { type: "string", title: "Responsabile", description: "Nome o id dell'agente che guida il reparto (es. Giulia Bennett)." },
          name: { type: "string", title: "Nome del reparto", description: "Nome mostrato nell'organigramma (es. Grafica).", maxLength: DEPARTMENT_NAME_MAX },
        },
      },
    },
  },
} as const;

/** Keeps the valid {lead, name} entries, trimmed. */
function resolveDepartmentNames(v: unknown): Array<{ lead: string; name: string }> {
  if (!Array.isArray(v)) return [];
  const out: Array<{ lead: string; name: string }> = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const { lead, name } = item as Record<string, unknown>;
    if (typeof lead !== "string" || typeof name !== "string") continue;
    const l = lead.trim();
    const n = name.trim().slice(0, DEPARTMENT_NAME_MAX);
    if (l && n) out.push({ lead: l, name: n });
  }
  return out;
}

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
    departmentNames: resolveDepartmentNames(r.departmentNames),
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
  if (r.departmentNames !== undefined && r.departmentNames !== null) {
    if (!Array.isArray(r.departmentNames)) {
      errors.push("departmentNames deve essere un elenco di coppie { lead, name }.");
    } else {
      r.departmentNames.forEach((item, i) => {
        const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
        if (typeof o.lead !== "string" || !o.lead.trim()) errors.push(`departmentNames[${i}]: manca il responsabile (lead: nome o id dell'agente).`);
        if (typeof o.name !== "string" || !o.name.trim()) errors.push(`departmentNames[${i}]: manca il nome del reparto (name).`);
        else if (o.name.trim().length > DEPARTMENT_NAME_MAX) errors.push(`departmentNames[${i}]: il nome supera ${DEPARTMENT_NAME_MAX} caratteri.`);
      });
    }
  }
  for (const key of Object.keys(r)) {
    if (!(key in INSTANCE_CONFIG_SCHEMA.properties)) warnings.push(`Impostazione sconosciuta ignorata: ${key}.`);
  }
  return { ok: errors.length === 0, errors, warnings };
}
