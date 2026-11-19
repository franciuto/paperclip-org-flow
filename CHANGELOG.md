# Changelog

Versioni di Org Flow. La versione che vede Paperclip è quella in `src/manifest.ts`.

## [1.2.0] — 2026-11-19

### Aggiunto

- Titolo di ogni agente sotto il nome, preso da Paperclip (campo titolo dell'agente). Se in Paperclip il titolo è vuoto si usa l'etichetta del ruolo di Paperclip (`AGENT_ROLE_LABELS`, per esempio `ceo` → "CEO"). Lo stato ("Dorme", "Lavora su…") scende di una riga.
- Pulsante "Schermo intero" nell'intestazione: usa lo schermo intero del browser; dove non è disponibile (per esempio Safari su iPhone) la pagina copre tutta l'interfaccia di Paperclip. Si esce con Esc o con lo stesso pulsante.

## [1.1.0] — 2026-11-19

### Cambiato

- Pagina riorganizzata: intestazione compatta su una riga; organigramma a tutta pagina (largo quanto la pagina, alto quanto lo schermo, scalato per starci tutto; su telefono scorre di lato) con spaziature più ampie.
- La scheda di dettaglio di task e persone scorre sopra il bordo destro dell'organigramma (su telefono sale dal basso); si chiude con × o Esc, il focus entra nella scheda e torna dov'era alla chiusura.
- Task padre, riepilogo "Adesso", attività in diretta e "Chiusi di recente" sono sezioni a scomparsa sotto l'organigramma, ricordate nel browser, con "Comprimi tutto / Espandi tutto".

### Aggiunto

- Reparti: ogni reparto (sotto-albero di un riporto diretto del CEO) è racchiuso in un riquadro neutro con nome e numero di persone. Con un worker che non manda i reparti la pagina li ricava dalla catena di riporto ("Team di <nome>").

## [1.0.0] — 2026-11-19

Prima versione completa. Specifica in [docs/specifica.md](docs/specifica.md).

### Aggiunto

- Pagina `/<prefisso>/org-flow` con:
  - striscia dei task padre con avanzamento reale (figli chiusi / figli totali, annullati esclusi) e persone coinvolte; clic per evidenziare un gruppo;
  - riepilogo "Al lavoro", "Rivedono", "Dormono", "Aspettano te";
  - organigramma live con i personaggi di Paperclip, stati visivi (`working`, `thinking`, `listening`, `success`, `confused`, `sleepy`, `idle`, `paused`, `waiting`) e chip dei task in mano con stato e percentuale;
  - volo animato del chip nei passaggi di mano e stati immediati all'arrivo degli eventi;
  - schede di dettaglio del task (fonte della percentuale, percorso con i tempi, rimbalzi, link a Paperclip) e della persona (task per gruppo, statistiche 24 h);
  - feed "Attività in diretta";
  - stato tranquillo con i task chiusi di recente;
  - modalità Simulazione con dati finti, senza scritture.
- Riquadro per la Dashboard di Paperclip (`dashboardWidget`).
- Percentuale dei task da quattro fonti: valore riportato dall'agente, sotto-task, checklist del documento `plan`, stima dallo stato.
- Strumento per gli agenti `report_progress` (`issue`, `percent`, `note`), limitato ai task propri e dei sottoposti.
- Cronologia dei passaggi nello stato del plugin (ultime 300 voci per company): percorsi, rimbalzi, statistiche.
- Colori stabili per task padre.
- Impostazioni per company: `sleepAfterMinutes`, `keepClosedHours`, `enableSimulation`.
- Aggiornamento in diretta via polling (`events` ogni 3 s con cursore, `snapshot` su richiesta, `refresh` ogni 60 s); lo stream resta pronto per quando Paperclip lo collegherà.
- Azioni `ping` (evento di prova) e `refresh`.
- Tema chiaro e scuro, layout per telefono, `prefers-reduced-motion`.
- Banco di prova visivo con screenshot (`npm run test:ui`).
- Documentazione in `docs/`.

### Modificato

- Il feed è salvato nella chiave `feed` (prima `recent-feed`, che viene ancora letta se `feed` è vuota).
- Nuove capability: `issue.subtree.read`, `issue.documents.read`, `agent.tools.register`, `ui.dashboardWidget.register`. All'aggiornamento Paperclip può chiedere di approvarle.

## [0.1.0] — 2026-11-19

Installata in produzione il 2026-11-19 verso le 00:15 (backup `~/.paperclip/backups-manual/pre-plugin-org-flow-install-20261119-001550.dump`).

### Aggiunto

- Versione minima per verificare eventi e streaming.
- Worker che ascolta `issue.created`, `issue.updated`, `agent.run.started/finished/failed` e li trasforma in un feed di passaggi di mano, cambi di stato e run, con nomi e titoli.
- Feed degli ultimi 100 eventi per company nello stato del plugin (chiave `recent-feed`), data key `recent`, azione `ping`.
- Pagina `org-flow` con il feed e link nella barra laterale.
- Prototipo statico, contratto dati e specifica della 1.0.

Con questa versione si è verificato che lo stream dei plugin non è collegato dall'host (501): vedi [docs/decisioni.md](docs/decisioni.md).
