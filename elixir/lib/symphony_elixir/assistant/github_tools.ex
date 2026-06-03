defmodule SymphonyElixir.Assistant.GitHubTools do
  @moduledoc false

  alias SymphonyElixir.GitHub.{Discovery, ProjectProvisioner}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerPresenter

  @tools ~w(list_github_projects provision_github_project create_github_tracker_project)

  @spec tools() :: [String.t()]
  def tools, do: @tools

  @spec tool_specs() :: [map()]
  def tool_specs do
    [
      tool_spec(
        "list_github_projects",
        "List GitHub Project v2 boards visible to Symphony's GITHUB_TOKEN (server-side; do not use gh in the shell).",
        %{"type" => "object", "additionalProperties" => false, "properties" => %{}}
      ),
      tool_spec(
        "provision_github_project",
        "Create a GitHub Project v2 on the repo owner with a single-select status field and states (server-side GraphQL).",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["repo", "title", "states"],
          "properties" => %{
            "repo" => string_schema("GitHub repo owner/name, e.g. clouapp/distributionmachine."),
            "title" => string_schema("Project board title."),
            "states" => %{
              "type" => "array",
              "items" => %{"type" => "string"},
              "description" => "Workflow status option names to create on the board."
            },
            "status_field" => string_schema("Single-select field name (default Symphony State).")
          }
        }
      ),
      tool_spec(
        "create_github_tracker_project",
        "Provision (or link) a GitHub Project and create the matching local Symphony tracker project.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["name", "slug", "repo"],
          "properties" => %{
            "name" => string_schema("Local tracker project display name."),
            "slug" => string_schema("Local tracker project slug."),
            "repo" => string_schema("GitHub repo owner/name."),
            "description" => string_schema("Optional project description."),
            "project_title" => string_schema("GitHub Project title when provisioning (defaults to name)."),
            "project_id" => string_schema("Existing GitHub Project node id; skips remote creation when set."),
            "states" => %{
              "type" => "array",
              "items" => %{"type" => "string"},
              "description" => "Status names when provisioning a new GitHub Project."
            },
            "status_field" => string_schema("Status field name when provisioning (default Symphony State).")
          }
        }
      )
    ]
  end

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(tool, arguments, opts \\ [])

  def execute("list_github_projects", _arguments, opts) do
    case Discovery.list_projects(opts) do
      {:ok, projects} ->
        {:ok,
         %{
           tool: "list_github_projects",
           message: "Found #{length(projects)} GitHub project(s).",
           data: %{projects: projects}
         }}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def execute("provision_github_project", arguments, opts) do
    with {:ok, attrs} <- provision_attrs(arguments),
         {:ok, result} <- ProjectProvisioner.provision(attrs, opts) do
      {:ok,
       %{
         tool: "provision_github_project",
         message: "Created GitHub Project #{result.project_url}.",
         data: result
       }}
    end
  end

  def execute("create_github_tracker_project", arguments, opts) do
    with {:ok, name} <- required_string(arguments, "name"),
         {:ok, slug} <- required_string(arguments, "slug"),
         {:ok, repo} <- required_string(arguments, "repo"),
         {:ok, github} <- resolve_github_config(arguments, opts),
         {:ok, project} <- create_local_project(name, slug, repo, arguments, github) do
      statuses = Context.list_statuses(project.slug)
      repositories = Context.list_repositories(project.slug)

      {:ok,
       %{
         tool: "create_github_tracker_project",
         message: "Created local tracker #{slug} linked to GitHub Project #{github.project_id}.",
         data: %{
           project: TrackerPresenter.project(project, statuses, repositories),
           github: github,
           workflow_snippet: workflow_github_snippet(repo, github)
         }
       }}
    end
  end

  def execute(tool, _arguments, _opts), do: {:error, {:unsupported_tool, tool}}

  defp resolve_github_config(arguments, opts) do
    case normalize_optional_string(Map.get(arguments, "project_id")) do
      nil ->
        with {:ok, attrs} <- provision_attrs(arguments),
             {:ok, result} <- ProjectProvisioner.provision(attrs, opts) do
          {:ok, github_result_to_config(result, attrs)}
        end

      project_id ->
        status_field = normalize_optional_string(Map.get(arguments, "status_field")) || "Symphony State"

        {:ok,
         %{
           project_id: project_id,
           project_url: nil,
           status_field: status_field,
           state_options: %{}
         }}
    end
  end

  defp github_result_to_config(result, attrs) do
    %{
      project_id: result.project_id,
      project_url: result.project_url,
      project_number: result.project_number,
      status_field: result.status_field_name,
      state_options: result.state_options,
      repo: Map.fetch!(attrs, :repo)
    }
  end

  defp create_local_project(name, slug, repo, arguments, github) do
    [_owner, repo_name] = String.split(repo, "/", parts: 2)

    attrs = %{
      "name" => name,
      "slug" => slug,
      "description" => normalize_optional_string(Map.get(arguments, "description")),
      "tracker" => %{
        "kind" => "github",
        "config" => %{
          "repo" => repo,
          "project_id" => github.project_id,
          "status_field" => github.status_field
        }
      },
      "repositories" => [
        %{
          "github_full_name" => repo,
          "clone_url" => "https://github.com/#{repo}.git",
          "workspace_path" => repo_name,
          "role" => "primary"
        }
      ]
    }

    Context.create_workspace_project(attrs)
  end

  defp workflow_github_snippet(repo, github) do
    """
    github:
      repo: #{repo}
      project:
        mode: existing
        id: "#{github.project_id}"
    """
    |> String.trim()
  end

  defp provision_attrs(arguments) when is_map(arguments) do
    with {:ok, repo} <- required_string(arguments, "repo"),
         {:ok, title} <- project_title(arguments),
         {:ok, states} <- required_states(arguments) do
      attrs = %{repo: repo, title: title, states: states}

      case normalize_optional_string(Map.get(arguments, "status_field")) do
        nil -> {:ok, attrs}
        status_field -> {:ok, Map.put(attrs, :status_field, status_field)}
      end
    end
  end

  defp project_title(arguments) do
    case normalize_optional_string(Map.get(arguments, "project_title")) ||
           normalize_optional_string(Map.get(arguments, "title")) ||
           normalize_optional_string(Map.get(arguments, "name")) do
      nil -> {:error, {:missing_required_field, :title}}
      title -> {:ok, title}
    end
  end

  defp required_states(arguments) do
    case Map.get(arguments, "states") do
      states when is_list(states) and states != [] -> {:ok, states}
      _ -> {:error, {:missing_required_field, :states}}
    end
  end

  defp required_string(arguments, field) do
    case normalize_optional_string(Map.get(arguments, field)) do
      nil -> {:error, {:missing_required_field, field}}
      value -> {:ok, value}
    end
  end

  defp tool_spec(name, description, input_schema) do
    %{"name" => name, "description" => description, "inputSchema" => input_schema}
  end

  defp string_schema(description), do: %{"type" => ["string", "null"], "description" => description}

  defp normalize_optional_string(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_optional_string(_value), do: nil
end
