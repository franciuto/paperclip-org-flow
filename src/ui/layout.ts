/**
 * Org chart layout (pure). A tidy top-down tree that works for any org:
 * - any depth and width, several roots, agents whose manager is missing (they become roots),
 *   reporting cycles (broken at the first repeated node);
 * - human users sit in their own row on top, linked to the top-level agents with dashed edges;
 * - column widths come from the content (name and task chips), so chips never overlap; the live
 *   state label is NOT part of the width (it changes every few seconds and would make the chart
 *   jitter): the renderer truncates it to the node width;
 * - a manager with more than 4 direct reports that are all leaves gets them wrapped in a grid
 *   (with a spine edge on the left), so wide teams don't make the chart endlessly wide;
 * - departments (a lead and its whole subtree) get a box drawn behind them: the layout reserves
 *   padding inside the box, a header band above the lead for the department name, and a wider gap
 *   between neighbouring departments. Edges coming from above stop at the top of the box.
 *
 * Node local coordinates (used by the SVG renderer): origin = centre of the character,
 * character image from y=-44 to y=20, name baseline at 34, state label at 49,
 * chips start at CHIPS_TOP.
 */
import { CHIP_GAP, CHIP_H, placeChips, type ChipPlacement } from "./chips.js";
import { estimateTextWidth, truncateToWidth } from "./format.js";

export const NODE_TOP = 56;          // space above the origin (halo, sparks, thought bubble)
export const NODE_BASE_BOTTOM = 56;  // below the origin when the person holds no chips
export const CHIPS_TOP = 60;         // chip block top, relative to origin
export const NODE_ENTRY = -47;       // where incoming edges end (just above the character)
export const NAME_FONT = 12.5;
export const LABEL_FONT = 10.5;
export const MAX_TEXT_W = 172;
export const MIN_NODE_W = 160;
export const H_GAP = 30;             // between sibling subtrees
export const V_GAP = 50;             // between rows (edges run in this band)
export const SPINE = 18;
export const PAD_X = 24;
export const PAD_TOP = 12;
export const PAD_BOTTOM = 24;
export const WRAP_THRESHOLD = 4;
export const DEPT_GAP = 44;          // between two neighbouring department boxes
export const DEPT_PAD_X = 22;        // inside the box, left and right
export const DEPT_PAD_BOTTOM = 18;   // inside the box, below the lowest member
export const DEPT_HEADER = 34;       // band at the top of the box for the department name
export const DEPT_LABEL_FONT = 10.5;
export const DEPT_LABEL_INSET = 14;   // label x inside the box
export const DEPT_LABEL_Y = 21;       // label baseline from the box top

export interface LayoutInput {
  id: string;
  kind: "agent" | "user";
  reportsTo: string | null;
  name: string;
  chipCount: number;
  /** Placed as a root but not linked to the users row (e.g. the "Altri" bucket). */
  detached?: boolean;
}

export interface LayoutDepartment {
  id: string;
  name: string;
  leadId: string;
  memberIds: string[];
}

export interface NodeLayout {
  id: string;
  kind: "agent" | "user";
  x: number;
  y: number;
  depth: number;
  width: number;
  bottom: number;     // local y of the bottom edge
  name: string;       // display name, truncated to fit (the state label is truncated to `width` by the renderer)
  chips: ChipPlacement;
  parentId: string | null; // effective parent used by the layout (null for roots and users)
}

export interface EdgeLayout {
  key: string;
  d: string;
  dashed: boolean;
}

