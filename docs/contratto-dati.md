# Contratto dati

Il contratto tra worker e UI è in un solo file: `src/shared/types.ts`. Tutto quello che contiene attraversa il bridge worker → host → browser, quindi è JSON puro: niente `Date`, niente `Map`, niente funzioni.

Regole generali:

- Le date sono stringhe ISO 8601 (`"2026-11-19T00:51:12.345Z"`).
- Id di una persona: UUID dell'agente per gli agenti, `user:<userId>` per gli utenti umani del board.
- Le percentuali sono interi da 0 a 100.
- Le etichette per l'utente sono in italiano e le produce il worker (`stateLabel`) o la UI.

## Feed

### `Party`

Una persona coinvolta in un evento, così come la nomina l'evento.

| Campo | Tipo | Significato |
| --- | --- | --- |
| `kind` | `"agent"` \| `"user"` | agente o utente umano |
| `id` | string | id dell'agente o dell'utente **senza** prefisso `user:` |
| `name` | string, facoltativo | nome aggiunto dal worker; per gli utenti è sempre `"Board"` |

Può essere `null` (nessuno, ad esempio un task senza assegnatario). Nel feed gli utenti hanno l'id grezzo; nello snapshot hanno l'id con prefisso. La UI li riconcilia con `resolveParty` (`src/ui/presence.ts`).

### `FeedKind`

| Valore | Quando |
| --- | --- |
| `handoff` | è cambiato l'assegnatario (agente ↔ agente, agente ↔ utente) |
| `status` | è cambiato lo stato, l'assegnatario no |
| `created` | task creato |
| `run_started` | un agente ha iniziato un run |
| `run_finished` | run finito bene |
| `run_failed` | run fallito o scaduto |
| `progress` | percentuale riportata con `report_progress` |
| `ping` | evento di prova, generato dall'azione `ping` |

I run annullati (`agent.run.cancelled`) chiudono il run in corso ma non producono un record.

### `FeedRecord`

| Campo | Tipo | Significato |
| --- | --- | --- |
| `id` | string | id dell'evento Paperclip (`eventId`), oppure UUID generato per `progress` e `ping`. Unico: la UI deduplica con questo |
| `at` | string ISO | quando è successo (`occurredAt` dell'evento) |
| `kind` | `FeedKind` | tipo |
| `issueId` | string \| null | id del task, se c'è |
| `identifier` | string \| null | identificatore leggibile, es. `FRA-62` |
| `title` | string \| null | titolo del task |
| `parentId` | string \| null | id del task padre, se noto; serve a colorare il record |
| `from` | `Party` | per `handoff`: chi aveva il task |
| `to` | `Party` | per `handoff`: chi lo riceve; per `created`: l'assegnatario iniziale |
| `actor` | `Party` | chi ha fatto l'azione (per i run: l'agente del run) |
| `statusFrom` | string \| null | stato precedente, se è cambiato |
| `statusTo` | string \| null | stato nuovo, se è cambiato; per `created`: lo stato iniziale |
| `percent` | number \| null | per `progress` |
| `note` | string \| null | per `progress`, la nota dell'agente |

Un `handoff` può anche cambiare stato nello stesso evento (es. passaggio al revisore con `statusTo: "in_review"`).

## Snapshot

Lo snapshot è lo stato completo di una company in un istante. Lo produce `deriveSnapshot` (`src/worker/snapshot.ts`).

### `VisualState` e `Pose`

Stati visivi di una persona e posa del personaggio di Paperclip associata (`POSE_FOR_STATE`):

| Stato | Posa | In breve |
| --- | --- | --- |
| `working` | `working` | run in corso |
| `thinking` | `thinking` | ha in mano un task `in_review` |
| `listening` | `listening` | ha appena ricevuto un task |
| `success` | `success` | ha appena chiuso un task |
| `confused` | `confused` | errore, run fallito o task rimandato indietro |
| `sleepy` | `sleepy` | niente da fare da un po' |
| `idle` | `idle` | ha task da fare, oppure è libero |
| `paused` | `rest` | agente in pausa o terminato |
| `waiting` | `idle` | utente umano con task che aspettano lui |

