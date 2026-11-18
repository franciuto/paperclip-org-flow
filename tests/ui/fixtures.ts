/**
 * Fixture snapshots built from the real org of the instance (people, chain of command, palettes),
 * used by the unit tests and by the visual harness.
 * - busySnapshot: a working afternoon (parent tasks, handoffs, a blocked task waiting for the board)
 * - quietSnapshot: production at night (everything closed recently, everyone sleeping)
 */
import type { FeedRecord, GroupView, PersonView, Snapshot, TaskView, VisualState } from "../../src/shared/types.js";

export const IDS = {
  board: "user:board-1",
  laura: "e5e91e2f-ce90-446d-8357-153ae4fd23fd",
  giulia: "3f93a800-059c-4410-9f92-9a0ba43d998c",
  martina: "f931e1bf-1948-4a00-b33f-660c41b20735",
  sofia: "ef701ac8-2909-40a3-ac05-f5db223ed7f6",
  iris: "d0e66c03-c4e7-425c-a4cb-3d2e8b0ad1eb",
  jamal: "d76a085e-324e-4842-9127-abcb98060c24",
  arold: "a30edce6-66f3-48a9-95a8-91d4ea4a1a9e",
  luke: "f73bb544-4886-4373-b04e-b17023d5ae28",
  daniel: "22ea1ecf-c013-4d1c-b208-5fec9813be9a",
  joe: "ad774e83-110e-4e00-bec2-56c6b69afa0e",
} as const;
export type Who = keyof typeof IDS;

const ORG: Array<[Who, string, string | null, Who | null, string | null]> = [
  // key, name, title, reportsTo, palette
  ["board", "Board", "Operatore umano", null, null],
  ["laura", "Laura", "CEO", null, "cherry-pop"],
  ["giulia", "Giulia Bennett", "Graphic Team Lead", "laura", "golden-hour"],
  ["martina", "Martina Hayes", "Senior Designer", "giulia", "orchid-peach"],
  ["sofia", "Sofia Carter", "Junior Designer", "giulia", "pink-lemonade"],
  ["iris", "Iris Whitmore", "Communication Team Lead", "laura", "cherry-pop"],
  ["jamal", "Jamal Brooks", "CIO", "laura", "pink-lemonade"],
  ["arold", "Arold Fletcher", "Head of Systems & Networking", "jamal", "coral-current"],
  ["luke", "Luke Sullivan", "Infrastructure Manager - Home", "arold", "lime-lagoon"],
  ["daniel", "Daniel Harper", "Cloud SysAdmin", "arold", "tangerine-cobalt"],
  ["joe", "Joe", "Librarian", "laura", "violet-ember"],
];

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

function person(key: Who, state: VisualState, label: string, now: number, extra: Partial<PersonView> = {}): PersonView {
  const [, name, title, reportsTo, palette] = ORG.find((o) => o[0] === key)!;
  const isUser = key === "board";
  return {
    id: IDS[key],
    kind: isUser ? "user" : "agent",
    name,
    title,
    role: null,
    reportsTo: reportsTo ? IDS[reportsTo] : null,
    paletteId: palette,
    customAvatarUrl: null,
    agentStatus: isUser ? null : state === "working" ? "running" : "idle",
    state,
    stateLabel: label,
    stateSince: iso(now - 4 * MIN),
    activeTaskId: null,
    lastActivityAt: iso(now - 3 * MIN),
    stats: { received24h: 0, passed24h: 0, closed24h: 0 },
    ...extra,
  };
}

export const GROUP_COLORS = ["oklch(62% .19 300)", "oklch(63% .12 190)", "oklch(58% .19 255)", "oklch(71% .15 62)", "oklch(63% .16 145)"];

interface TaskSpec {
  n: number;
  title: string;
  group: number | null;
  route: Who[];
  status: string;
  progress: number;
  startMin: number; // minutes ago the task was created
  closedMin?: number;
  bounces?: number;
  source?: TaskView["progressSource"];
  note?: string;
}

