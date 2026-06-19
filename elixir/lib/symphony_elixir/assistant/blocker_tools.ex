defmodule SymphonyElixir.Assistant.BlockerTools do
  @moduledoc false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerPresenter

  @tool "manage_blockers"
  @type_default "blocked_by"

  @description """
  List, create, or delete "blocked_by" relations on an issue.
  action "list" needs identifier; "create"/"delete" also need target (the blocking issue).
  """

  @spec assistant_tool_spec() :: map()
  def assistant_tool_spec do
    %{
      "name" => @tool,
      "description" => String.trim(@description),
      "inputSchema" => %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["action", "identifier"],
        "properties" => %{
          "action" => %{
            "type" => "string",
            "enum" => ["list", "create", "delete"],
            "description" => "Operation to perform."
          },
          "identifier" => %{
            "type" => "string",
            "description" => "Issue identifier that is (or would be) blocked."
          },
          "target" => %{
            "type" => "string",
            "description" => "Blocking issue identifier (required for create/delete)."
          }
        }
      }
    }
  end

  @spec tool_specs() :: [map()]
  def tool_specs, do: [assistant_tool_spec()]

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, arguments, opts \\ [])

  def execute(project_slug, arguments, _opts) when is_binary(project_slug) and is_map(arguments) do
    with {:ok, identifier} <- required(arguments, "identifier", :missing_identifier),
         {:ok, action} <- normalize_action(Map.get(arguments, "action")) do
      run(action, project_slug, identifier, arguments)
    end
  end

  defp run(:list, project_slug, identifier, _arguments) do
    with {:ok, relations} <- Context.list_blockers(project_slug, identifier) do
      blockers = Enum.map(relations, &TrackerPresenter.blocker/1)

      {:ok,
       %{
         tool: @tool,
         message: "#{identifier} has #{length(blockers)} blocker(s).",
         data: %{blockers: blockers}
       }}
    end
  end

  defp run(:create, project_slug, identifier, arguments) do
    with {:ok, target} <- required(arguments, "target", :missing_target),
         {:ok, relation} <- Context.add_blocker(project_slug, identifier, target, @type_default) do
      {:ok,
       %{
         tool: @tool,
         message: "#{identifier} is now blocked by #{target}.",
         data: %{blocker: TrackerPresenter.blocker(relation)}
       }}
    end
  end

  defp run(:delete, project_slug, identifier, arguments) do
    with {:ok, target} <- required(arguments, "target", :missing_target),
         {:ok, relation} <- Context.delete_blocker(project_slug, identifier, target, @type_default) do
      {:ok,
       %{
         tool: @tool,
         message: "Removed blocker #{target} from #{identifier}.",
         data: %{blocker: TrackerPresenter.blocker(relation)}
       }}
    end
  end

  defp normalize_action(action) when action in ["list", "create", "delete"],
    do: {:ok, String.to_existing_atom(action)}

  defp normalize_action(action) when is_binary(action), do: {:error, {:invalid_action, action}}
  defp normalize_action(_action), do: {:error, {:invalid_action, nil}}

  defp required(arguments, key, error) do
    case Map.get(arguments, key) do
      value when is_binary(value) ->
        case String.trim(value) do
          "" -> {:error, error}
          trimmed -> {:ok, trimmed}
        end

      _ ->
        {:error, error}
    end
  end
end
