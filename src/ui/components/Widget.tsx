import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useHostLocation, useHostNavigation, usePluginData, type PluginSidebarProps, type PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";
import { DATA_SNAPSHOT, type Snapshot } from "../../shared/types.js";
import { clampPercent, relativeTime } from "../format.js";
import { useNow } from "../hooks.js";
import { activeGroups, isGroupDone, liveCounts } from "../model.js";
import { useStyles } from "../styles.js";
import { isSnapshot, newerSnapshot } from "../useLive.js";
import { Avatar, OrgIcon } from "./Avatar.js";

const PAGE_PATH = "/org-flow";
const WIDGET_REFRESH_MS = 60_000;

/** Compact dashboard card: parent progress, who works, who sleeps, what waits for the board. */
export function OrgFlowDashboardWidget({ context }: PluginWidgetProps) {
  useStyles();
  const companyId = context.companyId ?? undefined;
  const nav = useHostNavigation();
  const params = useMemo(() => ({ companyId }), [companyId]);
  const q = usePluginData<Snapshot>(DATA_SNAPSHOT, params);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const now = useNow(30_000);
  useEffect(() => {
    if (isSnapshot(q.data)) setSnap((cur) => newerSnapshot(cur, q.data as Snapshot));
  }, [q.data]);
  useEffect(() => {
    const id = setInterval(() => q.refresh(), WIDGET_REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  if (!snap) {
    return (
      <div className="of-root">
        <div className="of-widget">
          <div className="of-wtop"><span>Org Flow</span></div>
          <p className="of-empty">{q.error ? "Dati non disponibili al momento." : "Caricamento…"}</p>
        </div>
      </div>
    );
  }

  const groups = activeGroups(snap.groups).slice(0, 4);
  const counts = liveCounts(snap.people, snap.tasks);
  const agents = snap.people.filter((p) => p.kind === "agent");
  return (
    <div className="of-root">
      <div className="of-widget" aria-label="Org Flow, riepilogo">
        <div className="of-wtop">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--of-fg)", fontWeight: 600 }}>
            <span style={{ width: 15, height: 15, display: "inline-flex" }}><OrgIcon /></span>Org Flow
          </span>
          <span title="Ultimo aggiornamento dei dati">{relativeTime(snap.generatedAt, now)}</span>
        </div>
        {groups.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {groups.map((g) => {
              const pct = isGroupDone(g) ? 100 : clampPercent(g.progress);
              return (
                <div className="of-wrow" key={g.id} style={{ ["--of-gc" as string]: g.color } as CSSProperties}>
                  <span className="of-t"><span className="of-sw" /><span title={g.title}>{g.title}</span></span>
                  <span className="of-bar"><i style={{ width: `${pct}%` }} /></span>
                  <b>{pct}%</b>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="of-wquiet">
            <span style={{ display: "flex" }}>
              {agents.slice(0, 3).map((p, i) => (
                <span key={p.id} style={{ marginLeft: i ? -8 : 0 }}><Avatar person={p} pose="sleepy" size={32} /></span>
              ))}
            </span>
            <span>
              Tutto tranquillo: nessun task aperto.
              {snap.counts?.closed24h ? ` ${snap.counts.closed24h === 1 ? "1 chiuso" : `${snap.counts.closed24h} chiusi`} nelle ultime 24 h.` : ""}
            </span>
          </div>
        )}
        <div className="of-wfoot">
          <span><b>{counts.working}</b> al lavoro</span>
          <span><b>{counts.sleepy}</b> dormono</span>
          {counts.tasksWaitingForUsers ? (
            <span className="of-w">{counts.tasksWaitingForUsers === 1 ? "1 task aspetta te" : `${counts.tasksWaitingForUsers} task aspettano te`}</span>
          ) : (
            <span>Niente che aspetta te</span>
          )}
          <a {...nav.linkProps(PAGE_PATH)}>Apri →</a>
        </div>
      </div>
    </div>
  );
}

/** Sidebar entry, styled like the host's own navigation items. */
export function OrgFlowSidebarLink(_props: PluginSidebarProps) {
  useStyles();
  const nav = useHostNavigation();
  const loc = useHostLocation();
  const active = /\/org-flow\/?$/.test(loc?.pathname ?? "");
  return (
    <div className="of-root">
      <a className={`of-side${active ? " of-active" : ""}`} aria-current={active ? "page" : undefined} {...nav.linkProps(PAGE_PATH)}>
        <OrgIcon />
        <span>Org Flow</span>
      </a>
    </div>
  );
}
