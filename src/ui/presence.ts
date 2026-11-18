/**
 * Live "presence" handling (pure). When a feed record arrives the UI reacts immediately,
 * without waiting for the next snapshot:
 * - flashes: short-lived visual state overrides on people (received → listening,
 *   done → success, sent back / failed → confused, run started → working);
 * - task overrides: the task jumps to its new holder / status / percent until a snapshot
 *   generated after the event replaces it;
 * - flights: a handoff between two people on the chart makes the chip fly.
 */
import type { FeedRecord, Party, PersonView, TaskView, VisualState } from "../shared/types.js";

export const FLASH_MS = 4200;
export const SUCCESS_FLASH_MS = 5200;
export const WORKING_FLASH_MS = 45_000;
export const OVERRIDE_MAX_MS = 45_000;
export const FLIGHT_MS = 1100;

export interface Flash {
  personId: string;
  /** null clears any flash on that person (e.g. run finished). */
  state: VisualState | null;
  label: string;
  from: number; // epoch ms, active from
  until: number; // epoch ms, active until
}

export interface TaskOverride {
  taskId: string;
  holderId?: string | null;
  status?: string;
  progress?: number;
  /** Record time (ISO): a snapshot generated at or after this already contains the change. */
  at: string;
  expires: number;
}

export interface Flight {
  key: string;
  taskId: string;
  fromId: string;
  toId: string;
  color: string;
  code: string;
  start: number;
}

export interface RecordEffects {
  flashes: Flash[];
  override: TaskOverride | null;
  flight: { taskId: string; fromId: string; toId: string } | null;
}

/** Resolve a feed party to a person id of the snapshot (users are `user:<id>` there). */
export function resolveParty(party: Party | undefined, people: Pick<PersonView, "id" | "kind">[]): string | null {
  if (!party) return null;
  const ids = new Set(people.map((p) => p.id));
  if (ids.has(party.id)) return party.id;
  if (party.kind === "user" && ids.has(`user:${party.id}`)) return `user:${party.id}`;
  return null;
}

export function findTask(rec: Pick<FeedRecord, "issueId" | "identifier">, tasks: TaskView[]): TaskView | null {
  if (rec.issueId) {
    const t = tasks.find((x) => x.id === rec.issueId);
    if (t) return t;
  }
  if (rec.identifier) return tasks.find((x) => x.identifier === rec.identifier) ?? null;
  return null;
}

const isSendBack = (from?: string | null, to?: string | null) =>
  from === "in_review" && (to === "in_progress" || to === "todo" || to === "backlog");

/** What a single record should do to the view right now. `flightMs` delays the receiver's flash. */
export function effectsOfRecord(
  rec: FeedRecord,
  people: PersonView[],
  tasks: TaskView[],
  nowMs: number,
  flightMs = FLIGHT_MS,
): RecordEffects {
  const out: RecordEffects = { flashes: [], override: null, flight: null };
  const task = findTask(rec, tasks);
  const code = rec.identifier ?? task?.identifier ?? "un task";
  const kindOf = (id: string) => people.find((p) => p.id === id)?.kind ?? "agent";
  const flash = (personId: string | null, state: VisualState | null, label: string, delay = 0, ms = FLASH_MS) => {
    if (!personId) return;
    if (kindOf(personId) === "user" && state !== null && state !== "waiting") return;
    out.flashes.push({ personId, state, label, from: nowMs + delay, until: nowMs + delay + ms });
  };
  const expires = nowMs + OVERRIDE_MAX_MS;

  switch (rec.kind) {
    case "handoff": {
      const fromId = resolveParty(rec.from, people);
      const toId = resolveParty(rec.to, people);
      if (task) {
        out.override = { taskId: task.id, holderId: rec.to === undefined ? undefined : toId, at: rec.at, expires };
        if (rec.statusTo) out.override.status = rec.statusTo;
      }
      const flies = !!(task && fromId && toId && fromId !== toId);
      if (flies) out.flight = { taskId: task!.id, fromId: fromId!, toId: toId! };
      const delay = flies ? flightMs : 0;
      if (toId && kindOf(toId) === "user") flash(toId, "waiting", `Ti aspetta ${code}`, delay);
      else if (isSendBack(rec.statusFrom, rec.statusTo)) flash(toId, "confused", `Rimandato indietro ${code}`, delay);
      else if (rec.statusTo === "in_review") flash(toId, "listening", `Da rivedere: ${code}`, delay);
      else flash(toId, "listening", `Ha ricevuto ${code}`, delay);
      break;
    }
    case "status": {
      if (task && rec.statusTo) {
        out.override = { taskId: task.id, status: rec.statusTo, at: rec.at, expires };
        if (rec.statusTo === "done") out.override.progress = 100;
      }
      const holder = task?.holderId ?? resolveParty(rec.actor, people);
      if (rec.statusTo === "done") {
        flash(holder, "success", `Fatto! ${code}`, 0, SUCCESS_FLASH_MS);
        const actor = resolveParty(rec.actor, people);
        if (actor && actor !== holder) flash(actor, "success", `Ha approvato ${code}`, 0, SUCCESS_FLASH_MS);
      } else if (isSendBack(rec.statusFrom, rec.statusTo)) flash(holder, "confused", `Rimandato indietro ${code}`);
      else if (rec.statusTo === "blocked") flash(holder, "confused", `Bloccato su ${code}`);
      else if (rec.statusTo === "in_review") flash(holder, "thinking", `Rivede ${code}`);
      break;
    }
    case "created": {
      const toId = resolveParty(rec.to, people);
      if (toId && kindOf(toId) === "user") flash(toId, "waiting", `Nuovo task: ${code}`);
      else flash(toId, "listening", `Nuovo task: ${code}`);
      break;
    }
    case "run_started": {
      const id = resolveParty(rec.actor, people);
      const label = task ? `Lavora su ${code}` : "Al lavoro";
      flash(id, "working", label, 0, WORKING_FLASH_MS);
      break;
    }
    case "run_finished":
      flash(resolveParty(rec.actor, people), null, "", 0, 0);
      break;
    case "run_failed":
      flash(resolveParty(rec.actor, people), "confused", "Run non riuscito");
      break;
    case "progress": {
      if (task && rec.percent != null) {
        out.override = { taskId: task.id, progress: Math.max(0, Math.min(100, Math.round(rec.percent))), at: rec.at, expires };
      }
      break;
    }
    default:
      break;
  }
  return out;
}

