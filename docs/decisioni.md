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
