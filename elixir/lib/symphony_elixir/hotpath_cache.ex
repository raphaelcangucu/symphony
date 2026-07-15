defmodule SymphonyElixir.HotpathCache do
  @moduledoc """
  Tiny process-local ETS TTL cache for tracker hotpath responses.

  Used by assistant catalogs, issue KB trees, and similar read-mostly payloads
  that are expensive to recompute (CLI discovery, git diffs) but safe to serve
  briefly stale.
  """

  @table :symphony_hotpath_cache

  @spec fetch(term()) :: {:ok, term()} | :miss
  def fetch(key) do
    ensure_table!()

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
    ensure_table!()
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

  defp ensure_table! do
    case :ets.whereis(@table) do
      :undefined ->
        try do
          :ets.new(@table, [:named_table, :public, :set, read_concurrency: true])
        rescue
          ArgumentError -> @table
        end

      _tid ->
        @table
    end
  end
end
