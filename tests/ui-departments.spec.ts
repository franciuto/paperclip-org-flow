import { describe, expect, it } from "vitest";
import { chipWidthFor } from "../src/ui/chips.js";
import { deriveDepartments, DEPT_GAP, layoutOrg, NODE_TOP, type LayoutDepartment, type LayoutInput, type OrgLayout } from "../src/ui/layout.js";
import { busySnapshot, DEPARTMENTS, IDS } from "./ui/fixtures.js";

const NOW = Date.parse("2026-11-19T15:00:00Z");

function realLayout(departments: LayoutDepartment[] = DEPARTMENTS) {
  const s = busySnapshot(NOW);
  const counts = new Map<string, number>();
  for (const t of s.tasks) if (!t.closedAt && t.holderId) counts.set(t.holderId, (counts.get(t.holderId) ?? 0) + 1);
  const input: LayoutInput[] = s.people.map((p) => ({ id: p.id, kind: p.kind, reportsTo: p.reportsTo, name: p.name, chipCount: counts.get(p.id) ?? 0 }));
  return { input, l: layoutOrg(input, chipWidthFor(s.tasks.map((t) => t.identifier!)), departments) };
}

const nodeBox = (l: OrgLayout, id: string) => {
  const n = l.nodes[id]!;
  return { left: n.x - n.width / 2, right: n.x + n.width / 2, top: n.y - NODE_TOP, bottom: n.y + n.bottom };
};

function checkBoxes(l: OrgLayout, departments: LayoutDepartment[]) {
  for (const b of l.boxes) {
    const d = departments.find((x) => x.leadId === b.leadId)!;
    for (const m of d.memberIds) {
      const nb = nodeBox(l, m);
      expect(nb.left, `${m} inside ${b.name}`).toBeGreaterThanOrEqual(b.x - 0.5);
      expect(nb.right).toBeLessThanOrEqual(b.x + b.w + 0.5);
      expect(nb.bottom).toBeLessThanOrEqual(b.y + b.h + 0.5);
      expect(l.nodes[m]!.y - 47).toBeGreaterThan(b.y + 20); // the header band is above the character
    }
    // people outside the department are outside its box
    for (const id of l.ids.filter((x) => !d.memberIds.includes(x))) {
      const nb = nodeBox(l, id);
      const inside = nb.left < b.x + b.w && nb.right > b.x && nb.top < b.y + b.h && nb.bottom > b.y;
      expect(inside, `${id} must not sit in ${b.name}`).toBe(false);
    }
  }
  for (let i = 0; i < l.boxes.length; i++) {
    for (let j = i + 1; j < l.boxes.length; j++) {
      const a = l.boxes[i]!;
      const b = l.boxes[j]!;
      const sepX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
      const sepY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
      expect(Math.max(sepX, sepY), `${a.name} vs ${b.name}`).toBeGreaterThanOrEqual(DEPT_GAP - 0.5);
    }
  }
  for (const b of l.boxes) {
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w).toBeLessThanOrEqual(l.width + 0.5);
    expect(b.y + b.h).toBeLessThanOrEqual(l.height + 0.5);
  }
}

describe("department boxes", () => {
  it("draws one neutral box per department, members inside, no overlaps, gaps between them", () => {
    const { l } = realLayout();
    expect(l.boxes.map((b) => [b.name, b.count])).toEqual([["GRAFICA", 3], ["COMUNICAZIONE", 1], ["IT E INFRASTRUTTURA", 4], ["LIBRERIA", 1]]);
    checkBoxes(l, DEPARTMENTS);
    // CEO and Board are not in any box
    for (const id of [IDS.laura, IDS.board]) {
      const nb = nodeBox(l, id);
      for (const b of l.boxes) expect(nb.bottom < b.y || nb.top > b.y + b.h || nb.right < b.x || nb.left > b.x + b.w).toBe(true);
    }
  });

  it("edges from the CEO run above the boxes and stop at the top centre of each lead's box", () => {
    const { l } = realLayout();
    const e = l.edges.find((x) => x.key === `e:${IDS.laura}`)!.d;
    for (const b of l.boxes) {
      const lead = l.nodes[b.leadId]!;
      expect(e).toContain(`M${Math.round(lead.x * 10) / 10} `);
      expect(e).toContain(`V${b.y}`);
    }
    const busY = Number(/M[\d.]+ ([\d.]+)H/.exec(e)![1]);
    for (const b of l.boxes) expect(busY).toBeLessThan(b.y);
  });

  it("derives the same grouping from the chain of command when the worker sends none", () => {
    const { input } = realLayout();
    const derived = deriveDepartments(input);
    expect(derived.map((d) => [d.name, [...d.memberIds].sort()])).toEqual(
      DEPARTMENTS.map((d) => [`Team di ${d.name === "Grafica" ? "Giulia" : d.name === "Comunicazione" ? "Iris" : d.name === "Libreria" ? "Joe" : "Jamal"}`, [...d.memberIds].sort()]),
    );
    const l = layoutOrg(input, 90, derived);
    expect(l.boxes).toHaveLength(4);
    checkBoxes(l, derived);
  });

  it("works for wide and deep orgs (wrapped single-member departments, nested teams)", () => {
    const agent = (id: string, reportsTo: string | null, chips = 0): LayoutInput => ({ id, kind: "agent", reportsTo, name: id, chipCount: chips });
    const people: LayoutInput[] = [{ id: "u", kind: "user", reportsTo: null, name: "Board", chipCount: 1 }, agent("ceo", null, 2)];
    for (let i = 0; i < 7; i++) people.push(agent(`solo${i}`, "ceo", i % 4)); // 7 leaves → wrapped grid
    const deps = deriveDepartments(people);
    expect(deps).toHaveLength(7);
    const l = layoutOrg(people, 90, deps);
    checkBoxes(l, deps);

    const deep: LayoutInput[] = [agent("ceo", null)];
    for (const t of ["a", "b"]) {
      deep.push(agent(t, "ceo", 1));
      for (let i = 0; i < 3; i++) {
        deep.push(agent(`${t}${i}`, t, i));
        deep.push(agent(`${t}${i}x`, `${t}${i}`, 3));
      }
    }
    const dd = deriveDepartments(deep);
    const l2 = layoutOrg(deep, 90, [...dd, { id: "a0", name: "Nested", leadId: "a0", memberIds: ["a0", "a0x"] }]);
    expect(l2.boxes).toHaveLength(2); // the nested department is ignored, the outer box wins
    checkBoxes(l2, dd);
  });

  it("without departments there are no boxes", () => {
    expect(realLayout([]).l.boxes).toHaveLength(0);
  });
});
