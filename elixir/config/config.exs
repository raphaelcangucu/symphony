import Config

config :phoenix, :json_library, Jason

config :symphony_elixir, ecto_repos: [SymphonyElixir.Repo]

# Local-first tracker reads/sync. Enabled by default so the UI and orchestrator
# read from the local mirror (and the background sync engine keeps it fresh),
# instead of hitting the remote GitHub/Linear/Jira API on every request and
# burning the rate limit. Disabled under :test so the existing suites that
# exercise the remote adapters keep their behavior unless they opt in via
# `Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)`.
config :symphony_elixir, :tracker, sync_enabled: Mix.env() != :test

# Process-level default agent kind for global-less per-project orchestration.
# A project's own WORKFLOW front matter (codex:/claude:) takes precedence; this
# is the fallback when a project declares no agent section. Override per
# deployment if a different default is desired.
config :symphony_elixir, :default_agent_kind, "codex"

# Persist the resolved GitHub viewer identity (login/name/avatar) to disk so it
# survives restarts and can be served when GitHub is rate-limited. Off in :test
# so suites stay hermetic (pure in-memory ETS cache).
config :symphony_elixir, :viewer_persist_enabled, Mix.env() != :test

# Seed a cold local mirror on first read: when a remote project has never been
# synced, fetch its issue list once (bounded — no comments/PRs) so the board is
# not empty at cold start, then enrich in the background. Off in :test so the
# local-first read suites stay hermetic (no remote calls).
config :symphony_elixir, :tracker_seed_on_empty, Mix.env() != :test

# Repo-root `skills/` directory for vendored, agent-agnostic skill definitions
# loaded by `SymphonyElixir.Skills`. `__DIR__` here is `.../symphony/elixir/config`,
# so `../../skills` resolves to the repo-root `skills/` dir.
config :symphony_elixir, :skills_root, Path.expand("../../skills", __DIR__)

config :symphony_elixir,
  codex_sessions_dir:
    System.get_env("SYMPHONY_CODEX_SESSIONS_DIR") ||
      if(Mix.env() == :test,
        do: Path.expand("../tmp/test-codex-sessions", __DIR__),
        else: Path.expand("~/.codex/sessions")
      )

# Local tracker SQLite database path.
#
# Override with `SYMPHONY_LOCAL_TRACKER_DATABASE` (e.g. in `elixir/.env`, which is
# sourced by `make serve`). The default deliberately lives in a persistent
# `.symphony/` directory (NOT the ephemeral `tmp/`, which gets wiped by cleans),
# so project/issue data survives across rebuilds. The test env stays in `tmp/`.
default_local_tracker_database =
  case Mix.env() do
    :test -> Path.expand("../tmp/test-local-tracker.sqlite3", __DIR__)
    _ -> Path.expand("../.symphony/tracker.sqlite3", __DIR__)
  end

# The test suite truncates every table on setup, so it must NEVER touch the
# dev/prod database. In `:test` we pin the path and ignore the
# `SYMPHONY_LOCAL_TRACKER_DATABASE` override (which is commonly exported via
# `.env`), preventing a sourced shell from pointing tests at real data.
local_tracker_database =
  case {Mix.env(), System.get_env("SYMPHONY_LOCAL_TRACKER_DATABASE")} do
    {:test, _override} -> default_local_tracker_database
    {_env, value} when is_binary(value) and value != "" -> Path.expand(value)
    {_env, _value} -> default_local_tracker_database
  end

File.mkdir_p!(Path.dirname(local_tracker_database))

# `SymphonyElixir.Repo.init/2` re-resolves the database path at boot (so a dev/prod
# instance picks up a changed `SYMPHONY_LOCAL_TRACKER_DATABASE` without a recompile).
# Under :test that runtime re-read would defeat the pinning above and reconnect the
# Repo to the real `.env` database — which is catastrophic because the suite truncates
# every table on setup. This flag tells `Repo.init/2` to trust the pinned config
# value here (NOT re-read the env var) so tests can NEVER touch real data. It is a
# plain Application env value (no `Mix` at runtime), so it is safe in releases.
config :symphony_elixir, :local_tracker_database_pinned?, Mix.env() == :test

default_backup_local_dir =
  case Mix.env() do
    :test -> Path.expand("../tmp/test-backups", __DIR__)
    _ -> Path.expand("../.symphony/backups", __DIR__)
  end

backup_local_dir =
  case {Mix.env(), System.get_env("SYMPHONY_BACKUP_DIR")} do
    {:test, _override} -> default_backup_local_dir
    {_env, value} when is_binary(value) and value != "" -> Path.expand(value)
    {_env, _value} -> default_backup_local_dir
  end

backup_retention_days =
  case Integer.parse(System.get_env("SYMPHONY_BACKUP_RETENTION_DAYS") || "30") do
    {days, _} when days > 0 -> days
    _ -> 30
  end

File.mkdir_p!(backup_local_dir)

config :symphony_elixir,
  root_dir: Path.expand("..", __DIR__),
  backup_local_dir: backup_local_dir,
  backup_retention_days: backup_retention_days

config :symphony_elixir, SymphonyElixir.Repo,
  database: local_tracker_database,
  pool_size: String.to_integer(System.get_env("SYMPHONY_LOCAL_TRACKER_POOL_SIZE") || "5"),
  stacktrace: Mix.env() in [:dev, :test],
  show_sensitive_data_on_connection_error: Mix.env() in [:dev, :test]

# Tests drive the endpoint via Phoenix.ConnTest (no real listener), so suppress
# the HTTP listener under :test. `nil` makes SymphonyElixir.HttpServer `:ignore`
# instead of binding a port (which would collide with a running dev server).
if Mix.env() == :test do
  config :symphony_elixir, server_port: nil
end

config :symphony_elixir, SymphonyElixirWeb.Endpoint,
  adapter: Bandit.PhoenixAdapter,
  url: [host: "localhost"],
  render_errors: [
    formats: [html: SymphonyElixirWeb.ErrorHTML, json: SymphonyElixirWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: SymphonyElixir.PubSub,
  live_view: [signing_salt: "symphony-live-view"],
  secret_key_base: String.duplicate("s", 64),
  check_origin: false,
  server: false
