import type { CSSProperties, ReactNode } from "react";
import type { HostNavigation } from "@paperclipai/plugin-sdk/ui";
import { POSE_FOR_STATE, STANDALONE_GROUP_ID, type FeedRecord, type GroupView, type Party, type PersonView, type Pose, type TaskView } from "../../shared/types.js";
import {
  statusRegression,
  clampPercent,
  clockTime,
  firstName,
  formatDuration,
  fullDateTime,
  plural,
  relativeTime,
  SOURCE_LABEL,
  statusColorVar,
  statusLabel,
  taskCode,
} from "../format.js";
import { isGroupDone, OTHERS_ID, type LiveCounts } from "../model.js";
import { resolveParty } from "../presence.js";
import { Avatar } from "./Avatar.js";
import type { Selection } from "./OrgChart.js";

const gc = (color: string) => ({ ["--of-gc" as string]: color }) as CSSProperties;

export function issuePath(t: { identifier: string | null; id: string }): string {
  return `/issues/${encodeURIComponent(t.identifier ?? t.id)}`;
}

export function agentPath(p: PersonView): string | null {
  return p.kind === "agent" && p.id !== OTHERS_ID ? `/agents/${encodeURIComponent(p.id)}` : null;
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}

/* ---------------- Parent tasks strip ---------------- */

export function ParentStrip(props: {
  groups: GroupView[];
  people: Map<string, PersonView>;
  focusGroup: string | null;
  openByGroup: Map<string, number>;
  onFocus: (id: string | null) => void;
}) {
  const { groups, people, focusGroup, onFocus } = props;
  return (
    <section className="of-parents" aria-label="Task padre">
      {groups.map((g) => {
        const done = isGroupDone(g);
        const pct = clampPercent(g.progress);
        const heads = g.holderIds.slice(0, 5);
        return (
          <button
            key={g.id}
            type="button"
            className={`of-pcard${focusGroup && focusGroup !== g.id ? " of-dim" : ""}`}
            style={gc(g.color)}
            aria-pressed={focusGroup === g.id}
            aria-label={`${g.identifier ?? ""} ${g.title}: ${done ? "completato" : `${g.childrenDone} su ${g.childrenTotal} chiusi, ${pct}%`}. ${focusGroup === g.id ? "Mostra tutti" : "Evidenzia nell'organigramma"}`}
            onClick={() => onFocus(focusGroup === g.id ? null : g.id)}
          >
            <span className="of-ptop">
              <span className="of-sw" />
              {g.identifier && <span className="of-idm">{g.identifier}</span>}
              <span className="of-ptitle" title={g.title}>{g.title}</span>
            </span>
            {g.id !== STANDALONE_GROUP_ID && <span className="of-bar"><i style={{ width: `${done ? 100 : pct}%` }} /></span>}
            <span className="of-pmeta">
              {g.id === STANDALONE_GROUP_ID ? (
                <span>{plural(props.openByGroup.get(g.id) ?? 0, "task aperto", "task aperti")}</span>
              ) : done ? (
                <span className="of-done-tag">Completato</span>
              ) : g.childrenTotal ? (
                <span><b>{g.childrenDone}</b>/{g.childrenTotal} chiusi · <b>{pct}%</b></span>
              ) : (
                <span>Nessun sotto-task</span>
              )}
              <span className="of-heads">
                {heads.map((h) => {
                  const p = people.get(h);
                  return <Avatar key={h} person={p} size={20} title={p?.name} />;
                })}
                {g.holderIds.length > heads.length && <span className="of-more-heads">+{g.holderIds.length - heads.length}</span>}
              </span>
            </span>
          </button>
        );
      })}
    </section>
  );
}

