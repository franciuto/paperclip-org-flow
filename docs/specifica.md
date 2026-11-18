# Org Flow — specifica della versione 1.0

Stato: approvata il 2026-11-19 (notte), base per l'implementazione. Le decisioni prese in autonomia sono in [decisioni.md](decisioni.md).

## Obiettivo

Un plugin di Paperclip che mostra, in diretta, l'organigramma della company con:

- chi sta facendo cosa adesso (stato "vivo" di ogni agente con i personaggi di Paperclip);
- quali task ha in mano ciascuno, con percentuale di completamento;
- i task raggruppati e colorati per task padre;
- i passaggi di mano animati (il task "vola" da una persona all'altra, senza frecce);
- un feed di attività e un riquadro compatto per la dashboard di Paperclip.

Il prototipo statico di riferimento è [`prototype/org-flow.src.html`](../prototype/org-flow.src.html): la versione reale ne riprende aspetto e comportamento, togliendo la simulazione come modalità principale.

## Superfici (slot UI)

| Slot | Export | Contenuto |
| --- | --- | --- |
| `page`, `routePath: "org-flow"` | `OrgFlowPage` | Pagina completa: striscia dei task padre, riepilogo, organigramma live, pannello dettaglio + attività |
| `sidebar` | `OrgFlowSidebarLink` | Link "Org Flow" nella barra laterale |
| `dashboardWidget` | `OrgFlowDashboardWidget` | Riquadro compatto: avanzamento dei padri, chi lavora, chi dorme, cosa aspetta il board |

## Dati e fonti

Tutto passa dal worker; la UI non chiama API core di Paperclip, tranne le immagini (personaggi e avatar), che carica per URL dallo stesso dominio.

| Dato | Fonte |
| --- | --- |
| Persone e catena di riporto | `ctx.agents.list` (`reportsTo`, `status`, `appearance`) |
| Utenti umani (board) | assegnatari `assigneeUserId` dei task; nome da `access.members.read` se disponibile, altrimenti "Board" |
| Task | `ctx.issues.list` per la company: aperti + chiusi nelle ultime `keepClosedHours` |
| Task padre | `parentId`; il padre si legge con `ctx.issues.get` |
| Percentuale task padre | figli `done` / figli totali (esclusi `cancelled`) |
| Percentuale task singolo | 1) riportata dall'agente con lo strumento `report_progress` (stato del plugin, scope `issue`); 2) checklist del documento `plan` (`- [x]` / caselle totali); 3) stima dallo stato |
| Stima dallo stato | backlog 0 · todo 5 · in_progress 40 · in_review 85 · blocked = ultimo valore noto o 40 · done 100 |
| Passaggi di mano e cronologia | eventi `issue.created`, `issue.updated` (con `changes.assigneeAgentId/assigneeUserId/status`), salvati nello stato del plugin (ultimi 300 per company) |
| Run degli agenti | eventi `agent.run.started/finished/failed` + `agent.status` |

## Stati visivi delle persone

Regole valutate in quest'ordine (la prima che vale vince). Tempi configurabili dove indicato.

| Stato | Quando | Posa |
| --- | --- | --- |
| `paused` | agente in pausa | `rest` |
| `confused` | `status = error`, oppure ultimo run fallito negli ultimi 10 min, oppure un suo task è tornato indietro negli ultimi 2 min | `confused` |
| `success` | ha chiuso un task (o un suo task è stato approvato) negli ultimi 90 s | `success` |
| `listening` | ha ricevuto un task negli ultimi 60 s | `listening` |
| `working` | run in corso (`status = running` o `run_started` senza fine) | `working` |
| `thinking` | ha in mano un task `in_review` | `thinking` |
| `idle` | ha task aperti (da fare) | `idle` |
| `sleepy` | nessun task aperto e nessuna attività da `sleepAfterMinutes` (default 15) | `sleepy` |
| `idle` | altrimenti ("Libero") | `idle` |
| `waiting` | (solo utenti) ha task aperti assegnati | — |

La UI applica anche "flash" locali immediati quando arriva un evento dallo stream (ricevuto, fatto, rimandato), senza aspettare il nuovo snapshot.

## Personaggi

URL: `/api/agent-avatars/cap-v1/<paletteId>/<posa>.png?size=128&scale=1`. Se l'agente ha una foto caricata (`appearance.customAvatarAssetId`) si usa `/api/assets/<id>/content` e le pose diventano solo animazioni CSS.

## Aggiornamento in diretta

- Canale stream `org-flow` (`STREAM_CHANNEL`).
- Ad ogni evento rilevante il worker emette subito `{ type: "event", record }` e, dopo 600 ms di debounce, `{ type: "snapshot", snapshot }`.
- La UI carica lo snapshot iniziale con `usePluginData("snapshot")`, poi lo sostituisce con quelli in arrivo dallo stream; ogni 60 s chiede un refresh leggero (fallback se lo stream cade) e aggiorna i tempi relativi.

## Strumento per gli agenti

`report_progress` (capability `agent.tools.register`): parametri `issue` (id o identificatore, es. `FRA-62`), `percent` (0–100), `note` (opzionale, max 200 caratteri). Salva nello stato del plugin, emette un evento `progress`. Solo per task assegnati all'agente che chiama (o ai suoi sottoposti, se disponibile la catena).

## Impostazioni (instanceConfigSchema)

`sleepAfterMinutes` (default 15), `keepClosedHours` (default 24), `enableSimulation` (default true).

## Modalità simulazione

Interruttore "Simulazione" nella pagina (visibile se `enableSimulation`): usa persone e personaggi reali e genera task ed eventi finti, come il prototipo. Etichetta ben visibile "Simulazione — dati finti". Non scrive nulla su Paperclip.

## Requisiti non funzionali

- Tema chiaro e scuro con le variabili CSS di Paperclip (`--background`, `--foreground`, `--muted-foreground`, `--border`, `--card`, `--accent`).
- CSS con prefisso `of-` iniettato una sola volta; niente librerie UI esterne.
- `prefers-reduced-motion`: niente animazioni di volo/rimbalzo.
- Usabile su telefono (organigramma scorrevole in orizzontale nel suo contenitore).
- Il worker non deve mai far cadere un evento per un errore di arricchimento: in caso di errore registra un warning e prosegue.
- Nessuna scrittura su task, agenti o altri dati core di Paperclip.
