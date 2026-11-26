# Decisions

The choices behind Org Flow, with the reason for each.

## Architecture

### A plugin, not a patch to Paperclip's code

A plugin lives outside Paperclip's install folder (`~/.paperclip/cli/installs/...`) and survives updates. A patch to the interface would have to be reapplied on every version.

### The native Dashboard is not replaced

Paperclip reserves the `/dashboard` route (`PLUGIN_RESERVED_COMPANY_ROUTE_SEGMENTS`) and has no setting for the home page. Org Flow therefore has its own page (`/<company>/org-flow`), a link in the sidebar and a widget (`dashboardWidget`) in the native Dashboard.

### Polling instead of the stream

The SDK provides real-time streaming to the UI (`ctx.streams` / `usePluginStream`). In Paperclip 2026.1023.0 the server does not connect the "stream bus" to the plugin routes: `GET /api/plugins/:id/bridge/stream/:channel` answers 501. The same holds for 2026.1106.0 (verified on the npm package).

The UI therefore queries the worker every ~3 seconds, asking only for new events (data key `events`). They are served from the worker's memory, so the cost is negligible. The worker keeps emitting on the stream too, so when Paperclip enables it the UI will use it with no changes.

### Read-only with respect to Paperclip

The plugin reads agents, tasks and documents and writes only to its own state (event history, reported percentages). It has no actions that modify tasks or agents: approvals are done from the native pages.

### No work after answering the bridge

The host rejects calls made by a data/action/tool handler after it has answered. `ping`, `refresh` and `report_progress` complete the snapshot before answering. The snapshot debounce starts only from event handlers, whose scope stays valid for about 15 minutes.

### Agent status deduced from runs

Paperclip does not emit `agent.status_changed`. `agent.run.started` brings the agent to `running`, and the end of the run brings it to `idle` (except paused and terminated agents). `agent.updated` makes the list be re-read.

After a restart the runs in progress are derived from the tasks' `activeRun`. A run with no end for more than 6 hours is ignored. Every run event makes the lists be re-read, because runs move tasks without an activity event.

### Task lists, one per status, without `limit`

`ctx.issues.list` forwards only some filters to the host, and pagination with `offset` is unreliable. The worker makes one call for each open status (every 60 s or after an event) and one for `done` and `cancelled` (every 5 minutes, because events update them in the meantime). In memory it keeps the tasks closed in the last `max(keepClosedHours, 24)` hours.

### Parents with `getSubtree`

A single read gives the parent and all the children, even those closed long ago. The parent's percentage is therefore computed on the real children, not just the visible ones. Hidden tasks (`hiddenAt`), which `getSubtree` returns, are excluded. An unreadable parent makes the children "No parent" instead of blocking the snapshot.

### Departments from the reporting line

Paperclip has no concept of department, but an org chart is easier to read with department names. The worker treats as a department the subtree under each direct report of a top-level agent. In a company where a CEO has a design lead, an engineering lead and a marketing lead as direct reports, this gives three departments without any configuration.

The name is derived from the lead's title and role, because Paperclip titles often already contain the trade ("Design Team Lead", "CTO"). The `departmentNames` setting replaces the name when the deduction is wrong. Top-level agents stay outside the departments, because they lead the whole company.

## Data

### Task percentage

Paperclip has no percentage for tasks. Order of the sources:

1. value reported by the agent with the `report_progress` tool;
2. checklist in the `plan` document;
3. estimate from the status.

The UI always shows where the number comes from. For parent tasks the value is real: closed children / total children (cancelled excluded).

The agents' instructions are not modified by the plugin. Using `report_progress` is a choice for the instance owner (see [agents-and-percentage.md](agents-and-percentage.md)).

### Reported percentage reset on handoff

The `report_progress` value is the estimate of whoever gave it. It is reset if the task is reopened or passes to a person other than the one who reported it. It stays if only the status changes. This way a reopened task does not restart from an old 90%.

### Bounces: only work that comes back

A bounce is one of these:

- a rework after review (`in_review` → `todo`/`in_progress`);
- a reopening (`done` → `todo`/`in_progress`/`in_review`);
- a task in review sent back down the reporting line to someone who already had it.

These do not count, because they are Paperclip's normal flow: delegating downwards, returning upwards (review, help, block, finished work), handing over again after an escalation, and approval with return to the implementer. Moves to `backlog`, `blocked` and `cancelled` do not count either.

The first rule, "A→B→A counts 1", flagged every review cycle as a bounce.

### Polling cursor by publication sequence

Records do not arrive in `occurredAt` order, because enrichment can delay one. A date-based cursor would lose records. The cursor is therefore `seq:<worker epoch>:<n>`.

After a restart the epoch changes and the UI receives the last 20 records, which it deduplicates by id. ISO cursors remain accepted with a 15 s overlap.

In the UI, polling starts only after the previous response (with a 15 s ceiling), because the host's `refresh()` cancels the request in progress without interrupting it.

### Snapshot version only if the content changes

`generatedAt` changes only when the content fingerprint changes. `events` polling can then compare `snapshotAt`, and the UI downloads the snapshot only when needed.

### Saved state protected from failed reads

Until feed, history and percentages have been read successfully, the worker saves nothing and retries the read after 10 s. A save after a failed read would overwrite the history with an almost empty one.

### Board users without a name

The plugin does not request `access.members.read`. Human users appear as "Board", "Board 2", … This needs fewer permissions, at the cost of anonymous users.

## Presentation

### Simulation mode

On a real instance most tasks may be closed and agents may work in short runs, so the page is often quiet. A "Simulation" toggle shows it animated: it uses the real people and characters with fake tasks, clearly flagged, and writes nothing to Paperclip. It can be hidden from the plugin settings (`enableSimulation`).

### Status labels computed by the worker

The worker produces `stateLabel` in English together with the state, so page, widget and tests see the same text. The UI overrides the label only during local flashes.