Le regole esatte sono in [stati-e-percentuali.md](stati-e-percentuali.md). Le pose disponibili sono `rest`, `idle`, `listening`, `thinking`, `working`, `success`, `confused`, `sleepy`.

### `PersonView`

| Campo | Tipo | Significato |
| --- | --- | --- |
| `id` | string | UUID dell'agente o `user:<userId>` |
| `kind` | `"agent"` \| `"user"` | |
| `name` | string | nome dell'agente; per gli utenti `"Board"`, `"Board 2"`, … in ordine di id |
| `title` | string \| null | titolo dell'agente in Paperclip |
| `role` | string \| null | ruolo dell'agente |
| `reportsTo` | string \| null | id del responsabile. `null` per i vertici, per gli utenti e quando il responsabile non è tra le persone mostrate |
| `paletteId` | string \| null | palette del personaggio (`appearance.paletteId`); `null` per gli utenti |
| `customAvatarUrl` | string \| null | `/api/assets/<id>/content` se l'agente ha una foto caricata; la UI la preferisce al personaggio |
| `agentStatus` | string \| null | stato grezzo di Paperclip (`idle`, `running`, `paused`, `error`, `terminated`, …); `null` per gli utenti |
| `state` | `VisualState` | stato visivo calcolato |
| `stateLabel` | string | etichetta breve sotto il nome, es. `"Lavora su FRA-62 · 40%"` |
| `stateSince` | string \| null | da quando vale lo stato, quando ha senso |
| `activeTaskId` | string \| null | task a cui si riferisce lo stato |
| `lastActivityAt` | string \| null | ultima attività nota (cronologia, run, heartbeat) |
| `stats` | `{ received24h, passed24h, closed24h }` | task ricevuti, passati ad altri e chiusi nelle ultime 24 ore (dalla cronologia del plugin) |

Gli agenti terminati compaiono solo se hanno ancora un task in mano. Gli utenti compaiono solo se hanno un task (aperto o chiuso di recente).

### `ProgressSource`

| Valore | Etichetta nella UI |
| --- | --- |
| `reported` | "riportata dall'agente" |
| `checklist` | "dalla checklist del piano" |
| `children` | "dai sotto-task chiusi" |
| `status` | "stimata dallo stato" |

### `JourneyStep`

| Campo | Tipo | Significato |
| --- | --- | --- |
| `personId` | string | chi aveva il task |
| `since` | string ISO | da quando |

### `TaskView`

