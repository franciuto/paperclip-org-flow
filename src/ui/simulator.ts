/**
 * Simulation mode (pure, deterministic given a seed). Ported from the prototype: it runs on top
 * of the REAL people of the snapshot (names, chain of command, characters) and invents parent
 * tasks, sub-tasks, handoffs, reviews, send-backs and blocked tasks. Nothing is written anywhere:
 * the UI just renders the fake Snapshot and FeedRecords it produces, through the same pipeline
 * as the live data (flights, flashes, feed).
 *
 * Time: one tick is one simulated minute (TICK_SIM_MS). The UI advances one tick per second.
 * `stepSimulation` mutates the state in place and returns the new records.
 */
import type {
  DepartmentView,
  FeedRecord,
  GroupView,
  OrgFlowSettings,
  Party,
  PersonView,
  Snapshot,
  TaskView,
  VisualState,
} from "../shared/types.js";
import { deriveDepartments, effectiveParents } from "./layout.js";

export const TICK_SIM_MS = 60_000;
export const SIM_SLEEP_AFTER_TICKS = 5;
const MAX_FEED = 100;

const GROUP_POOL: Array<{ title: string; color: string }> = [
  { title: "Lancio del nuovo sito", color: "oklch(58% .19 255)" },
  { title: "Identità visiva 2027", color: "oklch(62% .19 300)" },
  { title: "Infrastruttura più robusta", color: "oklch(63% .12 190)" },
  { title: "Comunicazione di fine anno", color: "oklch(71% .15 62)" },
  { title: "Knowledge base interna", color: "oklch(63% .16 145)" },
  { title: "Sicurezza degli accessi", color: "oklch(62% .2 18)" },
  { title: "Archivio dei documenti", color: "oklch(66% .15 110)" },
  { title: "Report trimestrale", color: "oklch(66% .13 215)" },
];

const TASK_POOL = [
  "Bozza della pagina principale",
  "Revisione dei testi",
  "Icone per il menu",
  "Controllo dei backup",
  "Inventario dei servizi",
  "Glossario dei termini",
  "Calendario delle uscite",
  "Copertina del documento",
  "Verifica dei permessi",
  "Riepilogo delle decisioni",
  "Schema dei flussi",
  "Prova sull'ambiente di test",
  "Pulizia delle cartelle condivise",
  "Nota per il board",
  "Aggiornamento delle dipendenze",
  "Raccolta dei feedback",
];

export interface SimTask {
  id: string;
  identifier: string;
  title: string;
  groupId: string;
  route: string[];
  idx: number;
  holder: string;
  status: string;
  progress: number;
  nextAt: number;
  bounces: number;
  journey: Array<{ personId: string; since: string }>;
  blockedFrom: string | null;
  closedAt: string | null;
  updatedAt: string;
}

export interface SimGroup {
  id: string;
  identifier: string;
  title: string;
  color: string;
  templates: string[];
  doneTick: number | null;
}

export interface SimState {
  rng: number;
  tick: number;
  startMs: number;
  settings: OrgFlowSettings;
  companyId: string;
  departments: DepartmentView[];
  people: PersonView[];
  boardId: string;
  routes: Record<string, string[]>;
  workers: string[];
  groups: SimGroup[];
  tasks: SimTask[];
  feed: FeedRecord[];
  emptySince: Record<string, number>;
  stats: Record<string, { recv: number; sent: number; closed: number }>;
  seq: { group: number; task: number; event: number; pool: number; title: number };
}

/* ---------------- rng (mulberry32, state kept in SimState) ---------------- */
function next(s: SimState): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (s: SimState, a: number, b: number) => a + Math.floor(next(s) * (b - a + 1));
const pick = <T>(s: SimState, list: T[]): T => list[Math.floor(next(s) * list.length)]!;

export const simTimeIso = (s: SimState, tick = s.tick) => new Date(s.startMs + tick * TICK_SIM_MS).toISOString();
export const simNowMs = (s: SimState) => s.startMs + s.tick * TICK_SIM_MS;

