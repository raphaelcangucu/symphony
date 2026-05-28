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
      case SymphonyElixir.Config.tracker_kind() do
        "local" -> SymphonyElixir.Config.local_database_path()
        _other -> Keyword.fetch!(config, :database)
      end

    :ok = File.mkdir_p!(Path.dirname(database))
    {:ok, Keyword.put(config, :database, database)}
  end
end