| Campo | Tipo | Significato |
| --- | --- | --- |
| `id` | string | id del task |
| `identifier` | string \| null | es. `FRA-62` |
| `title` | string | titolo, `"(senza titolo)"` se manca |
| `status` | string | stato di Paperclip (`backlog`, `todo`, `in_progress`, `in_review`, `blocked`, `done`, `cancelled`; altri stati sconosciuti sono trattati come aperti) |
| `priority` | string \| null | priorità di Paperclip |
| `holderId` | string \| null | id persona dell'assegnatario |
| `parentId` | string \| null | id del padre; `null` anche quando il padre non è leggibile |
| `groupId` | string | gruppo di colore: id del padre, id del task stesso se è un padre, oppure `"standalone"` |
| `progress` | number | 0–100 |
| `progressSource` | `ProgressSource` | da dove viene la percentuale |
| `progressNote` | string \| null | nota dell'agente, solo con `reported` |
| `updatedAt` | string ISO | ultimo aggiornamento del task |
| `bounces` | number | quante volte il lavoro è tornato indietro (regole in [stati-e-percentuali.md](stati-e-percentuali.md#rimbalzi)) |
| `journey` | `JourneyStep[]` | chi l'ha avuto, dal più vecchio; parziale per i task nati prima della 1.0 |
| `closedAt` | string \| null | data di chiusura per i task `done`/`cancelled` ancora visibili |

### `GroupView`

| Campo | Tipo | Significato |
| --- | --- | --- |
| `id` | string | id del task padre, o `"standalone"` |
| `identifier` | string \| null | identificatore del padre |
| `title` | string | titolo del padre; `"Task singoli"` per `standalone`; `"Task padre"` se il padre non è leggibile |
| `color` | string | colore CSS `oklch(...)` stabile per id; neutro `oklch(62% 0 0)` per `standalone` |
| `status` | string \| null | stato del padre |
| `progress` | number | figli chiusi / figli totali × 100, annullati esclusi; 100 se il padre è `done` |
| `childrenTotal` | number | figli totali (annullati esclusi), anche quelli fuori dalla finestra visibile |
| `childrenDone` | number | figli `done` |
| `holderIds` | string[] | persone che hanno in mano task aperti del gruppo |
| `updatedAt` | string \| null | aggiornamento più recente tra padre e task del gruppo |

Il worker ordina i gruppi (aperti prima, poi per aggiornamento recente, `standalone` in fondo); la UI li riordina per identificatore (`sortGroups` in `src/ui/model.ts`).

### `OrgFlowSettings`

| Campo | Tipo | Predefinito | Limiti |
| --- | --- | --- | --- |
| `sleepAfterMinutes` | integer | 15 | 1–1440 |
| `keepClosedHours` | integer | 24 | 0–720 |
| `enableSimulation` | boolean | true | |

Dettagli in [installazione.md](installazione.md#impostazioni).

### `Snapshot`

| Campo | Tipo | Significato |
| --- | --- | --- |
| `companyId` | string | company |
| `generatedAt` | string ISO | versione dello snapshot; cambia solo quando cambia il contenuto |
| `people` | `PersonView[]` | agenti nell'ordine di Paperclip, poi gli utenti |
| `tasks` | `TaskView[]` | task aperti + chiusi nelle ultime `keepClosedHours` ore |
| `groups` | `GroupView[]` | un gruppo per ogni padre presente, più `standalone` |
| `feed` | `FeedRecord[]` | dal più recente, massimo 100 |
| `settings` | `OrgFlowSettings` | impostazioni in vigore |
| `counts` | `{ working, thinking, sleepy, waiting, open, closed24h }` | persone per stato, task aperti, task chiusi nelle ultime 24 h |

La pagina e il widget ricalcolano i contatori con `liveCounts` (`src/ui/model.ts`) per tenere conto degli effetti locali; di `counts` usano solo `closed24h`. Attenzione: in `counts.waiting` il worker conta le persone in stato `waiting`, `liveCounts` conta i task aperti in mano agli utenti.

## Chiavi del bridge

Il bridge passa dal server di Paperclip:

- dati: `POST /api/plugins/<pluginId o chiave>/bridge/data`
- azioni: `POST /api/plugins/<pluginId o chiave>/bridge/action`

Corpo: `{ "key": "...", "companyId": "...", "params": { ... } }`. L'host controlla l'accesso alla company, poi passa `companyId` al worker insieme ai `params`; quello dell'host prevale su un eventuale `params.companyId`. La risposta riuscita è sempre avvolta in `{ "data": ... }`. Gli errori del worker tornano come HTTP 502 con `{ "code": "...", "message": "..." }`.

Funziona con una chiave API del board come `Authorization: Bearer`. Esempi pronti con `curl` in [installazione.md](installazione.md#verifiche).

### Dati `snapshot` (`DATA_SNAPSHOT`)

Richiesta:

```json
{ "key": "snapshot", "companyId": "625d6460-25f1-49d6-88c2-7feb4ad5924e", "params": {} }
```

Risposta (accorciata):

```json
{
  "data": {
    "companyId": "625d6460-25f1-49d6-88c2-7feb4ad5924e",
    "generatedAt": "2026-11-19T00:51:20.000Z",
    "people": [
      {
        "id": "8f0c…", "kind": "agent", "name": "Daniel Harper", "title": "SRE", "role": "engineer",
        "reportsTo": "1b2e…", "paletteId": "tangerine-cobalt", "customAvatarUrl": null,
        "agentStatus": "running", "state": "working", "stateLabel": "Lavora su FRA-58 · 30%",
        "stateSince": "2026-11-19T00:50:02.000Z", "activeTaskId": "c41d…",
        "lastActivityAt": "2026-11-19T00:50:02.000Z",
        "stats": { "received24h": 4, "passed24h": 0, "closed24h": 1 }
      }
    ],
    "tasks": [
      {
        "id": "c41d…", "identifier": "FRA-58", "title": "Backup di Postgres fuori dalla microSD",
        "status": "in_progress", "priority": "high", "holderId": "8f0c…", "parentId": "a7e9…",
        "groupId": "a7e9…", "progress": 30, "progressSource": "checklist", "progressNote": null,
        "updatedAt": "2026-11-19T00:39:10.000Z", "bounces": 0,
        "journey": [
          { "personId": "1b2e…", "since": "2026-11-19T00:20:00.000Z" },
          { "personId": "8f0c…", "since": "2026-11-19T00:39:10.000Z" }
        ],
        "closedAt": null
      }
    ],
    "groups": [
      {
        "id": "a7e9…", "identifier": "FRA-51", "title": "Homelab più robusto",
        "color": "oklch(68% 0.15 191)", "status": "in_progress", "progress": 38,
        "childrenTotal": 8, "childrenDone": 3, "holderIds": ["8f0c…"],
        "updatedAt": "2026-11-19T00:39:10.000Z"
      }
    ],
    "feed": [],
    "settings": { "sleepAfterMinutes": 15, "keepClosedHours": 24, "enableSimulation": true },
    "counts": { "working": 4, "thinking": 0, "sleepy": 1, "waiting": 1, "open": 14, "closed24h": 3 }
  }
}
```

Senza company il worker risponde `null`.

### Dati `events` (`DATA_EVENTS`)

Eventi nuovi per il polling. Parametri: `after` (facoltativo) = il `cursor` della pagina precedente.

Prima richiesta, senza cursore:

```json
{ "key": "events", "companyId": "625d6460-25f1-49d6-88c2-7feb4ad5924e", "params": {} }
```

Risposta:

```json
{
  "data": {
    "records": [
      { "id": "4b1f…", "at": "2026-11-19T00:43:02.000Z", "kind": "handoff", "issueId": "e2a0…",
        "identifier": "FRA-62", "title": "Pagina React dell'organigramma", "parentId": "f310…",
        "from": { "kind": "agent", "id": "77aa…", "name": "Laura" },
        "to": { "kind": "agent", "id": "90bb…", "name": "Jamal Brooks" },
        "actor": { "kind": "agent", "id": "77aa…", "name": "Laura" },
        "statusFrom": null, "statusTo": null }
    ],
    "cursor": "seq:3f9a12c0:57",
    "snapshotAt": "2026-11-19T00:51:20.000Z"
  }
}
```

Richiesta successiva:

```json
{ "key": "events", "companyId": "625d6460-25f1-49d6-88c2-7feb4ad5924e", "params": { "after": "seq:3f9a12c0:57" } }
```

Regole (`pageEvents` in `src/worker/feed.ts`):

| Cursore | Risposta |
| --- | --- |
| assente | gli ultimi 20 record, dal più vecchio |
| `seq:<epoca>:<n>` della stessa esecuzione del worker | i record pubblicati dopo `n`, dal più vecchio, massimo 50 |
| `seq:…` di un'esecuzione precedente (il worker è ripartito), o con `n` oltre l'ultimo record | come senza cursore: gli ultimi 20 |
| data ISO (formato vecchio) | i record con `at` successivo alla data meno 15 s, massimo 50 |

Il cursore è opaco: va solo ripassato. I record sono in ordine di pubblicazione, che non sempre coincide con `at`. Una pagina può ripetere record già visti (dopo un riavvio o con un cursore ISO): chi legge deduplica per `id`. Senza nulla di nuovo, `records` è vuoto e `cursor` resta valido.

`snapshotAt` è il `generatedAt` dell'ultimo snapshot del worker: se è più recente di quello mostrato, la UI richiede `snapshot`.

### Azione `ping` (`ACTION_PING`)

Pubblica un record `ping` e ricalcola lo snapshot. Serve a verificare che worker, stato e polling funzionino senza creare task.

```json
{ "key": "ping", "companyId": "625d6460-25f1-49d6-88c2-7feb4ad5924e", "params": {} }
```

Risposta: `{ "data": { "ok": true } }`. Nella pagina compare "Evento di prova: worker e pagina sono collegati". La UI non ha un pulsante per `ping`: si chiama dal bridge.

### Azione `refresh` (`ACTION_REFRESH`)

Fa scadere le cache di agenti, impostazioni e padri, ricostruisce il modello e restituisce lo snapshot nuovo (stessa forma di `snapshot`). I task chiusi mantengono il loro aggiornamento ogni 5 minuti. La pagina la chiama ogni 60 s.

### Strumento `report_progress` (`TOOL_REPORT_PROGRESS`)

Non passa dal bridge della UI: lo chiamano gli agenti durante un run. Vedi [agenti-e-percentuale.md](agenti-e-percentuale.md).

## Messaggi dello stream (per il futuro)

Canale `org-flow` (`STREAM_CHANNEL`). Oggi il worker li emette ma l'host non li consegna (501). Forma:

```json
{ "type": "event", "record": { "id": "…", "at": "…", "kind": "run_started", "actor": { "kind": "agent", "id": "…" } } }
```

```json
{ "type": "snapshot", "snapshot": { "companyId": "…", "generatedAt": "…", "people": [], "tasks": [], "groups": [], "feed": [], "settings": {}, "counts": {} } }
```

`event` parte subito a ogni record; `snapshot` dopo il debounce di 600 ms. Se lo stream si connette, la UI tratta `event` come una pagina di `events` e `snapshot` come una risposta di `snapshot` (vince il `generatedAt` più recente).

## Costanti

| Costante | Valore |
| --- | --- |
| `STREAM_CHANNEL` | `"org-flow"` |
| `DATA_SNAPSHOT` | `"snapshot"` |
| `DATA_EVENTS` | `"events"` |
| `ACTION_PING` | `"ping"` |
| `ACTION_REFRESH` | `"refresh"` |
| `TOOL_REPORT_PROGRESS` | `"report_progress"` |
| `STANDALONE_GROUP_ID` | `"standalone"` |
| `STANDALONE_COLOR` | `"oklch(62% 0 0)"` |

## Regole di versionamento

Worker e UI escono dallo stesso build, ma un browser può avere ancora in memoria la UI vecchia per qualche minuto dopo un aggiornamento (fino al ricaricamento della pagina). Lo stato salvato invece sopravvive a tutte le versioni. Quindi:

1. Ogni modifica a `src/shared/types.ts` è una modifica di contratto: nello stesso commit aggiorna worker, UI, test e questo file (lo dice anche il commento in testa a `types.ts`).
2. Aggiungere un campo va bene. La UI deve funzionare se il campo manca (snapshot del worker vecchio) e il worker non deve contare su campi nuovi nei dati salvati.
3. Rinominare o togliere un campo, o cambiarne il significato, richiede di gestire entrambe le forme per almeno una versione.
4. Nuovi valori di `FeedKind` o `VisualState`: la UI ha un caso predefinito per i tipi sconosciuti ("Evento", posa `idle`); aggiungi comunque il caso esplicito in `Panels.tsx`, `presence.ts` (UI) e `POSE_FOR_STATE`.
5. Dati salvati (`FeedRecord` nel feed, `HistoryEntry`, `ReportedProgress`): una nuova versione deve leggere quelli scritti dalla precedente. Se cambi chiave, leggi anche quella vecchia come fa `STATE_FEED_LEGACY` (`recent-feed` della 0.1.0).
6. Il cursore di `events` è opaco: la UI non deve interpretarlo. Il worker accetta ancora i cursori ISO della prima 1.0.
7. Cambiare una chiave del bridge o il nome dello strumento rompe la UI in cache o le istruzioni degli agenti: evitalo; se serve, registra entrambe le chiavi per una versione.
8. Annota la modifica in [CHANGELOG.md](../CHANGELOG.md) e, se è una scelta, in [decisioni.md](decisioni.md).