function party(s: SimState, id: string | null): Party {
  if (!id) return null;
  const p = s.people.find((x) => x.id === id);
  return p ? { kind: p.kind, id: p.id, name: p.name } : null;
}

/* ---------------- setup ---------------- */
export function createSimulation(base: Pick<Snapshot, "people" | "settings" | "companyId" | "departments">, opts: { seed?: number; nowMs: number }): SimState {
  const people = base.people.map((p) => ({ ...p }));
  let board = people.find((p) => p.kind === "user");
  if (!board) {
    board = {
      id: "user:sim-board", kind: "user", name: "Board", title: "Operatore umano", role: null, reportsTo: null,
      paletteId: null, customAvatarUrl: null, agentStatus: null, state: "idle", stateLabel: "Nessun task",
      stateSince: null, activeTaskId: null, lastActivityAt: null, stats: { received24h: 0, passed24h: 0, closed24h: 0 },
    };
    people.unshift(board);
  }
  const agents = people.filter((p) => p.kind === "agent");
  const parent = effectiveParents(people);
  const hasKids = new Set([...parent.values()].filter(Boolean) as string[]);
  const leaves = agents.filter((a) => !hasKids.has(a.id)).map((a) => a.id);
  const workers = leaves.length ? leaves : agents.map((a) => a.id);
  const routes: Record<string, string[]> = {};
  for (const w of workers) {
    const chain: string[] = [];
    let cur: string | null = w;
    while (cur && !chain.includes(cur)) {
      chain.unshift(cur);
      cur = parent.get(cur) ?? null;
    }
    routes[w] = [board.id, ...chain];
  }
  const s: SimState = {
    rng: (opts.seed ?? 42) | 0,
    tick: 0,
    startMs: Math.floor(opts.nowMs / TICK_SIM_MS) * TICK_SIM_MS,
    settings: base.settings,
    companyId: base.companyId,
    // Real departments (or derived from the chain of command, like an older worker would need)
    departments: base.departments ?? deriveDepartments(people),
    people,
    boardId: board.id,
    routes,
    workers,
    groups: [],
    tasks: [],
    feed: [],
    emptySince: Object.fromEntries(people.map((p) => [p.id, -30])),
    stats: Object.fromEntries(people.map((p) => [p.id, { recv: 0, sent: 0, closed: 0 }])),
    seq: { group: 1, task: 10, event: 1, pool: 0, title: 0 },
  };
  if (!workers.length) return s;
  for (let i = 0; i < 4; i++) addGroup(s);
  seedHistory(s);
  return s;
}

function addGroup(s: SimState): SimGroup {
  const def = GROUP_POOL[s.seq.pool++ % GROUP_POOL.length]!;
  const n = 3;
  const templates: string[] = [];
  for (let i = 0; i < n; i++) templates.push(TASK_POOL[s.seq.title++ % TASK_POOL.length]!);
  const g: SimGroup = { id: `sim-g${s.seq.group}`, identifier: `SIM-${s.seq.group++}`, title: def.title, color: def.color, templates, doneTick: null };
  s.groups.push(g);
  return g;
}

function newTask(s: SimState, g: SimGroup, tick: number): SimTask | null {
  const title = g.templates.shift();
  if (!title) return null;
  const worker = pick(s, s.workers);
  const route = s.routes[worker]!;
  const t: SimTask = {
    id: `sim-t${s.seq.task}`, identifier: `SIM-${s.seq.task++}`, title, groupId: g.id, route, idx: 0, holder: route[0]!,
    status: "todo", progress: 0, nextAt: tick + randInt(s, 1, 3), bounces: 0, journey: [{ personId: route[0]!, since: simTimeIso(s, tick) }],
    blockedFrom: null, closedAt: null, updatedAt: simTimeIso(s, tick),
  };
  s.tasks.push(t);
  return t;
}

