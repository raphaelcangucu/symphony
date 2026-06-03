defmodule SymphonyElixir.GitHub.ProjectProvisioner do
  @moduledoc """
  Creates a GitHub Project v2 and configures its built-in `Status`
  single-select field with the workflow states via GraphQL.

  The built-in `Status` field is the single source of truth for GitHub
  workflow control (see the GitHub Project status source design). Symphony
  reconciles its options instead of creating a separate `Symphony State`
  field, so the board view renders the workflow states as columns out of
  the box.

  Uses Symphony's server-side `GITHUB_TOKEN` (not the Codex workspace shell).
  """

  alias SymphonyElixir.GitHub.{Client, RepoSpec}

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

  @read_field_query """
  query SymphonyGitHubReadStatusField($projectId: ID!, $name: String!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        field(name: $name) {
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

  @update_field_mutation """
  mutation SymphonyGitHubUpdateStatusField($input: UpdateProjectV2FieldInput!) {
    updateProjectV2Field(input: $input) {
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

  @create_field_mutation """
  mutation SymphonyGitHubCreateStatusField(
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

  @type provision_attrs :: %{
          required(:repo) => String.t(),
          required(:title) => String.t(),
          required(:states) => [String.t()],
          optional(:status_field) => String.t()
        }

  @type provision_result :: %{
          project_id: String.t(),
          project_number: integer() | nil,
          project_url: String.t(),
          status_field_id: String.t(),
          status_field_name: String.t(),
          state_options: %{String.t() => String.t()}
        }

  @default_status_field "Status"

  @spec provision(provision_attrs(), keyword()) :: {:ok, provision_result()} | {:error, term()}
  def provision(attrs, opts \\ []) when is_map(attrs) do
    client = client_from_opts(opts)

    with {:ok, {owner, name}} <- RepoSpec.split(Map.fetch!(attrs, :repo)),
         {:ok, owner_id} <- resolve_owner_id(client, owner, name),
         {:ok, project} <- create_project(client, owner_id, Map.fetch!(attrs, :title)),
         {:ok, states} <- normalize_states(Map.get(attrs, :states)),
         {:ok, field} <- configure_status_field(client, project["id"], attrs, states) do
      state_options = field_options_to_map(field)

      {:ok,
       %{
         project_id: project["id"],
         project_number: project["number"],
         project_url: project["url"],
         status_field_id: field["id"],
         status_field_name: field["name"],
         state_options: state_options
       }}
    end
  end

  defp resolve_owner_id(client, owner, name) do
    case graphql(client, @owner_id_query, %{"owner" => owner, "name" => name}) do
      {:ok, %{"data" => %{"repository" => %{"owner" => %{"id" => id}}}}} when is_binary(id) ->
        {:ok, id}

      {:ok, %{"data" => %{"repository" => nil}}} ->
        {:error, :repository_not_found}

      {:ok, body} ->
        {:error, {:owner_lookup_unexpected, body}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp create_project(client, owner_id, title) do
    case graphql(client, @create_project_mutation, %{"ownerId" => owner_id, "title" => title}) do
      {:ok, %{"data" => %{"createProjectV2" => %{"projectV2" => %{"id" => _} = project}}}} ->
        {:ok, project}

      {:ok, body} ->
        {:error, {:create_project_unexpected, body}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp configure_status_field(client, project_id, attrs, states) do
    status_field = resolve_status_field_name(attrs)

    case read_status_field(client, project_id, status_field) do
      {:ok, %{"id" => _} = field} ->
        update_status_field_options(client, field, states)

      {:ok, nil} ->
        create_status_field(client, project_id, status_field, states)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp resolve_status_field_name(attrs) do
    status_field = Map.get(attrs, :status_field, @default_status_field) |> to_string() |> String.trim()
    if status_field == "", do: @default_status_field, else: status_field
  end

  defp read_status_field(client, project_id, status_field) do
    case graphql(client, @read_field_query, %{"projectId" => project_id, "name" => status_field}) do
      {:ok, %{"data" => %{"node" => %{"field" => %{"id" => _} = field}}}} ->
        {:ok, field}

      {:ok, %{"data" => %{"node" => %{"field" => nil}}}} ->
        {:ok, nil}

      {:ok, body} ->
        {:error, {:read_status_field_unexpected, body}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp update_status_field_options(client, field, states) do
    existing_options = field_options_to_map(field)
    options = build_options_input(states, existing_options)

    variables = %{
      "input" => %{
        "fieldId" => field["id"],
        "singleSelectOptions" => options
      }
    }

    case graphql(client, @update_field_mutation, variables) do
      {:ok,
       %{
         "data" => %{
           "updateProjectV2Field" => %{"projectV2Field" => %{"id" => _} = updated}
         }
       }} ->
        {:ok, updated}

      {:ok, body} ->
        {:error, {:update_status_field_unexpected, body}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp create_status_field(client, project_id, status_field, states) do
    options = build_options_input(states, %{})

    case graphql(client, @create_field_mutation, %{
           "projectId" => project_id,
           "name" => status_field,
           "options" => options
         }) do
      {:ok,
       %{
         "data" => %{
           "createProjectV2Field" => %{"projectV2Field" => %{"id" => _} = field}
         }
       }} ->
        {:ok, field}

      {:ok, body} ->
        {:error, {:create_status_field_unexpected, body}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp build_options_input(states, existing_options) do
    Enum.map(states, fn state ->
      base = %{"name" => state, "color" => "GRAY", "description" => state}

      case Map.get(existing_options, state) do
        id when is_binary(id) -> Map.put(base, "id", id)
        _ -> base
      end
    end)
  end

  defp normalize_states(states) when is_list(states) do
    normalized =
      states
      |> Enum.map(&to_string/1)
      |> Enum.map(&String.trim/1)
      |> Enum.reject(&(&1 == ""))
      |> Enum.uniq()

    if normalized == [], do: {:error, {:missing_required_field, :states}}, else: {:ok, normalized}
  end

  defp normalize_states(_), do: {:error, {:missing_required_field, :states}}

  defp field_options_to_map(%{"options" => options}) when is_list(options) do
    Enum.reduce(options, %{}, fn opt, acc ->
      case {opt["name"], opt["id"]} do
        {name, id} when is_binary(name) and is_binary(id) -> Map.put(acc, name, id)
        _ -> acc
      end
    end)
  end

  defp field_options_to_map(_), do: %{}

  defp graphql(client, query, variables) do
    case client do
      fun when is_function(fun, 3) -> fun.(query, variables, [])
      module when is_atom(module) -> module.graphql(query, variables, [])
    end
  end

  defp client_from_opts(opts) do
    Keyword.get(opts, :client) || Keyword.get(opts, :client_module, client_module())
  end

  defp client_module do
    Application.get_env(:symphony_elixir, :github_client_module, Client)
  end
end
