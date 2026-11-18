/**
 * Stub of `@paperclipai/plugin-sdk/ui` for the visual harness (aliased at bundle time).
 * It behaves like the production host we target:
 * - `usePluginData` resolves "snapshot" and "events" (with `after` cursor) from an in-memory store;
 * - `usePluginStream` NEVER connects (the real host answers 501 on the stream bridge);
 * - a scripted sequence of worker events is pushed into the store over time; the snapshot is
 *   updated 600 ms after each event, like the worker's debounce.
 * Query string: ?fixture=busy|quiet  &eventsFail=1 (every events poll fails)
 */
import { useCallback, useEffect, useState } from "react";
import type { EventsPage, FeedRecord, PersonView, Snapshot, TaskView } from "../../src/shared/types.js";
import { busySnapshot, IDS, quietSnapshot } from "./fixtures.js";

const qs = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const FIXTURE = qs.get("fixture") ?? "busy";
const START = Date.now();

let snapshot: Snapshot = FIXTURE === "quiet" ? quietSnapshot(START) : busySnapshot(START);
const log: FeedRecord[] = [...snapshot.feed].reverse(); // oldest first

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const agent = (k: keyof typeof IDS) => ({ kind: "agent" as const, id: IDS[k] });

function patchPerson(s: Snapshot, id: string, p: Partial<PersonView>) {
  s.people = s.people.map((x) => (x.id === id ? { ...x, ...p } : x));
}
function patchTask(s: Snapshot, identifier: string, p: Partial<TaskView>, newHolder?: string) {
  s.tasks = s.tasks.map((t) => {
    if (t.identifier !== identifier) return t;
    const next = { ...t, ...p, updatedAt: iso() };
    if (newHolder) next.journey = [...t.journey, { personId: newHolder, since: iso() }];
    return next;
  });
}
const base = (n: number, title: string, group: number | null) => ({ issueId: `iss-${n}`, identifier: `FRA-${n}`, title, parentId: group === null ? null : `grp-${group}` });

interface Step { at: number; rec: Omit<FeedRecord, "id" | "at">; apply?: (s: Snapshot) => void }

const BUSY_SCRIPT: Step[] = [
  {
    at: 1200,
    rec: { kind: "handoff", ...base(62, "Pagina React dell'organigramma", 2), from: agent("jamal"), to: agent("giulia"), actor: agent("jamal"), statusFrom: "todo", statusTo: "todo" },
    apply: (s) => {
      patchTask(s, "FRA-62", { holderId: IDS.giulia }, IDS.giulia);
      patchPerson(s, IDS.jamal, { state: "idle", stateLabel: "Libero" });
      patchPerson(s, IDS.giulia, { state: "listening", stateLabel: "Ha ricevuto FRA-62" });
    },
  },
  {
    at: 2600,
    rec: { kind: "status", ...base(57, "Guida all'uso degli avatar", 0), actor: agent("laura"), statusFrom: "in_review", statusTo: "done" },
    apply: (s) => {
      patchTask(s, "FRA-57", { status: "done", progress: 100, closedAt: iso() });
      patchPerson(s, IDS.laura, { state: "success", stateLabel: "Fatto! FRA-57" });
      s.groups = s.groups.map((g) => (g.id === "grp-0" ? { ...g, childrenDone: g.childrenDone + 1, progress: Math.round(((g.childrenDone + 1) / g.childrenTotal) * 100) } : g));
    },
  },
  {
    at: 3800,
    rec: { kind: "handoff", ...base(56, "Palette uniforme per gli sfondi", 0), from: agent("martina"), to: agent("giulia"), actor: agent("martina"), statusFrom: "in_progress", statusTo: "in_review" },
    apply: (s) => {
      patchTask(s, "FRA-56", { holderId: IDS.giulia, status: "in_review", progress: 100 }, IDS.giulia);
      patchPerson(s, IDS.martina, { state: "idle", stateLabel: "Libero" });
      patchPerson(s, IDS.giulia, { state: "thinking", stateLabel: "Rivede FRA-56" });
    },
  },
  {
    at: 5000,
    rec: { kind: "progress", ...base(55, "Pose degli avatar per i reparti", 0), actor: agent("sofia"), percent: 58, note: "Fatte 7 pose su 12" },
    apply: (s) => {
      patchTask(s, "FRA-55", { progress: 58, progressNote: "Fatte 7 pose su 12" });
      patchPerson(s, IDS.sofia, { stateLabel: "Lavora su FRA-55 · 58%" });
    },
  },
  {
    at: 6200,
    rec: { kind: "run_started", actor: { ...agent("luke"), name: "Luke Sullivan" } },
  },
  {
    at: 7150,
    rec: { kind: "handoff", ...base(60, "Rotazione del log service.out", 1), from: agent("arold"), to: agent("luke"), actor: agent("arold"), statusFrom: "todo", statusTo: "in_progress" },
    apply: (s) => {
      patchTask(s, "FRA-60", { holderId: IDS.luke, status: "in_progress", progress: 40 }, IDS.luke);
      patchPerson(s, IDS.arold, { state: "idle", stateLabel: "Libero" });
      patchPerson(s, IDS.luke, { state: "listening", stateLabel: "Ha ricevuto FRA-60" });
    },
  },
];

