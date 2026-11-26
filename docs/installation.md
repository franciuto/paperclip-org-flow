# Installation, updating and checks

How to install Org Flow on a Paperclip instance, update it, configure it and check that it works. The commands run on the machine where Paperclip runs.

## References

| What | Value |
| --- | --- |
| Plugin key | `franciuto.org-flow` |
| Page | `https://your-paperclip.example.com/<company-prefix>/org-flow` |
| Repo | `https://github.com/franciuto/paperclip-org-flow` |
| Compatible Paperclip | 2026.1023.0 or later |
| Plugin SDK | `@paperclipai/plugin-sdk` at the version pinned in `package.json` (2026.1023.0) |

`<company-prefix>` is the issue prefix of your company (for example `ACME`). `<company-id>` is the company's UUID.

## Prerequisites

- Node and npm in the `PATH`. `npm` without `node` in the `PATH` fails with `env: 'node': No such file or directory`.
- A Paperclip instance version 2026.1023.0 or later.
- The `paperclipai` CLI, authenticated as an instance administrator. An administrator is needed to install, uninstall and change settings.
- Git, to clone the repository.
- Only for the visual test bench: Chromium and `python3` (see [development.md](development.md#visual-test-bench)).

The CLI stores its token in `~/.paperclip/auth.json`. The token is registered under a key made of the API base URL and a trailing colon, for example `https://your-paperclip.example.com:`. The colon is part of the key. Every command must therefore use:

```bash
--api-base "https://your-paperclip.example.com:"
```

For brevity, the examples use:

```bash
PC="paperclipai --api-base https://your-paperclip.example.com:"
```

## Back up the database before touching it

Installing, uninstalling and changing settings write to the Paperclip database. Take a dump before every change. The example below assumes the database connection string is in the instance config file. Adapt it to your setup.

```bash
# The connection string contains the password: read it from the file without printing it.
DBURL=$(python3 -c 'import json,os;print(json.load(open(os.path.expanduser("~/.paperclip/instances/default/config.json")))["database"]["connectionString"])')
mkdir -p "$HOME/.paperclip/backups-manual"
pg_dump -Fc -d "$DBURL" -f "$HOME/.paperclip/backups-manual/pre-org-flow-<what>-$(date +%Y%m%d-%H%M%S).dump"
```

Replace `<what>` with a short label (for example `update-1.1`). Use a `pg_dump` that matches the server's major version. If Paperclip runs with its embedded Postgres, it may ship its own client tools: look in `~/.paperclip/`.

## First installation

Install from a dedicated clone, not from the folder where you develop. Paperclip reloads a plugin installed with `--local` when its folder changes, so every build in a development folder would reach the running plugin.

1. Back up the database (section above).
2. Clone the repository and build it:

   ```bash
   git clone https://github.com/franciuto/paperclip-org-flow.git ~/paperclip-plugins/org-flow
   cd ~/paperclip-plugins/org-flow
   npm ci
   npm run build
   ls dist/manifest.js dist/worker.js dist/ui/index.js
   ```

   To install a specific version, check out its tag or commit before `npm ci`.
3. If a version from another path is already installed, uninstall it **without** `--force`. The plugin's row stays (status `uninstalled`) with its id, configuration and saved state:

   ```bash
   $PC plugin uninstall franciuto.org-flow
   ```

4. Install from the clone. With `--local` Paperclip runs the plugin from that path, without copying it:

   ```bash
   $PC plugin install --local ~/paperclip-plugins/org-flow
   ```

   A reinstall after a soft uninstall reactivates the same row: same plugin id, saved state preserved.
5. Check the status:

   ```bash
   $PC plugin list
   $PC plugin inspect franciuto.org-flow
   ```

   It must be `ready`, with the expected version and `packagePath` pointing to your clone. If it is `upgrade_pending`, the version declares capabilities that the registered one did not have. Approve them from the plugin's page in the instance settings.
6. Open `https://your-paperclip.example.com/<company-prefix>/org-flow` and run the [checks](#checks).
7. Add the Dashboard widget from Paperclip's Dashboard, if the interface does not already show it.

## Updating

1. Get the new version and build it:

   ```bash
   cd ~/paperclip-plugins/org-flow
   git pull
   npm ci
   npm run build
   ```

2. Back up the database if the update changes capabilities, settings or the format of the saved state (see the [changelog](../CHANGELOG.md)).
3. **Automatic reload.** Paperclip watches the folder of plugins installed with `--local` and, when `dist/` changes, reloads the plugin after 500 ms: it re-reads the manifest and restarts the worker. There is no need to restart Paperclip. Check:

   ```bash
   $PC plugin list                         # status ready and new version
   $PC plugin logs franciuto.org-flow      # "org-flow: listening to tasks, agents and runs"
   ```

   If the version adds capabilities the plugin may stop at `upgrade_pending` until you approve them.

   **A version change needs a reinstall.** The automatic reload updates the UI bundle, but the worker and the registry can stay at the previous version (`plugin list` still shows the old version). When the version, the settings (`instanceConfigSchema`), the capabilities or the worker code change, reinstall after a database dump:

   ```bash
   $PC plugin uninstall franciuto.org-flow    # without --force: state and settings stay
   $PC plugin install --local ~/paperclip-plugins/org-flow
   $PC plugin list                            # ready and new version
   ```

   Paperclip reuses the same plugin id, so saved history and percentages stay.
4. **Reload the page** in the browser: the new UI arrives only with a reload.

If you develop the plugin, work in a separate clone and push your changes. Update the installed clone only from the remote.

## Settings

Defined in `instanceConfigSchema` (`src/worker/settings.ts`). The plugin reads them per company (`multiCompanyConfig: true`).

| Field | Title in Paperclip | Type | Default | Limits | Effect |
| --- | --- | --- | --- | --- | --- |
| `sleepAfterMinutes` | Minutes before "asleep" | integer | 15 | 1–1440 | an agent with no open tasks and no activity for this long is shown asleep |
| `keepClosedHours` | Visibility hours for closed tasks | integer | 24 | 0–720 | for how many hours `done`/`cancelled` tasks stay in the org chart and in "Recently closed" |
| `enableSimulation` | Show the "Simulation" toggle | boolean | true | | shows the "Simulation" button on the page |
| `departmentNames` | Department names | list of `{ lead, name }` | `[]` | `name` max 60 characters | replaces the deduced name of a department; `lead` is the lead's name or id, e.g. `[{ "lead": "Joe", "name": "Archive" }]` (see [data-contract.md](data-contract.md#departmentview)) |

Where to change them:

- **Paperclip interface**: instance settings → Plugins → Org Flow. The form is generated from the schema.
- **CLI**: saving replaces the entire configuration, so pass all the fields you want to keep:

  ```bash
  $PC plugin config franciuto.org-flow -C <company-id>
  $PC plugin config:set franciuto.org-flow -C <company-id> \
    --payload-json '{"companyId":"<company-id>","configJson":{"sleepAfterMinutes":20,"keepClosedHours":24,"enableSimulation":true}}'
  ```

Validation (`validateSettings`): non-integer values or values outside the limits are rejected with a message in English; unknown keys produce a warning. If an invalid value ends up in the database anyway, the worker brings it back within the limits or uses the default (`resolveSettings`). The worker applies the change immediately (`onConfigChanged`); at the latest within 60 s.

## Uninstalling and rolling back

Uninstall that preserves configuration and state (reinstallable with the same id):

```bash
$PC plugin uninstall franciuto.org-flow
```

Full uninstall, which also deletes configuration and saved state (activity feed, history, reported percentages):

```bash
$PC plugin uninstall franciuto.org-flow --force
```

Stop it without uninstalling:

```bash
$PC plugin disable franciuto.org-flow
$PC plugin enable franciuto.org-flow
```

Going back to a previous version:

```bash
cd ~/paperclip-plugins/org-flow
git checkout <previous-tag-or-commit>
npm ci && npm run build          # the automatic reload does the rest
```

If the worker version changed, reinstall as described in [Updating](#updating). The saved state stays compatible between versions (see the rules in [data-contract.md](data-contract.md#versioning-rules)). Restoring the database dump is needed only if something went wrong in the database itself. It rolls back the whole Paperclip instance, not just the plugin, and must be done with Paperclip stopped.

## Checks

### Plugin status

```bash
$PC plugin list
$PC plugin health franciuto.org-flow
$PC plugin logs franciuto.org-flow
```

`plugin health` reports the host's checks: plugin in the registry, valid manifest, status, last error (`healthy: true` if everything passes). The worker also has its own health status (`onHealth` in `src/worker.ts`): `ok` with "Org Flow active", or `degraded` for 5 minutes after a failed snapshot build, with the error message and the details `companies`, `lastEventAt`, `warnings`. The same errors end up in the logs as `org-flow: …` warnings. `plugin dashboard franciuto.org-flow` shows the host's diagnostics view.

### Bridge with `curl`

The board token is read from `~/.paperclip/auth.json` into a variable, without printing it:

```bash
TOKEN=$(python3 -c 'import json,os;print(json.load(open(os.path.expanduser("~/.paperclip/auth.json")))["credentials"]["https://your-paperclip.example.com:"]["token"])')
BASE="https://your-paperclip.example.com/api/plugins/franciuto.org-flow"
CO="<company-id>"
```

Snapshot (summarised with `python3`):

```bash
curl -sS -X POST "$BASE/bridge/data" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"key\":\"snapshot\",\"companyId\":\"$CO\",\"params\":{}}" \
  | python3 -c 'import json,sys; s=json.load(sys.stdin)["data"]; print(s["generatedAt"], len(s["people"]), "people", len(s["tasks"]), "tasks", s["counts"])'
```

Recent events for polling:

```bash
curl -sS -X POST "$BASE/bridge/data" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"key\":\"events\",\"companyId\":\"$CO\",\"params\":{}}" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]; print(d["cursor"], d["snapshotAt"]); [print(r["at"], r["kind"], r.get("identifier")) for r in d["records"]]'
```

Test event (appears in the page's activity feed as "Test event: worker and page are connected"; it does not create tasks and does not wake agents):

```bash
curl -sS -X POST "$BASE/bridge/action" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"key\":\"ping\",\"companyId\":\"$CO\",\"params\":{}}"
# {"data":{"ok":true}}
```

Stream (501 on Paperclip 2026.1023.0, which confirms that polling is needed):

```bash
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 10 -H "Authorization: Bearer $TOKEN" \
  "$BASE/bridge/stream/org-flow?companyId=$CO"
```

Useful error responses: `502` with `WORKER_UNAVAILABLE` (plugin not `ready`), `502` with another code (error in the worker, see the logs), `403` (token without access to the company), `501` on the stream.

The same thing from the CLI: `$PC plugin bridge:data franciuto.org-flow --payload-json '{"key":"snapshot","companyId":"<company-id>","params":{}}'`.

### Inspecting the saved state

Read-only, with `psql` (variable `DBURL` as in the backup). Replace `<plugin-id>` with the `id` shown by `$PC plugin inspect franciuto.org-flow`:

```bash
psql "$DBURL" -c "select scope_kind, scope_id, state_key, jsonb_typeof(value_json) as type,
  case when jsonb_typeof(value_json)='array' then jsonb_array_length(value_json) end as items, updated_at
  from plugin_state where plugin_id = '<plugin-id>' order by state_key;"
```

## What survives a Paperclip update

| What | Where it lives | After the update |
| --- | --- | --- |
| Plugin code | your clone, for example `~/paperclip-plugins/org-flow` | intact: it is outside `~/.paperclip/cli/installs/` |
| Plugin registration (`plugins` row, `packagePath`) | database | intact |
| Settings | database (`plugin_config`) | intact |
| Activity feed, history, reported percentages | database (`plugin_state`) | intact |
| Worker cache, runs in progress | memory | lost on restart, rebuilt on their own |

What can break: the plugin depends on host APIs that may change (`issues.list`, `getSubtree`, `agent.run.*` events, bridge shape). The build uses the `@paperclipai/plugin-sdk` SDK at the version pinned in `package.json` (2026.1023.0). After a Paperclip update:

1. `$PC plugin list`: status `ready`? If it is `error`, look at `lastError` and the logs ([troubleshooting.md](troubleshooting.md)). Paperclip retries plugins in error once at startup.
2. Open the page: "Live" indicator, people and tasks present.
3. Run the `ping` and check that it appears in the activity feed.
4. Check the stream: if it no longer answers 501, the UI will use it on its own; see [design-decisions.md](design-decisions.md#polling-instead-of-the-stream).
5. If the SDK needs updating: change the version in `package.json`, `npm install`, `npm run typecheck && npm test`, then the update procedure.
