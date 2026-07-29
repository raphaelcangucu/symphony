defmodule SymphonyElixir.Settings.AgentModels do
  @moduledoc """
  Per-agent CLI model selection (group "agent_models").

  Each supported coding agent (codex/claude/cursor) may pin a specific model that
  the CLI should use. A `nil` value means "CLI default (no --model flag)". The
  curated `@catalog` bounds the accepted values so the Settings UI only offers
  models the operator can actually select, and invalid/stale values fall back to
  the CLI default.
  """

  @behaviour SymphonyElixir.Settings.Group

  alias SymphonyElixir.Settings

  @group "agent_models"
  @agents ~w(codex claude cursor)

  @catalog %{
    # Keep the current Codex family available while the machine-level catalog
    # is warming. The live catalog is still the source of truth for account-
    # specific options and reasoning efforts.
    "codex" => ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark"],
    "claude" => ["claude-fable-5", "claude-opus-4-8", "claude-sonnet-5"],
    "cursor" => ["auto"]
  }

  @impl true
  def group, do: @group

  @impl true
  def defaults, do: Map.new(@agents, fn agent -> {agent, nil} end)

  @impl true
  def cast(agent, value) when agent in @agents, do: cast_model(agent, value)
  def cast(_name, _value), do: :error

  @doc "The agent keys that support model selection."
  @spec agents() :: [String.t()]
  def agents, do: @agents

  @doc "Curated model options for an agent (empty list for unknown agents)."
  @spec options(String.t()) :: [String.t()]
  def options(agent), do: Map.get(@catalog, agent, [])

  @doc "The currently-selected model for an agent, or nil for the CLI default."
  @spec selected(String.t()) :: String.t() | nil
  def selected(agent) when agent in @agents, do: Settings.get(@group, agent)
  def selected(_agent), do: nil

  defp cast_model(_agent, nil), do: {:ok, nil}

  defp cast_model(agent, value) when is_binary(value) do
    case String.trim(value) do
      "" -> {:ok, nil}
      trimmed -> if trimmed in options(agent), do: {:ok, trimmed}, else: :error
    end
  end

  defp cast_model(_agent, _value), do: :error
end
