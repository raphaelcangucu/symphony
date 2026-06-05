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

  # Single source of truth for kind names is Settings.Agents.agent_kinds/0;
  # duplicated here as a compile-time list so it can be used in guards.
  # Keep in sync (also: AgentRouting labels, GitHub.IssueAdapter@agent_kinds).
  @valid_kinds ["codex", "claude"]

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
