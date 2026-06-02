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

config :symphony_elixir, SymphonyElixir.Repo,
  database: local_tracker_database,
  pool_size: String.to_integer(System.get_env("SYMPHONY_LOCAL_TRACKER_POOL_SIZE") || "5"),
  stacktrace: Mix.env() in [:dev, :test],
  show_sensitive_data_on_connection_error: Mix.env() in [:dev, :test]

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
