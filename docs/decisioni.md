# Decisioni

Registro delle scelte prese durante lo sviluppo, con il motivo. Le più recenti in fondo.

## 2026-11-19 — notte (sviluppo della 1.0 in autonomia)

**Plugin e non patch del codice di Paperclip.** Un plugin vive fuori dalla cartella di installazione di Paperclip (`~/.paperclip/cli/installs/...`) e sopravvive agli aggiornamenti; una patch dell'interfaccia andrebbe riapplicata a ogni versione.

**Non si sostituisce la Dashboard nativa.** Paperclip riserva la rotta `/dashboard` (`PLUGIN_RESERVED_COMPANY_ROUTE_SEGMENTS`) e non ha un'impostazione per la pagina iniziale. Org Flow quindi ha la sua pagina (`/<company>/org-flow`), un link nella barra laterale e un riquadro (`dashboardWidget`) nella Dashboard nativa.

**Repository.** Repo privato `franciuto/paperclip-org-flow`, con il plugin alla radice, il prototipo in `prototype/` e la documentazione in `docs/`. Entra in `ai-final-boss` come submodule in `paperclip-plugins/org-flow`: una cartella nuova, perché `plugins/` di `ai-final-boss` contiene plugin di Claude, non di Paperclip. Nel commit di `ai-final-boss` sono stati inclusi solo `.gitmodules` e il submodule; le altre modifiche non committate presenti nel repo non sono state toccate.

**Polling invece dello stream.** L'SDK prevede lo streaming in tempo reale verso la UI (`ctx.streams` / `usePluginStream`), ma in Paperclip 2026.1023.0 il server non collega lo "stream bus" alle rotte dei plugin: `GET /api/plugins/:id/bridge/stream/:canale` risponde 501. Lo stesso vale per la 2026.1106.0 (verificato sul pacchetto npm). La UI quindi interroga il worker ogni ~3 secondi chiedendo solo gli eventi nuovi (data key `events`), che vengono serviti dalla memoria del worker: costo trascurabile. Il worker continua a emettere anche sullo stream, così quando Paperclip lo abiliterà la UI lo userà senza modifiche.

**Percentuale dei task.** Paperclip non ha una percentuale per i task. Ordine delle fonti: valore riportato dall'agente con lo strumento `report_progress` → checklist del documento `plan` → stima dallo stato. La UI mostra sempre da dove viene il numero. Per i task padre il valore è reale: figli chiusi / figli totali (esclusi gli annullati). Le istruzioni degli agenti non sono state modificate: usare `report_progress` è una scelta da fare in seguito (vedi [agenti-e-percentuale.md](agenti-e-percentuale.md)).

**Modalità simulazione.** In produzione quasi tutti i task sono chiusi e gli agenti lavorano a run brevi: la pagina reale è spesso tranquilla. Per vederla animata c'è un interruttore "Simulazione" che usa le persone e i personaggi reali con task finti, segnalato in modo evidente e senza scritture su Paperclip. Si può nascondere dalle impostazioni del plugin (`enableSimulation`).

**Nessuna scrittura su Paperclip.** Il plugin legge agenti, task e documenti e scrive solo nel proprio stato (cronologia eventi, percentuali riportate). Niente azioni che modificano task o agenti: le approvazioni si fanno dalle pagine native.

**Verifica in produzione senza creare task di prova.** I test end-to-end usano l'azione `ping` del plugin e gli eventi reali degli agenti, invece di creare task finti nell'istanza, che avrebbero potuto svegliare gli agenti e generare costi.

## 2026-11-19 — implementazione della 1.0 (ricavate dal codice durante la stesura della documentazione)

**Liste dei task una per stato, senza `limit`.** `ctx.issues.list` inoltra all'host solo alcuni filtri e la paginazione con `offset` non è affidabile. Il worker fa una chiamata per ogni stato aperto (ogni 60 s o dopo un evento) e una per `done` e `cancelled` (ogni 5 minuti, perché gli eventi li aggiornano nel frattempo). In memoria restano i chiusi delle ultime `max(keepClosedHours, 24)` ore.