export interface DepartmentBox {
  id: string;
  name: string;      // header label, truncated to the box width
  count: number;
  leadId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OrgLayout {
  nodes: Record<string, NodeLayout>;
  ids: string[];
  edges: EdgeLayout[];
  boxes: DepartmentBox[];
  width: number;
  height: number;
}

const VROOT = "\u0000root";

function wrapCols(count: number): number {
  const rows = Math.ceil(count / WRAP_THRESHOLD);
  return Math.min(WRAP_THRESHOLD, Math.ceil(count / rows));
}

/** Effective parent of every agent: manager if it exists and no cycle, otherwise null (root). */
export function effectiveParents(people: Array<Pick<LayoutInput, "id" | "kind" | "reportsTo">>): Map<string, string | null> {
  const agents = new Map(people.filter((p) => p.kind === "agent").map((p) => [p.id, p]));
  const parent = new Map<string, string | null>();
  for (const a of agents.values()) {
    const r = a.reportsTo;
    parent.set(a.id, r && r !== a.id && agents.has(r) ? r : null);
  }
  // Break cycles: walk up from every node; if we come back to a visited node, cut that link.
  for (const id of agents.keys()) {
    const seen = new Set<string>();
    let cur: string | null = id;
    while (cur) {
      if (seen.has(cur)) {
        parent.set(cur, null);
        break;
      }
      seen.add(cur);
      cur = parent.get(cur) ?? null;
    }
  }
  return parent;
}

/**
 * Departments derived from the chain of command, for workers that don't send them: the subtree
 * under each direct report of a top-level agent, named "Team di <nome>".
 */
export function deriveDepartments(people: Array<Pick<LayoutInput, "id" | "kind" | "reportsTo" | "name">>): LayoutDepartment[] {
  const parent = effectiveParents(people);
  const kids = new Map<string, string[]>();
  for (const [id, p] of parent) if (p) kids.set(p, [...(kids.get(p) ?? []), id]);
  const subtree = (id: string): string[] => [id, ...(kids.get(id) ?? []).flatMap(subtree)];
  const out: LayoutDepartment[] = [];
  for (const p of people) {
    if (p.kind !== "agent" || parent.get(p.id) !== null) continue;
    for (const lead of kids.get(p.id) ?? []) {
      const name = people.find((x) => x.id === lead)?.name ?? lead;
      out.push({ id: lead, name: `Team di ${name.trim().split(/\s+/)[0]}`, leadId: lead, memberIds: subtree(lead) });
    }
  }
  return out;
}

export function layoutOrg(people: LayoutInput[], chipW: number, departments: LayoutDepartment[] = []): OrgLayout {
  const users = people.filter((p) => p.kind === "user");
  const agents = people.filter((p) => p.kind === "agent");
  const parentOf = effectiveParents(people);

  const children = new Map<string, string[]>();
  children.set(VROOT, []);
  for (const a of agents) children.set(a.id, []);
  for (const a of agents) children.get(parentOf.get(a.id) ?? VROOT)!.push(a.id);

  // A department box is drawn around a lead's subtree. Nested leads are ignored (outer box wins).
  const deptByLead = new Map<string, LayoutDepartment>();
  for (const d of departments) if (children.has(d.leadId)) deptByLead.set(d.leadId, d);
  for (const lead of [...deptByLead.keys()]) {
    for (let p = parentOf.get(lead) ?? null; p; p = parentOf.get(p) ?? null) {
      if (deptByLead.has(p)) {
        deptByLead.delete(lead);
        break;
      }
    }
  }
  const isLead = (id: string) => deptByLead.has(id);
  const padOf = (id: string) => (isLead(id) ? DEPT_PAD_X : 0);
  const gapBetween = (a: string, b: string) => (isLead(a) || isLead(b) ? DEPT_GAP : H_GAP);

  // Node sizes
  const nodes: Record<string, NodeLayout> = {};
  for (const p of people) {
    const chips = placeChips(p.chipCount, chipW, CHIP_H, CHIP_GAP);
    const name = truncateToWidth(p.name, MAX_TEXT_W, NAME_FONT, true);
    const width = Math.ceil(Math.max(MIN_NODE_W, estimateTextWidth(name, NAME_FONT, true) + 12, chips.width + 8));
    nodes[p.id] = {
      id: p.id,
      kind: p.kind,
      x: 0,
      y: 0,
      depth: 0,
      width,
      bottom: chips.height ? CHIPS_TOP + chips.height : NODE_BASE_BOTTOM,
      name,
      chips,
      parentId: p.kind === "agent" ? parentOf.get(p.id) ?? null : null,
    };
  }

  const isLeaf = (id: string) => (children.get(id)?.length ?? 0) === 0;
  const wraps = (id: string) => {
    const k = children.get(id) ?? [];
    return k.length > WRAP_THRESHOLD && k.every(isLeaf);
  };
  const rowGaps = (kids: string[]) => kids.slice(1).reduce((s, k, i) => s + gapBetween(kids[i]!, k), 0);
  const gridCellW = (kids: string[]) => Math.max(...kids.map((k) => subW.get(k)!));
  const gridColGap = (kids: string[]) => (kids.some(isLead) ? DEPT_GAP : H_GAP);

  // Measure subtree widths (department padding included)
  const subW = new Map<string, number>();
  const measure = (id: string): number => {
    const own = id === VROOT ? 0 : nodes[id]!.width;
    const kids = children.get(id) ?? [];
    let inner = own;
    if (kids.length) {
      kids.forEach(measure);
      if (wraps(id)) {
        const cols = wrapCols(kids.length);
        inner = Math.max(own, cols * gridCellW(kids) + (cols - 1) * gridColGap(kids) + SPINE);
      } else {
        inner = Math.max(own, kids.reduce((s, k) => s + subW.get(k)!, 0) + rowGaps(kids));
      }
    }
    const w = inner + 2 * padOf(id);
    subW.set(id, w);
    return w;
  };
  measure(VROOT);

  // Horizontal placement
  const wrapRow = new Map<string, number>();
  const subLeft = new Map<string, number>();
  const place = (id: string, left: number, depth: number) => {
    subLeft.set(id, left);
    const kids = children.get(id) ?? [];
    const pad = padOf(id);
    const l = left + pad;
    const sw = subW.get(id)! - 2 * pad;
    let x = l + sw / 2;
    if (kids.length) {
      if (wraps(id)) {
        const cols = wrapCols(kids.length);
        const cellW = gridCellW(kids);
        const colGap = gridColGap(kids);
        const gridW = cols * cellW + (cols - 1) * colGap + SPINE;
        const gx = l + (sw - gridW) / 2 + SPINE;
        kids.forEach((k, i) => {
          // each cell holds the child's whole (leaf) subtree, which may include a department pad
          place(k, gx + (i % cols) * (cellW + colGap) + (cellW - subW.get(k)!) / 2, depth + 1);
          wrapRow.set(k, Math.floor(i / cols));
        });
        const row0 = kids.slice(0, cols).map((k) => nodes[k]!.x);
        x = (row0[0]! + row0[row0.length - 1]!) / 2;
      } else {
        const sum = kids.reduce((s, k) => s + subW.get(k)!, 0) + rowGaps(kids);
        let cursor = l + (sw - sum) / 2;
        kids.forEach((k, i) => {
          place(k, cursor, depth + 1);
          cursor += subW.get(k)! + (i < kids.length - 1 ? gapBetween(k, kids[i + 1]!) : 0);
        });
        x = (nodes[kids[0]!]!.x + nodes[kids[kids.length - 1]!]!.x) / 2;
      }
    }
    if (id !== VROOT) {
      nodes[id]!.x = x;
      nodes[id]!.depth = depth;
    }
  };

  const agentDepth0 = users.length ? 1 : 0;
  const forestW = subW.get(VROOT)!;
  const usersW = users.reduce((s, u) => s + nodes[u.id]!.width, 0) + Math.max(0, users.length - 1) * H_GAP;
  const innerW = Math.max(forestW, usersW, MIN_NODE_W);
  place(VROOT, PAD_X + (innerW - forestW) / 2, agentDepth0 - 1);
  {
    // Centre the users over the top-level agents (not over the whole forest), within bounds.
    const detachedIds = new Set(people.filter((p) => p.detached).map((p) => p.id));
    const row0 = children.get(VROOT)!.filter((r) => (wrapRow.get(r) ?? 0) === 0 && !detachedIds.has(r)).map((r) => nodes[r]!.x);
    const centre = row0.length ? (Math.min(...row0) + Math.max(...row0)) / 2 : PAD_X + innerW / 2;
    let cursor = Math.min(Math.max(PAD_X, centre - usersW / 2), PAD_X + innerW - usersW);
    for (const u of users) {
      const n = nodes[u.id]!;
      n.x = cursor + n.width / 2;
      n.depth = 0;
      cursor += n.width + H_GAP;
    }
  }

  // Vertical placement: one row per depth (wrapped leaves stack below their row 0). Rows that
  // contain a department lead get extra room above for the box header.
  const headRoom = (n: NodeLayout) => (isLead(n.id) ? DEPT_HEADER : 0);
  const maxDepth = people.reduce((m, p) => Math.max(m, nodes[p.id]!.depth), 0);
  const maxBottom: number[] = Array.from({ length: maxDepth + 1 }, () => NODE_BASE_BOTTOM);
  const rowHead: number[] = Array.from({ length: maxDepth + 1 }, () => 0);
  for (const p of people) {
    const n = nodes[p.id]!;
    if ((wrapRow.get(p.id) ?? 0) !== 0) continue;
    maxBottom[n.depth] = Math.max(maxBottom[n.depth]!, n.bottom);
    rowHead[n.depth] = Math.max(rowHead[n.depth]!, headRoom(n));
  }
  // Department membership (lead → whole subtree). Boxes add padding below their lowest member,
  // so the row below a row with department members must clear it.
  const deptOf = new Map<string, string>();
  for (const lead of deptByLead.keys()) {
    const walk = (id: string) => {
      deptOf.set(id, lead);
      (children.get(id) ?? []).forEach(walk);
    };
    walk(lead);
  }
  const deptBottomPad = (d: number) => (people.some((p) => nodes[p.id]!.depth === d && deptOf.has(p.id)) ? DEPT_PAD_BOTTOM : 0);
  const originY: number[] = [];
  for (let d = 0; d <= maxDepth; d++) {
    originY[d] = d === 0
      ? PAD_TOP + NODE_TOP + rowHead[0]!
      : originY[d - 1]! + maxBottom[d - 1]! + deptBottomPad(d - 1) + V_GAP + NODE_TOP + rowHead[d]!;
  }
  for (const p of people) {
    const n = nodes[p.id]!;
    if ((wrapRow.get(p.id) ?? 0) === 0) n.y = originY[n.depth]!;
  }

  const rowsOf = (id: string): NodeLayout[][] => {
    const kids = children.get(id) ?? [];
    const cols = wraps(id) ? wrapCols(kids.length) : Math.max(1, kids.length);
    const rows: NodeLayout[][] = [];
    kids.forEach((k, i) => (rows[Math.floor(i / cols)] ??= []).push(nodes[k]!));
    return rows;
  };
  const rowHeadOf = (row: NodeLayout[]) => Math.max(0, ...row.map(headRoom));
  const parentsTopDown = [VROOT, ...agents.map((a) => a.id).sort((a, b) => nodes[a]!.depth - nodes[b]!.depth)];
  for (const id of parentsTopDown) {
    const rows = rowsOf(id);
    for (let r = 1; r < rows.length; r++) {
      const prev = rows[r - 1]!;
      const prevPad = prev.some((n) => deptOf.has(n.id)) ? DEPT_PAD_BOTTOM : 0;
      const y = prev[0]!.y + Math.max(...prev.map((n) => n.bottom)) + prevPad + V_GAP + NODE_TOP + rowHeadOf(rows[r]!);
      for (const n of rows[r]!) n.y = y;
    }
  }

  // Department boxes: the subtree's horizontal slot, from the header band to the lowest member.
  const boxes: DepartmentBox[] = [];
  for (const [lead, d] of deptByLead) {
    const members = [...deptOf].filter(([, l]) => l === lead).map(([id]) => nodes[id]!);
    const leadNode = nodes[lead]!;
    const x = subLeft.get(lead)!;
    const w = subW.get(lead)!;
    const y = leadNode.y - NODE_TOP - DEPT_HEADER + 6;
    const bottom = Math.max(...members.map((m) => m.y + m.bottom)) + DEPT_PAD_BOTTOM;
    boxes.push({ id: d.id, name: d.name, count: d.memberIds.length || members.length, leadId: lead, x, y, w, h: bottom - y });
  }
  const boxOfLead = new Map(boxes.map((b) => [b.leadId, b]));

  // Edges: one bus per row, drops to every child, a spine on the left for wrapped grids.
  // A drop into a department lead stops at the top of its box.
  const edges: EdgeLayout[] = [];
  const entryY = (n: NodeLayout) => (boxOfLead.has(n.id) ? boxOfLead.get(n.id)!.y : n.y + NODE_ENTRY);
  const busOf = (row: NodeLayout[]) => Math.min(...row.map((n) => entryY(n))) - V_GAP / 2 + 4;
  const connect = (key: string, parents: NodeLayout[], rows: NodeLayout[][], dashed: boolean) => {
    if (!rows.length || !parents.length) return;
    const first = rows[0]![0]!;
    const firstLeft = boxOfLead.get(first.id)?.x ?? first.x - first.width / 2;
    const spineX = firstLeft - SPINE / 2 - 2;
    const parts: string[] = [];
    const bus0 = busOf(rows[0]!);
    for (const p of parents) parts.push(`M${r1(p.x)} ${r1(p.y + p.bottom + 3)}V${r1(bus0)}`);
    rows.forEach((row, r) => {
      const bus = busOf(row);
      const xs = row.map((n) => n.x);
      if (r === 0) xs.push(...parents.map((p) => p.x));
      if (rows.length > 1) xs.push(spineX);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      if (maxX - minX > 0.5) parts.push(`M${r1(minX)} ${r1(bus)}H${r1(maxX)}`);
      for (const n of row) parts.push(`M${r1(n.x)} ${r1(bus)}V${r1(entryY(n))}`);
    });
    if (rows.length > 1) parts.push(`M${r1(spineX)} ${r1(bus0)}V${r1(busOf(rows[rows.length - 1]!))}`);
    edges.push({ key, d: parts.join(""), dashed });
  };
  for (const a of agents) connect(`e:${a.id}`, [nodes[a.id]!], rowsOf(a.id), false);
  if (users.length) {
    const detached = new Set(people.filter((p) => p.detached).map((p) => p.id));
    const rows = rowsOf(VROOT).map((r) => r.filter((n) => !detached.has(n.id))).filter((r) => r.length);
    connect("e:users", users.map((u) => nodes[u.id]!), rows, true);
  }

  // Normalise: nothing left of PAD_X (wrapped spines can stick out a little)
  const ids = people.map((p) => p.id);
  if (!ids.length) return { nodes, ids, edges, boxes, width: 2 * PAD_X + MIN_NODE_W, height: 2 * NODE_TOP };
  let minLeft = Infinity;
  let maxRight = 0;
  let maxY = 0;
  for (const id of ids) {
    const n = nodes[id]!;
    minLeft = Math.min(minLeft, n.x - n.width / 2);
    maxRight = Math.max(maxRight, n.x + n.width / 2);
    maxY = Math.max(maxY, n.y + n.bottom);
  }
  for (const b of boxes) {
    minLeft = Math.min(minLeft, b.x);
    maxRight = Math.max(maxRight, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  const shift = minLeft < PAD_X ? PAD_X - minLeft : 0;
  if (shift) {
    for (const id of ids) nodes[id]!.x += shift;
    for (const e of edges) e.d = shiftPath(e.d, shift);
    for (const b of boxes) b.x += shift;
  }
  for (const b of boxes) {
    b.x = r1(b.x);
    b.y = r1(b.y);
    b.w = r1(b.w);
    b.h = r1(b.h);
    // Uppercase header "GRAFICA · 3"; the name is truncated so the label fits the box.
    const room = b.w - 2 * DEPT_LABEL_INSET - estimateTextWidth(` · ${b.count}`, DEPT_LABEL_FONT * 1.08, true);
    b.name = truncateToWidth(b.name.toUpperCase(), Math.max(40, room), DEPT_LABEL_FONT * 1.08, true);
  }
  return {
    nodes,
    ids,
    edges,
    boxes,
    width: Math.ceil(Math.max(maxRight + shift + PAD_X, innerW + 2 * PAD_X)),
    height: Math.ceil(maxY + PAD_BOTTOM),
  };
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Shift the x coordinates of a path made only of M x y / H x / V y commands. */
function shiftPath(d: string, dx: number): string {
  return d.replace(/([MH])(-?[\d.]+)/g, (_m, cmd: string, x: string) => `${cmd}${r1(Number(x) + dx)}`);
}
