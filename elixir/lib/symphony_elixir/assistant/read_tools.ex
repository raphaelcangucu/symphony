defmodule SymphonyElixir.Assistant.ReadTools do
  @moduledoc false

  alias SymphonyElixir.Assistant.ProjectExploreWorkspace
  alias SymphonyElixir.LocalTracker.{Context, Templates}
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixir.Workflow
  alias SymphonyElixir.Workspace
  alias SymphonyElixirWeb.{TemplatePresenter, TrackerPresenter}

  @tools ~w(get_issue get_project list_project_repositories get_template list_templates get_workflow read_workspace_file)
  @max_read_bytes 65_536
  @default_list_limit 20
  @max_list_limit 100

  @spec tools() :: [String.t()]
  def tools, do: @tools

  @spec tool_specs() :: [map()]
  def tool_specs do
    [
      tool_spec(
        "get_issue",
        "Fetch one tracker issue by identifier. Prefer this over list_issues when you know the id.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["identifier"],
          "properties" => %{
            "identifier" => string_schema("Issue identifier, for example MAC-1."),
            "include_comments" => %{
              "type" => "boolean",
              "description" => "When true, include issue comments in the response."
            }
          }
        }
      ),
      tool_spec(
        "get_project",
        "Fetch project metadata: board status names and categories (unstarted/started/completed), repositories, and setup summary. Status categories are UI metadata — they do NOT define orchestrator dispatch. For dispatch_states, active_states, and terminal_states use get_workflow.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "properties" => %{}
        }
      ),
      tool_spec(
        "list_project_repositories",
        "List repositories linked to this project in Symphony (persisted metadata). Compare with get_workflow when workflow front matter declares more repos than settings show.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "properties" => %{}
        }
      ),
      tool_spec(
        "get_template",
        "Fetch one workspace template by slug. Call list_templates first when unsure of slugs (e.g. multi-repo-fullstack, not multi-repo).",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["slug"],
          "properties" => %{
            "slug" => string_schema("Template slug."),
            "format" => %{
              "type" => ["string", "null"],
              "description" => "Response format: json (default) or yaml."
            }
          }
        }
      ),
      tool_spec(
        "list_templates",
        "List workspace templates stored in Symphony (slug, name, description). Use before get_template.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "properties" => %{}
        }
      ),
      tool_spec(
        "get_workflow",
        "Fetch workflow markdown from project settings (YAML front matter + body). Source of truth for orchestrator: tracker.dispatch_states (queue for NEW auto-runs), tracker.active_states (polled candidates), tracker.wait_states, tracker.terminal_states. Parsed config is in data.config. Body prose guides agents only; orchestrator reads YAML keys.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "properties" => %{}
        }
      ),
      tool_spec(
        "read_workspace_file",
        "Read a text file under the project explore workspace or an issue workspace (path relative to workspace root). For workflow markdown use get_workflow instead of WORKFLOW.md.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["path"],
          "properties" => %{
            "path" => string_schema("Relative path inside the workspace, e.g. front/README.md."),
            "issue_identifier" => string_schema("Optional issue id; reads from that issue workspace instead of project explore."),
            "start_line" => %{"type" => ["integer", "null"], "description" => "1-based start line (inclusive)."},
            "end_line" => %{"type" => ["integer", "null"], "description" => "1-based end line (inclusive)."}
          }
        }
      )
    ]
  end

  @spec execute(map(), String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project, tool, arguments, opts \\ [])

  def execute(project, "get_issue", arguments, _opts) do
    with {:ok, identifier} <- normalize_required_string(Map.get(arguments, "identifier"), :identifier),
         {:ok, issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]),
         {:ok, data} <- maybe_attach_comments(project, TrackerPresenter.issue(issue), arguments) do
      {:ok,
       %{
         tool: "get_issue",
         message: "Loaded issue #{data.identifier}.",
         data: data
       }}
    end
  end

  def execute(project, "get_project", _arguments, _opts) do
    slug = project_slug(project)

    with {:ok, _} <- Context.get_project(slug) do
      statuses = Context.list_statuses(slug)
      repositories = Context.list_repositories(slug)
      setup = Context.get_project_setup(slug)

      data =
        TrackerPresenter.project(project, statuses, repositories, setup)

      {:ok,
       %{
         tool: "get_project",
         message: "Loaded project #{slug}.",
         data: data
       }}
    end
  end

  def execute(project, "list_project_repositories", _arguments, _opts) do
    slug = project_slug(project)
    repositories = Context.list_repositories(slug) |> Enum.map(&TrackerPresenter.repository/1)

    {:ok,
     %{
       tool: "list_project_repositories",
       message: "Found #{length(repositories)} linked repositor#{if length(repositories) == 1, do: "y", else: "ies"} for #{slug}.",
       data: %{project_slug: slug, repositories: repositories}
     }}
  end

  def execute(_project, "list_templates", _arguments, _opts) do
    templates =
      Templates.list_templates()
      |> Enum.map(&TemplatePresenter.template/1)

    {:ok,
     %{
       tool: "list_templates",
       message: "Found #{length(templates)} workspace template(s).",
       data: %{templates: templates}
     }}
  end

  def execute(_project, "get_template", arguments, _opts) do
    with {:ok, slug} <- normalize_required_string(Map.get(arguments, "slug"), :slug),
         format <- normalize_format(Map.get(arguments, "format")) do
      case format do
        :yaml ->
          with {:ok, yaml} <- Templates.export_yaml(slug) do
            {:ok,
             %{
               tool: "get_template",
               message: "Loaded template #{slug} (yaml).",
               data: %{slug: slug, format: "yaml", yaml: yaml}
             }}
          end

        :json ->
          with {:ok, template} <- Templates.get_template(slug) do
            {:ok,
             %{
               tool: "get_template",
               message: "Loaded template #{slug}.",
               data: TemplatePresenter.template(template)
             }}
          end
      end
    end
  end

  def execute(project, "get_workflow", _arguments, _opts) do
    slug = project_slug(project)
    markdown = project_workflow_markdown(slug)

    case Workflow.parse_string(markdown) do
      {:ok, loaded} ->
        {:ok,
         %{
           tool: "get_workflow",
           message: "Loaded workflow for #{slug}.",
           data: workflow_payload(slug, markdown, loaded)
         }}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def execute(project, "read_workspace_file", arguments, opts) do
    with {:ok, relative} <- normalize_required_string(Map.get(arguments, "path"), :path) do
      if workflow_file_path?(relative) do
        read_workflow_as_file(project, relative, arguments)
      else
        read_workspace_file_contents(project, relative, arguments, opts)
      end
    end
  end

  def execute(_project, tool, _arguments, _opts), do: {:error, {:unsupported_tool, tool}}

  defp read_workspace_file_contents(project, relative, arguments, opts) do
    with {:ok, base} <- workspace_base(project, arguments, opts),
         {:ok, absolute} <- safe_path_under(base, relative),
         {:ok, content} <- read_file_limited(absolute),
         {:ok, slice} <- slice_lines(content, Map.get(arguments, "start_line"), Map.get(arguments, "end_line")) do
      {:ok,
       %{
         tool: "read_workspace_file",
         message: "Read #{relative}.",
         data: %{
           path: relative,
           workspace_root: base,
           content: slice.content,
           truncated: slice.truncated,
           total_lines: slice.total_lines,
           start_line: slice.start_line,
           end_line: slice.end_line
         }
       }}
    end
  end

  defp read_workflow_as_file(project, relative, arguments) do
    slug = project_slug(project)
    markdown = project_workflow_markdown(slug)

    with {:ok, slice} <- slice_lines(markdown, Map.get(arguments, "start_line"), Map.get(arguments, "end_line")) do
      {:ok,
       %{
         tool: "read_workspace_file",
         message: "Read #{relative} from project settings (workflow is not stored as a workspace file).",
         data: %{
           path: relative,
           source: "project_settings",
           project_slug: slug,
           content: slice.content,
           truncated: slice.truncated,
           total_lines: slice.total_lines,
           start_line: slice.start_line,
           end_line: slice.end_line
         }
       }}
    end
  end

  defp workflow_file_path?(path) when is_binary(path) do
    normalized = path |> String.trim() |> String.replace("\\", "/") |> Path.basename()

    String.match?(normalized, ~r/^WORKFLOW(\..+)?\.md$/i)
  end

  @spec apply_list_limits([map()], map()) :: [map()]
  def apply_list_limits(issues, arguments) when is_list(issues) do
    issues
    |> maybe_filter_status(Map.get(arguments, "status"))
    |> apply_limit(Map.get(arguments, "limit"))
  end

  @spec list_issues_schema_properties() :: map()
  def list_issues_schema_properties do
    %{
      "search" => string_schema("Optional full-text search query."),
      "assignee" => string_schema("Optional assignee filter."),
      "creator" => string_schema("Optional creator filter."),
      "status" => string_schema("Optional workflow status name filter."),
      "limit" => %{
        "type" => ["integer", "null"],
        "description" => "Maximum issues to return (default #{@default_list_limit}, max #{@max_list_limit})."
      }
    }
  end

  defp maybe_attach_comments(project, %{identifier: identifier} = presented, arguments) do
    if truthy?(Map.get(arguments, "include_comments")) do
      case IssueAdapter.dispatch(project, :list_comments, [identifier]) do
        {:ok, comments} ->
          {:ok, Map.put(presented, :comments, Enum.map(comments, &TrackerPresenter.comment/1))}

        {:error, reason} ->
          {:error, reason}
      end
    else
      {:ok, presented}
    end
  end

  defp project_workflow_markdown(slug) do
    case Context.get_project_setup(slug) do
      %{workflow_markdown: markdown} when is_binary(markdown) -> markdown
      _ -> ""
    end
  end

  defp workflow_payload(slug, markdown, %{config: config, prompt: prompt, prompt_template: prompt_template}) do
    %{
      project_slug: slug,
      markdown: markdown,
      config: config,
      prompt: prompt,
      prompt_template: prompt_template
    }
  end

  defp normalize_format(nil), do: :json

  defp normalize_format(format) when is_binary(format) do
    case String.trim(format) |> String.downcase() do
      "" -> :json
      "json" -> :json
      "yaml" -> :yaml
      other -> {:error, {:invalid_template_format, other}}
    end
  end

  defp normalize_format(_), do: {:error, :invalid_template_format}

  defp workspace_base(project, arguments, opts) do
    slug = project_slug(project)

    identifier =
      normalize_optional_string(Map.get(arguments, "issue_identifier")) ||
        normalize_optional_string(Keyword.get(opts, :bound_issue_identifier))

    if identifier do
      {:ok, Workspace.path_for_issue(identifier)}
    else
      {:ok, ProjectExploreWorkspace.path(slug)}
    end
  end

  defp project_slug(%{slug: slug}) when is_binary(slug), do: slug
  defp project_slug(%{"slug" => slug}) when is_binary(slug), do: slug

  defp safe_path_under(base, relative) do
    base = Path.expand(base)
    candidate = Path.expand(Path.join(base, relative), base)

    if candidate == base or String.starts_with?(candidate, base <> "/") do
      if File.regular?(candidate), do: {:ok, candidate}, else: {:error, :file_not_found}
    else
      {:error, :path_escape}
    end
  end

  defp read_file_limited(path) do
    case File.read(path) do
      {:ok, content} ->
        if byte_size(content) > @max_read_bytes do
          {:ok, binary_part(content, 0, @max_read_bytes)}
        else
          {:ok, content}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp slice_lines(content, start_line, end_line) do
    lines = String.split(content, ~r/\R/, trim: false)
    total = length(lines)
    start = normalize_line_number(start_line, 1, total)
    finish = normalize_line_number(end_line, total, total)

    {start, finish} =
      if start > finish do
        {finish, start}
      else
        {start, finish}
      end

    slice = lines |> Enum.slice(start - 1, finish - start + 1) |> Enum.join("\n")
    truncated = byte_size(content) > @max_read_bytes

    {:ok,
     %{
       content: slice,
       truncated: truncated,
       total_lines: total,
       start_line: if(total == 0, do: nil, else: start),
       end_line: if(total == 0, do: nil, else: finish)
     }}
  end

  defp normalize_line_number(nil, default, _total), do: default

  defp normalize_line_number(value, _default, total) when is_integer(value) and value >= 1 do
    min(value, max(total, 1))
  end

  defp normalize_line_number(_value, default, _total), do: default

  defp maybe_filter_status(issues, nil), do: issues
  defp maybe_filter_status(issues, ""), do: issues

  defp maybe_filter_status(issues, status) when is_binary(status) do
    wanted = status |> String.trim() |> String.downcase()

    Enum.filter(issues, fn issue ->
      issue
      |> Map.get(:status)
      |> status_name()
      |> String.downcase() == wanted
    end)
  end

  defp maybe_filter_status(issues, _status), do: issues

  defp status_name(%{name: name}) when is_binary(name), do: name
  defp status_name(%{"name" => name}) when is_binary(name), do: name
  defp status_name(_), do: ""

  defp apply_limit(issues, nil), do: Enum.take(issues, @default_list_limit)

  defp apply_limit(issues, limit) when is_integer(limit) and limit > 0 do
    Enum.take(issues, min(limit, @max_list_limit))
  end

  defp apply_limit(issues, limit) when is_binary(limit) do
    case Integer.parse(String.trim(limit)) do
      {parsed, ""} when parsed > 0 -> Enum.take(issues, min(parsed, @max_list_limit))
      _ -> Enum.take(issues, @default_list_limit)
    end
  end

  defp apply_limit(issues, _limit), do: Enum.take(issues, @default_list_limit)

  defp truthy?(value) when value in [true, "true", "1", 1], do: true
  defp truthy?(_), do: false

  defp tool_spec(name, description, input_schema) do
    %{"name" => name, "description" => description, "inputSchema" => input_schema}
  end

  defp string_schema(description), do: %{"type" => ["string", "null"], "description" => description}

  defp normalize_required_string(value, field) when is_binary(value) do
    case String.trim(value) do
      "" -> {:error, {:missing_required_field, field}}
      trimmed -> {:ok, trimmed}
    end
  end

  defp normalize_required_string(_value, field), do: {:error, {:missing_required_field, field}}

  defp normalize_optional_string(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_optional_string(_value), do: nil
end
