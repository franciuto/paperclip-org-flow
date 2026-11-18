/**
 * Org chart layout (pure). A tidy top-down tree that works for any org:
 * - any depth and width, several roots, agents whose manager is missing (they become roots),
 *   reporting cycles (broken at the first repeated node);
 * - human users sit in their own row on top, linked to the top-level agents with dashed edges;
 * - column widths come from the content (name and task chips), so chips never overlap; the live
 *   state label is NOT part of the width (it changes every few seconds and would make the chart
 *   jitter): the renderer truncates it to the node width;
 * - a manager with more than 4 direct reports that are all leaves gets them wrapped in a grid
 *   (with a spine edge on the left), so wide teams don't make the chart endlessly wide.
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
export const MIN_NODE_W = 150;
export const H_GAP = 22;
export const V_GAP = 34;
export const SPINE = 16;
export const PAD_X = 18;
export const PAD_TOP = 8;
export const PAD_BOTTOM = 16;
export const WRAP_THRESHOLD = 4;

export interface LayoutInput {
  id: string;
  kind: "agent" | "user";
  reportsTo: string | null;
  name: string;
  chipCount: number;
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

export interface OrgLayout {
  nodes: Record<string, NodeLayout>;
  ids: string[];
  edges: EdgeLayout[];
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

export function layoutOrg(people: LayoutInput[], chipW: number): OrgLayout {
  const users = people.filter((p) => p.kind === "user");
  const agents = people.filter((p) => p.kind === "agent");
  const parentOf = effectiveParents(people);

  const children = new Map<string, string[]>();
  children.set(VROOT, []);
  for (const a of agents) children.set(a.id, []);
  for (const a of agents) children.get(parentOf.get(a.id) ?? VROOT)!.push(a.id);

  // Node sizes
  const nodes: Record<string, NodeLayout> = {};
  for (const p of people) {
    const chips = placeChips(p.chipCount, chipW, CHIP_H, CHIP_GAP);
    const name = truncateToWidth(p.name, MAX_TEXT_W, NAME_FONT, true);
    const width = Math.ceil(Math.max(
      MIN_NODE_W,
      estimateTextWidth(name, NAME_FONT, true) + 8,
      chips.width + 4,
    ));
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

  // Measure subtree widths (post-order, iterative-safe via recursion depth = org depth)
  const subW = new Map<string, number>();
  const measure = (id: string): number => {
    const own = id === VROOT ? 0 : nodes[id]!.width;
    const kids = children.get(id) ?? [];
    let w = own;
    if (kids.length) {
      kids.forEach(measure);
      if (wraps(id)) {
        const cols = wrapCols(kids.length);
        const cellW = Math.max(...kids.map((k) => nodes[k]!.width));
        w = Math.max(own, cols * cellW + (cols - 1) * H_GAP + SPINE);
      } else {
        const sum = kids.reduce((s, k) => s + subW.get(k)!, 0) + (kids.length - 1) * H_GAP;
        w = Math.max(own, sum);
      }
    }
    subW.set(id, w);
    return w;
  };
  measure(VROOT);

  // Horizontal placement
  const wrapRow = new Map<string, number>();
  const place = (id: string, left: number, depth: number) => {
    const kids = children.get(id) ?? [];
    const sw = subW.get(id)!;
    let x = left + sw / 2;
    if (kids.length) {
      if (wraps(id)) {
        const cols = wrapCols(kids.length);
        const cellW = Math.max(...kids.map((k) => nodes[k]!.width));
        const gridW = cols * cellW + (cols - 1) * H_GAP + SPINE;
        const gx = left + (sw - gridW) / 2 + SPINE;
        kids.forEach((k, i) => {
          const n = nodes[k]!;
          n.x = gx + (i % cols) * (cellW + H_GAP) + cellW / 2;
          n.depth = depth + 1;
          wrapRow.set(k, Math.floor(i / cols));
        });
        const row0 = kids.slice(0, cols).map((k) => nodes[k]!.x);
        x = (row0[0]! + row0[row0.length - 1]!) / 2;
      } else {
        const sum = kids.reduce((s, k) => s + subW.get(k)!, 0) + (kids.length - 1) * H_GAP;
        let cursor = left + (sw - sum) / 2;
        for (const k of kids) {
          place(k, cursor, depth + 1);
          cursor += subW.get(k)! + H_GAP;
        }
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
    const row0 = children.get(VROOT)!.filter((r) => (wrapRow.get(r) ?? 0) === 0).map((r) => nodes[r]!.x);
    const centre = row0.length ? (Math.min(...row0) + Math.max(...row0)) / 2 : PAD_X + innerW / 2;
    let cursor = Math.min(Math.max(PAD_X, centre - usersW / 2), PAD_X + innerW - usersW);
    for (const u of users) {
      const n = nodes[u.id]!;
      n.x = cursor + n.width / 2;
      n.depth = 0;
      cursor += n.width + H_GAP;
    }
  }

  // Vertical placement: one row per depth (wrapped leaves stack below their row 0)
  const maxDepth = people.reduce((m, p) => Math.max(m, nodes[p.id]!.depth), 0);
  const maxBottom: number[] = Array.from({ length: maxDepth + 1 }, () => NODE_BASE_BOTTOM);
  for (const p of people) {
    const n = nodes[p.id]!;
    if ((wrapRow.get(p.id) ?? 0) === 0) maxBottom[n.depth] = Math.max(maxBottom[n.depth]!, n.bottom);
  }
  const originY: number[] = [];
  for (let d = 0; d <= maxDepth; d++) {
    originY[d] = d === 0 ? PAD_TOP + NODE_TOP : originY[d - 1]! + maxBottom[d - 1]! + V_GAP + NODE_TOP;
  }
  for (const p of people) {
    const n = nodes[p.id]!;
    if ((wrapRow.get(p.id) ?? 0) === 0) n.y = originY[n.depth]!;
  }

  // Wrapped rows: position rows below row 0 (top-down, so deeper rows see final parents)
  const rowsOf = (id: string): NodeLayout[][] => {
    const kids = children.get(id) ?? [];
    const cols = wraps(id) ? wrapCols(kids.length) : Math.max(1, kids.length);
    const rows: NodeLayout[][] = [];
    kids.forEach((k, i) => (rows[Math.floor(i / cols)] ??= []).push(nodes[k]!));
    return rows;
  };
  const parentsTopDown = [VROOT, ...agents.map((a) => a.id).sort((a, b) => nodes[a]!.depth - nodes[b]!.depth)];
  for (const id of parentsTopDown) {
    const rows = rowsOf(id);
    for (let r = 1; r < rows.length; r++) {
      const prev = rows[r - 1]!;
      const y = prev[0]!.y + Math.max(...prev.map((n) => n.bottom)) + V_GAP + NODE_TOP;
      for (const n of rows[r]!) n.y = y;
    }
  }

  // Edges: one bus per row, drops to every child, a spine on the left for wrapped grids
  const edges: EdgeLayout[] = [];
  const connect = (key: string, parents: NodeLayout[], rows: NodeLayout[][], dashed: boolean) => {
    if (!rows.length || !parents.length) return;
    const busOf = (row: NodeLayout[]) => row[0]!.y - NODE_TOP - V_GAP / 2 + 6;
    const first = rows[0]![0]!;
    const spineX = first.x - first.width / 2 - SPINE / 2 - 2;
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
      for (const n of row) parts.push(`M${r1(n.x)} ${r1(bus)}V${r1(n.y + NODE_ENTRY)}`);
    });
    if (rows.length > 1) parts.push(`M${r1(spineX)} ${r1(bus0)}V${r1(busOf(rows[rows.length - 1]!))}`);
    edges.push({ key, d: parts.join(""), dashed });
  };
  for (const a of agents) connect(`e:${a.id}`, [nodes[a.id]!], rowsOf(a.id), false);
  if (users.length) connect("e:users", users.map((u) => nodes[u.id]!), rowsOf(VROOT), true);

  // Normalise: make sure nothing sits left of PAD_X (wrapped spines can stick out a little)
  const ids = people.map((p) => p.id);
  let minLeft = Infinity;
  let maxRight = 0;
  let maxY = 0;
  for (const id of ids) {
    const n = nodes[id]!;
    minLeft = Math.min(minLeft, n.x - n.width / 2);
    maxRight = Math.max(maxRight, n.x + n.width / 2);
    maxY = Math.max(maxY, n.y + n.bottom);
  }
  if (!ids.length) return { nodes, ids, edges, width: 2 * PAD_X + MIN_NODE_W, height: 2 * NODE_TOP };
  const shift = minLeft < PAD_X ? PAD_X - minLeft : 0;
  if (shift) {
    for (const id of ids) nodes[id]!.x += shift;
    for (const e of edges) e.d = shiftPath(e.d, shift);
  }
  return {
    nodes,
    ids,
    edges,
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
