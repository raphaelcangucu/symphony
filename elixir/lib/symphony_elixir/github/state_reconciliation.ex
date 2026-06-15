defmodule SymphonyElixir.GitHub.StateReconciliation do
  @moduledoc false

  require Logger

  alias SymphonyElixir.Config
  alias SymphonyElixir.GitHub.{Client, ProjectMetadata}
  alias SymphonyElixir.LocalTracker.{Context, Project}
  alias SymphonyElixir.ProjectConfig

  @update_field_mutation """
  mutation SymphonyGitHubUpdateField($input: UpdateProjectV2FieldInput!) {
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

  @read_status_field_query """
  query SymphonyGitHubReadStatusField($projectId: ID!, $name: String!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        url
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

  @items_usage_query """
  query SymphonyGitHubItemsUsage($projectId: ID!, $first: Int!, $after: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: $first, after: $after, orderBy: {field: POSITION, direction: ASC}) {
          nodes {
            fieldValues(first: 30) {
              nodes {
                __typename
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2FieldCommon { id name } }
                }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
  """

  @spec reconcile_project(Project.t(), keyword()) :: :ok | {:error, String.t()}
  def reconcile_project(project, opts \\ [])

  def reconcile_project(%Project{tracker_kind: "github", tracker_config: cfg} = project, opts) do
    with {:ok, project_id} <- fetch_tracker_config_string(cfg, "project_id"),
         status_field_name <- Map.get(cfg, "status_field", "Status"),
         desired when desired != [] <- Keyword.get_lazy(opts, :desired_states, fn -> desired_states_for_project(project) end),
         {:ok, field, project_url} <-
           fetch_status_field(client_module(opts), project_id, status_field_name, opts) do
      metadata = %{
        "project_id" => project_id,
        "project_url" => project_url || "GitHub project",
        "status_field_id" => field["id"],
        "status_field_name" => field["name"] || status_field_name,
        "state_options" => field_options_to_map(field)
      }

      reconcile(nil, metadata, Keyword.put(opts, :desired_states, desired))
    else
      [] -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  def reconcile_project(_project, _opts), do: :ok

  @spec reconcile(Path.t() | nil, map(), keyword()) :: :ok | {:error, String.t()}
  def reconcile(base_dir, metadata, opts \\ []) when is_map(metadata) do
    client = client_module(opts)
    desired = Keyword.get(opts, :desired_states, desired_states())
    cached_options = metadata["state_options"] || %{}
    status_field_name = metadata["status_field_name"] || SymphonyElixir.GitHub.Config.status_field()
    field_id = metadata["status_field_id"]
    project_id = metadata["project_id"]
    project_url = metadata["project_url"] || "GitHub project"

    with :ok <-
           check_removed_states_in_use(
             client,
             project_id,
             field_id,
             status_field_name,
             cached_options,
             desired,
             project_url,
             opts
           ),
         {:ok, updated_options} <-
           add_missing_options(client, field_id, cached_options, desired, opts),
         :ok <- maybe_refresh_metadata(base_dir, metadata, updated_options, cached_options) do
      :ok
    else
      {:error, reason} -> {:error, reason}
    end
  end

  defp desired_states do
    Config.field_states()
  end

  defp check_removed_states_in_use(client, project_id, field_id, status_field_name, cached_options, desired, project_url, opts) do
    removed = Map.keys(cached_options) -- desired

    Enum.reduce_while(removed, :ok, fn state_name, _acc ->
      case count_items_with_state(client, project_id, field_id, status_field_name, state_name, opts) do
        {:ok, 0} ->
          {:cont, :ok}

        {:ok, count} ->
          {:halt,
           {:error, "WORKFLOW removed Project Status option #{inspect(state_name)} but #{count} project item(s) still use it. Move them to another state in #{project_url}, then restart Symphony."}}

        {:error, reason} ->
          {:halt, {:error, "Failed to check project items for state #{inspect(state_name)}: #{inspect(reason)}"}}
      end
    end)
  end

  defp add_missing_options(client, field_id, cached_options, desired, opts) do
    missing = Enum.filter(desired, fn name -> !Map.has_key?(cached_options, name) end)

    if missing == [] do
      {:ok, cached_options}
    else
      options_input = build_options_input(cached_options, desired)

      variables = %{
        "input" => %{
          "fieldId" => field_id,
          "singleSelectOptions" => options_input
        }
      }

      case client.graphql(@update_field_mutation, variables, graphql_opts(opts)) do
        {:ok, %{"data" => %{"updateProjectV2Field" => %{"projectV2Field" => %{"options" => options}}}}}
        when is_list(options) ->
          log_added_states(missing)
          {:ok, options_to_map(options)}

        {:ok, body} ->
          {:error, "Unexpected updateProjectV2Field response: #{inspect(body)}"}

        {:error, reason} ->
          {:error, "updateProjectV2Field failed: #{inspect(reason)}"}
      end
    end
  end

  defp build_options_input(cached_options, desired) do
    Enum.map(desired, fn name ->
      base = %{
        "name" => name,
        "color" => "GRAY",
        "description" => name
      }

      case Map.get(cached_options, name) do
        id when is_binary(id) -> Map.put(base, "id", id)
        _ -> base
      end
    end)
  end

  defp maybe_refresh_metadata(base_dir, metadata, updated_options, previous_options) do
    cond do
      updated_options == previous_options ->
        :ok

      is_binary(base_dir) ->
        ProjectMetadata.write!(base_dir, Map.put(metadata, "state_options", updated_options))
        :ok

      true ->
        :ok
    end
  end

  defp desired_states_for_project(%Project{} = project) do
    local =
      project.slug
      |> Context.list_statuses()
      |> Enum.sort_by(& &1.position)
      |> Enum.map(& &1.name)

    case local do
      [_ | _] = names -> names
      _ -> ProjectConfig.resolve(project).field_states || []
    end
  end

  defp fetch_status_field(client, project_id, status_field_name, opts) do
    case client.graphql(
           @read_status_field_query,
           %{"projectId" => project_id, "name" => status_field_name},
           graphql_opts(opts)
         ) do
      {:ok, %{"data" => %{"node" => %{"url" => url, "field" => %{"id" => _} = field}}}} ->
        {:ok, field, url}

      {:ok, %{"data" => %{"node" => %{"field" => nil}}}} ->
        {:error,
         "GitHub Project #{inspect(status_field_name)} field not found or is not a single-select field."}

      {:ok, body} ->
        {:error, "Unexpected read status field response: #{inspect(body)}"}

      {:error, reason} ->
        {:error, "read status field failed: #{inspect(reason)}"}
    end
  end

  defp fetch_tracker_config_string(cfg, key) do
    case Map.get(cfg, key) do
      value when is_binary(value) and value != "" -> {:ok, value}
      _ -> {:error, "tracker_config missing #{key}"}
    end
  end

  defp field_options_to_map(%{"options" => options}) when is_list(options) do
    options_to_map(options)
  end

  defp field_options_to_map(_field), do: %{}

  defp count_items_with_state(client, project_id, field_id, status_field_name, state_name, opts) do
    count_items_page(client, project_id, field_id, status_field_name, state_name, nil, 0, opts)
  end

  defp count_items_page(client, project_id, field_id, status_field_name, state_name, cursor, acc, opts) do
    variables = %{
      "projectId" => project_id,
      "first" => 50,
      "after" => cursor
    }

    case client.graphql(@items_usage_query, variables, graphql_opts(opts)) do
      {:ok, %{"data" => %{"node" => %{"items" => %{"nodes" => nodes, "pageInfo" => page_info}}}}}
      when is_list(nodes) ->
        page_count =
          Enum.count(nodes, fn item ->
            item_state_matches?(item, field_id, status_field_name, state_name)
          end)

        new_acc = acc + page_count

        if page_info["hasNextPage"] == true do
          count_items_page(
            client,
            project_id,
            field_id,
            status_field_name,
            state_name,
            page_info["endCursor"],
            new_acc,
            opts
          )
        else
          {:ok, new_acc}
        end

      {:ok, _body} ->
        {:error, :unexpected_items_response}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp item_state_matches?(item, field_id, status_field_name, state_name) do
    case get_in(item, ["fieldValues", "nodes"]) do
      nodes when is_list(nodes) -> Enum.any?(nodes, &field_value_matches?(&1, field_id, status_field_name, state_name))
      _ -> false
    end
  end

  defp field_value_matches?(node, field_id, status_field_name, state_name) do
    case node do
      %{
        "__typename" => "ProjectV2ItemFieldSingleSelectValue",
        "name" => ^state_name,
        "field" => %{"id" => ^field_id, "name" => ^status_field_name}
      } ->
        true

      %{
        "__typename" => "ProjectV2ItemFieldSingleSelectValue",
        "name" => ^state_name,
        "field" => %{"name" => ^status_field_name}
      } ->
        true

      _ ->
        false
    end
  end

  defp options_to_map(options) do
    Enum.reduce(options, %{}, fn opt, acc ->
      case {opt["name"], opt["id"]} do
        {name, id} when is_binary(name) and is_binary(id) -> Map.put(acc, name, id)
        _ -> acc
      end
    end)
  end

  defp log_added_states(missing) do
    Logger.info("Added Status option(s) to GitHub project: #{Enum.join(missing, ", ")}")
  end

  defp client_module(opts) do
    case Keyword.get(opts, :client_module) do
      nil -> Application.get_env(:symphony_elixir, :github_client_module, Client)
      module when is_atom(module) -> module
    end
  end

  defp graphql_opts(opts), do: Keyword.take(opts, [:request_fun, :operation_name])
end
