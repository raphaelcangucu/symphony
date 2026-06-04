defmodule SymphonyElixir.Assistant.DiscoveryTools do
  @moduledoc false

  alias SymphonyElixir.Jira.Discovery, as: JiraDiscovery
  alias SymphonyElixir.Linear.Discovery, as: LinearDiscovery
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerPresenter

  @tools ~w(list_tracker_projects list_linear_projects list_jira_projects)

  @spec tools() :: [String.t()]
  def tools, do: @tools

  @spec tool_specs() :: [map()]
  def tool_specs do
    [
      tool_spec(
        "list_tracker_projects",
        "List Symphony local tracker projects (server-side). Prefer this before remote GitHub/Linear/Jira discovery when the user asks about existing projects here.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "properties" => %{
            "include_archived" => %{
              "type" => "boolean",
              "description" => "When true, include archived local projects (default false)."
            }
          }
        }
      ),
      tool_spec(
        "list_linear_projects",
        "List Linear projects visible to Symphony's configured Linear auth (server-side GraphQL).",
        %{"type" => "object", "additionalProperties" => false, "properties" => %{}}
      ),
      tool_spec(
        "list_jira_projects",
        "List Jira Cloud projects visible to Symphony's configured Jira credentials (server-side REST).",
        %{"type" => "object", "additionalProperties" => false, "properties" => %{}}
      )
    ]
  end

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(tool, arguments, opts \\ [])

  def execute("list_tracker_projects", arguments, _opts) do
    include_archived? = truthy?(Map.get(arguments, "include_archived"))
    projects = Context.list_projects(include_archived: include_archived?)
    counts = Context.count_issues_by_project_ids(Enum.map(projects, & &1.id))

    presented =
      Enum.map(projects, fn project ->
        project
        |> TrackerPresenter.project()
        |> Map.put(:issue_count, Map.get(counts, project.id, 0))
      end)

    {:ok,
     %{
       tool: "list_tracker_projects",
       message: "Found #{length(presented)} local tracker project(s).",
       data: %{projects: presented}
     }}
  end

  def execute("list_linear_projects", _arguments, opts) do
    case LinearDiscovery.list_projects(opts) do
      {:ok, projects} ->
        {:ok,
         %{
           tool: "list_linear_projects",
           message: "Found #{length(projects)} Linear project(s).",
           data: %{projects: projects}
         }}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def execute("list_jira_projects", _arguments, opts) do
    case JiraDiscovery.list_projects(opts) do
      {:ok, projects} ->
        {:ok,
         %{
           tool: "list_jira_projects",
           message: "Found #{length(projects)} Jira project(s).",
           data: %{projects: projects}
         }}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def execute(tool, _arguments, _opts), do: {:error, {:unsupported_tool, tool}}

  defp truthy?(value) when value in [true, "true", "1", 1], do: true
  defp truthy?(_), do: false

  defp tool_spec(name, description, input_schema) do
    %{"name" => name, "description" => description, "inputSchema" => input_schema}
  end
end
