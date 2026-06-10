defmodule SymphonyElixir.GitHub.IssueComments do
  @moduledoc """
  Fetches and posts the comments attached to a GitHub issue for the tracker UI,
  including the agent's `## Codex Workpad` comment. GitHub does not expose these
  through the local SQLite store, so the GitHub `IssueAdapter` reads them on demand.

  Transport (GraphQL with REST fallback) is delegated to `SymphonyElixir.GitHub.Api`;
  this module keeps the comment-shaping (`parse_node/1`) and tracker-facing guards.
  """

  alias SymphonyElixir.GitHub.Api

  @type comment :: %{atom() => term()}

  @doc """
  Returns the issue comments for `repo` ("owner/name") and tracker `identifier`
  (e.g. `"#42"` or `"42"`), ordered oldest-first.

  A pull-request number (or otherwise non-issue) yields a GraphQL
  "Could not resolve to an Issue" error; comments are non-critical, so this
  degrades to an empty list instead of failing the request.
  """
  @spec for_issue(String.t() | nil, String.t() | nil, keyword()) ::
          {:ok, [comment()]} | {:error, term()}
  def for_issue(repo, identifier, opts \\ []) do
    if is_binary(repo) and is_binary(identifier) do
      case Api.list_comments(repo, identifier, opts) do
        {:error, {:github_graphql_errors, _}} -> {:ok, []}
        other -> other
      end
    else
      {:error, :invalid_arguments}
    end
  end

  @doc """
  Posts a new comment on the GitHub issue and returns the created comment map.
  """
  @spec create(String.t() | nil, String.t() | nil, String.t(), keyword()) ::
          {:ok, comment()} | {:error, term()}
  def create(repo, identifier, body, opts \\ []) do
    if is_binary(repo) and is_binary(identifier) and is_binary(body) and body != "" do
      Api.add_comment(repo, identifier, body, opts)
    else
      {:error, :invalid_arguments}
    end
  end

  @doc """
  Edits an existing GitHub issue comment in place and returns the updated
  comment map. `remote_id` is the comment's GraphQL node id or REST numeric id.
  """
  @spec update(String.t() | nil, String.t() | nil, String.t(), keyword()) ::
          {:ok, comment()} | {:error, term()}
  def update(repo, remote_id, body, opts \\ []) do
    if is_binary(repo) and is_binary(remote_id) and remote_id != "" and is_binary(body) and body != "" do
      Api.update_comment(repo, remote_id, body, opts)
    else
      {:error, :invalid_arguments}
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

  defp classify(body), do: SymphonyElixir.Tracker.Workpad.classify(body)

  defp extract_author(node) do
    case Map.get(node, "author") do
      %{"login" => login} when is_binary(login) and login != "" -> login
      _ -> nil
    end
  end

  defp string_or_nil(value) when is_binary(value), do: value
  defp string_or_nil(_value), do: nil
end
