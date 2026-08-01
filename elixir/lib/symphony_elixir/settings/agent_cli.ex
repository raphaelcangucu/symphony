defmodule SymphonyElixir.Settings.AgentCli do
  @moduledoc """
  Per-provider lifecycle preferences.

  Managed installations are the default. Automatic update checks are enabled,
  while cross-account failover remains an explicit opt-in.
  """

  @behaviour SymphonyElixir.Settings.Group

  alias SymphonyElixir.Settings

  @group "agent_cli"
  @agents ~w(codex claude cursor opencode)
  @default %{
    "preferred_source" => "managed",
    "auto_update" => true,
    "failover_enabled" => false
  }
  @keys Map.keys(@default) |> MapSet.new()

  @impl true
  def group, do: @group

  @impl true
  def defaults, do: Map.new(@agents, &{&1, @default})

  @impl true
  def cast(agent, value) when agent in @agents and is_map(value) do
    normalized = stringify_keys(value)

    with true <- MapSet.equal?(MapSet.new(Map.keys(normalized)), @keys),
         source when source in ["managed", "path"] <- normalized["preferred_source"],
         auto_update when is_boolean(auto_update) <- normalized["auto_update"],
         failover when is_boolean(failover) <- normalized["failover_enabled"] do
      {:ok,
       %{
         "preferred_source" => source,
         "auto_update" => auto_update,
         "failover_enabled" => failover
       }}
    else
      _ -> :error
    end
  end

  def cast(_agent, _value), do: :error

  @spec for(String.t()) :: map() | nil
  def for(agent) when agent in @agents, do: Settings.get(@group, agent)
  def for(_agent), do: nil

  defp stringify_keys(map) do
    Map.new(map, fn
      {key, value} when is_atom(key) -> {Atom.to_string(key), value}
      pair -> pair
    end)
  end
end
