defmodule SymphonyElixir.Assistant.HandoffTools do
  @moduledoc false

  alias SymphonyElixir.{AgentHandoffGate, Evidence.Gate, Issue, ProjectConfig, Workspace}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @tool "check_handoff_gate"

  @description """
  Check validate and publish gates before moving to a handoff status (Human Review, Done, etc.).
  Call this before set_issue_status when targeting wait_states or completion destinations.
  """

  @spec assistant_tool_spec() :: map()
  def assistant_tool_spec do
    tool_spec(@description, %{
      "type" => "object",
      "additionalProperties" => false,
      "required" => ["identifier"],
      "properties" => %{
        "identifier" => %{
          "type" => "string",
          "description" => "Issue identifier, for example MAC-1."
        }
      }
    })
  end

  @spec issue_bound_tool_spec() :: map()
  def issue_bound_tool_spec do
    tool_spec(@description, %{
      "type" => "object",
      "additionalProperties" => false,
      "required" => [],
      "properties" => %{}
    })
  end

  @spec tool_specs() :: [map()]
  def tool_specs, do: [assistant_tool_spec(), issue_bound_tool_spec()]

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, arguments, opts \\ [])

  def execute(project_slug, arguments, opts) when is_binary(project_slug) and is_map(arguments) do
    with {:ok, issue} <- resolve_issue(project_slug, arguments, opts),
         {:ok, config} <- load_config(project_slug, opts),
         workspace = workspace_for(issue, opts),
         validate = AgentHandoffGate.check_validate(issue, config, workspace: workspace),
         publish = AgentHandoffGate.check_publish(issue, config, workspace: workspace) do
      {:ok, present(issue.identifier, config, validate, publish)}
    end
  end

  defp present(identifier, config, validate, publish) do
    validate_violations = violations(validate)
    publish_violations = violations(publish)
    validate_ok = validate == :ok
    publish_ok = publish == :ok

    %{
      tool: @tool,
      message: gate_message(identifier, validate_ok and publish_ok),
      data: %{
        ready: validate_ok and publish_ok,
        target_statuses: target_statuses(config),
        validate_gate: gate_payload(validate_ok, validate_violations),
        publish_gate: gate_payload(publish_ok, publish_violations),
        environment_blocked_only: Gate.environment_blocked_only?(validate_violations)
      }
    }
  end

  defp gate_message(identifier, true), do: "Handoff gates satisfied for #{identifier}."
  defp gate_message(identifier, false), do: "Handoff gates not satisfied for #{identifier}."

  defp gate_payload(true, _violations), do: %{satisfied: true, violations: []}

  defp gate_payload(false, violations) do
    %{satisfied: false, violations: Enum.map(violations, &present_violation/1)}
  end

  defp violations(:ok), do: []
  defp violations({:error, _gate, violations}) when is_list(violations), do: violations

  defp present_violation(%{kind: kind, repo: repo, detail: detail}) do
    %{
      "kind" => atom_to_string(kind),
      "repo" => repo,
      "detail" => detail
    }
  end

  defp present_violation(violation) when is_map(violation), do: violation

  defp atom_to_string(value) when is_atom(value), do: Atom.to_string(value)

  defp target_statuses(%ProjectConfig{} = config) do
    destinations =
      config.completion_transitions
      |> completion_destinations()
      |> Enum.uniq()

    %{
      wait_states: List.wrap(config.wait_states),
      completion_destinations: destinations
    }
  end

  # `completion_transitions` is an optional per-project override, so it stays
  # `nil` when unset (see `ProjectConfig`). Treat the missing/invalid case as "no
  # extra destinations" instead of letting `Map.values/1` crash the tool — and,
  # with it, the whole agent run.
  defp completion_destinations(transitions) when is_map(transitions), do: Map.values(transitions)
  defp completion_destinations(transitions) when is_list(transitions), do: transitions
  defp completion_destinations(_transitions), do: []

  @spec resolve_issue(String.t(), map(), keyword()) :: {:ok, Issue.t()} | {:error, term()}
  def resolve_issue(project_slug, arguments, opts) do
    case Keyword.get(opts, :issue) do
      %Issue{} = issue ->
        {:ok, issue}

      _ ->
        with {:ok, identifier} <- required_string(Map.get(arguments, "identifier")) do
          Context.get_issue(project_slug, identifier)
        end
    end
  end

  @spec load_config(String.t(), keyword()) :: {:ok, ProjectConfig.t()} | {:error, term()}
  def load_config(project_slug, opts) do
    case Keyword.get(opts, :project_config) do
      %ProjectConfig{} = config ->
        {:ok, config}

      _ ->
        with {:ok, project} <- Context.get_project(project_slug) do
          {:ok, project |> Repo.preload(:setup) |> ProjectConfig.resolve()}
        end
    end
  end

  @spec workspace_for(Issue.t(), keyword()) :: String.t()
  def workspace_for(issue, opts) do
    Keyword.get_lazy(opts, :workspace, fn -> Workspace.path_for_issue(issue) end)
  end

  defp required_string(value) when is_binary(value) do
    case String.trim(value) do
      "" -> {:error, :missing_identifier}
      trimmed -> {:ok, trimmed}
    end
  end

  defp required_string(_), do: {:error, :missing_identifier}

  defp tool_spec(description, input_schema) do
    %{"name" => @tool, "description" => String.trim(description), "inputSchema" => input_schema}
  end
end