function buildTasks(specs: TaskSpec[], now: number): { tasks: TaskView[]; feed: FeedRecord[] } {
  const tasks: TaskView[] = [];
  const feed: FeedRecord[] = [];
  let ev = 1;
  for (const s of specs) {
    const id = `iss-${s.n}`;
    const identifier = `FRA-${s.n}`;
    const parentId = s.group === null ? null : `grp-${s.group}`;
    const step = s.route.length > 1 ? Math.max(1, Math.floor((s.startMin - (s.closedMin ?? 2)) / s.route.length)) : 1;
    const journey = s.route.map((w, i) => ({ personId: IDS[w], since: iso(now - (s.startMin - i * step) * MIN) }));
    const base = { issueId: id, identifier, title: s.title, parentId };
    feed.push({ id: `ev-${ev++}`, at: journey[0]!.since, kind: "created", ...base, to: { kind: s.route[0] === "board" ? "user" : "agent", id: s.route[0] === "board" ? "board-1" : IDS[s.route[0]!], name: undefined }, statusTo: "todo" });
    for (let i = 1; i < s.route.length; i++) {
      const fromW = s.route[i - 1]!;
      const toW = s.route[i]!;
      const party = (w: Who) => (w === "board" ? { kind: "user" as const, id: "board-1" } : { kind: "agent" as const, id: IDS[w] });
      const last = i === s.route.length - 1;
      feed.push({
        id: `ev-${ev++}`,
        at: journey[i]!.since,
        kind: "handoff",
        ...base,
        from: party(fromW),
        to: party(toW),
        actor: party(fromW),
        statusFrom: "todo",
        statusTo: last ? (s.status === "done" ? "in_review" : s.status) : "todo",
      });
    }
    if (s.closedMin !== undefined) {
      const last = s.route[s.route.length - 1]!;
      feed.push({ id: `ev-${ev++}`, at: iso(now - s.closedMin * MIN), kind: "status", ...base, actor: { kind: "agent", id: IDS[last] }, statusFrom: "in_review", statusTo: "done" });
    }
    tasks.push({
      id,
      identifier,
      title: s.title,
      status: s.status,
      priority: s.n % 5 === 0 ? "high" : "medium",
      holderId: IDS[s.route[s.route.length - 1]!],
      parentId,
      groupId: parentId ?? "standalone",
      progress: s.progress,
      progressSource: s.source ?? (s.status === "todo" ? "status" : "reported"),
      progressNote: s.note ?? null,
      updatedAt: iso(now - (s.closedMin ?? 2) * MIN),
      bounces: s.bounces ?? 0,
      journey,
      closedAt: s.closedMin !== undefined ? iso(now - s.closedMin * MIN) : null,
    });
  }
  feed.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return { tasks, feed };
}

function groupsFor(tasks: TaskView[], defs: Array<[number, number, string, number?]>, now: number, closed = false): GroupView[] {
  return defs.map(([g, n, title, doneBefore = 0], i) => {
    const kids = tasks.filter((t) => t.groupId === `grp-${g}`);
    // doneBefore: children closed long ago (no longer in the snapshot's task list)
    const total = kids.length + doneBefore;
    const done = kids.filter((t) => t.status === "done").length + doneBefore;
    return {
      id: `grp-${g}`,
      identifier: `FRA-${n}`,
      title,
      color: GROUP_COLORS[i % GROUP_COLORS.length]!,
      status: closed ? "done" : "in_progress",
      progress: total ? Math.round((done / total) * 100) : 0,
      childrenTotal: total,
      childrenDone: done,
      holderIds: [...new Set(kids.filter((t) => t.status !== "done").map((t) => t.holderId!))],
      updatedAt: iso(now - 5 * MIN),
    };
  });
}

const SETTINGS = { sleepAfterMinutes: 15, keepClosedHours: 24, enableSimulation: true };

