defmodule SymphonyElixir.Settings.Agents do
  @moduledoc "Agent-related operator settings (group \"agents\")."

  @behaviour SymphonyElixir.Settings.Group

  alias SymphonyElixir.InstanceConfig

  @agent_kinds ["codex", "claude", "cursor", "opencode"]

  @impl true
  def group, do: "agents"

  @impl true
  def defaults, do: %{"default_agent_kind" => InstanceConfig.default_agent_kind()}

  @impl true
  def cast("default_agent_kind", value) when value in @agent_kinds, do: {:ok, value}
  def cast(_name, _value), do: :error

  @spec agent_kinds() :: [String.t()]
  def agent_kinds, do: @agent_kinds

  @spec default_agent_kind() :: String.t()
  def default_agent_kind do
    SymphonyElixir.Settings.get(group(), "default_agent_kind") || InstanceConfig.default_agent_kind()
  end
end
