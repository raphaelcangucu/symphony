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

## Stop preview without touching main

```bash
cd .worktrees/combined-preview/elixir
make stop
```

Main daemon keeps running on `:4000`.