export function busySnapshot(now = Date.now()): Snapshot {
  const B: Who = "board";
  const L: Who = "laura";
  const { tasks, feed } = buildTasks(
    [
      { n: 55, title: "Pose degli avatar per i reparti", group: 0, route: [B, L, "giulia", "sofia"], status: "in_progress", progress: 45, startMin: 62 },
      { n: 56, title: "Palette uniforme per gli sfondi", group: 0, route: [B, L, "giulia", "martina"], status: "in_progress", progress: 72, startMin: 55, source: "checklist" },
      { n: 57, title: "Guida all'uso degli avatar", group: 0, route: [B, L, "giulia", L], status: "in_review", progress: 100, startMin: 70, bounces: 1 },
      { n: 58, title: "Backup di Postgres fuori dalla microSD", group: 1, route: [B, L, "jamal", "arold", "daniel"], status: "in_progress", progress: 30, startMin: 48, note: "Script pronto, manca la prova di ripristino" },
      { n: 59, title: "Aggiornare Paperclip alla 2026.1106.0", group: 1, route: [B, L, "jamal", "arold", "luke", B], status: "blocked", progress: 55, startMin: 66 },
      { n: 60, title: "Rotazione del log service.out", group: 1, route: [B, L, "jamal", "arold"], status: "todo", progress: 5, startMin: 30 },
      { n: 61, title: "Worker del plugin: eventi e stream", group: 2, route: [B, L, "jamal", "daniel"], status: "in_progress", progress: 18, startMin: 40 },
      { n: 62, title: "Pagina React dell'organigramma", group: 2, route: [B, L, "jamal"], status: "todo", progress: 5, startMin: 20 },
      { n: 63, title: "Newsletter di dicembre", group: 3, route: [B, L, "iris"], status: "in_progress", progress: 60, startMin: 58 },
      { n: 64, title: "Post LinkedIn sul nuovo homelab", group: 3, route: [B, L, "giulia"], status: "todo", progress: 5, startMin: 25 },
      { n: 65, title: "Indice della knowledge base homelab", group: 4, route: [B, L, "joe"], status: "done", progress: 100, startMin: 90, closedMin: 22 },
      { n: 66, title: "Allarme sulla temperatura di ai-pi", group: 1, route: [B, L, "jamal", "arold", "daniel"], status: "todo", progress: 5, startMin: 35 },
      { n: 67, title: "Certificati TLS in scadenza", group: null, route: [B, L, "jamal", "arold", "daniel"], status: "todo", progress: 5, startMin: 28 },
      { n: 68, title: "Pulizia dei container fermi", group: 1, route: [B, L, "jamal", "arold", "daniel"], status: "backlog", progress: 0, startMin: 26 },
    ],
    now,
  );
  const groups = groupsFor(tasks, [[0, 50, "Nuova identità visiva degli agenti", 2], [1, 51, "Homelab più robusto", 3], [2, 52, "Lancio del plugin Org Flow", 1], [3, 53, "Comunicazione di dicembre", 2], [4, 54, "Knowledge base dell'infrastruttura", 3]], now);
  groups.push({
    id: "standalone", identifier: null, title: "Senza padre", color: "oklch(62% 0 0)", status: null, progress: 0,
    childrenTotal: 1, childrenDone: 0, holderIds: [IDS.daniel], updatedAt: iso(now - 28 * MIN),
  });
  const people: PersonView[] = [
    person("board", "waiting", "Ti aspetta FRA-59", now),
    person("laura", "thinking", "Rivede FRA-57", now, { stats: { received24h: 9, passed24h: 8, closed24h: 2 } }),
    person("giulia", "idle", "Smista FRA-64", now, { stats: { received24h: 4, passed24h: 3, closed24h: 0 } }),
    person("martina", "working", "Lavora su FRA-56 · 72%", now, { activeTaskId: "iss-56", stats: { received24h: 1, passed24h: 0, closed24h: 1 } }),
    person("sofia", "working", "Lavora su FRA-55 · 45%", now, { activeTaskId: "iss-55", stats: { received24h: 1, passed24h: 0, closed24h: 0 } }),
    person("iris", "working", "Lavora su FRA-63 · 60%", now, { activeTaskId: "iss-63" }),
    person("jamal", "idle", "Smista FRA-62", now, { stats: { received24h: 6, passed24h: 5, closed24h: 0 } }),
    person("arold", "idle", "Smista FRA-60", now),
    person("luke", "sleepy", "Dorme da 12 min", now),
    person("daniel", "working", "Lavora su FRA-58 · 30%", now, { activeTaskId: "iss-58", stats: { received24h: 5, passed24h: 0, closed24h: 1 } }),
    person("joe", "sleepy", "Dorme da 20 min", now, { stats: { received24h: 1, passed24h: 0, closed24h: 1 } }),
  ];
  feed.unshift({ id: "ev-run-1", at: iso(now - 1 * MIN), kind: "run_started", actor: { kind: "agent", id: IDS.daniel, name: "Daniel Harper" }, issueId: "iss-58", identifier: "FRA-58", title: "Backup di Postgres fuori dalla microSD", parentId: "grp-1" });
  feed.unshift({ id: "ev-prog-1", at: iso(now - 0.5 * MIN), kind: "progress", actor: { kind: "agent", id: IDS.martina }, percent: 72, note: "Palette chiara pronta, manca la scura", issueId: "iss-56", identifier: "FRA-56", title: "Palette uniforme per gli sfondi", parentId: "grp-0" });
  const open = tasks.filter((t) => !t.closedAt);
  return {
    companyId: "co-1",
    generatedAt: iso(now),
    people,
    tasks,
    groups,
    feed: feed.slice(0, 100),
    settings: SETTINGS,
    counts: { working: 4, thinking: 1, sleepy: 2, waiting: 1, open: open.length, closed24h: 1 },
  };
}

