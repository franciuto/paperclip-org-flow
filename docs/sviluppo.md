# Sviluppo

Come è organizzato il repo, come si prova e quali convenzioni seguire. Per l'architettura vedi [architettura.md](architettura.md), per il rilascio [installazione.md](installazione.md#aggiornamento).

## Struttura del repo

```
org-flow/
├── src/
│   ├── manifest.ts            manifest del plugin (id, capability, slot, schema impostazioni, strumento)
│   ├── worker.ts              entry del worker: sottoscrizioni, bridge, strumento, health, config
│   ├── shared/types.ts        contratto dati tra worker e UI
│   ├── worker/                logica del worker (moduli puri + service.ts con lo stato)
│   └── ui/
│       ├── index.tsx          export degli slot: OrgFlowPage, OrgFlowSidebarLink, OrgFlowDashboardWidget
│       ├── components/        Page, OrgChart, Panels, Widget, Avatar
│       ├── useLive.tsx        polling + stream
│       ├── poll.ts            regole pure del polling (una richiesta alla volta, cursore bloccato), annunci, tastiera
│       ├── hooks.ts           orologio, reduced motion, simulazione
│       ├── model.ts           dati derivati per la vista (puro)
│       ├── presence.ts        effetti immediati degli eventi (puro)
│       ├── layout.ts, chips.ts  disposizione dell'organigramma e dei chip (puri)
│       ├── format.ts          testi, date, colori (puro)
│       ├── simulator.ts       modalità simulazione (puro, deterministico dato un seme)
│       └── styles.ts          tutto il CSS, iniettato una volta
├── tests/
│   ├── *.spec.ts              test vitest (worker, UI pura, manifest)
│   └── ui/                    banco di prova visivo (harness, stub dell'SDK, fixture, screenshot)
├── prototype/                 prototipo statico di riferimento e pose dei personaggi
├── docs/                      documentazione (questa cartella), img/ con gli screenshot
├── dist/                      build (ignorato da git)
├── esbuild.config.mjs         build con i preset dell'SDK
├── tsconfig.json, vitest.config.ts
└── package.json
```

`dist/` è nel `.gitignore`: in produzione si costruisce nel submodule ([installazione.md](installazione.md)).

## Script

Con Node nel `PATH` (`export PATH="$HOME/.local/node/bin:$PATH"`):

| Comando | Cosa fa |
| --- | --- |
| `npm ci` | installa le dipendenze bloccate da `package-lock.json` |
| `npm run build` | build di worker, manifest e UI in `dist/` (`esbuild.config.mjs`, preset `createPluginBundlerPresets`) |
| `npm run dev` | build in watch. Ricarica il plugin solo se Paperclip lo esegue da questa cartella: in produzione non è così |
| `npm run typecheck` | `tsc --noEmit` su `src` e `tests` |
| `npm test` | test vitest (`tests/**/*.spec.ts`) |
| `npm run test:ui [nome …]` | banco di prova visivo: build dell'harness e screenshot con Chromium headless in `tests/ui/out/` |

Prima di un commit: `npm run typecheck && npm test && npm run build`.

## Test

### Unità (vitest)

| File | Copre |
| --- | --- |
| `tests/feed.spec.ts` | eventi → record, `pushRecent`, paginazione di `events` |
| `tests/history.spec.ts` | cronologia, percorsi, rimbalzi, segnali per persona |
| `tests/progress.spec.ts` | stima dallo stato, checklist, conteggio figli, ordine delle fonti |
| `tests/presence.spec.ts` | ordine delle regole degli stati visivi |
| `tests/snapshot.spec.ts` | assemblaggio dello snapshot, gruppi, persone, mapper dell'host |
| `tests/colors.spec.ts` | colori stabili e leggibili |
| `tests/settings-tool.spec.ts` | impostazioni, parametri e permessi di `report_progress` |
| `tests/manifest.spec.ts` | manifest valido per il validatore dell'host; versione, slot, strumento, capability |
| `tests/worker.spec.ts` | worker completo con l'harness dell'SDK (`@paperclipai/plugin-sdk/testing`): eventi, debounce, polling, stato salvato, più company, strumento, health, impostazioni |
| `tests/ui-*.spec.ts` | parti pure della UI: formattazione, modello, layout, effetti degli eventi, simulatore |

I moduli puri si testano direttamente. Il worker si testa con l'harness dell'SDK, che simula host, eventi e stato.

### Banco di prova visivo

`tests/ui/` monta i tre componenti della UI in una pagina statica, con uno stub dell'SDK (`sdk-stub.tsx`) che si comporta come l'host di produzione:

- `usePluginData` risponde a `snapshot` ed `events` da un archivio in memoria;
- `usePluginStream` non si connette mai (come il 501 reale);
- una sequenza di eventi (`BUSY_SCRIPT`) viene pubblicata nel tempo, con lo snapshot aggiornato 600 ms dopo ogni evento.

