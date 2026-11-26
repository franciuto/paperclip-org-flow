# Development

How the repo is organised, how to try it out and which conventions to follow. For the architecture see [how-it-works.md](how-it-works.md), for releasing see [installation.md](installation.md#updating).

## Repo structure

```
org-flow/
├── src/
│   ├── manifest.ts            plugin manifest (id, capabilities, slots, settings schema, tool)
│   ├── worker.ts              worker entry: subscriptions, bridge, tool, health, config
│   ├── shared/types.ts        data contract between worker and UI
│   ├── worker/                worker logic (pure modules + service.ts with the state)
│   └── ui/
│       ├── index.tsx          slot exports: OrgFlowPage, OrgFlowSidebarLink, OrgFlowDashboardWidget
│       ├── components/        Page, OrgChart, Panels, Widget, Avatar
│       ├── useLive.tsx        polling + stream
│       ├── poll.ts            pure polling rules (one request at a time, locked cursor), announcements, keyboard
│       ├── hooks.ts           clock, reduced motion, simulation
│       ├── model.ts           data derived for the view (pure)
│       ├── presence.ts        immediate effects of events (pure)
│       ├── layout.ts, chips.ts  layout of the org chart and of the chips (pure)
│       ├── format.ts          texts, dates, colours (pure)
│       ├── simulator.ts       simulation mode (pure, deterministic given a seed)
│       └── styles.ts          all the CSS, injected once
├── tests/
│   ├── *.spec.ts              vitest tests (worker, pure UI, manifest)
│   └── ui/                    visual test bench (harness, SDK stub, fixtures, screenshots)
├── assets/demo/               screenshots used in the documentation
├── prototype/                 static reference prototype and character poses
├── docs/                      documentation (this folder)
├── dist/                      build (ignored by git)
├── esbuild.config.mjs         build with the SDK presets
├── tsconfig.json, vitest.config.ts
└── package.json
```

`dist/` is in `.gitignore`: build it in the clone you install from ([installation.md](installation.md)).

## Scripts

With Node in the `PATH`:

| Command | What it does |
| --- | --- |
| `npm ci` | installs the dependencies locked by `package-lock.json` |
| `npm run build` | builds worker, manifest and UI into `dist/` (`esbuild.config.mjs`, `createPluginBundlerPresets` preset) |
| `npm run dev` | build in watch mode. It reloads the plugin only if Paperclip runs it from this folder |
| `npm run typecheck` | `tsc --noEmit` on `src` and `tests` |
| `npm test` | vitest tests (`tests/**/*.spec.ts`) |
| `npm run test:ui [name …]` | visual test bench: builds the harness and takes screenshots with headless Chromium in `tests/ui/out/` |

Before a commit: `npm run typecheck && npm test && npm run build`.

## Tests

### Unit (vitest)

| File | Covers |
| --- | --- |
| `tests/feed.spec.ts` | events → records, `pushRecent`, pagination of `events` |
| `tests/history.spec.ts` | history, paths, bounces, per-person signals |
| `tests/progress.spec.ts` | estimate from the status, checklist, children count, order of the sources |
| `tests/presence.spec.ts` | order of the visual state rules |
| `tests/snapshot.spec.ts` | snapshot assembly, groups, people, host mappers |
| `tests/colors.spec.ts` | stable and readable colours |
| `tests/settings-tool.spec.ts` | settings, parameters and permissions of `report_progress` |
| `tests/manifest.spec.ts` | manifest valid for the host's validator; version, slots, tool, capabilities |
| `tests/worker.spec.ts` | full worker with the SDK harness (`@paperclipai/plugin-sdk/testing`): events, debounce, polling, saved state, multiple companies, tool, health, settings |
| `tests/ui-*.spec.ts` | pure parts of the UI: formatting, model, layout, event effects, simulator |

Pure modules are tested directly. The worker is tested with the SDK harness, which simulates host, events and state.

### Visual test bench

`tests/ui/` mounts the three UI components in a static page, with an SDK stub (`sdk-stub.tsx`) that behaves like the real host:

- `usePluginData` answers `snapshot` and `events` from an in-memory store;
- `usePluginStream` never connects (like the real 501);
- a sequence of events (`BUSY_SCRIPT`) is published over time, with the snapshot updated 600 ms after each event.

The fixtures (`fixtures.ts`) are a fake company with real names and palettes; the status labels are hand-written and partly come from the simulation (e.g. "Sorting ACME-64"), not from the worker.

`npm run test:ui` builds `tests/ui/out/harness.js`, starts `tests/ui/serve.py` on a random port and captures:

| Name | View |
| --- | --- |
| `busy-light`, `busy-dark` | page with work in progress, light and dark theme |
| `busy-selected-task` | detail panel of a task (`ACME-59`) open |
| `busy-selected-person` | detail panel of a person, dark theme |
| `quiet-light`, `quiet-dark` | no open tasks |
| `phone` | 400 px width |
| `widget`, `widget-quiet-dark` | Dashboard widget and sidebar link |
| `simulation` | simulation on |
| `offline` | polling that always fails ("Unreachable") |
| `chip-zoom` | zoom on a chip (`ACME-56`), to check that the text fits |

For a single capture: `npm run test:ui busy-dark phone`.

To look at the screenshots: open them from `tests/ui/out/*.png` (folder ignored by git). The ones used in the documentation are copied by hand into `assets/demo/`; copy them again when the UI changes visibly.

To use the harness live in the browser:

```bash
npm run test:ui busy-light                  # builds tests/ui/out/harness.js
python3 tests/ui/serve.py 8765              # listens on 127.0.0.1 only
# on a remote machine, forward the port: ssh -L 8765:127.0.0.1:8765 <host>
# then http://localhost:8765/?fixture=busy
```

Page parameters: `view=page|widget`, `fixture=busy|quiet`, `dark=1`, `sim=1` (turns the simulation on), `select=ACME-59` or `select=person:<name>`, `script=0` (no scripted events), `eventsFail=1` (every poll fails), `zoomchip=ACME-56&zoom=4` (zooms a chip). `serve.py` serves the poses from `prototype/poses/` and the Inter font from a Paperclip installation, if one is found.

### Prototype

`prototype/org-flow.src.html` is the static prototype the UI came from. `python3 prototype/build.py` produces `prototype/org-flow.html` with the poses embedded as data URIs (a single file to open in the browser). `prototype/poses/` contains the poses of Paperclip's 8 palettes (also `loading`, not used by the plugin).

## Conventions

### Contract

- Everything passing between worker and UI is in `src/shared/types.ts`. A change there goes in the same commit in worker, UI, tests and [data-contract.md](data-contract.md). Compatibility rules in [data-contract.md](data-contract.md#versioning-rules).
- Bridge keys and the tool name are constants in `types.ts`: do not write the strings by hand.

### Worker

- Rules in the pure modules, host calls only in `service.ts`.
- No host call after a data/action/tool handler has responded: the host rejects it. "After" work (timers) starts only from event handlers. Details in [how-it-works.md](how-it-works.md#host-limitations-and-how-they-are-worked-around).
- An event must never be dropped because of an enrichment error: `try/catch`, warning, publish anyway.
- The plugin does not write to tasks, agents or other Paperclip data: only to its own state.
- Log messages start with `org-flow:` and are in English.

### UI

- User-facing texts in English. The formatting functions are in `src/ui/format.ts` (`relativeTime`, `formatDuration`, `statusLabel`, `plural`, …).
- CSS only in `src/ui/styles.ts`, all classes with the `of-` prefix, injected once as `<style id="of-styles">` (`useStyles`). No external UI libraries.
- Colours from Paperclip's theme variables (`--background`, `--foreground`, `--card`, `--muted`, `--muted-foreground`, `--border`, `--font-sans`, `--font-mono`, …) through the `--of-*` variables; the dark theme is switched on by the host's `.dark` class.
- `prefers-reduced-motion`: no flights, no animations (block at the bottom of `styles.ts`).
- Accessibility: people and chips are keyboard-reachable buttons with a full `aria-label`; new events are announced to screen readers in a hidden `aria-live` region, at most one every 8 s (20 s in simulation), never the whole feed (`announce` in `src/ui/poll.ts`).
- Usable at 400 px: the org chart scrolls horizontally in its container.
- Calculations in pure modules (`model.ts`, `presence.ts`, `layout.ts`, …) with tests in `tests/ui-*.spec.ts`; the components stay thin.
- The UI does not call Paperclip's APIs, except for images (poses `/api/agent-avatars/cap-v1/<palette>/<pose>.png`, photos `/api/assets/<id>/content`) and navigation links.

### Version and documentation

- Plugin version in `src/manifest.ts` (the one Paperclip sees); keep `package.json` aligned.
- Every release: an entry in [CHANGELOG.md](../CHANGELOG.md). Every non-obvious choice: an entry in [design-decisions.md](design-decisions.md).

## Adding a new visual state

Example: a `blocked` state for agents stuck on a blocked task.

1. **Contract** (`src/shared/types.ts`): add the value to `VisualState` and the pose to `POSE_FOR_STATE`. The existing poses are `rest`, `idle`, `listening`, `thinking`, `working`, `success`, `confused`, `sleepy`: use one of these, Paperclip does not need any others.
2. **Rule** (`src/worker/presence.ts`): insert the rule in `computePresence` at the right place in the order, with an English label. If it depends on a time, an exported `…_WINDOW_MS` constant.
3. **Signals**: if a new piece of data is needed, add it to `PresenceInput` and compute it in `deriveSnapshot` (`src/worker/snapshot.ts`) or in `personSignals` (`src/worker/history.ts`).
4. **Tests**: a case in `tests/presence.spec.ts` (order relative to the neighbouring rules) and, if needed, in `tests/snapshot.spec.ts`.
5. **Look** (`src/ui/styles.ts`): `.of-node[data-state="blocked"]` rules for the label (`.of-stl`), the animation (`.of-bob`) and any effects (`Effects` in `OrgChart.tsx`: `of-zzz`, `of-typing`, `of-thought`, `of-bang`, `of-huh`, `of-spark`). Remember the `prefers-reduced-motion` block.
6. **Immediate effect** (optional, `src/ui/presence.ts`): a case in `effectsOfRecord` if the state must appear immediately when an event arrives; test in `tests/ui-presence.spec.ts`.
7. **Counters** (optional): `liveCounts` in `src/ui/model.ts` and `KpiStrip` in `Panels.tsx`; if it also goes into `Snapshot.counts`, it is a contract change.
8. **Simulation** (optional): `visual()` in `src/ui/simulator.ts`.
9. **Test bench**: a person in the `busySnapshot` fixture with the new state, `npm run test:ui`, check the light and dark screenshots.
10. **Documents**: tables in [states-and-percentages.md](states-and-percentages.md) and [data-contract.md](data-contract.md), changelog entry.

## Adding a field end-to-end

Example: `TaskView.dueAt` with the task's due date.

1. **Host → light copy**: add the field to `IssueLite` and read it in `toIssueLite` (`src/worker/snapshot.ts`), with `toIso` for dates. Test in `tests/snapshot.spec.ts` ("host mappers").
2. **Contract**: add `dueAt: string | null` to `TaskView` in `src/shared/types.ts` with a comment.
3. **Snapshot**: set it in `deriveSnapshot`. If the field changes often, remember that the snapshot fingerprint includes everything: every change produces a new version.
4. **Events**: if a change to the field must update the snapshot immediately, add the key to `RELEVANT_CHANGES` in `service.ts`.
5. **UI**: show it (e.g. in `TaskCard`, `Panels.tsx`), formatted with `format.ts`, text in English. Handle `undefined` (snapshot from an older worker).
6. **Simulation and fixtures**: add the field to `simulationSnapshot` (`simulator.ts`) and to the fixtures (`tests/ui/fixtures.ts`), otherwise `typecheck` fails.
7. **Tests and build**: `npm run typecheck && npm test && npm run build && npm run test:ui`.
8. **Documents**: a row in the `TaskView` table in [data-contract.md](data-contract.md), changelog.

For a field saved in the plugin state (feed, history), also follow compatibility rule 5: new versions must read the data written by old ones.

If a new host capability is needed, add it to the manifest: on update Paperclip may ask to approve it (`upgrade_pending`).
