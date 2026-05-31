defmodule SymphonyElixir.GitHub.IssueDiscussion do
  @moduledoc """
  Loads recent issue and pull-request discussion for agent prompts.
  """

  alias SymphonyElixir.GitHub.{Client, Config, ReadCache, RepoSpec}
  alias SymphonyElixir.Issue

  @pr_discussion_query """
  query SymphonyGitHubIssuePRDiscussion($owner: String!, $name: String!, $number: Int!, $commentLimit: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        closedByPullRequestsReferences(first: 5) {
          nodes {
            ... on PullRequest {
              number
              title
              comments(last: $commentLimit) {
                nodes {
                  author { login }
                  body
                  createdAt
                }
              }
              reviews(last: 10) {
                nodes {
                  author { login }
                  body
                  state
                  createdAt
                }
              }
              reviewThreads(last: 20) {
                nodes {
                  comments(last: $commentLimit) {
                    nodes {
                      author { login }
                      body
                      createdAt
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  """

  @type comment_map :: %{
          required(:author) => String.t(),
          required(:body) => String.t(),
          required(:created_at) => String.t(),
          required(:source) => String.t()
        }

  @doc """
  Parses issue-thread comments from a GraphQL Issue `content` node.
  """
  @spec parse_issue_comments(map()) :: [comment_map()]
  def parse_issue_comments(content) when is_map(content) do
    content
    |> Map.get("comments", %{})
    |> comment_nodes_to_maps("issue")
    |> trim_to_limit()
  end

  def parse_issue_comments(_content), do: []

  @doc """
  Appends pull-request review and comment context for each issue (best-effort).
  """
  @spec enrich_issues([Issue.t()], String.t(), keyword()) :: [Issue.t()]
  def enrich_issues(issues, repo, opts) when is_list(issues) and is_binary(repo) do
    case RepoSpec.split(repo) do
      {:ok, {owner, name}} ->
        Enum.map(issues, &enrich_issue_pr_feedback(&1, owner, name, opts))

      {:error, _} ->
        issues
    end
  end

  def enrich_issues(issues, _repo, _opts), do: issues

  defp enrich_issue_pr_feedback(%Issue{} = issue, owner, name, opts) do
    if Keyword.get(opts, :enrich_pr_discussion, true) do
      with number when is_integer(number) <- parse_issue_number(issue.identifier),
           pr_comments when is_list(pr_comments) <-
             safe_fetch_pr_discussion_comments(owner, name, number, opts) do
        merged =
          (issue.comments || [])
          |> Kernel.++(pr_comments)
          |> dedupe_comments()
          |> trim_to_limit()

        %{issue | comments: merged}
      else
        _ -> issue
      end
    else
      issue
    end
  end

  defp safe_fetch_pr_discussion_comments(owner, name, number, opts) do
    # Cached read-through (single source of truth) so dispatch-time enrichment and the
    # UI's on-open enrichment never duplicate the same GitHub call within the TTL window.
    cache_key = {:issue_pr_discussion, owner, name, number}

    case ReadCache.fetch(cache_key, fn -> {:ok, fetch_pr_discussion_comments(owner, name, number, opts)} end) do
      {:ok, comments} when is_list(comments) -> comments
      _ -> []
    end
  rescue
    _ -> []
  end

  defp fetch_pr_discussion_comments(owner, name, number, opts) do
    client = client_module(opts)
    graphql_opts = Keyword.take(opts, [:request_fun, :operation_name])
    limit = Config.comment_context_limit()

    variables = %{
      "owner" => owner,
      "name" => name,
      "number" => number,
      "commentLimit" => limit
    }

    case client.graphql(@pr_discussion_query, variables, graphql_opts) do
      {:ok, %{"data" => %{"repository" => %{"issue" => %{} = issue}}}} ->
        issue
        |> Map.get("closedByPullRequestsReferences", %{})
        |> Map.get("nodes", [])
        |> List.wrap()
        |> Enum.flat_map(&pr_node_to_comment_maps/1)
        |> Enum.reject(&blank_comment?/1)

      _ ->
        []
    end
  end

  defp pr_node_to_comment_maps(%{"number" => pr_number} = pr) when is_integer(pr_number) do
    prefix = "PR ##{pr_number}"

    pr_general =
      pr
      |> Map.get("comments", %{})
      |> comment_nodes_to_maps("#{prefix} comment")

    pr_reviews =
      pr
      |> Map.get("reviews", %{})
      |> Map.get("nodes", [])
      |> List.wrap()
      |> Enum.flat_map(fn
        %{"body" => body, "state" => state} = review when is_binary(body) and body != "" ->
          author = review |> Map.get("author", %{}) |> Map.get("login", "unknown")
          created_at = Map.get(review, "createdAt", "")

          [
            %{
              "author" => author,
              "body" => String.trim(body),
              "created_at" => created_at,
              "source" => "#{prefix} review (#{state})"
            }
          ]

        _ ->
          []
      end)

    pr_threads =
      pr
      |> Map.get("reviewThreads", %{})
      |> Map.get("nodes", [])
      |> List.wrap()
      |> Enum.flat_map(fn thread ->
        thread
        |> Map.get("comments", %{})
        |> comment_nodes_to_maps("#{prefix} review thread")
      end)

    pr_general ++ pr_reviews ++ pr_threads
  end

  defp pr_node_to_comment_maps(_), do: []

  defp comment_nodes_to_maps(%{"nodes" => nodes}, source) when is_list(nodes) do
    Enum.flat_map(nodes, fn node -> comment_node_to_map(node, source) end)
  end

  defp comment_nodes_to_maps(_, _source), do: []

  defp comment_node_to_map(%{"body" => body} = node, source) when is_binary(body) do
    trimmed = String.trim(body)

    if trimmed == "" do
      []
    else
      author = node |> Map.get("author", %{}) |> Map.get("login", "unknown")

      [
        %{
          "author" => author,
          "body" => trimmed,
          "created_at" => Map.get(node, "createdAt", ""),
          "source" => source
        }
      ]
    end
  end

  defp comment_node_to_map(_node, _source), do: []

  defp dedupe_comments(comments) do
    comments
    |> Enum.uniq_by(fn comment ->
      {Map.get(comment, "author"), Map.get(comment, "source"), Map.get(comment, "body")}
    end)
  end

  defp trim_to_limit(comments) do
    limit = Config.comment_context_limit()
    comments |> Enum.take(-limit)
  end

  defp blank_comment?(%{"body" => body}) when is_binary(body), do: String.trim(body) == ""
  defp blank_comment?(_), do: true

  defp parse_issue_number(identifier) when is_binary(identifier) do
    identifier
    |> String.trim()
    |> case do
      "" ->
        :error

      trimmed ->
        case Integer.parse(trimmed) do
          {number, ""} when number > 0 -> number
          _ -> :error
        end
    end
  end

  defp parse_issue_number(_), do: :error

  defp client_module(opts) do
    case Keyword.get(opts, :client_module) do
      nil -> Application.get_env(:symphony_elixir, :github_client_module, Client)
      module when is_atom(module) -> module
    end
  end
end
