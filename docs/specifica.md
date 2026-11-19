# Org Flow — specifica della versione 1.0

Stato: approvata il 2026-11-19 (notte), base per l'implementazione. Le decisioni prese in autonomia sono in [decisioni.md](decisioni.md).

Aggiornata il 2026-11-19 con le differenze dell'implementazione 1.0: i punti cambiati sono segnati con **Implementazione:**. Le regole di dettaglio sono in [stati-e-percentuali.md](stati-e-percentuali.md), i tipi in [contratto-dati.md](contratto-dati.md).

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
| `page`, `routePath: "org-flow"` | `OrgFlowPage` | Pagina completa: riga di intestazione compatta; organigramma live a tutta pagina con i reparti in riquadri e la scheda di dettaglio che scorre sopra il bordo destro (dal basso su telefono); sotto, sezioni a scomparsa: task padre, riepilogo "Adesso", attività (e "Chiusi di recente" nello stato tranquillo) |
| `sidebar` | `OrgFlowSidebarLink` | Link "Org Flow" nella barra laterale |
| `dashboardWidget` | `OrgFlowDashboardWidget` | Riquadro compatto: avanzamento dei padri, chi lavora, chi dorme, cosa aspetta il board |

## Dati e fonti

Tutto passa dal worker; la UI non chiama API core di Paperclip, tranne le immagini (personaggi e avatar), che carica per URL dallo stesso dominio.

| Dato | Fonte |
| --- | --- |
| Persone e catena di riporto | `ctx.agents.list` (`reportsTo`, `status`, `appearance`) |
| Utenti umani (board) | assegnatari `assigneeUserId` dei task; nome da `access.members.read` se disponibile, altrimenti "Board". **Implementazione:** la capability non è richiesta; i nomi sono sempre "Board", "Board 2", … in ordine di id |
| Task | `ctx.issues.list` per la company: aperti + chiusi nelle ultime `keepClosedHours`. **Implementazione:** una chiamata per stato senza `limit` (l'host ignora parte dei filtri e la paginazione non è affidabile); in memoria i chiusi delle ultime `max(keepClosedHours, 24)` ore |
| Task padre | `parentId`; il padre si legge con `ctx.issues.get`. **Implementazione:** padre e figli si leggono insieme con `ctx.issues.getSubtree` (capability `issue.subtree.read`), esclusi i task nascosti; un padre non leggibile rende i figli "Senza padre" |
| Percentuale task padre | figli `done` / figli totali (esclusi `cancelled`). **Implementazione:** su tutti i figli, anche quelli fuori dalla finestra visibile; 100 se il padre è `done` |
| Percentuale task singolo | 1) riportata dall'agente con lo strumento `report_progress` (stato del plugin, scope `issue`); 2) checklist del documento `plan` (`- [x]` / caselle totali); 3) stima dallo stato. **Implementazione:** prima di tutto `done` = 100; tra 1) e 2) i sotto-task, se il task è a sua volta un padre; il valore riportato è letto dall'indice di company `reported-progress` ed è azzerato se il task viene riaperto o passa a un'altra persona |
| Stima dallo stato | backlog 0 · todo 5 · in_progress 40 · in_review 85 · blocked = ultimo valore noto o 40 · done 100. **Implementazione:** anche cancelled 0, stati sconosciuti = ultimo valore noto o 0; l'ultimo valore noto è solo in memoria |
| Passaggi di mano e cronologia | eventi `issue.created`, `issue.updated` (con `changes.assigneeAgentId/assigneeUserId/status`), salvati nello stato del plugin (ultimi 300 per company). **Implementazione:** cronologia (300) e feed (100) sono due chiavi distinte, `history` e `feed` |
| Run degli agenti | eventi `agent.run.started/finished/failed` + `agent.status`. **Implementazione:** anche `agent.run.cancelled` (chiude il run senza record); `agent.status_changed` non viene mai emesso dall'host, quindi lo stato `running` si deduce dai run e la lista agenti si rilegge su `agent.created/updated/error_cleared`; dopo un riavvio i run in corso si ricavano da `activeRun` dei task; un run senza fine da più di 6 ore è ignorato |

## Stati visivi delle persone

Regole valutate in quest'ordine (la prima che vale vince). Tempi configurabili dove indicato.

