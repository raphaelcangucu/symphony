defmodule SymphonyElixir.GitHub.ReadCache do
  @moduledoc """
  Shared read-through cache for GitHub reads, acting as the single source of truth
  for both the orchestrator poll loop and frontend-serving endpoints.

  Successful results (`{:ok, _}`) are cached per logical key for a short TTL (default
  60s). Concurrent misses for the same key are coalesced into a single underlying
  fetch (single-flight), so the orchestrator and the UI never duplicate the same
  GitHub call within the window. Errors are never cached and never wedge a key.
  """

  use GenServer

  require Logger

  @table :symphony_github_read_cache
  @default_ttl_ms 60_000
  @call_timeout 60_000

  @type key :: term()
  @type fetch_result :: {:ok, term()} | {:error, term()}

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @spec table_name() :: atom()
  def table_name, do: @table

  @doc """
  Returns the cached value for `key` if fresh, otherwise runs `fun` (single-flight)
  and caches a `{:ok, _}` result for `ttl_ms`. Errors are returned without caching.
  """
  @spec fetch(key(), (-> fetch_result()), pos_integer()) :: fetch_result()
  def fetch(key, fun, ttl_ms \\ default_ttl_ms()) when is_function(fun, 0) and is_integer(ttl_ms) do
    cond do
      Process.whereis(__MODULE__) == nil ->
        fun.()

      true ->
        case lookup(key) do
          {:ok, _value} = hit -> hit
          :miss -> GenServer.call(__MODULE__, {:fetch, key, fun, ttl_ms}, @call_timeout)
        end
    end
  end

  @spec invalidate(key()) :: :ok
  def invalidate(key) do
    if :ets.whereis(@table) != :undefined, do: :ets.delete(@table, key)
    :ok
  end

  @spec invalidate_all() :: :ok
  def invalidate_all do
    if :ets.whereis(@table) != :undefined, do: :ets.delete_all_objects(@table)
    :ok
  end

  @spec default_ttl_ms() :: pos_integer()
  def default_ttl_ms do
    case Application.get_env(:symphony_elixir, :github_read_cache_ttl_ms, @default_ttl_ms) do
      ttl when is_integer(ttl) and ttl > 0 -> ttl
      _ -> @default_ttl_ms
    end
  end

  @impl true
  def init(_opts) do
    :ets.new(@table, [:named_table, :public, :set, read_concurrency: true])
    {:ok, %{inflight: %{}, refs: %{}}}
  end

  @impl true
  def handle_call({:fetch, key, fun, ttl_ms}, from, state) do
    case lookup(key) do
      {:ok, _value} = hit ->
        {:reply, hit, state}

      :miss ->
        {:noreply, start_or_join(state, key, fun, ttl_ms, from)}
    end
  end

  @impl true
  def handle_info({ref, result}, %{refs: refs} = state) when is_reference(ref) do
    Process.demonitor(ref, [:flush])

    case Map.pop(refs, ref) do
      {nil, _refs} ->
        {:noreply, state}

      {key, refs} ->
        state = %{state | refs: refs}
        {entry, inflight} = Map.pop(state.inflight, key)
        maybe_cache(key, result, entry)
        reply_waiters(entry, result)
        {:noreply, %{state | inflight: inflight}}
    end
  end

  def handle_info({:DOWN, ref, :process, _pid, reason}, %{refs: refs} = state) do
    case Map.pop(refs, ref) do
      {nil, _refs} ->
        {:noreply, state}

      {key, refs} ->
        {entry, inflight} = Map.pop(state.inflight, key)
        error = {:error, {:read_cache_crash, reason}}
        reply_waiters(entry, error)
        {:noreply, %{state | refs: refs, inflight: inflight}}
    end
  end

  def handle_info(_msg, state), do: {:noreply, state}

  defp start_or_join(%{inflight: inflight} = state, key, fun, ttl_ms, from) do
    case Map.get(inflight, key) do
      %{waiters: waiters} = entry ->
        %{state | inflight: Map.put(inflight, key, %{entry | waiters: [from | waiters]})}

      nil ->
        task = Task.Supervisor.async_nolink(SymphonyElixir.TaskSupervisor, safe_fun(fun))
        entry = %{waiters: [from], ttl_ms: ttl_ms}

        %{
          state
          | inflight: Map.put(inflight, key, entry),
            refs: Map.put(state.refs, task.ref, key)
        }
    end
  end

  # Guarantees the task always sends a result tuple so a key cannot wedge.
  defp safe_fun(fun) do
    fn ->
      try do
        case fun.() do
          {:ok, _value} = ok -> ok
          {:error, _reason} = error -> error
          other -> {:error, {:read_cache_unexpected, other}}
        end
      rescue
        exception -> {:error, {:read_cache_exception, exception}}
      end
    end
  end

  defp maybe_cache(key, {:ok, _value} = result, %{ttl_ms: ttl_ms}) when is_integer(ttl_ms) do
    expires_at = System.monotonic_time(:millisecond) + ttl_ms
    :ets.insert(@table, {key, result, expires_at})
  end

  defp maybe_cache(_key, _result, _entry), do: :ok

  defp reply_waiters(%{waiters: waiters}, result) when is_list(waiters) do
    Enum.each(waiters, fn from -> GenServer.reply(from, result) end)
  end

  defp reply_waiters(_entry, _result), do: :ok

  defp lookup(key) do
    case safe_ets_lookup(key) do
      [{^key, result, expires_at}] ->
        if System.monotonic_time(:millisecond) < expires_at, do: result, else: :miss

      _ ->
        :miss
    end
  end

  defp safe_ets_lookup(key) do
    :ets.lookup(@table, key)
  rescue
    ArgumentError -> []
  end
end
