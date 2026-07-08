defmodule SymphonyElixir.AgentUsage do
  @moduledoc """
  Process-global, TTL'd store of the latest plan-usage `Snapshot` per agent
  kind. Mirrors `SymphonyElixir.AgentAvailability`'s `:persistent_term` cache
  pattern. Usage is intentionally ephemeral (no DB): the latest snapshot per
  agent survives across runs/idle so the Settings panel can show "plan X% used"
  even when nothing is currently running, but it expires once it grows stale.

  Snapshots are written passively from the observability capture path
  (see `SymphonyElixir.Observability.Registry`).
  """

  alias SymphonyElixir.AgentUsage.Snapshot

  @store_key {__MODULE__, :store}
  @default_ttl_ms 600_000
  @known_agents ["codex", "claude", "cursor", "opencode"]

  @type entry :: %{snapshot: Snapshot.t() | nil, stale: boolean()}

  @spec put(String.t(), Snapshot.t()) :: :ok
  def put(agent_kind, %Snapshot{} = snapshot) when is_binary(agent_kind) do
    stamped = %Snapshot{snapshot | fetched_at: System.system_time(:second)}
    record = {stamped, System.monotonic_time(:millisecond)}
    :persistent_term.put(@store_key, Map.put(read_store(), agent_kind, record))
    :ok
  end

  @spec get(String.t()) :: Snapshot.t() | nil
  def get(agent_kind) when is_binary(agent_kind) do
    case Map.get(read_store(), agent_kind) do
      {%Snapshot{} = snapshot, _stored_at} -> snapshot
      _ -> nil
    end
  end

  @spec stale?(String.t(), integer()) :: boolean()
  def stale?(agent_kind, now_ms \\ System.monotonic_time(:millisecond)) when is_binary(agent_kind) do
    case Map.get(read_store(), agent_kind) do
      {_snapshot, stored_at} -> now_ms - stored_at >= ttl_ms()
      _ -> true
    end
  end

  @spec snapshot(integer()) :: %{atom() => entry()}
  def snapshot(now_ms \\ System.monotonic_time(:millisecond)) do
    Map.new(@known_agents, fn agent ->
      {String.to_atom(agent), %{snapshot: get(agent), stale: stale?(agent, now_ms)}}
    end)
  end

  @spec known_agents() :: [String.t()]
  def known_agents, do: @known_agents

  @spec reset() :: :ok
  def reset do
    :persistent_term.erase(@store_key)
    :ok
  end

  defp read_store, do: :persistent_term.get(@store_key, %{})

  defp ttl_ms, do: Application.get_env(:symphony_elixir, :agent_usage_ttl_ms, @default_ttl_ms)
end
