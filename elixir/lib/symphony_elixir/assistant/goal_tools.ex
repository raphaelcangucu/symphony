defmodule SymphonyElixir.Assistant.GoalTools do
  @moduledoc false

  alias SymphonyElixir.Assistant.{AuthoringGoalControl, History}
  alias SymphonyElixir.Codex.GoalControl
  alias SymphonyElixir.LocalTracker.{Context, Project}
  alias SymphonyElixir.Workspace

  @tool "manage_codex_goal"
  @actions ~w(get set_objective pause resume clear set_budget)

  @description """
  Set, adjust, pause, resume, clear, or inspect a Codex native goal.

  Use context "authoring" for the issue assistant conversation goal (spec/plan/analysis work in the chat).
  Use context "execution" (default in project chat) for the orchestrator execution goal that dispatch/resume carries.

  Actions:
  - get: read current goal state
  - set_objective: define or replace the objective (creates the native thread when needed)
  - pause / resume: toggle native goal status without removing the objective
  - clear: remove the goal (always clears local artifacts; native clear when goal mode is enabled)
  - set_budget: set token_budget to a positive integer, or null for unlimited
  """

  @spec assistant_tool_spec() :: map()
  def assistant_tool_spec do
    tool_spec(@description, assistant_input_schema())
  end

  @spec issue_bound_tool_spec() :: map()
  def issue_bound_tool_spec do
    tool_spec(
      @description <> " In this issue chat the identifier is fixed; default context is authoring.",
      issue_bound_input_schema()
    )
  end

  @spec tool_specs() :: [map()]
  def tool_specs, do: [assistant_tool_spec(), issue_bound_tool_spec()]

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, arguments, opts \\ [])

  def execute(project_slug, arguments, opts) when is_binary(project_slug) and is_map(arguments) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, identifier} <- resolve_identifier(arguments, opts),
         {:ok, action} <- required_action(arguments),
         {:ok, context} <- resolve_context(arguments, opts) do
      run_action(project, identifier, action, context, arguments)
    end
  end

  defp run_action(%Project{} = project, identifier, "get", context, _arguments) do
    case read_goal(project, identifier, context) do
      {:ok, payload} ->
        {:ok, success_payload("get", context, identifier, payload)}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp run_action(%Project{} = project, identifier, "clear", context, _arguments) do
    case clear_goal(project, identifier, context) do
      {:ok, payload} -> {:ok, success_payload("clear", context, identifier, payload, cleared: true)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp run_action(%Project{} = project, identifier, "set_objective", context, arguments) do
    with {:ok, objective} <- required_string(Map.get(arguments, "objective"), :empty_objective),
         {:ok, payload} <- set_objective(project, identifier, context, objective) do
      {:ok, success_payload("set_objective", context, identifier, payload)}
    end
  end

  defp run_action(%Project{} = project, identifier, "pause", context, _arguments) do
    with {:ok, payload} <- pause_goal(project, identifier, context) do
      {:ok, success_payload("pause", context, identifier, payload)}
    end
  end

  defp run_action(%Project{} = project, identifier, "resume", context, _arguments) do
    with {:ok, payload} <- resume_goal(project, identifier, context) do
      {:ok, success_payload("resume", context, identifier, payload)}
    end
  end

  defp run_action(%Project{} = project, identifier, "set_budget", context, arguments) do
    with {:ok, budget} <- parse_token_budget(Map.get(arguments, "token_budget")),
         {:ok, payload} <- set_budget(project, identifier, context, budget) do
      {:ok, success_payload("set_budget", context, identifier, payload)}
    end
  end

  defp run_action(_project, _identifier, action, _context, _arguments),
    do: {:error, {:invalid_action, action}}

  defp read_goal(%Project{} = project, identifier, "authoring") do
    with {:ok, thread} <- ensure_authoring_thread(project, identifier) do
      case AuthoringGoalControl.status(thread) do
        {:ok, payload, _thread} -> {:ok, serialize_authoring_payload(payload)}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp read_goal(%Project{} = project, identifier, "execution") do
    case GoalControl.get(project, identifier) do
      {:ok, nil} -> {:ok, %{goal: nil}}
      {:ok, goal} -> {:ok, %{goal: goal}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp set_objective(%Project{} = project, identifier, "authoring", objective) do
    with {:ok, thread} <- ensure_authoring_thread(project, identifier) do
      case AuthoringGoalControl.set_objective(thread, objective) do
        {:ok, payload, _thread} -> {:ok, serialize_authoring_payload(payload)}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp set_objective(%Project{} = project, identifier, "execution", objective) do
    case GoalControl.set_objective(project, identifier, objective) do
      {:ok, goal} -> {:ok, %{goal: goal}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp pause_goal(%Project{} = project, identifier, "authoring") do
    with {:ok, thread} <- ensure_authoring_thread(project, identifier) do
      case AuthoringGoalControl.pause(thread) do
        {:ok, payload, _thread} -> {:ok, serialize_authoring_payload(payload)}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp pause_goal(%Project{} = project, identifier, "execution") do
    case GoalControl.pause(project, identifier) do
      {:ok, goal} -> {:ok, %{goal: goal}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp resume_goal(%Project{} = project, identifier, "authoring") do
    with {:ok, thread} <- ensure_authoring_thread(project, identifier) do
      case AuthoringGoalControl.resume(thread) do
        {:ok, payload, _thread} -> {:ok, serialize_authoring_payload(payload)}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp resume_goal(%Project{} = project, identifier, "execution") do
    case GoalControl.resume(project, identifier) do
      {:ok, goal} -> {:ok, %{goal: goal}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp clear_goal(%Project{} = project, identifier, "authoring") do
    with {:ok, thread} <- ensure_authoring_thread(project, identifier) do
      case AuthoringGoalControl.clear(thread) do
        {:ok, payload, _thread} -> {:ok, serialize_authoring_payload(payload)}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp clear_goal(%Project{} = project, identifier, "execution") do
    case GoalControl.clear(project, identifier) do
      {:ok, :cleared} -> {:ok, %{goal: nil, cleared: true}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp set_budget(%Project{} = _project, _identifier, "authoring", _budget) do
    {:error, "token_budget is only supported for execution goals (context: execution)."}
  end

  defp set_budget(%Project{} = project, identifier, "execution", budget) do
    case GoalControl.set_budget(project, identifier, budget) do
      {:ok, goal} -> {:ok, %{goal: goal}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp ensure_authoring_thread(%Project{} = project, identifier) do
    issue_ref = %{id: nil, identifier: identifier, project_slug: project.slug}

    History.ensure_issue_thread(project.slug, identifier, %{
      workspace_path: Workspace.path_for_issue(issue_ref)
    })
  end

  defp serialize_authoring_payload(payload) when is_map(payload) do
    %{
      enabled: Map.get(payload, :enabled),
      objective: Map.get(payload, :objective),
      native: Map.get(payload, :native),
      goal: Map.get(payload, :goal)
    }
  end

  defp success_payload(action, context, identifier, data, extra \\ []) do
    cleared? = Keyword.get(extra, :cleared, false)

    message =
      case {action, cleared?} do
        {"clear", true} -> "Cleared #{context} Codex goal for #{identifier}."
        {"get", _} -> "Read #{context} Codex goal for #{identifier}."
        {other, _} -> "Applied #{other} to #{context} Codex goal for #{identifier}."
      end

    %{
      tool: @tool,
      message: message,
      data:
        Map.merge(
          %{
            action: action,
            context: context,
            identifier: identifier
          },
          data
        )
    }
  end

  defp resolve_identifier(arguments, opts) do
    case identifier_from_opts(opts) do
      {:ok, identifier} -> {:ok, identifier}
      :error -> required_string(Map.get(arguments, "identifier"), :missing_identifier)
    end
  end

  defp identifier_from_opts(opts) do
    case Keyword.get(opts, :bound_issue_identifier) do
      identifier when is_binary(identifier) and identifier != "" ->
        {:ok, identifier}

      _ ->
        case Keyword.get(opts, :issue) do
          %{identifier: identifier} when is_binary(identifier) and identifier != "" -> {:ok, identifier}
          _ -> :error
        end
    end
  end

  defp resolve_context(arguments, opts) do
    default =
      case Keyword.get(opts, :bound_issue_identifier) do
        id when is_binary(id) and id != "" -> "authoring"
        _ -> "execution"
      end

    case Map.get(arguments, "context") do
      nil -> {:ok, default}
      value when is_binary(value) -> normalize_context(value, default)
      _ -> {:error, :invalid_context}
    end
  end

  defp normalize_context(value, _default) do
    case String.trim(String.downcase(value)) do
      "authoring" -> {:ok, "authoring"}
      "execution" -> {:ok, "execution"}
      _ -> {:error, :invalid_context}
    end
  end

  defp required_action(arguments) do
    case Map.get(arguments, "action") do
      action when action in @actions -> {:ok, action}
      action when is_binary(action) -> {:error, {:invalid_action, action}}
      _ -> {:error, :missing_action}
    end
  end

  defp parse_token_budget(nil), do: {:ok, nil}

  defp parse_token_budget(value) when is_integer(value) and value > 0, do: {:ok, value}

  defp parse_token_budget(value) when is_binary(value) do
    case Integer.parse(String.trim(value)) do
      {parsed, ""} when parsed > 0 -> {:ok, parsed}
      _ -> {:error, :invalid_budget}
    end
  end

  defp parse_token_budget(_value), do: {:error, :invalid_budget}

  defp required_string(value, error) do
    case value do
      text when is_binary(text) ->
        case String.trim(text) do
          "" -> {:error, error}
          trimmed -> {:ok, trimmed}
        end

      _ ->
        {:error, error}
    end
  end

  defp assistant_input_schema do
    %{
      "type" => "object",
      "additionalProperties" => false,
      "required" => ["identifier", "action"],
      "properties" => input_properties()
    }
  end

  defp issue_bound_input_schema do
    %{
      "type" => "object",
      "additionalProperties" => false,
      "required" => ["action"],
      "properties" =>
        input_properties()
        |> Map.delete("identifier")
    }
  end

  defp input_properties do
    %{
      "identifier" => %{
        "type" => "string",
        "description" => "Issue identifier, for example DIS-6."
      },
      "action" => %{
        "type" => "string",
        "enum" => @actions,
        "description" => "Goal control action."
      },
      "context" => %{
        "type" => ["string", "null"],
        "enum" => ["authoring", "execution", nil],
        "description" => "authoring = chat goal; execution = orchestrator goal. Defaults to authoring in issue chat, execution elsewhere."
      },
      "objective" => %{
        "type" => ["string", "null"],
        "description" => "Required for set_objective."
      },
      "token_budget" => %{
        "type" => ["integer", "null"],
        "description" => "Required for set_budget (execution only). Pass null to remove the cap."
      }
    }
  end

  defp tool_spec(description, input_schema) do
    %{
      "name" => @tool,
      "description" => String.trim(description),
      "inputSchema" => input_schema
    }
  end
end
