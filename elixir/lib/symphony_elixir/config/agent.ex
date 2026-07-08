defmodule SymphonyElixir.Config.Agent do
  @moduledoc """
  Agent kind detection and validation derived from WORKFLOW.md: which agent
  sections are configured, the process-level default agent, per-project agent
  inference, and validation of each configured agent's own config module.
  `SymphonyElixir.Config` delegates here.
  """

  alias SymphonyElixir.Config.Workflow
  alias SymphonyElixir.InstanceConfig

  @agent_sections ["claude", "codex", "cursor", "opencode"]

  @spec agent_kind() :: String.t()
  def agent_kind, do: default_agent_kind()

  @spec configured_agent_kinds() :: [String.t()]
  def configured_agent_kinds do
    Workflow.detect_sections(@agent_sections)
  end

  @doc """
  Default agent when an issue only has the base `symphony` label.

  Prefers Codex when a (legacy) global WORKFLOW configures it, then the first
  configured agent. With global-less per-project orchestration there is usually
  no global agent section, so the process-level default falls back to the
  `:default_agent_kind` application setting and finally the `codex` code default.
  """
  @spec default_agent_kind() :: String.t()
  def default_agent_kind, do: InstanceConfig.default_agent_kind()

  @doc """
  Resolves the agent kind from a project's own front-matter map.

  Precedence: explicit `agent.kind` > exactly-one-section inference
  (`codex:`/`claude:`/`cursor:`) > nil (= inherit; resolved later by
  `SymphonyElixir.AgentPreference`).
  """
  @spec agent_kind_from_config(map() | term()) :: String.t() | nil
  def agent_kind_from_config(front_matter) when is_map(front_matter) do
    normalized = Workflow.normalize_keys(front_matter)

    explicit_agent_kind(normalized) ||
      case Enum.filter(@agent_sections, &Map.has_key?(normalized, &1)) do
        [single] -> single
        _ -> nil
      end
  end

  def agent_kind_from_config(_front_matter), do: nil

  @doc "Validates that at least one agent is configured and each kind's config."
  @spec validate_configured_agents!() :: :ok | {:error, String.t()}
  def validate_configured_agents! do
    case configured_agent_kinds() do
      [] ->
        {:error, "No agent configured — add a codex:, claude:, cursor:, or opencode: section to WORKFLOW.md"}

      kinds ->
        validate_agent_kinds(kinds)
    end
  end

  defp explicit_agent_kind(normalized) do
    case Map.get(normalized, "agent") do
      %{} = section -> SymphonyElixir.AgentPreference.normalize(Map.get(section, "kind"))
      _ -> nil
    end
  end

  defp validate_agent_kinds(kinds) do
    Enum.reduce_while(kinds, :ok, fn kind, :ok ->
      case validate_agent_kind!(kind) do
        :ok -> {:cont, :ok}
        {:error, _} = error -> {:halt, error}
      end
    end)
  end

  defp validate_agent_kind!("codex"), do: SymphonyElixir.Codex.Config.validate!()
  defp validate_agent_kind!("claude"), do: SymphonyElixir.Claude.Config.validate!()
  defp validate_agent_kind!("cursor"), do: SymphonyElixir.Cursor.Config.validate!()
  defp validate_agent_kind!("opencode"), do: SymphonyElixir.OpenCode.Config.validate!()
  defp validate_agent_kind!(other), do: {:error, "Unknown agent kind #{inspect(other)} in WORKFLOW.md"}
end
