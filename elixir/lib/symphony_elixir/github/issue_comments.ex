defmodule SymphonyElixir.GitHub.IssueComments do
  @moduledoc """
  Fetches the comments attached to a GitHub issue for the tracker UI, including
  the agent's `## Codex Workpad` comment. GitHub does not expose these through
  the local SQLite store, so the GitHub `IssueAdapter` reads them on demand.
  """

  alias SymphonyElixir.GitHub.{Client, RepoSpec}

  @default_limit 50
  @workpad_pattern ~r/^\s*#*\s*Codex Workpad/i

  @query """
  query SymphonyTrackerIssueComments($owner: String!, $name: String!, $number: Int!, $limit: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        comments(last: $limit) {
          nodes {
            id
            url
            body
            createdAt
            updatedAt
            author { login }
          }
        }
      }
    }
  }
  """

  @issue_node_query """
  query SymphonyTrackerIssueNodeId($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) { id }
    }
  }
  """

  @add_comment_mutation """
  mutation SymphonyTrackerAddIssueComment($subjectId: ID!, $body: String!) {
    addComment(input: { subjectId: $subjectId, body: $body }) {
      commentEdge {
        node {
          id
          url
          body
          createdAt
          updatedAt
          author { login }
        }
      }
    }
  }
  """

  @type comment :: %{atom() => term()}

  @doc """
  Returns the issue comments for `repo` ("owner/name") and tracker `identifier`
  (e.g. `"#42"` or `"42"`), ordered oldest-first.
  """
  @spec for_issue(String.t() | nil, String.t() | nil, keyword()) ::
          {:ok, [comment()]} | {:error, term()}
  def for_issue(repo, identifier, opts \\ [])

  def for_issue(repo, identifier, opts) when is_binary(repo) and is_binary(identifier) do
    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         {:ok, number} <- parse_issue_number(identifier) do
      fetch(owner, name, number, opts)
    end
  end

  def for_issue(_repo, _identifier, _opts), do: {:error, :invalid_arguments}

  @doc """
  Posts a new comment on the GitHub issue and returns the created comment map.
  """
  @spec create(String.t() | nil, String.t() | nil, String.t(), keyword()) ::
          {:ok, comment()} | {:error, term()}
  def create(repo, identifier, body, opts \\ [])

  def create(repo, identifier, body, opts)
      when is_binary(repo) and is_binary(identifier) and is_binary(body) and body != "" do
    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         {:ok, number} <- parse_issue_number(identifier),
         {:ok, node_id} <- fetch_issue_node_id(owner, name, number, opts) do
      post_comment(node_id, body, opts)
    end
  end

  def create(_repo, _identifier, _body, _opts), do: {:error, :invalid_arguments}

  defp fetch_issue_node_id(owner, name, number, opts) do
    client = client_module(opts)
    graphql_opts = Keyword.take(opts, [:request_fun, :operation_name])
    variables = %{"owner" => owner, "name" => name, "number" => number}

    case client.graphql(@issue_node_query, variables, graphql_opts) do
      {:ok, %{"data" => %{"repository" => %{"issue" => %{"id" => id}}}}} when is_binary(id) ->
        {:ok, id}

      {:ok, _payload} ->
        {:error, :issue_not_found}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp post_comment(node_id, body, opts) do
    client = client_module(opts)
    graphql_opts = Keyword.take(opts, [:request_fun, :operation_name])
    variables = %{"subjectId" => node_id, "body" => body}

    case client.graphql(@add_comment_mutation, variables, graphql_opts) do
      {:ok, %{"data" => %{"addComment" => %{"commentEdge" => %{"node" => node}}}}}
      when is_map(node) ->
        {:ok, parse_node(node)}

      {:ok, _payload} ->
        {:error, :remote_unavailable}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp fetch(owner, name, number, opts) do
    client = client_module(opts)
    graphql_opts = Keyword.take(opts, [:request_fun, :operation_name])
    limit = Keyword.get(opts, :limit, @default_limit)

    variables = %{"owner" => owner, "name" => name, "number" => number, "limit" => limit}

    case client.graphql(@query, variables, graphql_opts) do
      {:ok, %{"data" => %{"repository" => %{"issue" => %{"comments" => %{"nodes" => nodes}}}}}}
      when is_list(nodes) ->
        {:ok, nodes |> Enum.map(&parse_node/1) |> Enum.reject(&is_nil/1)}

      {:ok, %{"data" => %{"repository" => %{"issue" => nil}}}} ->
        {:ok, []}

      {:ok, _payload} ->
        {:ok, []}

      {:error, {:github_graphql_errors, _}} ->
        # A pull-request number (or otherwise non-issue) yields a GraphQL
        # "Could not resolve to an Issue" error. Comments are non-critical, so
        # degrade to an empty list instead of failing the request.
        {:ok, []}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc false
  @spec parse_node(map() | nil) :: comment() | nil
  def parse_node(%{"body" => body} = node) when is_binary(body) do
    %{
      id: string_or_nil(Map.get(node, "id")),
      author: extract_author(node),
      body: body,
      kind: classify(body),
      url: string_or_nil(Map.get(node, "url")),
      created_at: string_or_nil(Map.get(node, "createdAt")),
      updated_at: string_or_nil(Map.get(node, "updatedAt"))
    }
  end

  def parse_node(_node), do: nil

  defp classify(body) do
    if Regex.match?(@workpad_pattern, body), do: "workpad", else: "comment"
  end

  defp extract_author(node) do
    case Map.get(node, "author") do
      %{"login" => login} when is_binary(login) and login != "" -> login
      _ -> nil
    end
  end

  defp parse_issue_number(identifier) do
    identifier
    |> String.trim()
    |> String.trim_leading("#")
    |> Integer.parse()
    |> case do
      {number, ""} when number > 0 -> {:ok, number}
      _ -> {:error, {:invalid_issue_identifier, identifier}}
    end
  end

  defp string_or_nil(value) when is_binary(value), do: value
  defp string_or_nil(_value), do: nil

  defp client_module(opts) do
    case Keyword.get(opts, :client_module) do
      nil -> Application.get_env(:symphony_elixir, :github_client_module, Client)
      module when is_atom(module) -> module
    end
  end
end
