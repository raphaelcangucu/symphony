defmodule SymphonyElixir.LocalTracker.GitHubDiscovery do
  @moduledoc "GitHub repository discovery for the local tracker workspace wizard."

  alias SymphonyElixir.GitHub.Client

  @owners_query """
  query LocalTrackerOwners($after: String) {
    viewer {
      login
      name
      avatarUrl
      organizations(first: 50, after: $after) {
        nodes {
          login
          name
          avatarUrl
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
  """

  @repositories_query """
  query LocalTrackerRepositories($owner: String!, $after: String) {
    repositoryOwner(login: $owner) {
      repositories(first: 50, after: $after, orderBy: {field: NAME, direction: ASC}) {
        nodes {
          name
          nameWithOwner
          description
          url
          sshUrl
          isPrivate
          owner { avatarUrl }
          defaultBranchRef { name }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
  """

  @spec list_owners(keyword()) :: {:ok, [map()]} | {:error, term()}
  def list_owners(opts \\ []) when is_list(opts) do
    fetch_owners_page(nil, [], opts)
  end

  @spec list_repositories(String.t(), keyword()) :: {:ok, [map()]} | {:error, term()}
  def list_repositories(owner, opts \\ []) when is_binary(owner) do
    owner = String.trim(owner)

    if owner == "" do
      {:error, :owner_required}
    else
      fetch_page(owner, nil, [], opts)
    end
  end

  defp fetch_owners_page(after_cursor, acc, opts) do
    case Client.graphql(@owners_query, %{"after" => after_cursor}, Keyword.take(opts, [:request_fun])) do
      {:ok, body} ->
        case owners_connection(body) do
          {:ok, viewer, organizations, %{has_next_page: true, end_cursor: cursor}} when is_binary(cursor) ->
            fetch_owners_page(cursor, acc ++ normalize_owners(viewer, organizations, include_viewer?: acc == []), opts)

          {:ok, viewer, organizations, %{has_next_page: false}} ->
            {:ok, acc ++ normalize_owners(viewer, organizations, include_viewer?: acc == [])}

          {:error, _reason} = error ->
            error
        end

      {:error, _reason} = error ->
        error
    end
  end

  defp fetch_page(owner, after_cursor, acc, opts) do
    variables = %{"owner" => owner, "after" => after_cursor}

    case Client.graphql(@repositories_query, variables, Keyword.take(opts, [:request_fun])) do
      {:ok, body} ->
        case repository_connection(body) do
          {:ok, nodes, %{has_next_page: true, end_cursor: cursor}} when is_binary(cursor) ->
            fetch_page(owner, cursor, acc ++ Enum.map(nodes, &normalize_repository/1), opts)

          {:ok, nodes, %{has_next_page: false}} ->
            {:ok, acc ++ Enum.map(nodes, &normalize_repository/1)}

          {:error, _reason} = error ->
            error
        end

      {:error, _reason} = error ->
        error
    end
  end

  defp repository_connection(%{"data" => data}) when is_map(data) do
    connection = get_in(data, ["repositoryOwner", "repositories"])

    case connection do
      %{"nodes" => nodes, "pageInfo" => page_info} when is_list(nodes) ->
        {:ok, nodes,
         %{
           has_next_page: Map.get(page_info, "hasNextPage", false),
           end_cursor: Map.get(page_info, "endCursor")
         }}

      _ ->
        {:error, :github_owner_not_found}
    end
  end

  defp repository_connection(_body), do: {:error, :github_unknown_payload}

  defp owners_connection(%{"data" => %{"viewer" => viewer}}) when is_map(viewer) do
    organizations = get_in(viewer, ["organizations", "nodes"]) || []
    page_info = get_in(viewer, ["organizations", "pageInfo"]) || %{}

    {:ok, viewer, organizations,
     %{
       has_next_page: Map.get(page_info, "hasNextPage", false),
       end_cursor: Map.get(page_info, "endCursor")
     }}
  end

  defp owners_connection(_body), do: {:error, :github_unknown_payload}

  defp normalize_owners(viewer, organizations, include_viewer?: include_viewer?) do
    viewer_owner =
      if include_viewer? do
        [
          %{
            login: Map.get(viewer, "login"),
            name: Map.get(viewer, "name"),
            avatar_url: Map.get(viewer, "avatarUrl"),
            kind: "user"
          }
        ]
      else
        []
      end

    organization_owners =
      Enum.map(organizations, fn organization ->
        %{
          login: Map.get(organization, "login"),
          name: Map.get(organization, "name"),
          avatar_url: Map.get(organization, "avatarUrl"),
          kind: "organization"
        }
      end)

    viewer_owner ++ organization_owners
  end

  defp normalize_repository(node) do
    url = Map.get(node, "url")
    name = Map.get(node, "name")

    %{
      name: name,
      full_name: Map.get(node, "nameWithOwner"),
      description: Map.get(node, "description"),
      url: url,
      clone_url: https_clone_url(url),
      ssh_url: Map.get(node, "sshUrl"),
      default_branch: get_in(node, ["defaultBranchRef", "name"]),
      private: Map.get(node, "isPrivate", false),
      avatar_url: get_in(node, ["owner", "avatarUrl"]),
      suggested_local_path: suggested_local_path(name)
    }
  end

  defp https_clone_url(url) when is_binary(url), do: "#{url}.git"
  defp https_clone_url(_url), do: nil

  defp suggested_local_path(name) when is_binary(name) and name != "" do
    Path.join([System.user_home!(), "code", name])
  end

  defp suggested_local_path(_name), do: nil
end
