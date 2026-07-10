defmodule SymphonyElixir.Assistant.GoalTools do
  @moduledoc false

  alias SymphonyElixir.AgentGoal
  alias SymphonyElixir.LocalTracker.Context

  @tool "goal"
  @actions ~w(get set_objective pause resume clear set_budget)

  @description """
  Set, adjust, pause, resume, clear, or inspect a long-running agent goal.

  Codex uses the native thread goal API. Claude Code uses native /goal (completion
  condition) mirrored by Symphony. pause/resume/set_budget are Codex-only.

  Use context "authoring" for the issue assistant conversation goal (spec/plan/analysis work in the chat).
  Use context "execution" (default in project chat) for the orchestrator execution goal that dispatch/resume carries.

  Actions:
  - get: read current goal state
  - set_objective: define or replace the objective
  - pause / resume: toggle native goal status (Codex only)
  - clear: remove the goal
  - set_budget: set token_budget (Codex execution only); null for unlimited
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
         {:ok, context} <- resolve_context(arguments, opts),
         {:ok, data} <- AgentGoal.execute(project, identifier, action, context, arguments) do
      {:ok, success_payload(action, context, identifier, data)}
    end
  end

  defp success_payload(action, context, identifier, data) when is_map(data) do
    cleared? = Map.get(data, :cleared, false) == true

    message =
      case {action, cleared?} do
        {"clear", true} -> "Cleared #{context} goal for #{identifier}."
        {"get", _} -> "Read #{context} goal for #{identifier}."
        {other, _} -> "Applied #{other} to #{context} goal for #{identifier}."
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
      value when is_binary(value) -> normalize_context(value)
      _ -> {:error, :invalid_context}
    end
  end

  defp normalize_context(value) do
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
      "properties" => Map.delete(input_properties(), "identifier")
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
        "description" =>
          "authoring = chat goal; execution = orchestrator goal. Defaults to authoring in issue chat, execution elsewhere."
      },
      "objective" => %{
        "type" => ["string", "null"],
        "description" => "Required for set_objective."
      },
      "token_budget" => %{
        "type" => ["integer", "null"],
        "description" => "Required for set_budget (Codex execution only). Pass null to remove the cap."
      },
      "agent" => %{
        "type" => ["string", "null"],
        "description" => "Optional agent override: codex, claude, or cursor."
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