function record(s: SimState, t: SimTask | null, rec: Omit<FeedRecord, "id" | "at">, tick = s.tick): FeedRecord {
  const g = t ? s.groups.find((x) => x.id === t.groupId) : null;
  const r: FeedRecord = {
    id: `sim-e${s.seq.event++}`,
    at: simTimeIso(s, tick),
    issueId: t?.id ?? null,
    identifier: t?.identifier ?? null,
    title: t?.title ?? null,
    parentId: g?.id ?? null,
    ...rec,
  };
  s.feed.unshift(r);
  if (s.feed.length > MAX_FEED) s.feed.length = MAX_FEED;
  return r;
}

const heldBy = (s: SimState, id: string) => s.tasks.filter((t) => !t.closedAt && t.holder === id);

/** Moves a task and records the matching event (handoff, or status change when the holder stays). */
function move(s: SimState, t: SimTask, to: string, status: string, tick = s.tick): FeedRecord {
  const from = t.holder;
  const sFrom = t.status;
  t.holder = to;
  t.status = status;
  t.updatedAt = simTimeIso(s, tick);
  let r: FeedRecord;
  if (from !== to) {
    t.journey.push({ personId: to, since: simTimeIso(s, tick) });
    s.stats[from]!.sent++;
    s.stats[to]!.recv++;
    r = record(s, t, { kind: "handoff", from: party(s, from), to: party(s, to), actor: party(s, from), statusFrom: sFrom, statusTo: status }, tick);
  } else {
    r = record(s, t, { kind: "status", actor: party(s, from), statusFrom: sFrom, statusTo: status }, tick);
  }
  if (!heldBy(s, from).length) s.emptySince[from] = tick;
  return r;
}

const reviewerOf = (t: SimTask) => t.route[t.route.length - 2] ?? t.route[t.route.length - 1]!;
const workerOf = (t: SimTask) => t.route[t.route.length - 1]!;

function close(s: SimState, t: SimTask, tick = s.tick): FeedRecord {
  const rev = t.holder;
  const sFrom = t.status;
  t.status = "done";
  t.progress = 100;
  t.closedAt = simTimeIso(s, tick);
  t.updatedAt = t.closedAt;
  s.stats[rev]!.closed++;
  if (!heldBy(s, rev).length) s.emptySince[rev] = tick;
  return record(s, t, { kind: "status", actor: party(s, rev), statusFrom: sFrom, statusTo: "done" }, tick);
}

/** A plausible "right now": tasks at different stages, with some history behind them. */
function seedHistory(s: SimState) {
  const plan: Array<{ stage: "route" | "work" | "review" | "blocked" | "done"; progress: number }> = [
    { stage: "work", progress: 45 },
    { stage: "work", progress: 72 },
    { stage: "review", progress: 100 },
    { stage: "work", progress: 30 },
    { stage: "blocked", progress: 55 },
    { stage: "route", progress: 0 },
    { stage: "work", progress: 18 },
    { stage: "route", progress: 0 },
    { stage: "work", progress: 60 },
    { stage: "done", progress: 100 },
  ];
  plan.forEach((p, i) => {
    const g = s.groups[i % s.groups.length]!;
    let at = -randInt(s, 40, 70);
    const t = newTask(s, g, at);
    if (!t) return;
    t.journey = [{ personId: t.route[0]!, since: simTimeIso(s, at) }];
    record(s, t, { kind: "created", to: party(s, t.route[0]!), statusTo: "todo" }, at);
    const last = t.route.length - 1;
    const stop = p.stage === "route" ? Math.max(1, Math.min(last, randInt(s, 1, last))) : last;
    for (let k = 1; k <= stop; k++) {
      at += randInt(s, 2, 6);
      t.idx = k;
      move(s, t, t.route[k]!, k === last ? "in_progress" : "todo", at);
    }
    if (stop < last || last === 0) t.status = last === 0 ? "in_progress" : "todo";
    t.progress = p.progress;
    if (p.stage === "review" || p.stage === "done") {
      at += randInt(s, 8, 20);
      move(s, t, reviewerOf(t), "in_review", at);
      if (p.stage === "done") close(s, t, at + 3);
    }
    if (p.stage === "blocked") {
      at += randInt(s, 5, 12);
      t.blockedFrom = workerOf(t);
      move(s, t, s.boardId, "blocked", at);
    }
    t.nextAt = randInt(s, 1, 4);
  });
  s.feed.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  for (const id of Object.keys(s.emptySince)) if (!heldBy(s, id).length) s.emptySince[id] = Math.min(s.emptySince[id]!, -randInt(s, 6, 30));
}

