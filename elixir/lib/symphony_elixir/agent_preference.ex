defmodule SymphonyElixir.AgentPreference do
  @moduledoc """
  Resolves the effective coding agent with the chain
  task label > project explicit > user default > "codex".

  Task signal comes from `symphony:<kind>` labels; project signal from
  `agent.kind` in the project's workflow_markdown front matter (nil =
  inherit); user signal from the spatie-style settings store.
  """

  alias SymphonyElixir.AgentRouting
  alias SymphonyElixir.Settings

  @fallback "codex"
  @valid_kinds ["codex", "claude"]

  @spec valid_kinds() :: [String.t()]
  def valid_kinds, do: @valid_kinds

  @spec resolve([String.t()], String.t() | nil) :: String.t()
  def resolve(label_names, project_agent_kind) do
    resolve(label_names, project_agent_kind, Settings.Agents.default_agent_kind())
  end

  @spec resolve([String.t()], String.t() | nil, String.t() | nil) :: String.t()
  def resolve(label_names, project_agent_kind, user_default) when is_list(label_names) do
    AgentRouting.label_agent_kind(label_names) ||
      normalize(project_agent_kind) ||
      normalize(user_default) ||
      @fallback
  end

  @spec normalize(term()) :: String.t() | nil
  def normalize(kind) when kind in @valid_kinds, do: kind
  def normalize(_kind), do: nil
end
