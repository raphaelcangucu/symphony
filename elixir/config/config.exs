import Config

config :phoenix, :json_library, Jason

config :symphony_elixir, ecto_repos: [SymphonyElixir.Repo]

config :symphony_elixir,
  codex_sessions_dir:
    System.get_env("SYMPHONY_CODEX_SESSIONS_DIR") ||
      if(Mix.env() == :test,
        do: Path.expand("../tmp/test-codex-sessions", __DIR__),
        else: Path.expand("~/.codex/sessions")
      )

local_tracker_database =
  System.get_env("SYMPHONY_LOCAL_TRACKER_DATABASE") ||
    Path.expand("../tmp/#{Mix.env()}-local-tracker.sqlite3", __DIR__)

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