/* ---------------- step ---------------- */
function activeTaskOf(s: SimState, id: string): SimTask | null {
  const ip = heldBy(s, id).filter((t) => t.status === "in_progress" && workerOf(t) === id);
  if (!ip.length) return null;
  return ip.reduce((a, b) => (a.journey[a.journey.length - 1]!.since >= b.journey[b.journey.length - 1]!.since ? a : b));
}

export function stepSimulation(s: SimState): FeedRecord[] {
  const before = s.seq.event;
  s.tick++;
  if (!s.workers.length) return [];
  const tick = s.tick;
  const working = new Set<string>();
  for (const p of s.people) {
    const a = activeTaskOf(s, p.id);
    if (a) working.add(a.id);
  }
  const open = () => s.tasks.filter((t) => !t.closedAt);
  const blockedNow = open().filter((t) => t.status === "blocked").length;
  for (const t of open()) {
    if (t.status === "todo" && tick >= t.nextAt) {
      const nextIdx = Math.min(t.idx + 1, t.route.length - 1);
      const isWorker = nextIdx === t.route.length - 1;
      t.idx = nextIdx;
      move(s, t, t.route[nextIdx]!, isWorker ? "in_progress" : "todo");
      t.nextAt = tick + randInt(s, 2, 4);
    } else if (t.status === "in_progress" && working.has(t.id)) {
      t.progress = Math.min(100, t.progress + randInt(s, 2, 7));
      t.updatedAt = simTimeIso(s);
      if (t.progress >= 100) {
        move(s, t, reviewerOf(t), "in_review");
        t.nextAt = tick + randInt(s, 3, 6);
      } else if (t.progress > 25 && t.progress < 70 && blockedNow < 2 && next(s) < 0.012) {
        t.blockedFrom = t.holder;
        move(s, t, s.boardId, "blocked");
        t.nextAt = tick + randInt(s, 6, 12);
      }
    } else if (t.status === "in_review" && tick >= t.nextAt) {
      if (next(s) < (t.bounces ? 0.9 : 0.68)) {
        close(s, t);
      } else {
        t.bounces++;
        t.progress = randInt(s, 55, 78);
        move(s, t, workerOf(t), "in_progress");
      }
    } else if (t.status === "blocked" && tick >= t.nextAt) {
      move(s, t, t.blockedFrom ?? workerOf(t), "in_progress");
      t.blockedFrom = null;
    }
  }
  // Parent completion, replacement and new work
  for (const g of s.groups) {
    const gt = s.tasks.filter((t) => t.groupId === g.id);
    if (g.doneTick === null && !g.templates.length && gt.length && gt.every((t) => t.closedAt)) g.doneTick = tick;
  }
  for (let i = s.groups.length - 1; i >= 0; i--) {
    const g = s.groups[i]!;
    if (g.doneTick !== null && tick - g.doneTick > 8) {
      s.groups.splice(i, 1);
      s.tasks = s.tasks.filter((t) => t.groupId !== g.id);
      addGroup(s);
    }
  }
  if (open().length < 10 && next(s) < 0.3) {
    const cand = s.groups.filter((g) => g.doneTick === null && g.templates.length);
    if (cand.length) {
      const t = newTask(s, pick(s, cand), tick);
      if (t) record(s, t, { kind: "created", to: party(s, t.holder), statusTo: "todo" });
    }
  }
  // Closed tasks stay visible for an hour of simulated time
  s.tasks = s.tasks.filter((t) => !t.closedAt || tick * TICK_SIM_MS + s.startMs - Date.parse(t.closedAt) < 60 * TICK_SIM_MS);
  const created = s.seq.event - before;
  return s.feed.slice(0, created).reverse();
}

