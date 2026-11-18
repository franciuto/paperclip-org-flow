import { describe, expect, it } from "vitest";
import { chipWidthFor, placeChips, CHIP_H, CHIP_GAP } from "../src/ui/chips.js";
import { CHIPS_TOP, effectiveParents, layoutOrg, MIN_NODE_W, NODE_ENTRY, NODE_TOP, type LayoutInput, type OrgLayout } from "../src/ui/layout.js";
import { busySnapshot, IDS } from "./ui/fixtures.js";

const agent = (id: string, reportsTo: string | null, chipCount = 0, name = id): LayoutInput => ({ id, kind: "agent", reportsTo, name, chipCount });
const user = (id: string, name = "Board"): LayoutInput => ({ id, kind: "user", reportsTo: null, name, chipCount: 0 });

/** Bounding box of a node including its chips. */
function box(l: OrgLayout, id: string) {
  const n = l.nodes[id]!;
  return { left: n.x - n.width / 2, right: n.x + n.width / 2, top: n.y - NODE_TOP, bottom: n.y + n.bottom };
}

function assertNoOverlap(l: OrgLayout) {
  const ids = l.ids;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = box(l, ids[i]!);
      const b = box(l, ids[j]!);
      const overlapX = a.left < b.right - 0.5 && b.left < a.right - 0.5;
      const overlapY = a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      expect(overlapX && overlapY, `${ids[i]} overlaps ${ids[j]}`).toBe(false);
    }
  }
}

function assertInside(l: OrgLayout) {
  for (const id of l.ids) {
    const b = box(l, id);
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeLessThanOrEqual(l.width + 0.5);
    expect(b.bottom).toBeLessThanOrEqual(l.height + 0.5);
  }
}