| Stato | Quando | Posa |
| --- | --- | --- |
| `paused` | agente in pausa (**Implementazione:** anche terminato, "Non più attivo"; gli agenti terminati compaiono solo se hanno task) | `rest` |
| `confused` | `status = error`, oppure ultimo run fallito negli ultimi 10 min, oppure un suo task è tornato indietro negli ultimi 2 min (**Implementazione:** "tornato indietro" = rilavorazione dopo la revisione, riapertura, oppure task in revisione restituito verso il basso nella catena a chi l'aveva già avuto; vedi [stati-e-percentuali.md](stati-e-percentuali.md#rimbalzi)) | `confused` |
| `success` | ha chiuso un task (o un suo task è stato approvato) negli ultimi 90 s | `success` |
| `listening` | ha ricevuto un task negli ultimi 60 s | `listening` |
| `working` | run in corso (`status = running` o `run_started` senza fine) | `working` |
| `thinking` | ha in mano un task `in_review` | `thinking` |
| `idle` | ha task aperti (da fare) | `idle` |
| `sleepy` | nessun task aperto e nessuna attività da `sleepAfterMinutes` (default 15) | `sleepy` |
| `idle` | altrimenti ("Libero") | `idle` |
| `waiting` | (solo utenti) ha task aperti assegnati (**Implementazione:** altrimenti `idle` "Nessun task") | — (**Implementazione:** posa `idle`; gli utenti hanno un'icona, non un personaggio) |

La UI applica anche "flash" locali immediati quando arriva un evento dallo stream (ricevuto, fatto, rimandato), senza aspettare il nuovo snapshot. **Implementazione:** gli eventi arrivano dal polling; flash anche per bloccato, in revisione, run iniziato/fallito; durate e tabella in [stati-e-percentuali.md](stati-e-percentuali.md#effetti-immediati-nella-pagina-ui).

## Personaggi

URL: `/api/agent-avatars/cap-v1/<paletteId>/<posa>.png?size=128&scale=1`. Se l'agente ha una foto caricata (`appearance.customAvatarAssetId`) si usa `/api/assets/<id>/content` e le pose diventano solo animazioni CSS.

## Aggiornamento in diretta

- Canale stream `org-flow` (`STREAM_CHANNEL`).
- Ad ogni evento rilevante il worker emette subito `{ type: "event", record }` e, dopo 600 ms di debounce, `{ type: "snapshot", snapshot }`.
- La UI carica lo snapshot iniziale con `usePluginData("snapshot")`, poi lo sostituisce con quelli in arrivo dallo stream; ogni 60 s chiede un refresh leggero (fallback se lo stream cade) e aggiorna i tempi relativi.

**Implementazione:** in Paperclip 2026.1023.0 lo stream dei plugin non è collegato dall'host (501). Il canale principale è il polling:

- data key `events` 3 s dopo la risposta precedente (6 s dopo un errore) con un cursore opaco (`seq:<epoca>:<n>`): restituisce i record nuovi in ordine di pubblicazione e `snapshotAt`;
- `snapshot` richiesto quando arrivano record nuovi o `snapshotAt` è più recente, e comunque ogni 30 s;
- azione `refresh` ogni 60 s (stati che dipendono dal tempo);
- polling fermo con la scheda nascosta; indicatore "Live" / "Connessione…" / "Non raggiungibile" (dopo 3 errori consecutivi).

Il worker emette comunque sullo stream; se l'host lo collega, la UI lo usa e il polling scende a ogni 30 s. Dettagli in [architettura.md](architettura.md#polling-al-posto-dello-stream).

## Strumento per gli agenti

`report_progress` (capability `agent.tools.register`): parametri `issue` (id o identificatore, es. `FRA-62`), `percent` (0–100), `note` (opzionale, max 200 caratteri). Salva nello stato del plugin, emette un evento `progress`. Solo per task assegnati all'agente che chiama (o ai suoi sottoposti, se disponibile la catena).

**Implementazione:** rifiuta i task chiusi e quelli assegnati a utenti o non assegnati; accetta `percent` anche come testo (`"40%"`); il valore è azzerato se il task viene riaperto o passa a una persona diversa da chi l'ha riportato; i valori più vecchi di 30 giorni vengono scartati. Le istruzioni degli agenti non sono state modificate. Dettagli in [agenti-e-percentuale.md](agenti-e-percentuale.md).

## Impostazioni (instanceConfigSchema)

`sleepAfterMinutes` (default 15), `keepClosedHours` (default 24), `enableSimulation` (default true).

**Implementazione:** limiti 1–1440 minuti e 0–720 ore; le impostazioni sono per company (`multiCompanyConfig: true`); valori non validi sono rifiutati dalla validazione e, se presenti, riportati nei limiti o al predefinito. Vedi [installazione.md](installazione.md#impostazioni).

## Modalità simulazione

Interruttore "Simulazione" nella pagina (visibile se `enableSimulation`): usa persone e personaggi reali e genera task ed eventi finti, come il prototipo. Etichetta ben visibile "Simulazione — dati finti". Non scrive nulla su Paperclip.

**Implementazione:** un tick al secondo, ogni tick vale un minuto simulato; regole degli stati semplificate (es. "Dorme da N min" dopo 5 minuti simulati).

## Requisiti non funzionali

- Tema chiaro e scuro con le variabili CSS di Paperclip (`--background`, `--foreground`, `--muted-foreground`, `--border`, `--card`, `--accent`).
- CSS con prefisso `of-` iniettato una sola volta; niente librerie UI esterne.
- `prefers-reduced-motion`: niente animazioni di volo/rimbalzo.
- Usabile su telefono (organigramma scorrevole in orizzontale nel suo contenitore).
- Il worker non deve mai far cadere un evento per un errore di arricchimento: in caso di errore registra un warning e prosegue.
- Nessuna scrittura su task, agenti o altri dati core di Paperclip.
- **Implementazione:** nessuna chiamata all'host dopo che un gestore data/action/tool ha risposto (l'host la rifiuta); lo stato salvato non viene sovrascritto finché non è stato letto con successo.
