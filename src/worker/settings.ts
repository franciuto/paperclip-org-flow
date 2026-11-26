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
      title: "Minutes before \"asleep\"",
      description: "An agent with no open tasks and no activity for this many minutes is shown as asleep.",
      default: DEFAULT_SETTINGS.sleepAfterMinutes,
      minimum: LIMITS.sleepAfterMinutes.min,
      maximum: LIMITS.sleepAfterMinutes.max,
    },
    keepClosedHours: {
      type: "integer",
      title: "Hours closed tasks stay visible",
      description: "For how many hours closed tasks (done or cancelled) stay visible in the org chart.",
      default: DEFAULT_SETTINGS.keepClosedHours,
      minimum: LIMITS.keepClosedHours.min,
      maximum: LIMITS.keepClosedHours.max,
    },
    enableSimulation: {
      type: "boolean",
      title: "Show the \"Simulation\" switch",
      description: "Lets you start a simulation with fake data from the page (nothing is written to Paperclip).",
      default: DEFAULT_SETTINGS.enableSimulation,
    },
    departmentNames: {
      type: "array",
      title: "Department names",
      description: "Optional. A department is the group under each direct report of the top-level agent (e.g. the CEO); its name is derived from the lead's title and role. Here you can override it: give the lead (agent name or id) and the name to show.",
      default: [],
      items: {
        type: "object",
        required: ["lead", "name"],
        properties: {
          lead: { type: "string", title: "Lead", description: "Name or id of the agent who leads the department (e.g. Giulia Bennett)." },
          name: { type: "string", title: "Department name", description: "Name shown in the org chart (e.g. Graphics).", maxLength: DEPARTMENT_NAME_MAX },
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
    if (typeof v !== "number" || !Number.isInteger(v)) errors.push(`${key} must be an integer.`);
    else if (v < min || v > max) errors.push(`${key} must be between ${min} and ${max}.`);
  };
  checkInt("sleepAfterMinutes");
  checkInt("keepClosedHours");
  if (r.enableSimulation !== undefined && typeof r.enableSimulation !== "boolean") errors.push("enableSimulation must be true or false.");
  if (r.departmentNames !== undefined && r.departmentNames !== null) {
    if (!Array.isArray(r.departmentNames)) {
      errors.push("departmentNames must be a list of { lead, name } pairs.");
    } else {
      r.departmentNames.forEach((item, i) => {
        const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
        if (typeof o.lead !== "string" || !o.lead.trim()) errors.push(`departmentNames[${i}]: missing the lead (lead: agent name or id).`);
        if (typeof o.name !== "string" || !o.name.trim()) errors.push(`departmentNames[${i}]: missing the department name (name).`);
        else if (o.name.trim().length > DEPARTMENT_NAME_MAX) errors.push(`departmentNames[${i}]: the name exceeds ${DEPARTMENT_NAME_MAX} characters.`);
      });
    }
  }
  for (const key of Object.keys(r)) {
    if (!(key in INSTANCE_CONFIG_SCHEMA.properties)) warnings.push(`Unknown setting ignored: ${key}.`);
  }
  return { ok: errors.length === 0, errors, warnings };
}
