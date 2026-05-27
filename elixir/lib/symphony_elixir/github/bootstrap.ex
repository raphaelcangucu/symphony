defmodule SymphonyElixir.GitHub.Bootstrap do
  @moduledoc """
  Provisions a repo-level GitHub Project v2 with a `Symphony State`
  single-select field on first startup. Idempotent: skipped when a
  cached project metadata file already exists.
  """

  require Logger

  alias SymphonyElixir.Config
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

  @create_field_mutation """
  mutation SymphonyGitHubCreateField(
    $projectId: ID!,
    $name: String!,
    $options: [ProjectV2SingleSelectFieldOptionInput!]!
  ) {
    createProjectV2Field(input: {
      projectId: $projectId
      dataType: SINGLE_SELECT
      name: $name
      singleSelectOptions: $options
    }) {
      projectV2Field {
        ... on ProjectV2SingleSelectField {
          id
          name
          options { id name }
        }
      }
    }
  }
  """

  @existing_project_query """
  query SymphonyGitHubReadProject(
    $projectId: ID!,
    $statusFieldName: String!,
    $nativeStatusFieldName: String!
  ) {
    node(id: $projectId) {
      ... on ProjectV2 {
        id
        number
        url
        symphonyField: field(name: $statusFieldName) {
          ... on ProjectV2SingleSelectField {
            id
            name
            options { id name }
          }
        }
        nativeField: field(name: $nativeStatusFieldName) {
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
         {:ok, project} <- create_project(client, owner_id, title),
         :ok <- log_created_project(project),
         {:ok, field} <- create_status_field(client, project["id"], status_field_name, project),
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
    url = project["url"]
    Logger.info("GitHub Project created (id=#{project["id"]} url=#{url}); creating Symphony State field…")
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
        with {:ok, project, field, native_field} <-
               load_existing_project(client, project_id, status_field_name),
             metadata <- build_metadata(project, field, native_field),
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

  defp create_status_field(client, project_id, name, project) do
    options = build_option_inputs()

    variables = %{
      "projectId" => project_id,
      "name" => name,
      "options" => options
    }

    case client.graphql(@create_field_mutation, variables) do
      {:ok,
       %{
         "data" => %{
           "createProjectV2Field" => %{
             "projectV2Field" => %{"id" => _, "options" => _} = field
           }
         }
       }} ->
        {:ok, field}

      {:ok, body} ->
        {:error, {:create_field_unexpected, project["url"], body}}

      {:error, reason} ->
        {:error, {:create_field_failed, project["url"], reason}}
    end
  end

  defp load_existing_project(client, project_id, status_field_name) do
    native_status_field_name = GitHub.Config.native_status_field()

    case client.graphql(@existing_project_query, %{
           "projectId" => project_id,
           "statusFieldName" => status_field_name,
           "nativeStatusFieldName" => native_status_field_name
         }) do
      {:ok,
       %{
         "data" => %{
           "node" =>
             %{
               "id" => _,
               "symphonyField" => %{"id" => _, "options" => _} = field
             } = project
         }
       }} ->
        native_field = Map.get(project, "nativeField")
        {:ok, project, field, native_field}

      {:ok, body} ->
        {:error, {:existing_project_unexpected, body}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp build_option_inputs do
    Config.field_states()
    |> Enum.uniq()
    |> Enum.map(fn name ->
      %{
        "name" => name,
        "color" => "GRAY",
        "description" => name
      }
    end)
  end

  defp build_metadata(project, field, native_field \\ nil) do
    %{
      "project_id" => project["id"],
      "project_number" => project["number"],
      "project_url" => project["url"],
      "status_field_id" => field["id"],
      "status_field_name" => field["name"],
      "state_options" => field_options_to_map(field),
      "bootstrapped_at" => DateTime.utc_now() |> DateTime.to_iso8601()
    }
    |> maybe_put_native_status_metadata(native_field)
  end

  defp maybe_put_native_status_metadata(metadata, %{"id" => id, "name" => name, "options" => options})
       when is_binary(id) and is_binary(name) and is_list(options) do
    Map.merge(metadata, %{
      "native_status_field_id" => id,
      "native_status_field_name" => name,
      "native_state_options" => field_options_to_map(%{"options" => options})
    })
  end

  defp maybe_put_native_status_metadata(metadata, _native_field), do: metadata

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

  defp format_error({:create_field_failed, url, reason}),
    do: "Project was created at #{url} but Symphony State field creation failed (#{format_error(reason)}). Delete the project on GitHub or set github.project.mode=existing with github.project.id."

  defp format_error({:create_field_unexpected, url, body}),
    do: "Project was created at #{url} but Symphony State field response was unexpected: #{inspect(body)}. Delete the project on GitHub or set github.project.mode=existing with github.project.id."

  defp format_error(reason) when is_binary(reason), do: reason
  defp format_error(reason), do: inspect(reason)
end