/** Merge new flashes into the current list: a newer flash replaces older ones for the same person. */
export function mergeFlashes(current: Flash[], incoming: Flash[], nowMs: number): Flash[] {
  let list = current.filter((f) => f.until > nowMs);
  for (const f of incoming) {
    list = list.filter((x) => x.personId !== f.personId || x.from > f.from);
    if (f.state !== null && f.until > nowMs) list.push(f);
  }
  return list;
}

export function activeFlash(flashes: Flash[], personId: string, nowMs: number): Flash | null {
  let best: Flash | null = null;
  for (const f of flashes) {
    if (f.personId !== personId || f.from > nowMs || f.until <= nowMs) continue;
    if (!best || f.from >= best.from) best = f;
  }
  return best;
}

/** People with their state replaced by the active flash, if any. */
export function applyFlashes(people: PersonView[], flashes: Flash[], nowMs: number): PersonView[] {
  if (!flashes.length) return people;
  return people.map((p) => {
    const f = activeFlash(flashes, p.id, nowMs);
    return f && f.state ? { ...p, state: f.state, stateLabel: f.label || p.stateLabel } : p;
  });
}

/** Earliest future moment at which a flash starts or ends (to schedule a re-render). */
export function nextFlashChange(flashes: Flash[], nowMs: number): number | null {
  let next: number | null = null;
  for (const f of flashes) {
    for (const t of [f.from, f.until]) if (t > nowMs && (next === null || t < next)) next = t;
  }
  return next;
}

/** Drop overrides that the snapshot already contains (generated after the event) or that expired. */
export function pruneOverrides(overrides: TaskOverride[], snapshotGeneratedAt: string | null, nowMs: number): TaskOverride[] {
  const gen = snapshotGeneratedAt ? Date.parse(snapshotGeneratedAt) : NaN;
  return overrides.filter((o) => o.expires > nowMs && !(Number.isFinite(gen) && gen >= Date.parse(o.at)));
}

export function applyOverrides(tasks: TaskView[], overrides: TaskOverride[]): TaskView[] {
  if (!overrides.length) return tasks;
  const byTask = new Map<string, TaskOverride[]>();
  for (const o of overrides) {
    const list = byTask.get(o.taskId) ?? [];
    list.push(o);
    byTask.set(o.taskId, list);
  }
  return tasks.map((t) => {
    const list = byTask.get(t.id);
    if (!list) return t;
    const next = { ...t };
    for (const o of [...list].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
      if (o.holderId !== undefined && o.holderId !== next.holderId) {
        next.holderId = o.holderId;
        if (o.holderId) next.journey = [...next.journey, { personId: o.holderId, since: o.at }];
      }
      if (o.status !== undefined) next.status = o.status;
      if (o.progress !== undefined) next.progress = o.progress;
    }
    return next;
  });
}

/** Short Italian sentence for a feed record, used in aria-labels and tests. */
export function describeRecord(rec: FeedRecord, nameOf: (p: Party | undefined) => string): string {
  const from = nameOf(rec.from);
  const to = nameOf(rec.to);
  const actor = nameOf(rec.actor);
  switch (rec.kind) {
    case "handoff":
      if (isSendBack(rec.statusFrom, rec.statusTo)) return `${from} ha rimandato indietro il task a ${to}`;
      if (rec.statusTo === "in_review") return `${from} ha passato il task a ${to} da rivedere`;
      if (rec.statusTo === "blocked") return `${from} chiede una decisione a ${to}`;
      return `${from} ha passato il task a ${to}`;
    case "status":
      return `Stato cambiato da ${actor}`;
    case "created":
      return rec.to ? `Nuovo task assegnato a ${to}` : "Nuovo task";
    case "run_started":
      return `${actor} ha iniziato a lavorare`;
    case "run_finished":
      return `${actor} ha finito il run`;
    case "run_failed":
      return `Run di ${actor} non riuscito`;
    case "progress":
      return `${actor} è al ${rec.percent ?? 0}%`;
    case "ping":
      return "Evento di prova";
    default:
      return "Evento";
  }
}
