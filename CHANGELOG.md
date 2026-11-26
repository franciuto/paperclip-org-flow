# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). The version Paperclip sees is the one in `src/manifest.ts`.

## [Unreleased]

### Changed

- The interface, the plugin settings, the `report_progress` tool and the documentation are now in English. The documentation files have English names (`docs/how-it-works.md`, `docs/installation.md`, ...).
- Locale for dates and sorting is `en-GB`.
- The project is licensed under the MIT licence.

### Removed

- The 1.0 specification (`docs/specifica.md`): `docs/how-it-works.md`, `docs/data-contract.md` and `docs/states-and-percentages.md` describe the behaviour.

## [1.2.0] - 2026-11-19

### Added

- Title of each agent under the name, taken from Paperclip (the agent's title field). If the title is empty in Paperclip, Paperclip's role label is used (`AGENT_ROLE_LABELS`, for example `ceo` → "CEO"). The state ("Asleep", "Working on…") moves down one line.
- "Full screen" button in the header: it uses the browser's full screen; where that is not available (for example Safari on iPhone) the page covers the whole Paperclip interface. Exit with Esc or the same button.

## [1.1.0] - 2026-11-19

### Changed

- Page reorganised: compact one-row header; full-width org chart (as wide as the page, as tall as the screen, scaled to fit entirely; on a phone it scrolls sideways) with more generous spacing.
- The detail panel for tasks and people slides over the right edge of the org chart (on a phone it rises from the bottom); close it with × or Esc, focus moves into the panel and returns to where it was on close.
- Parent tasks, the "Now" summary, live activity and "Recently closed" are collapsible sections below the org chart, remembered in the browser, with "Collapse all / Expand all".

### Added

- Departments: each department (subtree of a direct report of the CEO) is enclosed in a neutral box with its name and headcount. With a worker that does not send departments, the page derives them from the reporting chain ("<name>'s team").

## [1.0.0] - 2026-11-19

First complete version.

### Added

- Page `/<prefix>/org-flow` with:
  - strip of parent tasks with real progress (closed children / total children, cancelled excluded) and the people involved; click to highlight a group;
  - summary "Working", "Reviewing", "Asleep", "Waiting on you";
  - live org chart with the Paperclip characters, visual states (`working`, `thinking`, `listening`, `success`, `confused`, `sleepy`, `idle`, `paused`, `waiting`) and chips for the tasks they hold with status and percentage;
  - animated chip flight on handoffs and immediate states when events arrive;
  - detail panels for the task (percentage source, path with timings, bounces, link to Paperclip) and for the person (tasks by group, 24 h statistics);
  - "Live activity" feed;
  - quiet state with recently closed tasks;
  - Simulation mode with fake data, with no writes.
- Widget for the Paperclip Dashboard (`dashboardWidget`).
- Task percentage from four sources: value reported by the agent, subtasks, checklist in the `plan` document, estimate from the status.
- Tool for agents `report_progress` (`issue`, `percent`, `note`), limited to their own tasks and their reports' tasks.
- Handoff history in the plugin state (last 300 entries per company): paths, bounces, statistics.
- Stable colours per parent task.
- Per-company settings: `sleepAfterMinutes`, `keepClosedHours`, `enableSimulation`.
- Live updates via polling (`events` every 3 s with a cursor, `snapshot` on demand, `refresh` every 60 s); the stream is ready for when Paperclip wires it up.
- Actions `ping` (test event) and `refresh`.
- Light and dark theme, phone layout, `prefers-reduced-motion`.
- Visual test bench with screenshots (`npm run test:ui`).
- Documentation in `docs/`.

### Changed

- The feed is saved under the `feed` key (previously `recent-feed`, which is still read if `feed` is empty).
- New capabilities: `issue.subtree.read`, `issue.documents.read`, `agent.tools.register`, `ui.dashboardWidget.register`. On update Paperclip may ask to approve them.

## [0.1.0] - 2026-11-19

### Added

- Minimal version to verify events and streaming.
- Worker that listens to `issue.created`, `issue.updated`, `agent.run.started/finished/failed` and turns them into a feed of handoffs, status changes and runs, with names and titles.
- Feed of the last 100 events per company in the plugin state (key `recent-feed`), data key `recent`, action `ping`.
- `org-flow` page with the feed and a link in the sidebar.
- Static prototype and data contract.

With this version it was verified that the plugins' stream is not wired up by the host (501): see [docs/design-decisions.md](docs/design-decisions.md).
