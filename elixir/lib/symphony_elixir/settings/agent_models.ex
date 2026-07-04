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
    "codex" => ["gpt-5-codex", "gpt-5"],
    "claude" => ["claude-sonnet-4-5", "claude-opus-4-1"],
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
