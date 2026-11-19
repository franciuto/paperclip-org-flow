import { describe, expect, it } from "vitest";
import { computeDepartments, departmentName, effectiveManagers, type DepartmentAgent } from "../src/worker/departments.js";
import { deriveSnapshot, type AgentLite } from "../src/worker/snapshot.js";
import { DEFAULT_SETTINGS, resolveSettings, validateSettings } from "../src/worker/settings.js";

const a = (id: string, name: string, title: string | null, role: string | null, reportsTo: string | null): DepartmentAgent =>
  ({ id, name, title, role, reportsTo });

// The real org of the production instance (terminated agents excluded).
const REAL: DepartmentAgent[] = [
  a("laura", "Laura", null, "ceo", null),
  a("jamal", "Jamal Brooks", "CIO", "cto", "laura"),
  a("iris", "Iris Whitmore", "Communication Team Lead", "cmo", "laura"),
  a("giulia", "Giulia Bennett", "Graphic Team Lead", "designer", "laura"),
  a("joe", "Joe", "Librarian", "general", "laura"),
  a("martina", "Martina Hayes", "Senior Designer", "designer", "giulia"),
  a("sofia", "Sofia Carter", "Junior Designer", "designer", "giulia"),
  a("arold", "Arold Fletcher", "Head of Systems & Networking", "devops", "jamal"),
  a("luke", "Luke Sullivan", "Infrastructure Manager - Home", "devops", "arold"),
  a("daniel", "Daniel Harper", "Cloud SysAdmin", "devops", "arold"),
];

const byName = (r: ReturnType<typeof computeDepartments>) =>
  Object.fromEntries(r.departments.map((d) => [d.name, [...d.memberIds].sort()]));

describe("computeDepartments", () => {
  it("derives the departments of the real org", () => {
    const r = computeDepartments(REAL);
    expect(byName(r)).toEqual({
      Grafica: ["giulia", "martina", "sofia"],
      Comunicazione: ["iris"],
      "IT e infrastruttura": ["arold", "daniel", "jamal", "luke"],
      Libreria: ["joe"],
    });
    expect(r.departmentOf.get("laura")).toBeUndefined();
    expect(r.departmentOf.get("luke")).toBe("jamal");
    const it = r.departments.find((d) => d.leadId === "jamal")!;
    expect(it).toMatchObject({ id: "jamal", leadId: "jamal" });
    expect(it.memberIds[0]).toBe("jamal");
  });

  it("applies overrides by lead name (case-insensitive) or id", () => {
    const r = computeDepartments(REAL, [{ lead: "giulia bennett", name: "Studio grafico" }, { lead: "joe", name: "Archivio" }]);
    expect(r.departments.find((d) => d.leadId === "giulia")!.name).toBe("Studio grafico");
    expect(r.departments.find((d) => d.leadId === "joe")!.name).toBe("Archivio");
  });

  it("disambiguates duplicate names with the lead's first name", () => {
    const org = [
      a("ceo", "Capo", null, "ceo", null),
      a("g1", "Giulia Bennett", "Graphic Team Lead", null, "ceo"),
      a("g2", "Marco Rossi", "Designer", null, "ceo"),
    ];
    expect(computeDepartments(org).departments.map((d) => d.name).sort()).toEqual(["Grafica · Giulia", "Grafica · Marco"]);
  });

  it("treats missing managers and cycles as top-level", () => {
    const org = [
      a("x", "Xavier", null, null, "y"),
      a("y", "Yara", null, null, "x"),
      a("c", "Carla", "Developer", null, "x"),
      a("o", "Orfano", null, null, "gone"),
      a("p", "Pia", "Legal counsel", null, "o"),
    ];
    const m = effectiveManagers(org);
    expect(m.get("x")).toBeNull();
    expect(m.get("y")).toBeNull();
    expect(m.get("o")).toBeNull();
    expect(m.get("c")).toBe("x");
    const r = computeDepartments(org);
    expect(byName(r)).toEqual({ Sviluppo: ["c"], Legale: ["p"] });
    expect(r.departmentOf.get("x")).toBeUndefined();
  });

  it("works with no agents and with several top-level agents", () => {
    expect(computeDepartments([]).departments).toEqual([]);
    const r = computeDepartments([a("t1", "Uno", null, null, null), a("t2", "Due", null, null, null), a("s", "Sara Neri", null, null, "t2")]);
    expect(r.departments).toEqual([{ id: "s", name: "Team di Sara", leadId: "s", memberIds: ["s"] }]);
  });
});

