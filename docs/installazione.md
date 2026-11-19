# Installazione, aggiornamento e verifiche

Procedure per l'istanza di produzione su `ai-pi`. Tutti i comandi si lanciano su `ai-pi` come utente `franciuto`.

## Riferimenti

| Cosa | Valore |
| --- | --- |
| Paperclip in produzione | 2026.1023.0 (`~/.paperclip/cli/install.json`) |
| Server | `100.104.9.110:3100` (solo tailnet), pubblicato su `https://agents.franciuto.com` |
| Chiave del plugin | `franciuto.org-flow` |
| Id del plugin nel database | `5e51d4f3-8ea9-4619-ae76-949c682b4562` (resta lo stesso dopo disinstallazione senza `--force` e reinstallazione) |
| Company | `franciuto.com`, id `625d6460-25f1-49d6-88c2-7feb4ad5924e`, prefisso `FRA` |
| Pagina | `https://agents.franciuto.com/FRA/org-flow` |
| Repo | `franciuto/paperclip-org-flow` (privato) |
| Sviluppo | `~/workdir/Repos/org-flow` |
| Produzione | submodule `~/ai-final-boss/paperclip-plugins/org-flow` di `franciuto/ai-final-boss` |
| Node | `~/.local/node/bin` (v26) |

## Prerequisiti

- Node e npm nel `PATH`. `npm` senza `node` nel `PATH` fallisce con `env: 'node': No such file or directory`:

  ```bash
  export PATH="$HOME/.local/node/bin:$PATH"
  ```

- CLI `paperclipai` autenticata. Il token in `~/.paperclip/auth.json` è registrato sotto la chiave `https://agents.franciuto.com:` (con i due punti finali), quindi ogni comando va lanciato con:

  ```bash
  --api-base "https://agents.franciuto.com:"
  ```

  L'utente è amministratore dell'istanza: serve per installare, disinstallare e cambiare le impostazioni.
- Accesso git al repo privato (per `git submodule update`).
- Solo per il banco di prova visivo: Chromium (`/usr/bin/chromium`) e `python3`.

Per brevità negli esempi:

```bash
export PATH="$HOME/.local/node/bin:$PATH"
PC="paperclipai --api-base https://agents.franciuto.com:"
```

## Backup prima di toccare il database

Installare, disinstallare e cambiare impostazioni scrive nel database di Paperclip. La convenzione è un dump in `~/.paperclip/backups-manual/` prima di ogni modifica. Gli strumenti Postgres sono in `~/.paperclip/pg18/root` e richiedono la libpq inclusa:

```bash
export LD_LIBRARY_PATH="$HOME/.paperclip/pg18/root/usr/lib/aarch64-linux-gnu"
PGBIN="$HOME/.paperclip/pg18/root/usr/lib/postgresql/18/bin"
# La stringa di connessione contiene la password: si legge dal file senza stamparla.
DBURL=$(python3 -c 'import json,os;print(json.load(open(os.path.expanduser("~/.paperclip/instances/default/config.json")))["database"]["connectionString"])')
"$PGBIN/pg_dump" -Fc -d "$DBURL" -f "$HOME/.paperclip/backups-manual/pre-org-flow-<cosa>-$(date +%Y%m%d-%H%M%S).dump"
```

Sostituisci `<cosa>` (es. `update-1.0`). C'è già `pre-plugin-org-flow-install-20261119-001550.dump`, fatto prima dell'installazione della 0.1.0.

## Prima installazione

Situazione al 2026-11-19: la 0.1.0 è installata dalla cartella di prova `/home/franciuto/workdir/Repos/paperclip-org-flow/paperclip-plugin-org-flow` (stato `ready`). Il passaggio alla 1.0 sposta l'installazione sul submodule.

1. Backup (sezione sopra).
2. Prepara il submodule alla versione voluta e costruiscilo:

   ```bash
   cd ~/ai-final-boss
   git submodule update --init --remote paperclip-plugins/org-flow   # oppure checkout di un commit preciso dentro il submodule
   cd paperclip-plugins/org-flow
   npm ci
   npm run build
   ls dist/manifest.js dist/worker.js dist/ui/index.js
   ```

3. Se è installata una versione da un altro percorso, disinstallala **senza** `--force`. La riga del plugin resta (stato `uninstalled`) con il suo id, la configurazione e lo stato salvato:

   ```bash
   $PC plugin uninstall franciuto.org-flow
   ```

