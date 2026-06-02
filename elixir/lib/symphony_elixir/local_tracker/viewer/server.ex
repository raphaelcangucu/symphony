defmodule SymphonyElixir.LocalTracker.Viewer.Server do
  @moduledoc "Owns the ETS table backing `SymphonyElixir.LocalTracker.Viewer`."

  use GenServer

  @table :symphony_viewer_cache

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @spec table_name() :: atom()
  def table_name, do: @table

  @impl true
  def init(_opts) do
    :ets.new(@table, [:named_table, :public, :set, read_concurrency: true])
    SymphonyElixir.LocalTracker.Viewer.hydrate_from_disk()
    {:ok, %{}}
  end
end