Le fixture (`fixtures.ts`) sono una company finta con nomi e palette reali; le etichette di stato sono scritte a mano e in parte vengono dalla simulazione (es. "Smista FRA-64"), non dal worker.

`npm run test:ui` costruisce `tests/ui/out/harness.js`, avvia `tests/ui/serve.py` su una porta casuale e cattura:

| Nome | Vista |
| --- | --- |
| `busy-light`, `busy-dark` | pagina con lavoro in corso, tema chiaro e scuro |
| `busy-selected-task` | scheda di un task (`FRA-59`) aperta |
| `busy-selected-person` | scheda di una persona, tema scuro |
| `quiet-light`, `quiet-dark` | nessun task aperto |
| `phone` | larghezza 400 px |
| `widget`, `widget-quiet-dark` | riquadro della Dashboard e link nella barra laterale |
| `simulation` | simulazione attiva |
| `offline` | polling che fallisce sempre ("Non raggiungibile") |
| `chip-zoom` | ingrandimento di un chip (`FRA-56`), per controllare che il testo ci stia |

Per una sola cattura: `npm run test:ui busy-dark phone`.

Per guardare gli screenshot: aprili da `tests/ui/out/*.png` (cartella ignorata da git). Quelli usati nella documentazione sono copiati a mano in `docs/img/`; ricopiali quando la UI cambia in modo visibile.

Per usare l'harness dal vivo nel browser:

```bash
npm run test:ui busy-light                  # costruisce tests/ui/out/harness.js
python3 tests/ui/serve.py 8765              # ascolta solo su 127.0.0.1
# dal portatile: ssh -L 8765:127.0.0.1:8765 ai-pi
# poi http://localhost:8765/?fixture=busy
```

Parametri della pagina: `view=page|widget`, `fixture=busy|quiet`, `dark=1`, `sim=1` (attiva la simulazione), `select=FRA-59` o `select=person:<nome>`, `script=0` (niente eventi scriptati), `eventsFail=1` (ogni polling fallisce), `zoomchip=FRA-56&zoom=4` (ingrandisce un chip). `serve.py` serve le pose da `prototype/poses/` e il font Inter dall'installazione di Paperclip.

### Prototipo

`prototype/org-flow.src.html` è il prototipo statico da cui è nata la UI. `python3 prototype/build.py` produce `prototype/org-flow.html` con le pose incluse come data URI (file unico da aprire nel browser). `prototype/poses/` contiene le pose delle 8 palette di Paperclip (anche `loading`, non usata dal plugin).

## Convenzioni

### Contratto

