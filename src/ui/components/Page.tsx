import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHostNavigation, type PluginPageProps } from "@paperclipai/plugin-sdk/ui";
import { STANDALONE_COLOR, type FeedRecord, type PersonView, type Snapshot, type TaskView } from "../../shared/types.js";
import { chipWidthFor } from "../chips.js";
import { clockTime, relativeTime, taskCode } from "../format.js";
import { useNow, usePrefersReducedMotion, useSimulation } from "../hooks.js";
import { layoutOrg } from "../layout.js";
import { activeGroups, CONNECTION_LABEL, heldByPerson, isOpenTask, liveCounts, mergeFeed, recentlyClosed, sortGroups, touchedBy } from "../model.js";
import {
  applyFlashes,
  applyOverrides,
  effectsOfRecord,
  findTask,
  FLIGHT_MS,
  mergeFlashes,
  nextFlashChange,
  pruneOverrides,
  type Flash,
  type Flight,
  type TaskOverride,
} from "../presence.js";
import { useStyles } from "../styles.js";
import { useLiveOrgFlow } from "../useLive.js";
import { OrgChart, StatusGlyph, type Selection } from "./OrgChart.js";
import { ActivityFeed, KpiStrip, ParentStrip, PersonCard, QuietStrip, TaskCard, type FeedContext } from "./Panels.js";

const FRESH_MS = 2600;