describe("departmentName", () => {
  it("uses title keywords, then role, then 'Team di'", () => {
    expect(departmentName(a("1", "A", "Head of Finance", null, null))).toBe("Amministrazione");
    expect(departmentName(a("1", "A", "Sales Lead", null, null))).toBe("Vendite");
    expect(departmentName(a("1", "A", "HR partner", null, null))).toBe("Persone");
    expect(departmentName(a("1", "A", "Knowledge keeper", null, null))).toBe("Libreria");
    expect(departmentName(a("1", "A", "Software Engineer", null, null))).toBe("Sviluppo");
    expect(departmentName(a("1", "A", "Capo", "researcher", null))).toBe("Ricerca");
    expect(departmentName(a("1", "A", "", "cmo", null))).toBe("Comunicazione");
    expect(departmentName(a("1", "Anna Verdi", "Visionaria", "general", null))).toBe("Team di Anna");
  });
  it("does not mistake words containing 'it' or 'admin' for IT", () => {
    expect(departmentName(a("1", "A", "Editor", null, null))).toBe("Team di A");
    expect(departmentName(a("1", "A", "Cloud SysAdmin", null, null))).toBe("IT e infrastruttura");
  });
});

describe("departments in settings and snapshot", () => {
  it("resolves and validates departmentNames", () => {
    expect(resolveSettings({}).departmentNames).toEqual([]);
    expect(resolveSettings({ departmentNames: [{ lead: " Joe ", name: " Archivio " }, { lead: "", name: "x" }, "bad"] }).departmentNames)
      .toEqual([{ lead: "Joe", name: "Archivio" }]);
    expect(validateSettings({ departmentNames: [{ lead: "Joe", name: "Archivio" }] }).ok).toBe(true);
    const bad = validateSettings({ departmentNames: [{ lead: "", name: "x".repeat(61) }] });
    expect(bad.ok).toBe(false);
    expect(bad.errors).toHaveLength(2);
    expect(validateSettings({ departmentNames: "Grafica" }).ok).toBe(false);
  });

  it("sets departments and departmentId in the snapshot", () => {
    const agents: AgentLite[] = REAL.map((x) => ({
      ...x, status: "idle", paletteId: null, customAvatarAssetId: null, lastHeartbeatAt: null, pausedAt: null,
    }));
    agents.push({ ...agents[0], id: "old", name: "Vecchio", status: "terminated", reportsTo: "laura", title: "Legal" });
    const s = deriveSnapshot({
      companyId: "co",
      base: { agents, issues: [{ id: "t", identifier: "T", title: "T", status: "todo", priority: null, parentId: null, assigneeAgentId: null, assigneeUserId: "u1", createdAt: "2026-11-19T00:00:00.000Z", updatedAt: "2026-11-19T00:00:00.000Z", closedAt: null, activeRun: null }], parents: {}, children: {}, checklists: {}, builtAt: "" },
      history: [], feed: [], runs: { active: {}, last: {} }, reported: {}, lastKnown: {},
      settings: { ...DEFAULT_SETTINGS, departmentNames: [{ lead: "Iris Whitmore", name: "Social" }] }, now: Date.parse("2026-11-19T10:00:00.000Z"),
    });
    expect(s.departments!.map((d) => d.name).sort()).toEqual(["Grafica", "IT e infrastruttura", "Libreria", "Social"]);
    const dep = (id: string) => s.people.find((p) => p.id === id)!.departmentId;
    expect(dep("sofia")).toBe("giulia");
    expect(dep("luke")).toBe("jamal");
    expect(dep("laura")).toBeNull();
    expect(dep("user:u1")).toBeNull();
  });
});
