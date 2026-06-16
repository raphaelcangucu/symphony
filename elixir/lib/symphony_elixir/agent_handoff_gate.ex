defmodule SymphonyElixir.AgentHandoffGate do
  @moduledoc """
  Guards agent-initiated moves to handoff statuses (wait states and
  completion-transition destinations). Validate and publish gates must pass
  before an issue may enter review.
  """

  alias SymphonyElixir.Evidence.Gate
  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixir.RunContract
  alias SymphonyElixir.Workspace

  @type violation :: map()

  @spec handoff_status?(String.t(), ProjectConfig.t()) :: boolean()
  def handoff_status?(status, %ProjectConfig{} = config) when is_binary(status) do
    norm = normalize(status)
    wait?(norm, config) or destination?(norm, config)
  end

  def handoff_status?(_status, _config), do: false

  @spec check(map(), ProjectConfig.t(), keyword()) ::
          :ok | {:error, :validate_gate, [violation()]} | {:error, :publish_gate, [violation()]}
  def check(issue, %ProjectConfig{} = config, opts \\ []) do
    workspace = Keyword.get(opts, :workspace, Workspace.path_for_issue(issue))

    with :ok <- check_validate(workspace, config),
         :ok <- check_publish(workspace) do
      :ok
    end
  end

  defp check_validate(workspace, config) do
    case Gate.evaluate(workspace, evidence_config(config)) do
      :satisfied -> :ok
      {:violations, violations} -> {:error, :validate_gate, violations}
    end
  end

  defp check_publish(workspace) do
    states = RunContract.repo_states(workspace)

    case RunContract.evaluate_publish(states, RunContract.gh_pr_checker()) do
      :satisfied -> :ok
      {:violations, violations} -> {:error, :publish_gate, violations}
    end
  end

  defp evidence_config(%ProjectConfig{evidence: evidence}) when is_map(evidence), do: evidence
  defp evidence_config(_config), do: %{required: false, repos: %{}}

  defp wait?(norm, config) do
    config.wait_states
    |> List.wrap()
    |> Enum.any?(&(normalize(&1) == norm))
  end

  defp destination?(norm, config) do
    config.completion_transitions
    |> Map.values()
    |> Enum.any?(&(normalize(&1) == norm))
  end

  defp normalize(state) when is_binary(state) do
    state |> String.trim() |> String.downcase()
  end
end