4. Installa dal submodule. Con `--local` Paperclip esegue il plugin da quel percorso, senza copiarlo:

   ```bash
   $PC plugin install --local ~/ai-final-boss/paperclip-plugins/org-flow
   ```

   Una reinstallazione dopo una disinstallazione morbida riattiva la stessa riga: stesso id, stato salvato conservato (la 1.0 legge anche il feed della 0.1.0, chiave `recent-feed`).
5. Controlla lo stato:

   ```bash
   $PC plugin list
   $PC plugin inspect franciuto.org-flow
   ```

   Deve essere `ready`, versione `1.0.0`, `packagePath` = il submodule. Se è `upgrade_pending` (capability nuove rispetto alla versione registrata: la 1.0 aggiunge `issue.subtree.read`, `issue.documents.read`, `agent.tools.register`, `ui.dashboardWidget.register`), approvale dalla pagina del plugin nelle impostazioni dell'istanza.
6. Apri `https://agents.franciuto.com/FRA/org-flow` e fai le [verifiche](#verifiche).
7. Il riquadro per la Dashboard va aggiunto dalla Dashboard di Paperclip, se l'interfaccia non lo mostra già.

## Aggiornamento

Lo sviluppo si fa in `~/workdir/Repos/org-flow`; la produzione gira dal submodule. Percorso di una modifica:

1. **Sviluppo e test** in `~/workdir/Repos/org-flow`:

   ```bash
   cd ~/workdir/Repos/org-flow
   npm run typecheck && npm test && npm run build
   npm run test:ui          # facoltativo, screenshot in tests/ui/out/
   ```

   Aggiorna `CHANGELOG.md` e la versione in `src/manifest.ts` (e `package.json`).
2. **Commit e push** sul repo `franciuto/paperclip-org-flow`.
3. **Backup** del database se la modifica cambia capability, impostazioni o il formato dello stato salvato.
4. **Aggiorna il submodule** in `ai-final-boss`:

   ```bash
   cd ~/ai-final-boss
   git submodule update --remote paperclip-plugins/org-flow
   git -C paperclip-plugins/org-flow log --oneline -1     # controlla il commit
   ```

5. **Build** nel submodule:

   ```bash
   cd ~/ai-final-boss/paperclip-plugins/org-flow
   npm ci
   npm run build
   ```

6. **Ricarica automatica.** Paperclip osserva la cartella dei plugin installati con `--local` e, quando cambia `dist/`, dopo 500 ms ricarica il plugin: rilegge il manifest e riavvia il worker. Non serve riavviare Paperclip. Controlla:

   ```bash
   $PC plugin list                         # stato ready e versione nuova
   $PC plugin logs franciuto.org-flow      # "org-flow: in ascolto su task, agenti e run"
   ```

   Se la versione aggiunge capability il plugin può fermarsi in `upgrade_pending` finché non le approvi.

   **Verificato il 2026-11-19 con il passaggio 1.0.0 → 1.1.0:** in produzione la ricarica automatica ha aggiornato il bundle della UI, ma il worker e il registro sono rimasti alla versione precedente (`plugin list` mostrava ancora 1.0.0 e lo snapshot non aveva i reparti). Quando cambiano versione, impostazioni (`instanceConfigSchema`), capability o codice del worker, reinstalla dopo un dump del database:

   ```bash
   $PC plugin uninstall franciuto.org-flow    # senza --force: stato e impostazioni restano
   $PC plugin install --local ~/ai-final-boss/paperclip-plugins/org-flow
   $PC plugin list                            # ready e versione nuova
   ```

   Paperclip riusa lo stesso id del plugin, quindi cronologia e percentuali salvate restano.
7. **Ricarica la pagina** nel browser: la UI nuova arriva solo con un ricaricamento.
8. **Registra il puntatore** del submodule in `ai-final-boss`:

   ```bash
   cd ~/ai-final-boss
   git add paperclip-plugins/org-flow
   git commit -m "org-flow: aggiornato a <versione>"
   git push
   ```

Non installare la produzione da `~/workdir/Repos/org-flow`: ogni `npm run build` o `npm run dev` lì ricaricherebbe il plugin in produzione.

## Impostazioni

Definite in `instanceConfigSchema` (`src/worker/settings.ts`). Il plugin le legge per company (`multiCompanyConfig: true`).

| Campo | Titolo in Paperclip | Tipo | Predefinito | Limiti | Effetto |
| --- | --- | --- | --- | --- | --- |
| `sleepAfterMinutes` | Minuti prima di "dorme" | intero | 15 | 1–1440 | un agente senza task aperti e senza attività da questo tempo è mostrato addormentato |
| `keepClosedHours` | Ore di visibilità dei task chiusi | intero | 24 | 0–720 | per quante ore i task `done`/`cancelled` restano nell'organigramma e in "Chiusi di recente" |
| `enableSimulation` | Mostra l'interruttore "Simulazione" | booleano | true | | mostra il pulsante "Simulazione" nella pagina |
| `departmentNames` | Nomi dei reparti | elenco di `{ lead, name }` | `[]` | `name` max 60 caratteri | sostituisce il nome dedotto di un reparto; `lead` è il nome o l'id del responsabile, es. `[{ "lead": "Joe", "name": "Archivio" }]` (vedi [contratto-dati.md](contratto-dati.md#departmentview)) |

Dove cambiarle:

- **Interfaccia di Paperclip**: impostazioni dell'istanza → Plugin → Org Flow (percorso `/FRA/company/settings/instance/plugins/5e51d4f3-8ea9-4619-ae76-949c682b4562`). Il modulo è generato dallo schema.
- **CLI**: il salvataggio sostituisce l'intera configurazione, quindi passa tutti e tre i campi:

  ```bash
  $PC plugin config franciuto.org-flow -C 625d6460-25f1-49d6-88c2-7feb4ad5924e
  $PC plugin config:set franciuto.org-flow -C 625d6460-25f1-49d6-88c2-7feb4ad5924e \
    --payload-json '{"companyId":"625d6460-25f1-49d6-88c2-7feb4ad5924e","configJson":{"sleepAfterMinutes":20,"keepClosedHours":24,"enableSimulation":true}}'
  ```

Validazione (`validateSettings`): valori non interi o fuori dai limiti sono rifiutati con un messaggio in italiano; chiavi sconosciute danno un avviso. Se nel database finisce comunque un valore non valido, il worker lo riporta nei limiti o usa il predefinito (`resolveSettings`). Il worker applica il cambio subito (`onConfigChanged`); al più tardi entro 60 s.

## Disinstallazione e ritorno indietro

Disinstallazione che conserva configurazione e stato (reinstallabile con lo stesso id):

```bash
$PC plugin uninstall franciuto.org-flow
```

Disinstallazione completa, cancella anche configurazione e stato salvato (feed, cronologia, percentuali riportate):

```bash
$PC plugin uninstall franciuto.org-flow --force
```

Fermarlo senza disinstallare:

```bash
$PC plugin disable franciuto.org-flow
$PC plugin enable franciuto.org-flow
```

Tornare a una versione precedente:

```bash
cd ~/ai-final-boss/paperclip-plugins/org-flow
git checkout <commit-precedente>
npm ci && npm run build          # la ricarica automatica fa il resto
cd ~/ai-final-boss && git add paperclip-plugins/org-flow && git commit -m "org-flow: ritorno a <commit>"
```

Lo stato salvato resta compatibile tra 0.1.0 e 1.0 (vedi le regole in [contratto-dati.md](contratto-dati.md#regole-di-versionamento)). Il ripristino del dump del database serve solo se qualcosa è andato storto nel database stesso, e riporta indietro tutta l'istanza di Paperclip, non solo il plugin: va fatto a Paperclip fermo.

## Verifiche

### Stato del plugin

```bash
$PC plugin list
$PC plugin health franciuto.org-flow
$PC plugin logs franciuto.org-flow
```

`plugin health` riporta i controlli dell'host: plugin nel registro, manifest valido, stato, ultimo errore (`healthy: true` se tutto passa). Il worker ha anche un suo stato di salute (`onHealth` in `src/worker.ts`): `ok` con "Org Flow attivo", oppure `degraded` per 5 minuti dopo una costruzione dello snapshot fallita, con il messaggio dell'errore e i dettagli `companies`, `lastEventAt`, `warnings`. Gli stessi errori finiscono nei log come warning `org-flow: …`; `plugin dashboard franciuto.org-flow` mostra la vista di diagnostica dell'host.

### Bridge con `curl`

Il token del board si legge da `~/.paperclip/auth.json` in una variabile, senza stamparlo:

```bash
TOKEN=$(python3 -c 'import json,os;print(json.load(open(os.path.expanduser("~/.paperclip/auth.json")))["credentials"]["https://agents.franciuto.com:"]["token"])')
BASE="https://agents.franciuto.com/api/plugins/franciuto.org-flow"
CO="625d6460-25f1-49d6-88c2-7feb4ad5924e"
```

Snapshot (riassunto con `python3`):

```bash
curl -sS -X POST "$BASE/bridge/data" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"key\":\"snapshot\",\"companyId\":\"$CO\",\"params\":{}}" \
  | python3 -c 'import json,sys; s=json.load(sys.stdin)["data"]; print(s["generatedAt"], len(s["people"]), "persone", len(s["tasks"]), "task", s["counts"])'
```

Eventi recenti per il polling:

```bash
curl -sS -X POST "$BASE/bridge/data" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"key\":\"events\",\"companyId\":\"$CO\",\"params\":{}}" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]; print(d["cursor"], d["snapshotAt"]); [print(r["at"], r["kind"], r.get("identifier")) for r in d["records"]]'
```

Evento di prova (compare nel feed della pagina come "Evento di prova: worker e pagina sono collegati"; non crea task e non sveglia agenti):

```bash
curl -sS -X POST "$BASE/bridge/action" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"key\":\"ping\",\"companyId\":\"$CO\",\"params\":{}}"
# {"data":{"ok":true}}
```

Stream (oggi 501, conferma che serve il polling):

```bash
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 10 -H "Authorization: Bearer $TOKEN" \
  "$BASE/bridge/stream/org-flow?companyId=$CO"
```

Risposte d'errore utili: `502` con `WORKER_UNAVAILABLE` (plugin non `ready`), `502` con un altro codice (errore nel worker, vedi i log), `403` (token senza accesso alla company), `501` sullo stream.

La stessa cosa dalla CLI: `$PC plugin bridge:data franciuto.org-flow --payload-json '{"key":"snapshot","companyId":"…","params":{}}'`.

### Ispezionare lo stato salvato

Sola lettura, con `psql` dagli strumenti inclusi (variabili `LD_LIBRARY_PATH`, `PGBIN`, `DBURL` come nel backup):

```bash
"$PGBIN/psql" "$DBURL" -c "select scope_kind, scope_id, state_key, jsonb_typeof(value_json) as tipo,
  case when jsonb_typeof(value_json)='array' then jsonb_array_length(value_json) end as elementi, updated_at
  from plugin_state where plugin_id = '5e51d4f3-8ea9-4619-ae76-949c682b4562' order by state_key;"
```

## Cosa sopravvive a un aggiornamento di Paperclip

| Cosa | Dove sta | Dopo l'aggiornamento |
| --- | --- | --- |
| Codice del plugin | `~/ai-final-boss/paperclip-plugins/org-flow` | intatto: è fuori da `~/.paperclip/cli/installs/` |
| Registrazione del plugin (riga `plugins`, `packagePath`) | database | intatta |
| Impostazioni | database (`plugin_config`) | intatte |
| Feed, cronologia, percentuali riportate | database (`plugin_state`) | intatti |
| Cache del worker, run in corso | memoria | perse al riavvio, ricostruite da sole |

Cosa può rompersi: il plugin dipende da API dell'host che possono cambiare (`issues.list`, `getSubtree`, eventi `agent.run.*`, forma del bridge). Il build usa l'SDK `@paperclipai/plugin-sdk` alla versione fissata in `package.json` (2026.1023.0). Dopo un aggiornamento di Paperclip:

1. `$PC plugin list`: stato `ready`? Se è `error`, guarda `lastError` e i log ([risoluzione-problemi.md](risoluzione-problemi.md)). Paperclip ritenta una volta all'avvio i plugin in errore.
2. Apri la pagina: indicatore "Live", persone e task presenti.
3. Esegui il `ping` e controlla che compaia nel feed.
4. Controlla lo stream: se non risponde più 501, la UI lo userà da sola; annotalo in [decisioni.md](decisioni.md).
5. Se serve aggiornare l'SDK: cambia la versione in `package.json`, `npm install`, `npm run typecheck && npm test`, poi la procedura di aggiornamento.
