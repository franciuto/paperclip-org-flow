# CLAUDE.md

A Paperclip plugin (`franciuto.org-flow`) that shows the company's org chart live: who works on what, task percentages, parent-task groups, animated handoffs, a Dashboard widget and the `report_progress` tool for agents. A worker (`src/worker/`) listens to Paperclip events and builds a snapshot; a React UI (`src/ui/`) polls the worker and draws it. Read `docs/how-it-works.md` before changing the data flow and `docs/data-contract.md` before changing a type or a bridge key.

## Map

| Path | What it is |
|---|---|
| `src/manifest.ts` | The plugin manifest: id, version, capabilities, UI slots, settings schema, the tool |
| `src/worker.ts` | Worker entry: subscribes to events, registers the bridge handlers and the tool |
| `src/worker/service.ts` | Runtime: per-company caches, event ingestion, snapshot building, bridge handlers. The only file that calls the host |
| `src/worker/*.ts` | Pure modules, tested without a host: `feed` (events → records), `history` (handoffs, bounces, stats), `progress` (percentage), `presence` (state of each person), `snapshot` (assembly), `departments`, `colors`, `settings`, `tool` |
| `src/shared/types.ts` | The data contract shared by worker and UI |
| `src/ui/index.tsx` | UI entry: exports the components the manifest mounts in its slots |
| `src/ui/*.ts` | Pure UI logic: `layout`, `chips`, `model`, `format`, `presence`, `poll`, `viewport`, `simulator`, `styles` (all CSS, classes prefixed `of-`) |
| `src/ui/components/` | React components: `Page`, `OrgChart`, `Panels`, `Layout`, `Widget`, `Avatar` |
| `tests/*.spec.ts` | Unit tests (vitest) for the worker and the pure UI modules |
| `tests/ui/` | Visual test bench: harness, SDK stub, fixtures, `shoot.mjs` (headless Chrome screenshots), `serve.py` |
| `prototype/` | The static prototype the UI grew out of. `build.py` inlines the character poses into `org-flow.html` (generated) |
| `assets/` | Banner and the README screenshots in `demo/` |
| `docs/` | `how-it-works`, `data-contract`, `states-and-percentages`, `agents-and-percentage`, `installation`, `development`, `troubleshooting`, `design-decisions` |
| `README.md`, `CHANGELOG.md` | User docs, including the install prompt for agents under "Onboard your agent"; the changelog |

## Commands

```bash
npm ci
npm run typecheck                   # tsc --noEmit
npm test                            # vitest, no Paperclip needed
npm run build                       # esbuild: dist/worker.js, dist/manifest.js, dist/ui/
npm run dev                         # build in watch mode
npm run test:ui                     # screenshots in tests/ui/out/ (Chromium or Chrome)
python3 prototype/build.py          # rebuild prototype/org-flow.html after editing the .src.html
```

Put new rules in the pure modules and test them there. Test the worker with the harness in `tests/worker.spec.ts` instead of a real Paperclip.

Release: update `CHANGELOG.md`, bump `version` in `src/manifest.ts` and `package.json` together, then reinstall the plugin on the instance (a new worker version needs a reinstall, see `docs/installation.md#updating`).

## Contracts that must hold

- **Read-only on Paperclip.** The plugin writes only to its own saved state. No action changes a task or an agent.
- **No host call after answering the bridge.** The host rejects calls made by a data/action/tool handler after it has answered. `ping`, `refresh` and `report_progress` finish the snapshot before they answer; the snapshot debounce starts only from event handlers.
- **Polling cursor** is `seq:<worker epoch>:<n>`, never a date. Records do not arrive in `occurredAt` order. The UI starts the next poll only after the previous response.
- **`generatedAt` changes only when the snapshot content changes**, so the UI can compare `snapshotAt` and download the snapshot only when needed.
- **Saved state is protected.** Until feed, history and percentages have been read successfully the worker saves nothing. A save after a failed read would overwrite the history.
- **Every user-facing string is English.** Status labels come from the worker (`stateLabel`), so page, widget and tests show the same text.
- **A bounce is work that comes back** (review → rework, a reopened task, a task sent back down the reporting line). Normal delegation, review, help and blocking are not bounces. The rule lives in `src/worker/history.ts` and is mirrored in `src/ui/format.ts`: change both.
- **The tool name `report_progress` and the plugin id `franciuto.org-flow` are identifiers** that agents and saved state depend on. Do not rename them.
- **Any new capability in the manifest** makes Paperclip ask the owner to approve it on update. Add one only on purpose and say so in the changelog.

## Common mistakes

| Mistake | Result | Do instead |
|---|---|---|
| Calling the host from a pure module | It can no longer be tested without a Paperclip instance | Put host calls in `service.ts`, rules in the pure modules |
| Installing production from the folder you develop in | Paperclip reloads the plugin whenever the folder changes: every test build reaches production | Install production from a separate clone |
| Changing the worker's version and only rebuilding | Paperclip keeps the old worker | Reinstall the plugin |
| Using `ctx.issues.list` with `limit` or `offset` | Missing or repeated tasks: the host forwards only some filters and paging is unreliable | One call per status, as `service.ts` does |
| Counting a parent's progress from the visible children | Wrong percentage | Read the whole subtree with `getSubtree` and exclude hidden tasks |
| Using a date as the polling cursor | Records enriched late are lost | Use the sequence cursor |
| Adding a state or a field in one place only | Worker and UI disagree, tests pass | Follow "Adding a new visual state" and "Adding a field end-to-end" in `docs/development.md` |
| Hard-coding a colour in the UI | Unreadable in the other theme | Use the host's theme variables with the fallbacks in `styles.ts` |
| Adding photos of real people to a test or a screenshot | Real people end up in the repo | Use the sample image in `tests/ui/photos/` |
| Editing `prototype/org-flow.html` | Lost at the next build: it is generated | Edit `org-flow.src.html` and run `build.py` |
