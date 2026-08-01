defmodule SymphonyElixir.AgentUsage do
  @moduledoc """
  Ephemeral plan-usage state keyed by `{agent_kind, account_id}`.

  Inactive accounts remain visible, failures retain their last useful snapshot,
  and refresh generations prevent delayed responses from overwriting newer
  data. The legacy arity-two API maps to the `"default"` compatibility account.
  """

  alias SymphonyElixir.AgentUsage.Snapshot
  alias SymphonyElixir.AgentUsage.Window

  @store_key {__MODULE__, :store}
  @default_account_id "default"
  @default_ttl_ms 600_000
  @known_agents ["codex", "claude", "cursor", "opencode"]

  @type entry :: %{
          snapshot: Snapshot.t() | nil,
          stale: boolean(),
          state: :fresh | :refreshing | :stale,
          stale_reason: atom() | nil,
          next_refresh_at: integer() | nil,
          generation: non_neg_integer(),
          failure_count: non_neg_integer()
        }

  @spec put(String.t(), Snapshot.t()) :: :ok
  def put(agent_kind, %Snapshot{} = snapshot),
    do: put(agent_kind, @default_account_id, snapshot)

  @spec put(String.t(), String.t(), Snapshot.t()) :: :ok
  def put(agent_kind, account_id, %Snapshot{} = snapshot)
      when is_binary(agent_kind) and is_binary(account_id) do
    now_ms = System.monotonic_time(:millisecond)
    stamped = stamp(snapshot, account_id, :fresh, nil, nil, nil)

    transaction(fn ->
      previous = Map.get(read_store(), {agent_kind, account_id}, empty_record())

      record = %{
        previous
        | snapshot: stamped,
          stored_at: now_ms,
          state: :fresh,
          stale_reason: nil,
          next_refresh_at: nil,
          error: nil,
          failure_count: 0
      }

      write_record(agent_kind, account_id, record)
    end)
  end

  @spec get(String.t()) :: Snapshot.t() | nil
  def get(agent_kind), do: get(agent_kind, @default_account_id)

  @spec get(String.t(), String.t()) :: Snapshot.t() | nil
  def get(agent_kind, account_id) do
    case entry(agent_kind, account_id) do
      %{snapshot: %Snapshot{} = snapshot} -> snapshot
      _ -> nil
    end
  end

  @spec entry(String.t(), String.t(), integer()) :: entry()
  def entry(agent_kind, account_id, now_ms \\ System.monotonic_time(:millisecond)) do
    record = Map.get(read_store(), {agent_kind, account_id}, empty_record())
    present(record, now_ms)
  end

  @spec account_ids(String.t()) :: [String.t()]
  def account_ids(agent_kind) do
    for {{^agent_kind, account_id}, _record} <- read_store(), do: account_id
  end

  @spec capture_event(String.t(), String.t(), map()) :: :ok
  def capture_event(agent_kind, account_id, event)
      when is_binary(agent_kind) and is_binary(account_id) and is_map(event) do
    rate_limits = Map.get(event, :rate_limits) || Map.get(event, "rate_limits")

    if is_map(rate_limits) do
      snapshot = Window.normalize(agent_kind, rate_limits)

      if usage_present?(snapshot) do
        put(agent_kind, account_id, snapshot)
      else
        :ok
      end
    else
      :ok
    end
  rescue
    _error -> :ok
  end

  @spec stale?(String.t(), integer()) :: boolean()
  def stale?(agent_kind, now_ms \\ System.monotonic_time(:millisecond)),
    do: entry(agent_kind, @default_account_id, now_ms).stale

  @spec stale?(String.t(), String.t(), integer()) :: boolean()
  def stale?(agent_kind, account_id, now_ms),
    do: entry(agent_kind, account_id, now_ms).stale

  @spec snapshot(integer()) :: %{atom() => entry()}
  def snapshot(now_ms \\ System.monotonic_time(:millisecond)) do
    Map.new(@known_agents, fn agent ->
      {String.to_atom(agent), entry(agent, @default_account_id, now_ms)}
    end)
  end

  @spec begin_refresh(String.t(), String.t(), keyword()) ::
          {:ok, pos_integer()} | {:error, :already_refreshing | :backoff}
  def begin_refresh(agent_kind, account_id, options \\ []) do
    now_ms = Keyword.get(options, :now_ms, System.monotonic_time(:millisecond))
    force? = Keyword.get(options, :force, false)

    transaction(fn ->
      record = Map.get(read_store(), {agent_kind, account_id}, empty_record())

      cond do
        record.state == :refreshing and not force? ->
          {:error, :already_refreshing}

        is_integer(record.next_refresh_at) and now_ms < record.next_refresh_at and not force? ->
          {:error, :backoff}

        true ->
          generation = record.generation + 1
          updated = %{record | generation: generation, state: :refreshing}
          write_record(agent_kind, account_id, updated)
          {:ok, generation}
      end
    end)
  end

  @spec complete_refresh(String.t(), String.t(), pos_integer(), term(), keyword()) ::
          :ok | :ignored
  def complete_refresh(agent_kind, account_id, generation, result, options \\ []) do
    now_ms = Keyword.get(options, :now_ms, System.monotonic_time(:millisecond))

    transaction(fn ->
      record = Map.get(read_store(), {agent_kind, account_id}, empty_record())

      if record.generation != generation do
        :ignored
      else
        updated = complete_record(record, account_id, result, now_ms, options)
        write_record(agent_kind, account_id, updated)
      end
    end)
  end

  @spec known_agents() :: [String.t()]
  def known_agents, do: @known_agents

  @spec reset() :: :ok
  def reset do
    :persistent_term.erase(@store_key)
    :ok
  end

  defp complete_record(record, account_id, {:ok, %Snapshot{} = snapshot}, now_ms, _options) do
    %{
      record
      | snapshot: stamp(snapshot, account_id, :fresh, nil, nil, nil),
        stored_at: now_ms,
        state: :fresh,
        stale_reason: nil,
        next_refresh_at: nil,
        error: nil,
        failure_count: 0
    }
  end

  defp complete_record(record, _account_id, {:error, reason}, now_ms, options) do
    stale_reason = error_class(reason)
    backoff_ms = Keyword.get(options, :backoff_ms, 0)
    next_refresh_at = now_ms + max(backoff_ms, 0)

    %{
      record
      | snapshot:
          mark_snapshot(
            record.snapshot,
            :stale,
            stale_reason,
            next_refresh_at,
            sanitized_error(reason)
          ),
        state: :stale,
        stale_reason: stale_reason,
        next_refresh_at: next_refresh_at,
        error: sanitized_error(reason),
        failure_count: record.failure_count + 1
    }
  end

  defp complete_record(record, _account_id, other, now_ms, options),
    do: complete_record(record, nil, {:error, {:unexpected, other}}, now_ms, options)

  defp present(record, now_ms) do
    ttl_stale? =
      is_integer(record.stored_at) and now_ms - record.stored_at >= ttl_ms()

    {state, reason} =
      if ttl_stale? and record.state == :fresh do
        {:stale, :ttl_expired}
      else
        {record.state, record.stale_reason}
      end

    %{
      snapshot:
        mark_snapshot(
          record.snapshot,
          state,
          reason,
          record.next_refresh_at,
          record.error
        ),
      stale: is_nil(record.snapshot) or state == :stale,
      state: state,
      stale_reason: reason,
      next_refresh_at: record.next_refresh_at,
      generation: record.generation,
      failure_count: record.failure_count,
      error: record.error
    }
  end

  defp stamp(%Snapshot{} = snapshot, account_id, state, stale_reason, next_refresh_at, error) do
    %Snapshot{
      snapshot
      | account_id: account_id,
        fetched_at: System.system_time(:second),
        state: state,
        stale_reason: stale_reason,
        next_refresh_at: next_refresh_at,
        error: error
    }
  end

  defp mark_snapshot(nil, _state, _reason, _next_refresh_at, _error), do: nil

  defp mark_snapshot(%Snapshot{} = snapshot, state, reason, next_refresh_at, error) do
    %Snapshot{
      snapshot
      | state: state,
        stale_reason: reason,
        next_refresh_at: next_refresh_at,
        error: error
    }
  end

  defp empty_record do
    %{
      snapshot: nil,
      stored_at: nil,
      state: :stale,
      stale_reason: :missing,
      next_refresh_at: nil,
      generation: 0,
      failure_count: 0,
      error: nil
    }
  end

  defp write_record(agent_kind, account_id, record) do
    :persistent_term.put(
      @store_key,
      Map.put(read_store(), {agent_kind, account_id}, record)
    )

    :ok
  end

  defp error_class({:rate_limited, _retry_after_ms}), do: :rate_limited
  defp error_class(:authentication), do: :authentication
  defp error_class(:token_expired), do: :authentication
  defp error_class(:session_expired), do: :authentication
  defp error_class(:timeout), do: :timeout
  defp error_class({:http_error, :timeout}), do: :timeout
  defp error_class({:http_status, 429}), do: :rate_limited
  defp error_class(_reason), do: :provider_error

  defp usage_present?(snapshot) do
    snapshot.windows != [] or snapshot.plan != nil or
      snapshot.credits_remaining != nil or snapshot.credits_unlimited
  end

  defp sanitized_error({:http_error, reason}), do: {:http_error, reason}
  defp sanitized_error({:rate_limited, _retry_after_ms}), do: :rate_limited
  defp sanitized_error(reason) when is_atom(reason), do: reason
  defp sanitized_error(_reason), do: :provider_error

  defp read_store, do: :persistent_term.get(@store_key, %{})
  defp transaction(fun), do: :global.trans({__MODULE__, :store}, fun)
  defp ttl_ms, do: Application.get_env(:symphony_elixir, :agent_usage_ttl_ms, @default_ttl_ms)
end