describe("layoutOrg", () => {
  it("lays out the real org: board on top, managers above their reports, no overlaps", () => {
    const s = busySnapshot(Date.parse("2026-11-19T15:00:00Z"));
    const counts = new Map<string, number>();
    for (const t of s.tasks) if (!t.closedAt && t.holderId) counts.set(t.holderId, (counts.get(t.holderId) ?? 0) + 1);
    const l = layoutOrg(s.people.map((p) => ({ id: p.id, kind: p.kind, reportsTo: p.reportsTo, name: p.name, chipCount: counts.get(p.id) ?? 0 })), chipWidthFor(s.tasks.map((t) => t.identifier!)));
    expect(l.nodes[IDS.board]!.depth).toBe(0);
    expect(l.nodes[IDS.laura]!.depth).toBe(1);
    expect(l.nodes[IDS.giulia]!.depth).toBe(2);
    expect(l.nodes[IDS.luke]!.depth).toBe(4);
    // parents are above children and horizontally centred over them
    expect(l.nodes[IDS.giulia]!.y).toBeGreaterThan(l.nodes[IDS.laura]!.y);
    const gx = l.nodes[IDS.giulia]!.x;
    expect(gx).toBeCloseTo((l.nodes[IDS.martina]!.x + l.nodes[IDS.sofia]!.x) / 2, 5);
    // Daniel holds 5 tasks: 3 chips + "+2 altri"
    expect(l.nodes[IDS.daniel]!.chips.slots).toHaveLength(3);
    expect(l.nodes[IDS.daniel]!.chips.more?.count).toBe(2);
    // board → laura is a dashed edge
    expect(l.edges.find((e) => e.key === "e:users")?.dashed).toBe(true);
    expect(l.edges.filter((e) => !e.dashed).length).toBeGreaterThan(0);
    assertNoOverlap(l);
    assertInside(l);
  });

  it("puts all users in the top row and links them to every top-level agent", () => {
    const l = layoutOrg([user("u1", "Anna"), user("u2", "Bruno"), agent("a", null), agent("b", null), agent("c", "a")], 80);
    expect(l.nodes.u1!.y).toBe(l.nodes.u2!.y);
    expect(l.nodes.a!.depth).toBe(1);
    expect(l.nodes.c!.depth).toBe(2);
    const users = l.edges.find((e) => e.key === "e:users")!;
    // drops to both roots
    expect(users.d).toContain(`V${Math.round((l.nodes.a!.y + NODE_ENTRY) * 10) / 10}`);
    assertNoOverlap(l);
  });

  it("treats agents with a missing manager as roots and survives reporting cycles", () => {
    const people = [agent("a", "ghost"), agent("b", "c"), agent("c", "b"), agent("d", "d"), agent("e", "a")];
    const parents = effectiveParents(people);
    expect(parents.get("a")).toBeNull();
    expect(parents.get("d")).toBeNull();
    // exactly one of b/c keeps its manager, the cycle is broken
    expect([parents.get("b"), parents.get("c")].filter((x) => x === null)).toHaveLength(1);
    const l = layoutOrg(people, 80);
    expect(Object.keys(l.nodes)).toHaveLength(5);
    assertNoOverlap(l);
    assertInside(l);
  });

  it("sizes columns from the chips so neighbours never overlap", () => {
    const chipW = chipWidthFor(["FRA-1234"]);
    const people = [agent("m", null), ...["a", "b", "c", "d"].map((k) => agent(k, "m", 4))];
    const l = layoutOrg(people, chipW);
    for (const k of ["a", "b", "c", "d"]) expect(l.nodes[k]!.width).toBeGreaterThanOrEqual(2 * chipW + CHIP_GAP);
    assertNoOverlap(l);
  });

  it("wraps a wide team of leaves into a grid with a spine", () => {
    const people = [agent("boss", null), ...Array.from({ length: 10 }, (_, i) => agent(`w${i}`, "boss", i % 3))];
    const l = layoutOrg(people, 80);
    const rows = new Set(people.slice(1).map((p) => l.nodes[p.id]!.y));
    expect(rows.size).toBe(3); // 10 leaves → 4 + 4 + 2
    expect(l.width).toBeLessThan(5 * (MIN_NODE_W + 30));
    assertNoOverlap(l);
    assertInside(l);
  });

  it("handles deep chains and many roots without overlaps", () => {
    const people: LayoutInput[] = [];
    for (let r = 0; r < 3; r++) {
      people.push(agent(`r${r}`, null, 1));
      let prev = `r${r}`;
      for (let d = 0; d < 6; d++) {
        const id = `r${r}d${d}`;
        people.push(agent(id, prev, d % 5));
        if (d % 2 === 0) people.push(agent(`${id}x`, prev, 2));
        prev = id;
      }
    }
    const l = layoutOrg(people, 90);
    expect(Math.max(...Object.values(l.nodes).map((n) => n.depth))).toBe(6);
    assertNoOverlap(l);
    assertInside(l);
  });

  it("returns a small empty canvas for an empty org", () => {
    const l = layoutOrg([], 80);
    expect(l.ids).toHaveLength(0);
    expect(l.width).toBeGreaterThan(0);
  });

  it("starts the chip block below the state label", () => {
    const l = layoutOrg([agent("a", null, 2)], 80);
    expect(l.nodes.a!.bottom).toBe(CHIPS_TOP + CHIP_H);
  });
});

describe("placeChips", () => {
  it("places up to 2 per row, centred", () => {
    const one = placeChips(1, 80);
    expect(one.slots).toEqual([{ x: -40, y: 0 }]);
    const three = placeChips(3, 80);
    expect(three.slots[0]).toEqual({ x: -82, y: 0 });
    expect(three.slots[1]).toEqual({ x: 2, y: 0 });
    expect(three.slots[2]).toEqual({ x: -40, y: CHIP_H + CHIP_GAP });
    expect(three.height).toBe(2 * CHIP_H + CHIP_GAP);
    expect(three.more).toBeNull();
  });

  it("shows 4 chips, or 3 plus '+n altri' beyond 4", () => {
    expect(placeChips(4, 80).slots).toHaveLength(4);
    const seven = placeChips(7, 80);
    expect(seven.slots).toHaveLength(3);
    expect(seven.more).toEqual({ x: 2, y: CHIP_H + CHIP_GAP, count: 4 });
  });

  it("is empty for zero tasks", () => {
    expect(placeChips(0, 80)).toEqual({ slots: [], more: null, width: 0, height: 0 });
  });

  it("chip width grows with the identifier length", () => {
    expect(chipWidthFor(["FRA-1"])).toBeLessThan(chipWidthFor(["PROJECT-12345"]));
    expect(chipWidthFor(["X".repeat(80)])).toBeLessThanOrEqual(132);
  });
});
