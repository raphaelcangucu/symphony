defmodule SymphonyElixir.HotpathCache do
  @moduledoc """
  Tiny process-local ETS TTL cache for tracker hotpath responses.

  Used by assistant catalogs, issue KB trees, and similar read-mostly payloads
  that are expensive to recompute (CLI discovery, git diffs) but safe to serve
  briefly stale.

  `fetch_or_store/4` adds per-key single-flight so concurrent cold misses do not
  each launch the same expensive CLI/git work: the first caller computes while
  the others wait for the shared result. With the `:stale_ms` option it also
  supports stale-while-revalidate — an expired-but-within-stale entry is returned
  immediately while a single background task refreshes it.
  """

  alias SymphonyElixir.Observability.Metrics

  @table :symphony_hotpath_cache
  @lock_table :symphony_hotpath_cache_locks

  # Loser poll interval and how long a leader may hold the compute lock before a
  # loser assumes it is gone and takes over. Both are overridable per call.
  @poll_ms 10
  @lock_ttl_ms 30_000
  @default_wait_ms 5_000

  @doc """
  Creates the cache and lock ETS tables if missing. Called at boot by the
  supervised owner so the tables outlive the short-lived request/task processes
  that would otherwise own (and, on exit, delete) them.
  """
  @spec ensure_tables!() :: :ok
  def ensure_tables! do
    ensure_table!()
    ensure_lock_table!()
    :ok
  end

  @spec fetch(term()) :: {:ok, term()} | :miss
  def fetch(key) do
    case read_entry(key) do
      {:fresh, value} -> {:ok, value}
      _ -> :miss
    end
  end

  @spec put(term(), term(), non_neg_integer()) :: :ok
  def put(key, value, ttl_ms) when is_integer(ttl_ms) and ttl_ms >= 0 do
    store(key, value, ttl_ms, [])
  end

  @doc """
  Returns the cached value for `key`, computing and storing it with `fun` on a
  miss. Concurrent misses for the same key run `fun` once (single-flight); the
  other callers wait for and share the result.

  Options:

    * `:stale_ms` — length of the stale-while-revalidate window after the fresh
      TTL. Within it, the stale value is returned immediately and refreshed by a
      single background task. Defaults to `0` (no stale window).
    * `:wait_ms` — how long a waiting caller polls for the leader's result before
      computing directly to guarantee progress. Defaults to `#{@default_wait_ms}`.

  Raises whatever `fun` raises (the compute lock is always released first).
  """
  @spec fetch_or_store(term(), non_neg_integer(), (-> term()), keyword()) :: term()
  def fetch_or_store(key, ttl_ms, fun, opts \\ [])
      when is_integer(ttl_ms) and ttl_ms >= 0 and is_function(fun, 0) and is_list(opts) do
    case read_entry(key) do
      {:fresh, value} ->
        emit_fetch(key, :fresh)
        value

      {:stale, value} ->
        emit_fetch(key, :stale)
        start_stale_refresh(key, ttl_ms, fun, opts)
        value

      :miss ->
        emit_fetch(key, :miss)
        compute_single_flight(key, ttl_ms, fun, opts)
    end
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

  # ── Internals ──────────────────────────────────────────────────────────

  defp compute_single_flight(key, ttl_ms, fun, opts) do
    case acquire_lock(key) do
      :acquired -> run_and_store(key, ttl_ms, fun, opts, :computed)
      :busy -> wait_for_leader(key, ttl_ms, fun, opts, wait_ms(opts), monotonic_start())
    end
  end

  # A leader too slow (or gone) is bounded: after the wait budget the waiter
  # computes directly so a stuck compute never blocks a request indefinitely.
  defp wait_for_leader(key, ttl_ms, fun, opts, remaining, _start) when remaining <= 0 do
    compute_direct(key, ttl_ms, fun, opts)
  end

  defp wait_for_leader(key, ttl_ms, fun, opts, remaining, start) do
    Process.sleep(@poll_ms)

    case read_entry(key) do
      {:fresh, value} -> coalesced(key, value, start)
      {:stale, value} -> coalesced(key, value, start)
      :miss -> wait_for_leader(key, ttl_ms, fun, opts, remaining - @poll_ms, start)
    end
  end

  # The leader delivered the shared result: this caller avoided a duplicate
  # compute. Record it so coalescing is observable, and return the value.
  defp coalesced(key, value, start) do
    Metrics.emit([:hotpath, :recompute], %{duration_ms: Metrics.duration_ms(start)}, %{
      key: key,
      outcome: :coalesced
    })

    value
  end

  defp run_and_store(key, ttl_ms, fun, opts, outcome) do
    Metrics.span([:hotpath, :recompute], %{key: key, outcome: outcome}, fn ->
      try do
        value = fun.()
        store(key, value, ttl_ms, opts)
        value
      after
        release_lock(key)
      end
    end)
  end

  defp compute_direct(key, ttl_ms, fun, opts) do
    Metrics.span([:hotpath, :recompute], %{key: key, outcome: :computed}, fn ->
      value = fun.()
      store(key, value, ttl_ms, opts)
      value
    end)
  end

  defp start_stale_refresh(key, ttl_ms, fun, opts) do
    case acquire_lock(key) do
      :acquired -> Task.start(fn -> run_and_store(key, ttl_ms, fun, opts, :stale_refresh) end)
      :busy -> :ok
    end

    :ok
  end

  defp emit_fetch(key, hit) do
    Metrics.emit([:hotpath, :fetch], %{count: 1}, %{key: key, hit: hit})
  end

  defp monotonic_start, do: Metrics.monotonic_start()

  defp store(key, value, ttl_ms, opts) do
    ensure_table!()
    now = now_ms()
    fresh_until = now + ttl_ms
    stale_until = fresh_until + max(Keyword.get(opts, :stale_ms, 0), 0)
    :ets.insert(@table, {key, value, fresh_until, stale_until})
    :ok
  rescue
    ArgumentError -> :ok
  end

  # Table-loss-safe read: ephemeral ETS ownership means the table can briefly
  # vanish when its creator process exits; degrade to :miss instead of crashing.
  defp read_entry(key) do
    ensure_table!()
    entry(key, now_ms())
  rescue
    ArgumentError -> :miss
  end

  defp entry(key, now) do
    case :ets.lookup(@table, key) do
      [{^key, value, fresh_until, stale_until}] ->
        cond do
          now < fresh_until -> {:fresh, value}
          now < stale_until -> {:stale, value}
          true -> :miss
        end

      _ ->
        :miss
    end
  end

  defp acquire_lock(key) do
    ensure_lock_table!()
    now = now_ms()
    deadline = now + @lock_ttl_ms

    if :ets.insert_new(@lock_table, {key, deadline}) do
      :acquired
    else
      take_over_expired_lock(key, now, deadline)
    end
  rescue
    ArgumentError -> :busy
  end

  defp take_over_expired_lock(key, now, deadline) do
    case :ets.lookup(@lock_table, key) do
      [{^key, existing_deadline}] when now >= existing_deadline ->
        :ets.delete(@lock_table, key)
        if :ets.insert_new(@lock_table, {key, deadline}), do: :acquired, else: :busy

      _ ->
        :busy
    end
  end

  defp release_lock(key) do
    if :ets.whereis(@lock_table) != :undefined, do: :ets.delete(@lock_table, key)
    :ok
  end

  defp wait_ms(opts), do: max(Keyword.get(opts, :wait_ms, @default_wait_ms), 0)

  defp now_ms, do: System.monotonic_time(:millisecond)

  defp ensure_table!, do: ensure_named_table!(@table)
  defp ensure_lock_table!, do: ensure_named_table!(@lock_table)

  defp ensure_named_table!(name) do
    case :ets.whereis(name) do
      :undefined ->
        try do
          :ets.new(name, [:named_table, :public, :set, read_concurrency: true, write_concurrency: true])
        rescue
          ArgumentError -> name
        end

      _tid ->
        name
    end
  end
end