/** Strip shown when nothing is open: an intentional, calm state plus the recently closed tasks. */
export function QuietStrip(props: {
  people: PersonView[];
  closed: TaskView[];
  groupColor: (groupId: string) => string;
  nowMs: number;
  onSelect: (s: Selection) => void;
}) {
  const sleepers = props.people.filter((p) => p.kind === "agent").slice(0, 4);
  const sleeping = props.people.filter((p) => p.kind === "agent" && p.state === "sleepy").length;
  const agents = props.people.filter((p) => p.kind === "agent").length;
  return (
    <section className="of-quiet" aria-label="Situazione tranquilla">
      <div className="of-calm">
        <span className="of-calm-faces" aria-hidden="true">
          {sleepers.map((p) => (
            <Avatar key={p.id} person={p} pose="sleepy" size={44} />
          ))}
        </span>
        <span>
          <b>Tutto tranquillo: nessun task aperto</b>
          <p>
            {sleeping === agents && agents > 0
              ? "Gli agenti si riposano. Appena arriva un task li vedi svegliarsi e passarselo qui sotto."
              : `${plural(sleeping, "agente dorme", "agenti dormono")}. Appena arriva un task lo vedi passare di mano qui sotto.`}
          </p>
        </span>
      </div>
      <div className="of-closed">
        {props.closed.length ? (
          <ul>
            {props.closed.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => props.onSelect({ type: "task", id: t.id })} style={gc(props.groupColor(t.groupId))}>
                  <span className="of-check"><CheckIcon /></span>
                  <span className="of-idm">{taskCode(t)}</span>
                  <span className="of-t">{t.title}</span>
                  <span className="of-idm" title={fullDateTime(t.closedAt)}>{relativeTime(t.closedAt, props.nowMs)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="of-empty">Nessun task chiuso nelle ultime ore.</p>
        )}
      </div>
    </section>
  );
}

/* ---------------- KPI strip ---------------- */

/** Face for a KPI: someone in that state, otherwise a different agent per slot (variety). */
function kpiFace(people: PersonView[], state: PersonView["state"], slot: number): PersonView | undefined {
  const agents = people.filter((p) => p.kind === "agent" && (p.paletteId || p.customAvatarUrl));
  if (!agents.length) return undefined;
  const byPalette = [...new Map(agents.map((a) => [a.paletteId ?? a.id, a])).values()];
  return agents.find((p) => p.state === state) ?? byPalette[(slot * 2 + 1) % byPalette.length];
}

export function KpiStrip(props: { people: PersonView[]; counts: LiveCounts; onWaiting?: () => void }) {
  const { people, counts } = props;
  const items: Array<{ key: string; v: number; l: string; pose: Pose; state: PersonView["state"]; slot: number }> = [
    { key: "working", v: counts.working, l: "Al lavoro", pose: "working", state: "working", slot: 0 },
    { key: "thinking", v: counts.thinking, l: "Rivedono", pose: "thinking", state: "thinking", slot: 1 },
    { key: "sleepy", v: counts.sleepy, l: "Dormono", pose: "sleepy", state: "sleepy", slot: 2 },
  ];
  return (
    <section className="of-kpis" aria-label="Adesso">
      {items.map((k) => (
        <div className="of-kpi" key={k.key}>
          <Avatar person={kpiFace(people, k.state, k.slot)} pose={k.pose} size={34} />
          <div>
            <div className="of-v">{k.v}</div>
            <div className="of-l">{k.l}</div>
          </div>
        </div>
      ))}
      {props.onWaiting ? (
        <button type="button" className={`of-kpi of-click${counts.tasksWaitingForUsers ? " of-warn" : ""}`} onClick={props.onWaiting} aria-label={`Aspettano te: ${counts.tasksWaitingForUsers}. Mostra i dettagli`}>
          <Avatar person={kpiFace(people, "confused", 3)} pose={counts.tasksWaitingForUsers ? "confused" : "idle"} size={34} />
          <div>
            <div className="of-v">{counts.tasksWaitingForUsers}</div>
            <div className="of-l">Aspettano te</div>
          </div>
        </button>
      ) : (
        <div className={`of-kpi${counts.tasksWaitingForUsers ? " of-warn" : ""}`}>
          <Avatar person={kpiFace(people, "confused", 3)} pose="idle" size={34} />
          <div>
            <div className="of-v">{counts.tasksWaitingForUsers}</div>
            <div className="of-l">Aspettano te</div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------------- Detail cards ---------------- */

export function TaskCard(props: {
  task: TaskView;
  group: GroupView | undefined;
  groupColor: string;
  people: Map<string, PersonView>;
  nowMs: number;
  nav: HostNavigation;
  onClose: () => void;
  onSelect: (s: Selection) => void;
}) {
  const { task: t, group, people, nowMs, nav } = props;
  const pct = clampPercent(t.progress);
  const closed = !!t.closedAt || t.status === "done" || t.status === "cancelled";
  const holder = t.holderId ? people.get(t.holderId) : undefined;
  const journey = t.journey.length ? t.journey : t.holderId ? [{ personId: t.holderId, since: t.updatedAt }] : [];
  const endOf = (i: number) => {
    const next = journey[i + 1];
    if (next) return Date.parse(next.since);
    if (t.closedAt) return Date.parse(t.closedAt);
    return nowMs;
  };
  return (
    <div className="of-card" aria-label={`Task ${taskCode(t)}`}>
      <div className="of-card-top">
        <div className="of-pills">
          <a className="of-idm" {...nav.linkProps(issuePath(t))}>{taskCode(t)}</a>
          <span className="of-pill"><i style={{ background: statusColorVar(t.status) }} />{statusLabel(t.status)}</span>
          {t.bounces > 0 && <span className="of-pill">Rimandato {t.bounces}×</span>}
          {t.priority && t.priority !== "medium" && <span className="of-pill">Priorità {priorityLabel(t.priority)}</span>}
        </div>
        <button className="of-x" type="button" onClick={props.onClose} aria-label="Chiudi il dettaglio (Esc)" data-autofocus>×</button>
      </div>
      <h3><a {...nav.linkProps(issuePath(t))}>{t.title}</a></h3>
      {group && group.id !== "standalone" ? (
        <div className="of-gline" style={gc(props.groupColor)}>
          <span className="of-sw" />
          <span>Parte di <b>{group.identifier ?? ""}</b> · {group.title}</span>
        </div>
      ) : (
        <div className="of-gline" style={gc(props.groupColor)}><span className="of-sw" /><span>Task senza padre</span></div>
      )}
      <div className="of-bigbar" style={gc(props.groupColor)}>
        <span className="of-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Completamento"><i style={{ width: `${pct}%` }} /></span>
        <b>{pct}%</b>
      </div>
      <div className="of-src">Percentuale {SOURCE_LABEL[t.progressSource] ?? ""}{t.progressNote ? ` · “${t.progressNote}”` : ""}</div>
      <div className="of-meta">
        {closed ? (
          <>Chiuso {relativeTime(t.closedAt ?? t.updatedAt, nowMs)}</>
        ) : holder ? (
          <>In mano a <b>{holder.name}</b></>
        ) : (
          <>Senza assegnatario</>
        )}
        {" · "}
        {plural(Math.max(0, journey.length - 1), "passaggio", "passaggi")}
      </div>
      {journey.length > 0 && (
        <ol className="of-path" aria-label="Percorso del task">
          {journey.map((j, i) => {
            const p = people.get(j.personId);
            const cur = i === journey.length - 1 && !closed;
            return (
              <li key={`${j.personId}-${j.since}-${i}`} className={cur ? "of-cur" : undefined}>
                <span className="of-n">{i + 1}</span>
                <Avatar person={p} size={22} />
                <span className="of-who-n">
                  {p ? (
                    <button type="button" className="of-plain" onClick={() => props.onSelect({ type: "person", id: p.id })}>
                      {p.name}
                    </button>
                  ) : (
                    "Persona non più presente"
                  )}{" "}
                  <span className="of-idm" title={fullDateTime(j.since)}>{clockTime(j.since)}</span>
                </span>
                <span className="of-d">{cur ? "da " : ""}{formatDuration(endOf(i) - Date.parse(j.since))}</span>
              </li>
            );
          })}
        </ol>
      )}
      <a className="of-link" {...nav.linkProps(issuePath(t))}>
        Apri il task in Paperclip
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 3h7v7M13 3 4 12" /></svg>
      </a>
    </div>
  );
}

function priorityLabel(p: string): string {
  return ({ critical: "critica", high: "alta", low: "bassa", urgent: "urgente" } as Record<string, string>)[p] ?? p;
}

export function PersonCard(props: {
  person: PersonView;
  held: TaskView[];
  groups: Map<string, GroupView>;
  groupOrder: string[];
  groupColor: (id: string) => string;
  nav: HostNavigation;
  onClose: () => void;
  onSelect: (s: Selection) => void;
}) {
  const { person: p, held, nav } = props;
  const pose = POSE_FOR_STATE[p.state] ?? "idle";
  const byGroup = new Map<string, TaskView[]>();
  for (const t of held) byGroup.set(t.groupId, [...(byGroup.get(t.groupId) ?? []), t]);
  const order = [...byGroup.keys()].sort((a, b) => indexOr(props.groupOrder, a) - indexOr(props.groupOrder, b));
  const link = agentPath(p);
  return (
    <div className="of-card" aria-label={`Persona ${p.name}`}>
      <div className="of-card-top">
        <div className="of-who">
          <Avatar person={p} pose={pose} size={72} />
          <div style={{ minWidth: 0 }}>
            <h3>{link ? <a {...nav.linkProps(link)}>{p.name}</a> : p.name}</h3>
            <div className="of-meta">{p.title ?? (p.kind === "user" ? "Operatore umano" : p.role ?? "")}</div>
            <div className="of-meta"><b>{p.stateLabel}</b></div>
          </div>
        </div>
        <button className="of-x" type="button" onClick={props.onClose} aria-label="Chiudi il dettaglio (Esc)" data-autofocus>×</button>
      </div>
      <div className="of-stats">
        <div><b>{held.length}</b><span>in mano</span></div>
        <div><b>{p.stats.received24h}</b><span>ricevuti 24h</span></div>
        <div><b>{p.stats.passed24h}</b><span>passati 24h</span></div>
        <div><b>{p.stats.closed24h}</b><span>chiusi 24h</span></div>
      </div>
      {held.length ? (
        order.map((gid) => {
          const g = props.groups.get(gid);
          return (
            <div className="of-tgroup" key={gid}>
              <div className="of-tgroup-h" style={gc(props.groupColor(gid))}>
                <span className="of-sw" />
                <span>{g && gid !== "standalone" ? `${g.identifier ? g.identifier + " · " : ""}${g.title}` : "Senza padre"}</span>
              </div>
              {byGroup.get(gid)!.map((t) => (
                <button key={t.id} type="button" className="of-trow" style={gc(props.groupColor(gid))} onClick={() => props.onSelect({ type: "task", id: t.id })}>
                  <span className="of-sw" />
                  <span className="of-t">{taskCode(t)} · {t.title}</span>
                  <span className="of-p">{t.status === "blocked" ? "bloccato" : t.status === "in_review" ? "in revisione" : `${clampPercent(t.progress)}%`}</span>
                </button>
              ))}
            </div>
          );
        })
      ) : (
        <div className="of-meta">Nessun task in mano.</div>
      )}
      {link && (
        <a className="of-link" {...nav.linkProps(link)}>
          Apri la scheda dell'agente
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 3h7v7M13 3 4 12" /></svg>
        </a>
      )}
    </div>
  );
}

function indexOr(list: string[], id: string): number {
  const i = list.indexOf(id);
  return i < 0 ? 999 : i;
}

/* ---------------- Activity feed ---------------- */

export interface FeedContext {
  people: PersonView[];
  personById: Map<string, PersonView>;
  colorOf: (rec: FeedRecord) => string;
}

function who(ctx: FeedContext, party: Party | undefined): { person: PersonView | undefined; name: string } {
  const id = resolveParty(party, ctx.people);
  const person = id ? ctx.personById.get(id) : undefined;
  if (person) return { person, name: person.kind === "user" ? person.name : firstName(person.name) };
  if (party?.name) return { person: undefined, name: party.kind === "user" ? party.name : firstName(party.name) };
  return { person: undefined, name: party?.kind === "user" ? "Board" : "qualcuno" };
}

const SEND_BACK = (r: FeedRecord) => statusRegression(r.statusFrom, r.statusTo) !== null;
const REOPEN = (r: FeedRecord) => statusRegression(r.statusFrom, r.statusTo) === "reopen";

function FeedLine({ r, ctx }: { r: FeedRecord; ctx: FeedContext }): ReactNode {
  const A = (party: Party | undefined, pose: Pose = "idle", bold = false) => {
    const w = who(ctx, party);
    return (
      <>
        <Avatar person={w.person} pose={pose} size={20} />
        {bold ? <b>{w.name}</b> : <span>{w.name}</span>}
      </>
    );
  };
  switch (r.kind) {
    case "handoff": {
      const toUser = r.to?.kind === "user";
      const em = REOPEN(r) ? "riaperto" : SEND_BACK(r) ? "rimandato indietro" : r.statusTo === "in_review" ? "da rivedere" : r.statusTo === "blocked" ? "serve una tua decisione" : toUser ? "per te" : "assegnato";
      const pose: Pose = SEND_BACK(r) ? "confused" : r.statusTo === "in_review" ? "thinking" : "listening";
      return (
        <div className="of-fl1">
          {r.from ? A(r.from) : <span>Nessuno</span>}
          <span className="of-arrow" aria-hidden="true">→</span>
          {r.to ? A(r.to, pose, true) : <b>nessuno</b>}
          <em>{em}</em>
        </div>
      );
    }
    case "status":
      if (r.statusTo === "done")
        return <div className="of-fl1">{A(r.actor, "success", true)}<span className="of-ok">ha chiuso il task</span></div>;
      if (REOPEN(r))
        return <div className="of-fl1">{A(r.actor, "confused", true)}<em>ha riaperto il task</em></div>;
      if (SEND_BACK(r))
        return <div className="of-fl1">{A(r.actor, "thinking", true)}<em>ha rimandato indietro</em></div>;
      return (
        <div className="of-fl1">
          {r.actor ? A(r.actor, "idle", true) : null}
          <span className="of-pill"><i style={{ background: statusColorVar(r.statusFrom) }} />{statusLabel(r.statusFrom)}</span>
          <span className="of-arrow" aria-hidden="true">→</span>
          <span className="of-pill"><i style={{ background: statusColorVar(r.statusTo) }} />{statusLabel(r.statusTo)}</span>
        </div>
      );
    case "created":
      return <div className="of-fl1"><span>Nuovo task</span>{r.to ? <><em>per</em>{A(r.to, "listening", true)}</> : null}</div>;
    case "run_started":
      return <div className="of-fl1">{A(r.actor, "working", true)}<em>inizia a lavorare</em></div>;
    case "run_finished":
      return <div className="of-fl1">{A(r.actor, "idle", true)}<em>ha finito il run</em></div>;
    case "run_failed":
      return <div className="of-fl1">{A(r.actor, "confused", true)}<span className="of-bad">run fallito</span></div>;
    case "progress":
      return (
        <div className="of-fl1">
          {A(r.actor, "working", true)}<em>è al</em><b>{clampPercent(r.percent)}%</b>
          {r.note ? <em title={r.note}>· {r.note.length > 60 ? r.note.slice(0, 59) + "…" : r.note}</em> : null}
        </div>
      );
    case "ping":
      return <div className="of-fl1"><em>Evento di prova: worker e pagina sono collegati</em></div>;
    default:
      return <div className="of-fl1"><em>Evento</em></div>;
  }
}

export function ActivityFeed(props: {
  records: FeedRecord[];
  ctx: FeedContext;
  freshIds: ReadonlySet<string>;
  selectedTaskId: string | null;
  nowMs: number;
  taskIdOf: (r: FeedRecord) => string | null;
  onSelect: (s: Selection) => void;
}) {
  const { records, ctx } = props;
  if (!records.length) {
    return <p className="of-feed-empty">Ancora nessuna attività registrata. Appena un task cambia mano o stato, o un agente parte, compare qui.</p>;
  }
  return (
    <ol className="of-feed" aria-label="Eventi recenti, dal più nuovo">
      {records.map((r) => {
        const tid = props.taskIdOf(r);
        const on = !!tid && tid === props.selectedTaskId;
        const fresh = props.freshIds.has(r.id);
        return (
          <li key={r.id} className={`${on ? "of-on" : ""}${fresh ? " of-new" : ""}`}>
            <button type="button" onClick={() => tid && props.onSelect({ type: "task", id: tid })} aria-disabled={!tid}>
              <span className="of-ft" title={`${fullDateTime(r.at)} · ${relativeTime(r.at, props.nowMs)}`}>{clockTime(r.at)}</span>
              <span style={{ minWidth: 0 }}>
                <FeedLine r={r} ctx={ctx} />
                {(r.identifier || r.title) && (
                  <div className="of-fl2" style={gc(ctx.colorOf(r))}>
                    <span className="of-sw" />
                    {r.identifier && <span className="of-idm">{r.identifier}</span>}
                    <span>{r.title ?? ""}</span>
                  </div>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
