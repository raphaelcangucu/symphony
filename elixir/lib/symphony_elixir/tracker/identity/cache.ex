defmodule SymphonyElixir.Tracker.Identity.Cache do
  @moduledoc """
  Owns the ETS table backing `SymphonyElixir.Tracker.Identity`.

  Provider identities (Jira `accountId`, Linear user id, etc.) change rarely, so
  they are cached with a TTL to avoid burning provider rate limits on every poll
  cycle. GitHub identity is cached separately by `LocalTracker.Viewer`.
  """

  use GenServer

  @table :symphony_tracker_identity_cache

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @spec table_name() :: atom()
  def table_name, do: @table

  @spec fetch(term()) :: {:ok, term()} | :miss
  def fetch(key) do
    case :ets.lookup(@table, key) do
      [{^key, value, expires_at}] ->
        if System.monotonic_time(:millisecond) < expires_at, do: {:ok, value}, else: :miss

      _ ->
        :miss
    end
  rescue
    ArgumentError -> :miss
  end

  @spec put(term(), term(), non_neg_integer()) :: :ok
  def put(key, value, ttl_ms) when is_integer(ttl_ms) and ttl_ms >= 0 do
    expires_at = System.monotonic_time(:millisecond) + ttl_ms
    :ets.insert(@table, {key, value, expires_at})
    :ok
  rescue
    ArgumentError -> :ok
  end

  @spec invalidate(term()) :: :ok
  def invalidate(key) do
    if :ets.whereis(@table) != :undefined, do: :ets.delete(@table, key)
    :ok
  end

  @spec invalidate_all() :: :ok
  def invalidate_all do
    if :ets.whereis(@table) != :undefined, do: :ets.delete_all_objects(@table)
    :ok
  end

  @impl true
  def init(_opts) do
    :ets.new(@table, [:named_table, :public, :set, read_concurrency: true])
    {:ok, %{}}
  end
end