- Tutto quello che passa tra worker e UI è in `src/shared/types.ts`. Una modifica lì va fatta nello stesso commit in worker, UI, test e [contratto-dati.md](contratto-dati.md). Regole di compatibilità in [contratto-dati.md](contratto-dati.md#regole-di-versionamento).
- Chiavi del bridge e nome dello strumento sono costanti in `types.ts`: non scrivere le stringhe a mano.

### Worker

- Regole nei moduli puri, chiamate all'host solo in `service.ts`.
- Nessuna chiamata all'host dopo che un gestore data/action/tool ha risposto: l'host la rifiuta. Il lavoro "dopo" (timer) parte solo dai gestori di eventi. Dettagli in [architettura.md](architettura.md#limiti-dellhost-e-come-sono-aggirati).
- Un evento non deve mai cadere per un errore di arricchimento: `try/catch`, warning, si pubblica comunque.
- Il plugin non scrive su task, agenti o altri dati di Paperclip: solo nel proprio stato.
- I messaggi di log iniziano con `org-flow:` e sono in italiano.

### UI

- Testi per l'utente in italiano. Le funzioni di formato sono in `src/ui/format.ts` (`relativeTime`, `formatDuration`, `statusLabel`, `plural`, …).
- CSS solo in `src/ui/styles.ts`, tutte le classi con prefisso `of-`, iniettato una volta come `<style id="of-styles">` (`useStyles`). Niente librerie UI esterne.
- Colori dalle variabili del tema di Paperclip (`--background`, `--foreground`, `--card`, `--muted`, `--muted-foreground`, `--border`, `--font-sans`, `--font-mono`, …) attraverso le variabili `--of-*`; il tema scuro si attiva con la classe `.dark` dell'host.
- `prefers-reduced-motion`: niente voli, niente animazioni (blocco in fondo a `styles.ts`).
- Accessibilità: persone e chip sono pulsanti raggiungibili da tastiera con `aria-label` completo; gli eventi nuovi sono annunciati ai lettori di schermo in una regione `aria-live` nascosta, al massimo uno ogni 8 s (20 s in simulazione), mai l'intero feed (`announce` in `src/ui/poll.ts`).
- Usabile a 400 px: l'organigramma scorre in orizzontale nel suo contenitore.
- Calcoli in moduli puri (`model.ts`, `presence.ts`, `layout.ts`, …) con test in `tests/ui-*.spec.ts`; i componenti restano sottili.
- La UI non chiama le API di Paperclip, tranne le immagini (pose `/api/agent-avatars/cap-v1/<palette>/<posa>.png`, foto `/api/assets/<id>/content`) e i link di navigazione.

### Versione e documentazione

- Versione del plugin in `src/manifest.ts` (quella che vede Paperclip); tieni allineato `package.json`.
- Ogni rilascio: voce in [CHANGELOG.md](../CHANGELOG.md). Ogni scelta non ovvia: voce in fondo a [decisioni.md](decisioni.md). Se cambia un comportamento descritto in [specifica.md](specifica.md), aggiorna anche quella.

## Aggiungere un nuovo stato visivo

Esempio: uno stato `blocked` per gli agenti fermi su un task bloccato.

1. **Contratto** (`src/shared/types.ts`): aggiungi il valore a `VisualState` e la posa in `POSE_FOR_STATE`. Le pose esistenti sono `rest`, `idle`, `listening`, `thinking`, `working`, `success`, `confused`, `sleepy`: usa una di queste, Paperclip non ne serve altre.
2. **Regola** (`src/worker/presence.ts`): inserisci la regola in `computePresence` nel punto giusto dell'ordine, con etichetta in italiano. Se dipende da un tempo, una costante `…_WINDOW_MS` esportata.
3. **Segnali**: se serve un dato nuovo, aggiungilo a `PresenceInput` e calcolalo in `deriveSnapshot` (`src/worker/snapshot.ts`) o in `personSignals` (`src/worker/history.ts`).
4. **Test**: caso in `tests/presence.spec.ts` (ordine rispetto alle regole vicine) e, se serve, in `tests/snapshot.spec.ts`.
5. **Aspetto** (`src/ui/styles.ts`): regole `.of-node[data-state="blocked"]` per l'etichetta (`.of-stl`), l'animazione (`.of-bob`) ed eventuali effetti (`Effects` in `OrgChart.tsx`: `of-zzz`, `of-typing`, `of-thought`, `of-bang`, `of-huh`, `of-spark`). Ricorda il blocco `prefers-reduced-motion`.
6. **Effetto immediato** (facoltativo, `src/ui/presence.ts`): caso in `effectsOfRecord` se lo stato deve comparire subito all'arrivo di un evento; test in `tests/ui-presence.spec.ts`.
7. **Contatori** (facoltativo): `liveCounts` in `src/ui/model.ts` e `KpiStrip` in `Panels.tsx`; se va anche in `Snapshot.counts`, è una modifica di contratto.
8. **Simulazione** (facoltativo): `visual()` in `src/ui/simulator.ts`.
9. **Banco di prova**: una persona nella fixture `busySnapshot` con il nuovo stato, `npm run test:ui`, controlla gli screenshot chiaro e scuro.
10. **Documenti**: tabelle in [stati-e-percentuali.md](stati-e-percentuali.md) e [contratto-dati.md](contratto-dati.md), voce nel changelog.

## Aggiungere un campo end-to-end

Esempio: `TaskView.dueAt` con la scadenza del task.

1. **Host → copia leggera**: aggiungi il campo a `IssueLite` e leggilo in `toIssueLite` (`src/worker/snapshot.ts`), con `toIso` per le date. Test in `tests/snapshot.spec.ts` ("host mappers").
2. **Contratto**: aggiungi `dueAt: string | null` a `TaskView` in `src/shared/types.ts` con un commento.
3. **Snapshot**: valorizzalo in `deriveSnapshot`. Se il campo cambia spesso, ricorda che l'impronta dello snapshot include tutto: ogni cambio produce una nuova versione.
4. **Eventi**: se un cambio del campo deve aggiornare subito lo snapshot, aggiungi la chiave a `RELEVANT_CHANGES` in `service.ts`.
5. **UI**: mostralo (es. in `TaskCard`, `Panels.tsx`), formattato con `format.ts`, testo in italiano. Gestisci `undefined` (snapshot di un worker più vecchio).
6. **Simulazione e fixture**: aggiungi il campo a `simulationSnapshot` (`simulator.ts`) e alle fixture (`tests/ui/fixtures.ts`), altrimenti `typecheck` fallisce.
7. **Test e build**: `npm run typecheck && npm test && npm run build && npm run test:ui`.
8. **Documenti**: riga nella tabella di `TaskView` in [contratto-dati.md](contratto-dati.md), changelog.

Per un campo salvato nello stato del plugin (feed, cronologia), segui anche la regola 5 di compatibilità: le versioni nuove devono leggere i dati scritti dalle vecchie.

Se serve una capability nuova dell'host, aggiungila al manifest: all'aggiornamento Paperclip può chiedere di approvarla (`upgrade_pending`).
