defmodule SymphonyElixir.Assistant.ProjectBoardTools do
  @moduledoc false

  alias SymphonyElixir.Assistant.{ToolExecutor, ToolSchema}

  @scoped_tools ~w(
    list_issues
    create_issue
    create_draft_issue
    get_issue
    update_issue
    move_issue
    add_comment
    get_project
    list_project_repositories
    get_workflow
    read_workspace_file
    list_pull_requests
    manage_preview
    check_handoff_gate
    get_evidence_status
    manage_dev_env
    scan_project_setup
    suggest_project_setup
    update_project_workflow
    update_project_repositories
    dispatch_codex
    get_agent_executions
    link_pull_request
    get_issue_orchestrator_state
    explain_dispatch_eligibility
    manage_blockers
    sync_issue
    list_running_agents
    steer_agent
    manage_codex_goal
    classify_execution_unit
    create_subtask
    set_issue_parent
    get_execution_bundle
    preview_execution_plan
    define_shared_contract
    update_shared_contract
  )

  @tools @scoped_tools ++ ~w(create_tracker_project)

  @spec tools() :: [String.t()]
  def tools, do: @tools

  @spec tool_specs() :: [map()]
  def tool_specs do
    scoped_specs =
      ToolExecutor.tool_specs()
      |> Enum.filter(&(Map.get(&1, "name") in @scoped_tools))
      |> Enum.map(&ToolSchema.with_project_slug/1)

    scoped_specs ++ [create_tracker_project_spec()]
  end

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(tool, arguments, opts \\ [])

  def execute("create_tracker_project", arguments, opts) do
    ToolExecutor.execute_create_tracker_project(arguments, opts)
  end

  def execute(tool, arguments, opts) when tool in @scoped_tools do
    with {:ok, project_slug} <- required_string(arguments, "project_slug"),
         arguments <- Map.drop(arguments, ["project_slug"]) do
      ToolExecutor.execute(project_slug, tool, arguments, opts)
    end
  end

  def execute(tool, _arguments, _opts), do: {:error, {:unsupported_tool, tool}}

  defp create_tracker_project_spec do
    %{
      "name" => "create_tracker_project",
      "description" => "Create a local-only Symphony tracker project (no GitHub/Linear/Jira link). Use after list_tracker_projects when setting up a new board.",
      "inputSchema" => %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["name", "slug"],
        "properties" => %{
          "name" => %{"type" => "string", "description" => "Display name."},
          "slug" => %{"type" => "string", "description" => "URL slug, e.g. meu-projeto."},
          "description" => %{"type" => ["string", "null"], "description" => "Optional description."}
        }
      }
    }
  end

  defp required_string(arguments, field) do
    case normalize_optional_string(Map.get(arguments, field)) do
      nil -> {:error, {:missing_required_field, field}}
      value -> {:ok, value}
    end
  end

  defp normalize_optional_string(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_optional_string(_value), do: nil
end
