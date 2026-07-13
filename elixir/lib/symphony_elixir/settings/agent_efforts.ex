defmodule SymphonyElixir.Settings.AgentEfforts do
  @moduledoc """
  Per-agent default reasoning effort (group "agent_efforts").

  Each supported coding agent may pin a default effort used when an issue does
  not set one. A `nil` value means "CLI default (no effort flag)". The curated
  `@efforts` allowlist bounds accepted values so the Settings UI only offers
  efforts the operator can select, and invalid/stale values fall back to the
  CLI default.
  """

  @behaviour SymphonyElixir.Settings.Group

  alias SymphonyElixir.Settings

  @group "agent_efforts"
  @agents ~w(codex claude cursor opencode)
  @efforts ~w(low medium high xhigh max)

  @impl true
  def group, do: @group

  @impl true
  def defaults, do: Map.new(@agents, fn agent -> {agent, nil} end)

  @impl true
  def cast(agent, value) when agent in @agents, do: cast_effort(value)
  def cast(_name, _value), do: :error

  @doc "The agent keys that support effort selection."
  @spec agents() :: [String.t()]
  def agents, do: @agents

  @doc "Curated effort options for an agent (empty list for unknown agents)."
  @spec options(String.t()) :: [String.t()]
  def options(agent) when agent in @agents, do: @efforts
  def options(_agent), do: []

  @doc "The currently-selected effort for an agent, or nil for the CLI default."
  @spec selected(String.t()) :: String.t() | nil
  def selected(agent) when agent in @agents, do: Settings.get(@group, agent)
  def selected(_agent), do: nil

  defp cast_effort(nil), do: {:ok, nil}

  defp cast_effort(value) when is_binary(value) do
    case String.trim(value) do
      "" -> {:ok, nil}
      trimmed -> if trimmed in @efforts, do: {:ok, trimmed}, else: :error
    end
  end

  defp cast_effort(_value), do: :error
end
