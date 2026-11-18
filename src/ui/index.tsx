import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  useHostNavigation,
  usePluginAction,
  usePluginData,
  usePluginStream,
  type PluginPageProps,
  type PluginSidebarProps,
} from "@paperclipai/plugin-sdk/ui";
import type { FeedRecord, Party } from "../shared/types.js";

/* Host theme tokens (Paperclip defines them for light and dark). */
const C = {
  fg: "var(--foreground)",
  muted: "var(--muted-foreground)",
  border: "var(--border)",
  card: "var(--card)",
  accent: "var(--accent)",
  ok: "oklch(65% .15 150)",
  warn: "oklch(70% .16 70)",
  bad: "oklch(62% .2 25)",
};

const STATUS: Record<string, string> = {
  backlog: "Backlog",
  todo: "Da fare",
  in_progress: "In corso",
  in_review: "In revisione",
  blocked: "Bloccato",
  done: "Fatto",
  cancelled: "Annullato",
};
const status = (s?: string | null) => (s ? STATUS[s] ?? s : "—");

function who(p?: Party): string {
  if (!p) return "nessuno";
  if (p.kind === "user") return "utente";
  return p.name ?? p.id.slice(0, 8);
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function OrgFlowSidebarLink(_props: PluginSidebarProps) {
  const nav = useHostNavigation();
  return (
    <a {...nav.linkProps("/org-flow")} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 6, color: "inherit", textDecoration: "none", fontSize: 14 }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="5" cy="6" r="2.5" /><circle cx="19" cy="6" r="2.5" /><circle cx="12" cy="19" r="2.5" />
        <path d="M7.5 6h9M6.5 8.2l4.2 8.6M17.5 8.2l-4.2 8.6" />
      </svg>
      Org Flow
    </a>
  );
}

function Pill({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, padding: "1px 8px", borderRadius: 999, border: `1px solid ${color ?? C.border}`, color: color ?? C.fg, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function Line({ r }: { r: FeedRecord }) {
  const b = (s: string) => <b style={{ fontWeight: 600 }}>{s}</b>;
  switch (r.kind) {
    case "handoff":
      return <>{b(who(r.from))} → {b(who(r.to))}{r.statusTo ? <> · <Pill>{status(r.statusFrom)} → {status(r.statusTo)}</Pill></> : null}</>;
    case "status":
      return <><Pill>{status(r.statusFrom)} → {status(r.statusTo)}</Pill>{r.actor ? <span style={{ color: C.muted }}> da {who(r.actor)}</span> : null}</>;
    case "created":
      return <>Nuovo task{r.to ? <>, assegnato a {b(who(r.to))}</> : null}</>;
    case "run_started":
      return <>{b(who(r.actor))} <span style={{ color: C.ok }}>ha iniziato a lavorare</span></>;
    case "run_finished":
      return <>{b(who(r.actor))} ha finito il run</>;
    case "run_failed":
      return <>{b(who(r.actor))} <span style={{ color: C.bad }}>run fallito</span></>;
    case "ping":
      return <span style={{ color: C.muted }}>Evento di prova: worker → stream → pagina funzionano</span>;
  }
}

export function OrgFlowPage({ context }: PluginPageProps) {
  const companyId = context.companyId ?? undefined;
  const nav = useHostNavigation();
  const history = usePluginData<{ records: FeedRecord[] }>("recent", { companyId });
  const stream = usePluginStream<FeedRecord>("feed", { companyId });
  const ping = usePluginAction("ping");
  const [pingError, setPingError] = useState<string | null>(null);
  const [pinging, setPinging] = useState(false);

  const records = useMemo(() => {
    const seen = new Set<string>();
    const out: FeedRecord[] = [];
    for (const r of [...stream.events].reverse().concat(history.data?.records ?? [])) {
      if (!r || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
    return out.slice(0, 100);
  }, [stream.events, history.data]);

  const liveIds = useMemo(() => new Set(stream.events.map((e) => e?.id)), [stream.events]);

  const conn = stream.connected
    ? { text: "In ascolto", color: C.ok }
    : stream.connecting
      ? { text: "Connessione…", color: C.warn }
      : { text: stream.error ? "Stream non disponibile" : "Non connesso", color: C.bad };

  async function sendPing() {
    setPinging(true);
    setPingError(null);
    try { await ping({ companyId }); }
    catch (err) { setPingError((err as Error).message); }
    finally { setPinging(false); }
  }

  const wrap: CSSProperties = { maxWidth: 960, margin: "0 auto", padding: "20px 16px", color: C.fg, display: "flex", flexDirection: "column", gap: 14 };

  return (
    <div style={wrap}>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 650, margin: 0 }}>Org Flow</h1>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: conn.color }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: conn.color }} />{conn.text}
        </span>
        <span style={{ fontSize: 12, color: C.muted, border: `1px dashed ${C.border}`, borderRadius: 999, padding: "1px 8px" }}>versione minima</span>
        <button type="button" onClick={sendPing} disabled={pinging || !companyId}
          style={{ marginLeft: "auto", border: `1px solid ${C.border}`, background: C.card, color: C.fg, borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 13 }}>
          {pinging ? "Invio…" : "Invia un evento di prova"}
        </button>
      </header>
      <p style={{ margin: 0, color: C.muted, fontSize: 14 }}>
        Passaggi di mano dei task, cambi di stato e run degli agenti, appena succedono. Serve a verificare che eventi e aggiornamenti in diretta arrivino fin qui.
      </p>
      {pingError ? <p style={{ margin: 0, color: C.bad, fontSize: 13 }}>Evento di prova non riuscito: {pingError}</p> : null}
      {history.error ? <p style={{ margin: 0, color: C.bad, fontSize: 13 }}>Storico non disponibile: {history.error.message}</p> : null}

      <section style={{ border: `1px solid ${C.border}`, borderRadius: 10, background: C.card }}>
        {history.loading && !records.length ? (
          <p style={{ margin: 0, padding: 16, color: C.muted }}>Caricamento…</p>
        ) : !records.length ? (
          <p style={{ margin: 0, padding: 16, color: C.muted }}>
            Ancora nessun evento. Appena un task cambia assegnatario o stato, o un agente parte, compare qui. Per provare subito usa "Invia un evento di prova".
          </p>
        ) : (
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {records.map((r, i) => (
              <li key={r.id} style={{ display: "grid", gridTemplateColumns: "72px minmax(0,1fr)", gap: 10, padding: "9px 14px", borderTop: i ? `1px solid ${C.border}` : "none", background: liveIds.has(r.id) ? "color-mix(in oklch, var(--accent) 60%, transparent)" : undefined }}>
                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: C.muted, paddingTop: 2 }}>{time(r.at)}</span>
                <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}><Line r={r} /></span>
                  {r.identifier || r.title ? (
                    <a {...nav.linkProps(`/issues/${r.identifier ?? r.issueId}`)} style={{ fontSize: 12.5, color: C.muted, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <span style={{ fontFamily: "ui-monospace, monospace" }}>{r.identifier}</span>{r.title ? ` · ${r.title}` : ""}
                    </a>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Ultimi {records.length} eventi · storico salvato nello stato del plugin (massimo 100).</p>
    </div>
  );
}
