defmodule SymphonyElixir.Assistant.SetupTools do
  @moduledoc false

  alias SymphonyElixir.LocalTracker.{Context, Repository, RepositoryScanner, WorkflowSuggester}
  alias SymphonyElixirWeb.TrackerPresenter

  @tools ~w(scan_project_setup suggest_project_setup)

  @spec tools() :: [String.t()]
  def tools, do: @tools

  @spec tool_specs() :: [map()]
  def tool_specs do
    [
      tool_spec(
        "scan_project_setup",
        "Scan linked repositories for stack hints (same as the project setup wizard).",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "properties" => %{
            "repositories" => %{
              "type" => ["array", "null"],
              "description" => "Optional repository scan inputs. Omit to scan the project's linked repositories."
            }
          }
        }
      ),
      tool_spec(
        "suggest_project_setup",
        "Suggest workflow markdown, hooks, and validation commands from repository scans.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "properties" => %{
            "repositories" => %{
              "type" => ["array", "null"],
              "description" => "Optional repository metadata. Omit to use the project's linked repositories."
            },
            "scans" => %{
              "type" => ["array", "null"],
              "description" => "Optional scan results. Omit to run scan_project_setup first."
            }
          }
        }
      )
    ]
  end

  @spec execute(String.t(), String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(tool, project_slug, arguments, opts \\ [])

  def execute("scan_project_setup", project_slug, arguments, opts) when is_binary(project_slug) and is_map(arguments) do
    scanner = Keyword.get(opts, :scanner, &RepositoryScanner.scan/1)

    with {:ok, repositories} <- repositories_for_scan(project_slug, arguments),
         scans <- scan_repositories(repositories, scanner) do
      {:ok,
       %{
         tool: "scan_project_setup",
         message: "Scanned #{length(scans)} repository(ies).",
         data: %{scans: scans}
       }}
    end
  end

  def execute("suggest_project_setup", project_slug, arguments, opts) when is_binary(project_slug) and is_map(arguments) do
    with {:ok, repositories} <- repositories_for_suggest(project_slug, arguments),
         {:ok, scans} <- scans_for_suggest(project_slug, arguments, opts),
         {:ok, suggestion} <- WorkflowSuggester.suggest(%{repositories: repositories, scans: scans}) do
      {:ok,
       %{
         tool: "suggest_project_setup",
         message: "Generated setup suggestions for #{length(repositories)} repository(ies).",
         data: suggestion
       }}
    end
  end

  def execute(_tool, _project_slug, _arguments, _opts), do: {:error, {:unsupported_tool, :setup}}

  defp repositories_for_scan(project_slug, arguments) do
    case Map.get(arguments, "repositories") do
      repositories when is_list(repositories) and repositories != [] ->
        {:ok, repositories}

      _ ->
        with :ok <- ensure_project(project_slug) do
          {:ok, Enum.map(Context.list_repositories(project_slug), &repository_scan_attrs/1)}
        end
    end
  end

  defp repositories_for_suggest(project_slug, arguments) do
    case Map.get(arguments, "repositories") do
      repositories when is_list(repositories) and repositories != [] ->
        {:ok, normalize_repository_list(repositories)}

      _ ->
        with :ok <- ensure_project(project_slug) do
          {:ok, Context.list_repositories(project_slug) |> Enum.map(&repository_suggest_attrs/1)}
        end
    end
  end

  defp scans_for_suggest(project_slug, arguments, opts) do
    case Map.get(arguments, "scans") do
      scans when is_list(scans) ->
        {:ok, scans}

      _ ->
        case execute("scan_project_setup", project_slug, %{}, opts) do
          {:ok, %{data: %{scans: scans}}} -> {:ok, scans}
          {:error, reason} -> {:error, reason}
        end
    end
  end

  defp scan_repositories(repositories, scanner) do
    Enum.map(repositories, fn repository ->
      case scanner.(repository) do
        {:ok, scan} -> scan
        {:error, reason} -> %{workspace_path: Map.get(repository, "workspace_path") || Map.get(repository, :workspace_path), error: reason}
      end
    end)
  end

  defp repository_scan_attrs(%Repository{} = repository) do
    repository
    |> TrackerPresenter.repository()
    |> Map.take([:github_full_name, :clone_url, :default_branch, :selected_branch, :local_path, :workspace_path, :role])
    |> stringify_keys()
  end

  defp repository_suggest_attrs(%Repository{} = repository) do
    Map.take(repository, [:github_full_name, :clone_url, :default_branch, :selected_branch, :workspace_path, :role])
  end

  defp normalize_repository_list(repositories) do
    Enum.map(repositories, fn repository ->
      repository
      |> stringify_keys()
      |> Map.take(["github_full_name", "clone_url", "default_branch", "selected_branch", "workspace_path", "role"])
    end)
  end

  defp ensure_project(project_slug) do
    case Context.get_project(project_slug) do
      {:ok, _project} -> :ok
      {:error, :project_not_found} -> {:error, :project_not_found}
    end
  end

  defp stringify_keys(value) when is_map(value) do
    Map.new(value, fn
      {key, nested} when is_atom(key) -> {Atom.to_string(key), stringify_keys(nested)}
      {key, nested} when is_binary(key) -> {key, stringify_keys(nested)}
    end)
  end

  defp stringify_keys(value) when is_list(value), do: Enum.map(value, &stringify_keys/1)
  defp stringify_keys(value), do: value

  defp tool_spec(name, description, input_schema) do
    %{"name" => name, "description" => description, "inputSchema" => input_schema}
  end
end
