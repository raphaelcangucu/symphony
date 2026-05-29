defmodule SymphonyElixir.GitHub.Bootstrap do
  @moduledoc """
  Provisions a repo-level GitHub Project v2 and caches the built-in
  `Status` single-select field on first startup. Idempotent: skipped
  when a cached project metadata file already exists.
  """

  require Logger

  alias SymphonyElixir.GitHub
  alias SymphonyElixir.GitHub.{Client, ProjectMetadata, RepoSpec, StateReconciliation, Viewer}

  @owner_id_query """
  query SymphonyGitHubResolveOwner($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      owner { id }
    }
  }
  """

  @create_project_mutation """
  mutation SymphonyGitHubCreateProject($ownerId: ID!, $title: String!) {
    createProjectV2(input: { ownerId: $ownerId, title: $title }) {
      projectV2 { id number url }
    }
  }
  """

  @existing_project_query """
  query SymphonyGitHubReadProject(
    $projectId: ID!,
    $statusFieldName: String!
  ) {
    node(id: $projectId) {
      ... on ProjectV2 {
        id
        number
        url
        statusField: field(name: $statusFieldName) {
          ... on ProjectV2SingleSelectField {
            id
            name
            options { id name }
          }
        }
      }
    }
  }
  """

  @type opts :: [
          base_dir: Path.t(),
          client_module: module()
        ]

  @spec ensure_project(opts()) :: :ok | {:error, String.t()}
  def ensure_project(opts \\ []) do
    base_dir = Keyword.get(opts, :base_dir, File.cwd!())

    case ProjectMetadata.read(base_dir) do
      {:ok, metadata} ->
        post_bootstrap_validate(base_dir, metadata, opts)

      {:error, :missing_project_metadata} ->
        run_bootstrap(opts)

      {:error, :invalid_project_metadata} ->
        {:error, "Invalid GitHub project metadata at #{ProjectMetadata.cache_path(base_dir)}. Delete the file and restart."}
    end
  end

  defp run_bootstrap(opts) do
    case GitHub.Config.project_mode() do
      "auto" -> bootstrap_auto(opts)
      "existing" -> bootstrap_existing(opts)
      other -> {:error, "Unsupported github.project.mode: #{inspect(other)}"}
    end
  end

  defp bootstrap_auto(opts) do
    client = client_module(opts)
    base_dir = Keyword.get(opts, :base_dir, File.cwd!())
    title = GitHub.Config.project_title()
    status_field_name = GitHub.Config.status_field()
    repo = GitHub.Config.repo()

    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         {:ok, owner_id} <- resolve_owner_id(client, owner, name),
         {:ok, created} <- create_project(client, owner_id, title),
         :ok <- log_created_project(created),
         {:ok, project, field} <-
           load_existing_project(client, created["id"], status_field_name),
         metadata <- build_metadata(project, field),
         :ok <- write_metadata(base_dir, metadata),
         :ok <- post_bootstrap_validate(base_dir, metadata, opts) do
      Logger.info("GitHub Project bootstrapped: #{project["url"]}")
      :ok
    else
      {:error, reason} -> {:error, "GitHub project bootstrap failed: #{format_error(reason)}"}
    end
  end

  defp post_bootstrap_validate(base_dir, metadata, opts) do
    with :ok <- StateReconciliation.reconcile(base_dir, metadata, opts) do
      Viewer.ensure_cached(base_dir, opts)
    end
  end

  defp log_created_project(project) do
    Logger.info("GitHub Project created (id=#{project["id"]} url=#{project["url"]}); caching Status field…")
    :ok
  end

  defp bootstrap_existing(opts) do
    client = client_module(opts)
    base_dir = Keyword.get(opts, :base_dir, File.cwd!())
    status_field_name = GitHub.Config.status_field()

    case GitHub.Config.project_id() do
      nil ->
        {:error, "github.project.mode is \"existing\" but github.project.id is not set in WORKFLOW.md"}

      project_id ->
        with {:ok, project, field} <-
               load_existing_project(client, project_id, status_field_name),
             metadata <- build_metadata(project, field),
             :ok <- write_metadata(base_dir, metadata),
             :ok <- post_bootstrap_validate(base_dir, metadata, opts) do
          Logger.info("GitHub Project metadata cached: #{project["url"]}")
          :ok
        else
          {:error, reason} ->
            {:error, "GitHub project bootstrap failed: #{format_error(reason)}"}
        end
    end
  end

  defp resolve_owner_id(client, owner, name) do
    case client.graphql(@owner_id_query, %{"owner" => owner, "name" => name}) do
      {:ok, %{"data" => %{"repository" => %{"owner" => %{"id" => id}}}}} when is_binary(id) ->
        {:ok, id}

      {:ok, body} ->
        {:error, {:owner_lookup_unexpected, body}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp create_project(client, owner_id, title) do
    case client.graphql(@create_project_mutation, %{"ownerId" => owner_id, "title" => title}) do
      {:ok, %{"data" => %{"createProjectV2" => %{"projectV2" => %{"id" => _} = project}}}} ->
        {:ok, project}

      {:ok, body} ->
        {:error, {:create_project_unexpected, body}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp load_existing_project(client, project_id, status_field_name) do
    case client.graphql(@existing_project_query, %{
           "projectId" => project_id,
           "statusFieldName" => status_field_name
         }) do
      {:ok,
       %{
         "data" => %{
           "node" =>
             %{
               "id" => _,
               "statusField" => %{"id" => _, "options" => _} = field
             } = project
         }
       }} ->
        {:ok, project, field}

      {:ok, %{"data" => %{"node" => %{"statusField" => nil}}}} ->
        {:error, {:missing_status_field, status_field_name}}

      {:ok, body} ->
        {:error, {:existing_project_unexpected, body}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp build_metadata(project, field) do
    %{
      "project_id" => project["id"],
      "project_number" => project["number"],
      "project_url" => project["url"],
      "status_field_id" => field["id"],
      "status_field_name" => field["name"],
      "state_options" => field_options_to_map(field),
      "bootstrapped_at" => DateTime.utc_now() |> DateTime.to_iso8601()
    }
  end

  defp field_options_to_map(%{"options" => options}) when is_list(options) do
    Enum.reduce(options, %{}, fn opt, acc ->
      case {opt["name"], opt["id"]} do
        {name, id} when is_binary(name) and is_binary(id) -> Map.put(acc, name, id)
        _ -> acc
      end
    end)
  end

  defp field_options_to_map(_field), do: %{}

  defp write_metadata(base_dir, metadata) do
    ProjectMetadata.write!(base_dir, metadata)
    :ok
  rescue
    e in [File.Error] -> {:error, {:write_metadata, Exception.message(e)}}
  end

  defp client_module(opts) do
    case Keyword.get(opts, :client_module) do
      nil -> Application.get_env(:symphony_elixir, :github_client_module, Client)
      module when is_atom(module) -> module
    end
  end

  defp format_error({:github_graphql_errors, errors}) when is_list(errors) do
    messages =
      errors
      |> Enum.map(&Map.get(&1, "message"))
      |> Enum.reject(&is_nil/1)
      |> Enum.join("; ")

    case messages do
      "" -> "GitHub GraphQL error: #{inspect(errors)}"
      _ -> "GitHub GraphQL error: #{messages}"
    end
  end

  defp format_error({:github_api_status, status}), do: "GitHub API status #{status}"

  defp format_error({:github_api_request, reason}),
    do: "GitHub API request failed: #{inspect(reason)}"

  defp format_error({:owner_lookup_unexpected, %{"data" => %{"repository" => nil}}}),
    do: "GitHub repository not found — verify github.repo in WORKFLOW.md"

  defp format_error({:missing_status_field, name}),
    do:
      "GitHub Project #{inspect(name)} field not found or is not a single-select field. Add a single-select #{inspect(name)} field to the project (GitHub provides a built-in Status field by default)."

  defp format_error(reason) when is_binary(reason), do: reason
  defp format_error(reason), do: inspect(reason)
end