export function OrgFlowPage({ context }: PluginPageProps) {
  useStyles();
  const companyId = context.companyId ?? undefined;
  const nav = useHostNavigation();
  const reduced = usePrefersReducedMotion();
  const realNow = useNow(30_000);
  const [, setTick] = useState(0);

  const [simOn, setSimOn] = useState(false);
  const simRef = useRef(simOn);
  simRef.current = simOn;
  const [liveExtra, setLiveExtra] = useState<FeedRecord[]>([]);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [flashes, setFlashes] = useState<Flash[]>([]);
  const [overrides, setOverrides] = useState<TaskOverride[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [sel, setSel] = useState<Selection | null>(null);
  const [focusGroup, setFocusGroup] = useState<string | null>(null);

  // Latest displayed people/tasks, read by the record handler (which runs outside render).
  const viewRef = useRef<{ people: PersonView[]; tasks: TaskView[]; colorOf: (groupId: string) => string }>({ people: [], tasks: [], colorOf: () => STANDALONE_COLOR });
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  const freshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRecords = useCallback((source: "live" | "sim", records: FeedRecord[], animate: boolean) => {
    if (source === "live") setLiveExtra((prev) => mergeFeed([...records].reverse(), prev));
    if ((source === "sim") !== simRef.current || !animate || !records.length) return;
    const now = Date.now();
    const view = viewRef.current;
    const newFlashes: Flash[] = [];
    const newOverrides: TaskOverride[] = [];
    const newFlights: Flight[] = [];
    let tasks = view.tasks;
    for (const rec of records) {
      const fx = effectsOfRecord(rec, view.people, tasks, now, reducedRef.current ? 0 : FLIGHT_MS);
      newFlashes.push(...fx.flashes);
      if (fx.override) {
        newOverrides.push(fx.override);
        tasks = applyOverrides(tasks, [fx.override]);
      }
      if (fx.flight && !reducedRef.current) {
        const t = tasks.find((x) => x.id === fx.flight!.taskId);
        const flight: Flight = { key: `${rec.id}`, ...fx.flight, color: view.colorOf(t?.groupId ?? ""), code: t ? taskCode(t) : rec.identifier ?? "", start: now };
        for (let i = newFlights.length - 1; i >= 0; i--) if (newFlights[i]!.taskId === flight.taskId) newFlights.splice(i, 1);
        newFlights.push(flight);
      }
    }
    if (newFlashes.length) setFlashes((prev) => mergeFlashes(prev, newFlashes, now));
    if (newOverrides.length) setOverrides((prev) => [...prev, ...newOverrides]);
    if (newFlights.length) {
      const ids = new Set(newFlights.map((f) => f.taskId));
      setFlights((prev) => [...prev.filter((f) => !ids.has(f.taskId)), ...newFlights]);
    }
    setFresh((prev) => new Set([...prev, ...records.map((r) => r.id)]));
    if (freshTimer.current) clearTimeout(freshTimer.current);
    freshTimer.current = setTimeout(() => setFresh(new Set()), FRESH_MS);
  }, []);
  useEffect(() => () => { if (freshTimer.current) clearTimeout(freshTimer.current); }, []);

  const live = useLiveOrgFlow(companyId, useCallback((r: FeedRecord[], animate: boolean) => handleRecords("live", r, animate), [handleRecords]), { forceRefresh: !simOn });
  const simSnap = useSimulation(simOn, live.snapshot, useCallback((r: FeedRecord[]) => handleRecords("sim", r, true), [handleRecords]));

  // Mode switch: start from a clean slate
  useEffect(() => {
    setFlashes([]);
    setOverrides([]);
    setFlights([]);
    setSel(null);
    setFocusGroup(null);
    setFresh(new Set());
  }, [simOn]);

  const base: Snapshot | null = simOn ? simSnap : live.snapshot;
  const nowMs = Date.now();
  const displayNow = simOn && simSnap ? Date.parse(simSnap.generatedAt) : Math.max(realNow, nowMs);

  // Re-render exactly when a flash starts/ends
  useEffect(() => {
    const at = nextFlashChange(flashes, Date.now());
    if (at === null) return;
    const id = setTimeout(() => {
      setFlashes((prev) => prev.filter((f) => f.until > Date.now()));
      setTick((n) => n + 1);
    }, Math.max(16, at - Date.now() + 10));
    return () => clearTimeout(id);
  }, [flashes]);

  // Drop overrides the new snapshot already contains
  useEffect(() => {
    if (base) setOverrides((prev) => {
      const next = pruneOverrides(prev, base.generatedAt, Date.now());
      return next.length === prev.length ? prev : next;
    });
  }, [base]);

  const groups = useMemo(() => sortGroups(base?.groups ?? []), [base?.groups]);
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const groupOrder = useMemo(() => groups.map((g) => g.id), [groups]);
  const colorOf = useCallback((id: string) => groupById.get(id)?.color ?? STANDALONE_COLOR, [groupById]);
  const titleOf = useCallback((id: string) => groupById.get(id)?.title ?? "", [groupById]);

  const tasks = useMemo(() => applyOverrides(base?.tasks ?? [], pruneOverrides(overrides, base?.generatedAt ?? null, nowMs)), [base?.tasks, base?.generatedAt, overrides, nowMs]);
  const people = useMemo(() => applyFlashes(base?.people ?? [], flashes, nowMs), [base?.people, flashes, nowMs]);
  viewRef.current = { people, tasks, colorOf };
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const hidden = useMemo(() => new Set(flights.map((f) => f.taskId)), [flights]);
  const held = useMemo(() => heldByPerson(tasks, groupOrder, hidden), [tasks, groupOrder, hidden]);
  const chipW = useMemo(() => chipWidthFor(tasks.filter(isOpenTask).map(taskCode)), [tasks]);
  const layoutKey = people.map((p) => `${p.id}|${p.kind}|${p.reportsTo ?? ""}|${p.name}|${held.get(p.id)?.length ?? 0}`).join("\n") + `#${chipW}`;
  const layout = useMemo(
    () => layoutOrg(people.map((p) => ({ id: p.id, kind: p.kind, reportsTo: p.reportsTo, name: p.name, chipCount: held.get(p.id)?.length ?? 0 })), chipW),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layoutKey],
  );
  const counts = useMemo(() => liveCounts(people, tasks), [people, tasks]);
  const openByGroup = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) if (isOpenTask(t)) m.set(t.groupId, (m.get(t.groupId) ?? 0) + 1);
    return m;
  }, [tasks]);
  const users = people.filter((p) => p.kind === "user");

  const selTask = sel?.type === "task" ? tasks.find((t) => t.id === sel.id) ?? null : null;
  const selPerson = sel?.type === "person" ? personById.get(sel.id) ?? null : null;
  const touched = useMemo(() => touchedBy(selTask), [selTask]);

  const feed = useMemo(() => mergeFeed(base?.feed ?? [], simOn ? [] : liveExtra), [base?.feed, liveExtra, simOn]);
  const feedCtx: FeedContext = useMemo(
    () => ({
      people,
      personById,
      colorOf: (r: FeedRecord) => {
        if (r.parentId && groupById.has(r.parentId)) return groupById.get(r.parentId)!.color;
        const t = findTask(r, tasks);
        return t ? colorOf(t.groupId) : STANDALONE_COLOR;
      },
    }),
    [people, personById, groupById, tasks, colorOf],
  );
  const taskIdOf = useCallback((r: FeedRecord) => findTask(r, tasks)?.id ?? null, [tasks]);

  const onFlightDone = useCallback((key: string) => setFlights((prev) => prev.filter((f) => f.key !== key)), []);
  const select = useCallback((s: Selection | null) => setSel((cur) => (s && cur && cur.type === s.type && cur.id === s.id ? null : s)), []);

  const conn = simOn ? { cls: "of-sim", text: "Simulazione" } : { cls: live.connection === "live" ? "" : live.connection === "connecting" ? "of-connecting" : "of-offline", text: CONNECTION_LABEL[live.connection] };

  /* ---------- states without data ---------- */
  if (!companyId) {
    return (
      <div className="of-root"><div className="of-page"><h1 className="of-h1">Org Flow</h1><p className="of-sub">Apri Org Flow dall'interno di una company per vedere il suo organigramma in diretta.</p></div></div>
    );
  }
  if (!base) {
    return (
      <div className="of-root">
        <div className="of-page">
          <div className="of-titlerow"><h1 className="of-h1">Org Flow</h1></div>
          {live.error ? (
            <div className="of-error" role="alert">Non riesco a leggere i dati del plugin: {live.error}. Riprovo da solo tra poco.</div>
          ) : (
            <p className="of-sub" aria-busy="true">Carico l'organigramma…</p>
          )}
        </div>
      </div>
    );
  }

  const strip = activeGroups(groups);
  const showSim = base.settings?.enableSimulation || simOn;

  return (
    <div className="of-root">
      <div className="of-page">
        <header>
          <div className="of-titlerow">
            <h1 className="of-h1">Org Flow</h1>
            <span className={`of-conn ${conn.cls}`} role="status" title={live.lastOkAt && !simOn ? `Ultimo aggiornamento ${relativeTime(new Date(live.lastOkAt).toISOString(), nowMs)}` : undefined}>
              <i aria-hidden="true" />{conn.text}
            </span>
            <span className="of-clock" aria-label={`Ora ${clockTime(displayNow)}`}>{clockTime(displayNow)}</span>
            <div className="of-controls">
              {showSim && (
                <button type="button" className="of-btn" aria-pressed={simOn} onClick={() => setSimOn((v) => !v)}>
                  <span className="of-switch" aria-hidden="true" />Simulazione
                </button>
              )}
            </div>
          </div>
          <p className="of-sub">Chi sta facendo cosa in questo momento, a che punto è ogni task e come passa da una persona all'altra. I colori sono i task padre.</p>
        </header>

        {simOn && (
          <div className="of-banner" role="note">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3" /><path d="M7 15h10" /></svg>
            <div>Simulazione — dati finti, niente viene scritto su Paperclip. <span>Persone e personaggi sono quelli veri; task, percentuali e passaggi sono inventati.</span></div>
          </div>
        )}

        {strip.length ? (
          <ParentStrip groups={strip} people={personById} focusGroup={focusGroup} openByGroup={openByGroup} onFocus={setFocusGroup} />
        ) : (
          <QuietStrip people={people} closed={recentlyClosed(tasks)} groupColor={colorOf} nowMs={displayNow} onSelect={select} />
        )}

        <KpiStrip people={people} counts={counts} onWaiting={users.length ? () => setSel({ type: "person", id: users[0]!.id }) : undefined} />

        <div className="of-main">
          <section className="of-stage" aria-label="Organigramma con i task">
            {people.length ? (
              <OrgChart
                people={people}
                held={held}
                groupColor={colorOf}
                groupTitle={titleOf}
                layout={layout}
                chipW={chipW}
                selected={sel}
                focusGroup={focusGroup}
                touched={touched}
                touchColor={selTask ? colorOf(selTask.groupId) : null}
                flights={flights}
                onFlightDone={onFlightDone}
                onSelect={select}
                ariaLabel="Organigramma della company con i task in mano a ciascuno"
              />
            ) : (
              <p className="of-feed-empty" style={{ padding: 20 }}>Nessun agente in questa company.</p>
            )}
            <div className="of-legend">
              {(["todo", "in_progress", "in_review", "blocked"] as const).map((s) => (
                <span key={s}>
                  <svg viewBox="-6 -6 12 12" aria-hidden="true"><StatusGlyph status={s} /></svg>
                  {({ todo: "Da fare", in_progress: "In corso", in_review: "In revisione", blocked: "Bloccato" } as const)[s]}
                </span>
              ))}
              <span>Il riempimento è la percentuale di completamento</span>
              <span className="of-hint">Clicca una persona o un task per i dettagli</span>
            </div>
          </section>

          <aside className="of-panel" aria-label="Dettaglio e attività">
            {selTask && (
              <TaskCard
                task={selTask}
                group={groupById.get(selTask.groupId)}
                groupColor={colorOf(selTask.groupId)}
                people={personById}
                nowMs={displayNow}
                nav={nav}
                onClose={() => setSel(null)}
                onSelect={select}
              />
            )}
            {selPerson && (
              <PersonCard
                person={selPerson}
                held={held.get(selPerson.id) ?? []}
                groups={groupById}
                groupOrder={groupOrder}
                groupColor={colorOf}
                nav={nav}
                onClose={() => setSel(null)}
                onSelect={select}
              />
            )}
            <header>
              <h2 className="of-h2">Attività in diretta</h2>
              <span className="of-count">{feed.length === 1 ? "1 evento" : `${feed.length} eventi`}</span>
            </header>
            <ActivityFeed records={feed} ctx={feedCtx} freshIds={fresh} selectedTaskId={selTask?.id ?? null} nowMs={displayNow} taskIdOf={taskIdOf} onSelect={select} />
          </aside>
        </div>
      </div>
    </div>
  );
}