**Padri con `getSubtree`.** Un'unica lettura dà il padre e tutti i figli, anche quelli chiusi da tempo: la percentuale del padre è sui figli reali, non solo su quelli visibili. I task nascosti (`hiddenAt`), che `getSubtree` restituisce, sono esclusi. Un padre non leggibile rende i figli "Senza padre" invece di bloccare lo snapshot.

**Nessun lavoro dopo la risposta al bridge.** L'host rifiuta le chiamate fatte da un gestore data/action/tool dopo che ha risposto. `ping`, `refresh` e `report_progress` completano lo snapshot prima di rispondere; il debounce dello snapshot parte solo dai gestori di eventi, il cui scope resta valido circa 15 minuti.

**Stato degli agenti dedotto dai run.** Paperclip non emette `agent.status_changed`. `agent.run.started` porta l'agente a `running`, la fine del run a `idle` (tranne pausa e terminato); `agent.updated` fa rileggere la lista. Dopo un riavvio i run in corso si ricavano dal `activeRun` dei task; un run senza fine da più di 6 ore è ignorato. Ogni evento di run fa rileggere le liste, perché i run spostano i task senza evento di attività.

**Cursore di polling per sequenza di pubblicazione.** I record non arrivano in ordine di `occurredAt` (l'arricchimento può ritardarne uno). Un cursore per data perderebbe record; il cursore è quindi `seq:<epoca del worker>:<n>`. Dopo un riavvio l'epoca cambia e la UI riceve gli ultimi 20 record, che deduplica per id. I cursori ISO restano accettati con 15 s di sovrapposizione. Nella UI il polling parte solo dopo la risposta precedente (con un tetto di 15 s), perché `refresh()` dell'host annulla la richiesta in corso senza interromperla.

**Versione dello snapshot solo se cambia il contenuto.** `generatedAt` cambia solo quando cambia l'impronta del contenuto: il polling di `events` può confrontare `snapshotAt` e la UI scarica lo snapshot solo quando serve.

**Rimbalzi: solo il lavoro che torna indietro.** Un rimbalzo è una rilavorazione dopo la revisione (`in_review` → `todo`/`in_progress`), una riapertura (`done` → `todo`/`in_progress`/`in_review`) o un task in revisione restituito verso il basso nella catena di riporto a chi l'aveva già avuto. Delegare verso il basso, restituire verso l'alto (revisione, aiuto, blocco, lavoro finito), ripassare dopo un'escalation e l'approvazione con ritorno all'implementatore sono il flusso normale di Paperclip e non contano; nemmeno `backlog`, `blocked` e `cancelled`. La prima regola, "A→B→A conta 1", segnava come rimbalzo ogni ciclo di revisione.

**Percentuale riportata azzerata al cambio di mano.** Il valore di `report_progress` è la stima di chi l'ha dato: si azzera se il task viene riaperto o passa a una persona diversa da chi l'ha riportato; resta se cambia solo lo stato. Così un task riaperto non riparte da un vecchio 90%.

**Stato salvato protetto da letture fallite.** Finché feed, cronologia e percentuali non sono stati letti con successo, il worker non salva nulla e riprova la lettura dopo 10 s: un salvataggio dopo una lettura fallita sovrascriverebbe la cronologia con una quasi vuota.

**Utenti del board senza nome.** Il plugin non chiede `access.members.read`: gli utenti umani compaiono come "Board", "Board 2", … Meno permessi, e in questa istanza c'è un solo utente.

**Etichette di stato calcolate dal worker.** Il worker produce `stateLabel` in italiano insieme allo stato, così pagina, widget e test vedono lo stesso testo; la UI sovrascrive l'etichetta solo durante i flash locali.

**Produzione dal submodule, non dalla cartella di sviluppo.** Paperclip ricarica un plugin installato con `--local` quando cambia la sua cartella. Installare la produzione da `~/workdir/Repos/org-flow` porterebbe in produzione ogni build di prova; la produzione si installa da `~/ai-final-boss/paperclip-plugins/org-flow`. Al 2026-11-19 la 0.1.0 risulta ancora installata da `/home/franciuto/workdir/Repos/paperclip-org-flow/paperclip-plugin-org-flow`: il passaggio al submodule è descritto in [installazione.md](installazione.md#prima-installazione).
