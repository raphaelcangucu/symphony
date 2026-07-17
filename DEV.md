# combined-preview worktree — isolated dev stack

This worktree must **not** share the main Symphony daemon (`symphony/elixir` on
`:4000`). Use the preview stack below so QA and feature work stay on a separate
SQLite database and test project.

## Isolation checklist

| Resource | Main (`symphony/elixir`) | Preview (this worktree) |
|---|---|---|
| HTTP | `:4000` | `:4001` |
| Vite | `:5173` (default) | `:5174` |
| SQLite | `.symphony/tracker.sqlite3` | `.symphony/tracker-test.sqlite3` |
| Serve lock | `/tmp/symphony-tracker-serve.lock` | `.symphony/serve.lock` |
| BEAM node | `symphony@127.0.0.1` | `symphony-combined@127.0.0.1` |
| Tracker token | `elixir/.env` | **different** token in this worktree's `elixir/.env` |
| Test project | real projects (`gamba`, …) | `symphony-tracker` (`SYM-*` issues) |

## Boot preview stack

Terminal 1 — backend (from this worktree):

```bash
cd .worktrees/combined-preview/elixir
make preview-serve
```

Terminal 2 — frontend (proxies to `:4001`, not `:4000`):

```bash
cd .worktrees/combined-preview/elixir
make preview-tracker-dev
```

Open:

- Board: http://127.0.0.1:5174/tracker/projects/symphony-tracker/board
- Agent QA issue: http://127.0.0.1:5174/tracker/projects/symphony-tracker/board/issues/SYM-4/agent?agent=execution

Set the preview token in the browser once:

```js
localStorage.setItem('symphony.tracker.token', '<SYMPHONY_TRACKER_TOKEN from elixir/.env>');
```

## Test project

The preview database ships with project **`symphony-tracker`** and issues
`SYM-1` … `SYM-4` for UI/orchestrator experiments. Do **not** use `gamba` /
`GAM-*` here — those live in the main database.

Repo clone target: this Symphony repo (`workspace_path: symphony`), so agent
runs stay inside the worktree checkout.

## Dogfood issue Preview

The repository convention in `.symphony/devenv.yaml` defines the tracker Vite
serve step. It runs through `symphony-preview-runner`; do not add a
project-local `.symphony/serve.sh`.

Vite only serves the UI and proxies `/api` and `/socket`, so Phoenix must
already be running when Preview starts:

- For the main stack, run `cd elixir && make serve`. Vite defaults
  `TRACKER_API_PROXY_TARGET` and `TRACKER_SOCKET_PROXY_TARGET` to Phoenix on
  `127.0.0.1:4000`.
- For this isolated preview stack, start Phoenix with the proxy targets in the
  daemon environment so the runner-launched Vite process inherits them:

  ```bash
  cd .worktrees/combined-preview/elixir
  TRACKER_API_PROXY_TARGET=http://127.0.0.1:4001 \
    TRACKER_SOCKET_PROXY_TARGET=ws://127.0.0.1:4001 \
    make preview-serve
  ```

`elixir/WORKFLOW.local-dev.md` enables the runtime contract for project slug
`symphony`. The preview database uses `symphony-tracker`, so give that project
the same `dev_server` settings in
`/projects/symphony-tracker/settings/workflow`:

```yaml
dev_server:
  enabled: true
  runtime_contract_v1: true
  port_range: [4400, 4499]
```

After an issue workspace has cloned this repository, open
`/projects/symphony-tracker/settings/dev`, click **Propose steps**, verify the
**Tracker Vite preview** serve step, then click **Save configuration**. This
imports the nested `run_spec` once for the project; repeat propose/save only
when the convention changes.

To smoke the dogfood flow, open a `SYM-*` issue, open its **Preview** tab, and
click **Start Preview**. Readiness should resolve at `/tracker/` on the leased
port while API and socket traffic continue to reach the running Phoenix
backend.

## Stop preview without touching main

```bash
cd .worktrees/combined-preview/elixir
make stop
```

Main daemon keeps running on `:4000`.
