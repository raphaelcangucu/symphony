defmodule SymphonyElixir.Repo do
  @moduledoc """
  SQLite repository used by Symphony's local tracker.
  """

  use Ecto.Repo,
    otp_app: :symphony_elixir,
    adapter: Ecto.Adapters.SQLite3

  @impl true
  def init(_type, config) do
    database =
      if Application.get_env(:symphony_elixir, :local_tracker_database_pinned?, false) do
        # In :test the path is pinned by config.exs to a tmp file and the
        # SYMPHONY_LOCAL_TRACKER_DATABASE override is deliberately ignored, so
        # the suite (which truncates every table on setup) can NEVER touch the
        # dev/prod database. Trust that already-resolved value instead of
        # re-reading the env var, which would reconnect tests to real data.
        Keyword.fetch!(config, :database)
      else
        SymphonyElixir.Config.local_tracker_database_path()
      end

    :ok = File.mkdir_p!(Path.dirname(database))
    {:ok, Keyword.put(config, :database, database)}
  end
end
