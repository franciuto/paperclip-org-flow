/**
 * Departments derived from the reporting chain. Paperclip has no department concept:
 * a department is the subtree under one direct report of a top-level agent. Pure module.
 */

import type { DepartmentView } from "../shared/types.js";

export interface DepartmentAgent {
  id: string;
  name: string;
  title: string | null;
  role: string | null;
  reportsTo: string | null;
}

export interface DepartmentNameOverride { lead: string; name: string }

/** Title keywords → department name, checked in this order. */
const TITLE_RULES: Array<[RegExp, string]> = [
  [/grafic|graphic|design/, "Graphics"],
  [/communicat|comunicazion|marketing|social/, "Communications"],
  [/\b(cio|cto|it)\b|system|sistem|infrastruct|infrastrutt|network|\breti?\b|devops|sysadmin/, "IT and infrastructure"],
  [/librar|bibliotec|knowledge|archiv|documentation|documentazion/, "Library"],
  [/financ|finanz|accounting|contabil|\badmin/, "Administration"],
  [/sales|vendit/, "Sales"],
  [/engineer|developer|software|svilupp/, "Development"],
  [/legal/, "Legal"],
  [/\bhr\b|people|human resources|risorse umane/, "People"],
];

const ROLE_NAMES: Record<string, string> = {
  designer: "Graphics",
  cmo: "Communications",
  cto: "IT and infrastructure",
  devops: "IT and infrastructure",
  engineer: "Development",
  researcher: "Research",
};

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Name for a department led by `lead`: override, then title keywords, then role, then "<Name>'s team". */
export function departmentName(lead: DepartmentAgent, overrides: DepartmentNameOverride[] = []): string {
  const leadName = lead.name.trim().toLowerCase();
  const hit = overrides.find((o) => {
    const key = o.lead.trim().toLowerCase();
    return key !== "" && (o.lead.trim() === lead.id || key === leadName);
  });
  if (hit && hit.name.trim()) return hit.name.trim();
  const title = (lead.title ?? "").toLowerCase();
  if (title) for (const [re, name] of TITLE_RULES) if (re.test(title)) return name;
  const byRole = lead.role ? ROLE_NAMES[lead.role.toLowerCase()] : undefined;
  if (byRole) return byRole;
  return `${firstName(lead.name)}'s team`;
}

/**
 * Effective manager of each agent: null for top-level agents, for agents whose manager is
 * missing, and for agents whose chain loops back on itself.
 */
export function effectiveManagers(agents: DepartmentAgent[]): Map<string, string | null> {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const out = new Map<string, string | null>();
  for (const a of agents) {
    const m = a.reportsTo;
    if (!m || m === a.id || !byId.has(m)) { out.set(a.id, null); continue; }
    // Walk up: if we come back to `a`, it is part of a cycle.
    const seen = new Set<string>([a.id]);
    let cur: string | null = m;
    let cycle = false;
    while (cur) {
      if (seen.has(cur)) { cycle = cur === a.id; break; }
      seen.add(cur);
      const next: string | null = byId.get(cur)?.reportsTo ?? null;
      cur = next && byId.has(next) ? next : null;
    }
    out.set(a.id, cycle ? null : m);
  }
  return out;
}

export interface DepartmentResult {
  departments: DepartmentView[];
  /** Agent id → department id (agents outside any department are absent). */
  departmentOf: Map<string, string>;
}

export function computeDepartments(agents: DepartmentAgent[], overrides: DepartmentNameOverride[] = []): DepartmentResult {
  const managers = effectiveManagers(agents);
  const children = new Map<string, DepartmentAgent[]>();
  for (const a of agents) {
    const m = managers.get(a.id);
    if (!m) continue;
    const list = children.get(m) ?? [];
    list.push(a);
    children.set(m, list);
  }
  const byName = (x: DepartmentAgent, y: DepartmentAgent) => x.name.localeCompare(y.name) || x.id.localeCompare(y.id);
  const tops = agents.filter((a) => !managers.get(a.id)).sort(byName);

  const departments: DepartmentView[] = [];
  const departmentOf = new Map<string, string>();
  for (const top of tops) {
    for (const lead of [...(children.get(top.id) ?? [])].sort(byName)) {
      const memberIds: string[] = [];
      const queue = [lead];
      const seen = new Set<string>();
      while (queue.length) {
        const cur = queue.shift()!;
        if (seen.has(cur.id)) continue;
        seen.add(cur.id);
        memberIds.push(cur.id);
        departmentOf.set(cur.id, lead.id);
        queue.push(...[...(children.get(cur.id) ?? [])].sort(byName));
      }
      departments.push({ id: lead.id, name: departmentName(lead, overrides), leadId: lead.id, memberIds });
    }
  }

  // Same name twice → "Graphics · Giulia", "Graphics · Marco".
  const counts = new Map<string, number>();
  for (const d of departments) counts.set(d.name, (counts.get(d.name) ?? 0) + 1);
  const leadName = new Map(agents.map((a) => [a.id, a.name]));
  for (const d of departments) {
    if ((counts.get(d.name) ?? 0) > 1) d.name = `${d.name} · ${firstName(leadName.get(d.leadId) ?? "")}`;
  }
  return { departments, departmentOf };
}
