defmodule SymphonyElixir.Assistant.SyncTools do
  @moduledoc false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixir.Tracker.Sync.Engine
  alias SymphonyElixirWeb.TrackerPresenter

  @tool "sync_issue"

  @description """
  Force-pull a single issue from its remote tracker (GitHub/Linear/Jira) and return the refreshed local copy.
  Use after the issue was edited outside Symphony. Returns an error for local-only projects.
  """

  @spec assistant_tool_spec() :: map()
  def assistant_tool_spec do
    %{
      "name" => @tool,
      "description" => String.trim(@description),
      "inputSchema" => %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["identifier"],
        "properties" => %{
          "identifier" => %{"type" => "string", "description" => "Issue identifier, for example MAC-1."}
        }
      }
    }
  end

  @spec tool_specs() :: [map()]
  def tool_specs, do: [assistant_tool_spec()]

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, arguments, opts \\ [])

  def execute(project_slug, arguments, opts) when is_binary(project_slug) and is_map(arguments) do
    sync_fun = Keyword.get(opts, :sync_issue, &Engine.sync_issue/2)

    with {:ok, identifier} <- required_identifier(arguments),
         {:ok, project} <- Context.get_project(project_slug),
         {:ok, _record} <- sync_fun.(project, identifier),
         {:ok, issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]) do
      {:ok,
       %{
         tool: @tool,
         message: "Synced #{identifier} from its remote tracker.",
         data: %{issue: TrackerPresenter.issue(issue)}
       }}
    end
  end

  defp required_identifier(arguments) do
    case Map.get(arguments, "identifier") do
      value when is_binary(value) ->
        case String.trim(value) do
          "" -> {:error, :missing_identifier}
          trimmed -> {:ok, trimmed}
        end

      _ ->
        {:error, :missing_identifier}
    end
  end
end