export function quietSnapshot(now = Date.now()): Snapshot {
  const B: Who = "board";
  const L: Who = "laura";
  const H = 60;
  const { tasks, feed } = buildTasks(
    [
      { n: 41, title: "Inventario delle porte su home-pi", group: 0, route: [B, L, "jamal", "arold", "luke"], status: "done", progress: 100, startMin: 9 * H, closedMin: 1.5 * H },
      { n: 42, title: "Glossario dei servizi di ai-pi", group: 1, route: [B, L, "joe"], status: "done", progress: 100, startMin: 8 * H, closedMin: 3 * H },
      { n: 43, title: "Icone di stato per gli agenti", group: 2, route: [B, L, "giulia", "sofia"], status: "done", progress: 100, startMin: 10 * H, closedMin: 4.2 * H },
      { n: 44, title: "Calendario editoriale di gennaio", group: 3, route: [B, L, "iris"], status: "done", progress: 100, startMin: 11 * H, closedMin: 6 * H },
      { n: 45, title: "Allarme sulla temperatura di ai-pi", group: 0, route: [B, L, "jamal", "arold", "daniel"], status: "done", progress: 100, startMin: 12 * H, closedMin: 7.5 * H },
    ],
    now,
  );
  const groups = groupsFor(tasks, [[0, 40, "Homelab più robusto"], [1, 39, "Knowledge base dell'infrastruttura"], [2, 38, "Nuova identità visiva"], [3, 37, "Comunicazione di gennaio"]], now, true);
  const sleepy = (k: Who, mins: number, closed = 0) =>
    person(k, "sleepy", `Dorme da ${mins >= 60 ? `${Math.floor(mins / 60)} h` : `${mins} min`}`, now, { agentStatus: "idle", stats: { received24h: closed, passed24h: 0, closed24h: closed } });
  const people: PersonView[] = [
    person("board", "idle", "Nessuna richiesta", now),
    sleepy("laura", 85),
    sleepy("giulia", 240),
    sleepy("martina", 300),
    sleepy("sofia", 250, 1),
    sleepy("iris", 360, 1),
    sleepy("jamal", 90),
    sleepy("arold", 90),
    sleepy("luke", 92, 1),
    sleepy("daniel", 450, 1),
    sleepy("joe", 180, 1),
  ];
  feed.unshift({ id: "ev-run-q1", at: iso(now - 80 * MIN), kind: "run_finished", actor: { kind: "agent", id: IDS.laura, name: "Laura" } });
  return {
    companyId: "co-1",
    generatedAt: iso(now),
    people,
    tasks,
    groups,
    feed: feed.slice(0, 100),
    settings: SETTINGS,
    counts: { working: 0, thinking: 0, sleepy: 10, waiting: 0, open: 0, closed24h: 5 },
  };
}