let seq = 1000;
if (FIXTURE === "busy" && qs.get("script") !== "0") {
  for (const step of BUSY_SCRIPT) {
    setTimeout(() => {
      const rec: FeedRecord = { id: `script-${seq++}`, at: iso(), ...step.rec };
      log.push(rec);
      setTimeout(() => {
        const next = clone(snapshot);
        step.apply?.(next);
        next.feed = [...log].reverse().slice(0, 100);
        next.generatedAt = iso();
        snapshot = next;
      }, 600);
    }, step.at);
  }
}

function eventsPage(after: string | undefined): EventsPage {
  if (qs.get("eventsFail") === "1") throw new Error("Il worker non risponde");
  const list = after ? log.filter((r) => r.at > after).slice(0, 50) : log.slice(-20);
  return { records: clone(list), cursor: list.length ? list[list.length - 1]!.at : after ?? null, snapshotAt: snapshot.generatedAt };
}

function resolve(key: string, params: Record<string, unknown>): unknown {
  if (key === "snapshot") return clone(snapshot);
  if (key === "events") return eventsPage(params.after as string | undefined);
  throw new Error(`Chiave dati sconosciuta: ${key}`);
}

export function usePluginData<T = unknown>(key: string, params?: Record<string, unknown>) {
  const pkey = JSON.stringify(params ?? {});
  const [n, setN] = useState(0);
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: { code: string; message: string } | null }>({ data: null, loading: true, error: null });
  useEffect(() => {
    let dead = false;
    setState((s) => ({ ...s, loading: true }));
    const t = setTimeout(() => {
      if (dead) return;
      try {
        setState({ data: resolve(key, JSON.parse(pkey)) as T, loading: false, error: null });
      } catch (err) {
        setState({ data: null, loading: false, error: { code: "WORKER_ERROR", message: (err as Error).message } });
      }
    }, 40);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [key, pkey, n]);
  const refresh = useCallback(() => setN((x) => x + 1), []);
  return { ...state, refresh };
}

const STREAM = { events: [], lastEvent: null, connecting: false, connected: false, error: new Error('Failed to connect to plugin stream "org-flow"'), close() {} };
export function usePluginStream<T = unknown>(_channel: string, _options?: { companyId?: string }) {
  return STREAM as unknown as { events: T[]; lastEvent: T | null; connecting: boolean; connected: boolean; error: Error | null; close(): void };
}

export function usePluginAction(key: string) {
  return useCallback(async (_params?: Record<string, unknown>) => (key === "refresh" ? clone(snapshot) : { ok: true }), [key]);
}

const navigation = {
  resolveHref: (to: string) => `/FRA${to}`,
  navigate: (to: string) => console.info("[harness] navigate", to),
  linkProps: (to: string) => ({
    href: `/FRA${to}`,
    onClick: (e: { preventDefault(): void }) => {
      e.preventDefault();
      console.info("[harness] navigate", to);
    },
  }),
};
export function useHostNavigation() {
  return navigation;
}

const CONTEXT = { companyId: "co-1", companyPrefix: "FRA", projectId: null, entityId: null, entityType: null, userId: "board-1" };
export function useHostContext() {
  return CONTEXT;
}

export function useHostLocation() {
  return { pathname: qs.get("view") === "widget" ? "/FRA/dashboard" : "/FRA/org-flow", search: "", hash: "" };
}

export function usePluginToast() {
  return () => null;
}