/* ---------------- snapshot ---------------- */
/** Visual state, with the same Italian labels as the worker (src/worker/presence.ts). */
function visual(s: SimState, p: PersonView): { state: VisualState; label: string; active: SimTask | null } {
  const held = heldBy(s, p.id);
  if (p.kind === "user") {
    if (!held.length) return { state: "idle", label: "Nessun task", active: null };
    return { state: "waiting", label: held.length === 1 ? `Da gestire: ${held[0]!.identifier}` : `${held.length} task da gestire`, active: null };
  }
  const a = activeTaskOf(s, p.id);
  if (a) return { state: "working", label: `Lavora su ${a.identifier} · ${a.progress}%`, active: a };
  const rv = held.find((t) => t.status === "in_review");
  if (rv) return { state: "thinking", label: `Revisiona ${rv.identifier}`, active: rv };
  if (held.length === 1) {
    const t = held[0]!;
    const label = t.status === "in_progress" ? `In corso: ${t.identifier} · ${t.progress}%` : t.status === "blocked" ? `Bloccato: ${t.identifier}` : `Da fare: ${t.identifier}`;
    return { state: "idle", label, active: null };
  }
  if (held.length) return { state: "idle", label: `${held.length} task da fare`, active: null };
  const idle = s.tick - (s.emptySince[p.id] ?? 0);
  if (idle >= SIM_SLEEP_AFTER_TICKS) return { state: "sleepy", label: "Dorme", active: null };
  return { state: "idle", label: "Libero", active: null };
}

export function simulationSnapshot(s: SimState): Snapshot {
  const now = simTimeIso(s);
  const people: PersonView[] = s.people.map((p) => {
    const v = visual(s, p);
    const st = s.stats[p.id] ?? { recv: 0, sent: 0, closed: 0 };
    return {
      ...p,
      agentStatus: p.kind === "agent" ? (v.state === "working" ? "running" : "idle") : null,
      state: v.state,
      stateLabel: v.label,
      stateSince: v.state === "sleepy" ? simTimeIso(s, s.emptySince[p.id] ?? 0) : null,
      activeTaskId: v.active?.id ?? null,
      stats: { received24h: st.recv, passed24h: st.sent, closed24h: st.closed },
    };
  });
  const tasks: TaskView[] = s.tasks.map((t) => ({
    id: t.id,
    identifier: t.identifier,
    title: t.title,
    status: t.status,
    priority: null,
    holderId: t.holder,
    parentId: t.groupId,
    groupId: t.groupId,
    progress: t.progress,
    progressSource: "reported",
    progressNote: null,
    updatedAt: t.updatedAt,
    bounces: t.bounces,
    journey: t.journey.map((j) => ({ ...j })),
    closedAt: t.closedAt,
  }));
  const groups: GroupView[] = s.groups.map((g) => {
    const gt = s.tasks.filter((t) => t.groupId === g.id);
    const total = gt.length + g.templates.length;
    const done = gt.filter((t) => t.closedAt).length;
    return {
      id: g.id,
      identifier: g.identifier,
      title: g.title,
      color: g.color,
      status: g.doneTick !== null ? "done" : "in_progress",
      progress: total ? Math.round((done / total) * 100) : 0,
      childrenTotal: total,
      childrenDone: done,
      holderIds: [...new Set(gt.filter((t) => !t.closedAt).map((t) => t.holder))],
      updatedAt: now,
    };
  });
  const open = tasks.filter((t) => !t.closedAt);
  return {
    companyId: s.companyId,
    generatedAt: now,
    people,
    tasks,
    groups,
    feed: s.feed.slice(),
    settings: s.settings,
    departments: s.departments,
    counts: {
      working: people.filter((p) => p.state === "working").length,
      thinking: people.filter((p) => p.state === "thinking").length,
      sleepy: people.filter((p) => p.state === "sleepy").length,
      waiting: open.filter((t) => t.holderId === s.boardId).length,
      open: open.length,
      closed24h: tasks.filter((t) => t.closedAt).length,
    },
  };
}
