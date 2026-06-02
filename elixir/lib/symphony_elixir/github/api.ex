defmodule SymphonyElixir.GitHub.Api do
  @moduledoc """
  Resilient GitHub transport. Each operation runs on GraphQL first and, only when
  the GraphQL attempt is `{:rate_limited, _}`, transparently falls back to REST,
  normalizing both transports to one shape (F1 — pure fallback).

  Projects v2 board operations are GraphQL-only and are intentionally absent here;
  they stay in `GitHub.Client` and defer until reset.
  """

  require Logger
  alias SymphonyElixir.GitHub.{Client, IssueComments, RepoSpec}

  @type comment :: %{
          id: String.t() | nil,
          author: String.t() | nil,
          body: String.t(),
          kind: String.t(),
          url: String.t() | nil,
          created_at: String.t() | nil,
          updated_at: String.t() | nil
        }

  @add_comment_mutation """
  mutation SymphonyApiAddComment($subjectId: ID!, $body: String!) {
    addComment(input: { subjectId: $subjectId, body: $body }) {
      commentEdge { node { id url body createdAt updatedAt author { login } } }
    }
  }
  """

  @issue_node_query """
  query SymphonyApiIssueNodeId($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) { issue(number: $number) { id } }
  }
  """

  @list_comments_query """
  query SymphonyApiIssueComments($owner: String!, $name: String!, $number: Int!, $limit: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        comments(last: $limit) {
          nodes { id url body createdAt updatedAt author { login } }
        }
      }
    }
  }
  """

  @default_comment_limit 50

  @close_issue_mutation """
  mutation SymphonyApiCloseIssue($issueId: ID!) {
    closeIssue(input: { issueId: $issueId, stateReason: COMPLETED }) { issue { id state } }
  }
  """

  @reopen_issue_mutation """
  mutation SymphonyApiReopenIssue($issueId: ID!) {
    reopenIssue(input: { issueId: $issueId }) { issue { id state } }
  }
  """

  @label_page_size 50

  @issue_prs_query """
  query SymphonyApiIssuePRs($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        closedByPullRequestsReferences(first: 30) {
          nodes { number url title state merged }
        }
      }
    }
  }
  """

  @label_issues_query """
  query SymphonyApiLabelIssues($owner: String!, $name: String!, $label: String!, $first: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      issues(states: [OPEN], labels: [$label], first: $first, after: $after) {
        nodes { id number }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
  """

  @spec add_comment(String.t(), String.t(), String.t(), keyword()) ::
          {:ok, comment()} | {:error, term()}
  def add_comment(repo, identifier, body, opts \\ [])
      when is_binary(repo) and is_binary(identifier) and is_binary(body) do
    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         {:ok, number} <- parse_issue_number(identifier) do
      with_fallback(
        :add_comment,
        fn -> graphql_add_comment(owner, name, number, body, opts) end,
        fn -> rest_add_comment(owner, name, number, body, opts) end
      )
    end
  end

  @spec list_comments(String.t(), String.t(), keyword()) :: {:ok, [comment()]} | {:error, term()}
  def list_comments(repo, identifier, opts \\ []) when is_binary(repo) and is_binary(identifier) do
    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         {:ok, number} <- parse_issue_number(identifier) do
      with_fallback(
        :list_comments,
        fn -> graphql_list_comments(owner, name, number, opts) end,
        fn -> rest_list_comments(owner, name, number, opts) end
      )
    end
  end

  defp graphql_list_comments(owner, name, number, opts) do
    limit = Keyword.get(opts, :limit, @default_comment_limit)
    variables = %{"owner" => owner, "name" => name, "number" => number, "limit" => limit}

    case Client.graphql(@list_comments_query, variables, graphql_opts(opts)) do
      {:ok, %{"data" => %{"repository" => %{"issue" => %{"comments" => %{"nodes" => nodes}}}}}}
      when is_list(nodes) ->
        {:ok, nodes |> Enum.map(&IssueComments.parse_node/1) |> Enum.reject(&is_nil/1)}

      {:ok, %{"data" => %{"repository" => %{"issue" => nil}}}} ->
        {:ok, []}

      {:ok, _payload} ->
        {:ok, []}

      {:error, _} = error ->
        error
    end
  end

  defp rest_list_comments(owner, name, number, opts) do
    path = "/repos/#{owner}/#{name}/issues/#{number}/comments?per_page=100"

    case Client.rest_get(path, rest_opts(opts)) do
      {:ok, %{body: list}} when is_list(list) ->
        {:ok, list |> Enum.map(&normalize_rest_comment/1) |> Enum.reject(&is_nil/1)}

      {:error, _} = error ->
        error
    end
  end

  @spec list_issue_prs(String.t(), String.t(), String.t() | nil, keyword()) ::
          {:ok, [%{number: integer(), url: String.t() | nil, title: String.t() | nil, state: String.t()}]}
          | {:error, term()}
  def list_issue_prs(repo, identifier, branch, opts \\ []) when is_binary(repo) and is_binary(identifier) do
    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         {:ok, number} <- parse_issue_number(identifier) do
      with_fallback(
        :list_issue_prs,
        fn -> graphql_issue_prs(owner, name, number, opts) end,
        fn -> rest_issue_prs(owner, name, branch, opts) end
      )
    end
  end

  defp graphql_issue_prs(owner, name, number, opts) do
    variables = %{"owner" => owner, "name" => name, "number" => number}

    case Client.graphql(@issue_prs_query, variables, graphql_opts(opts)) do
      {:ok,
       %{
         "data" => %{
           "repository" => %{"issue" => %{"closedByPullRequestsReferences" => %{"nodes" => nodes}}}
         }
       }}
      when is_list(nodes) ->
        {:ok, Enum.flat_map(nodes, &normalize_graphql_pr/1)}

      {:ok, %{"data" => %{"repository" => %{"issue" => nil}}}} ->
        {:ok, []}

      {:ok, _payload} ->
        {:ok, []}

      {:error, _} = error ->
        error
    end
  end

  defp normalize_graphql_pr(%{"number" => number} = pr) when is_integer(number) do
    state =
      cond do
        pr["merged"] == true -> "merged"
        pr["state"] == "OPEN" -> "open"
        true -> "closed"
      end

    [%{number: number, url: pr["url"], title: pr["title"], state: state}]
  end

  defp normalize_graphql_pr(_pr), do: []

  defp rest_issue_prs(_owner, _name, nil, _opts), do: {:ok, []}

  defp rest_issue_prs(owner, name, branch, opts) do
    path = "/repos/#{owner}/#{name}/pulls?head=#{owner}:#{branch}&state=all&per_page=30"

    case Client.rest_get(path, rest_opts(opts)) do
      {:ok, %{body: list}} when is_list(list) ->
        {:ok, Enum.flat_map(list, &normalize_rest_pr/1)}

      {:error, _} = error ->
        error
    end
  end

  defp normalize_rest_pr(%{"number" => number} = pr) when is_integer(number) do
    state =
      cond do
        is_binary(pr["merged_at"]) -> "merged"
        pr["state"] == "open" -> "open"
        true -> "closed"
      end

    [%{number: number, url: pr["html_url"], title: pr["title"], state: state}]
  end

  defp normalize_rest_pr(_pr), do: []

  @spec list_label_issues(String.t(), String.t(), keyword()) ::
          {:ok, [%{number: integer(), node_id: String.t()}]} | {:error, term()}
  def list_label_issues(repo, label, opts \\ []) when is_binary(repo) and is_binary(label) do
    with {:ok, {owner, name}} <- RepoSpec.split(repo) do
      with_fallback(
        :list_label_issues,
        fn -> graphql_label_issues(owner, name, label, nil, [], opts) end,
        fn -> rest_label_issues(owner, name, label, 1, [], opts) end
      )
    end
  end

  defp graphql_label_issues(owner, name, label, after_cursor, acc, opts) do
    variables = %{
      "owner" => owner,
      "name" => name,
      "label" => label,
      "first" => @label_page_size,
      "after" => after_cursor
    }

    case Client.graphql(@label_issues_query, variables, graphql_opts(opts)) do
      {:ok, %{"data" => %{"repository" => %{"issues" => %{"nodes" => nodes, "pageInfo" => page}}}}}
      when is_list(nodes) ->
        rows = Enum.flat_map(nodes, &graphql_label_row/1)

        case page do
          %{"hasNextPage" => true, "endCursor" => cursor} when is_binary(cursor) and cursor != "" ->
            graphql_label_issues(owner, name, label, cursor, acc ++ rows, opts)

          _ ->
            {:ok, acc ++ rows}
        end

      {:ok, %{"data" => %{"repository" => nil}}} ->
        {:error, :github_repo_not_found}

      {:ok, _payload} ->
        {:error, :github_unknown_payload}

      {:error, _} = error ->
        error
    end
  end

  defp graphql_label_row(%{"id" => id, "number" => number}) when is_binary(id) and is_integer(number),
    do: [%{number: number, node_id: id}]

  defp graphql_label_row(_node), do: []

  defp rest_label_issues(owner, name, label, page, acc, opts) do
    path =
      "/repos/#{owner}/#{name}/issues?labels=#{URI.encode_www_form(label)}&state=open&per_page=100&page=#{page}"

    case Client.rest_get(path, rest_opts(opts)) do
      {:ok, %{body: list} = resp} when is_list(list) ->
        rows = Enum.flat_map(list, &rest_label_row/1)

        if rest_has_next_page?(resp) do
          rest_label_issues(owner, name, label, page + 1, acc ++ rows, opts)
        else
          {:ok, acc ++ rows}
        end

      {:error, _} = error ->
        error
    end
  end

  defp rest_label_row(%{"number" => number, "node_id" => node_id})
       when is_integer(number) and is_binary(node_id),
       do: [%{number: number, node_id: node_id}]

  defp rest_label_row(_item), do: []

  defp rest_has_next_page?(%{headers: headers}) do
    case header_value(headers, "link") do
      link when is_binary(link) -> String.contains?(link, "rel=\"next\"")
      _ -> false
    end
  end

  defp rest_has_next_page?(_resp), do: false

  defp header_value(headers, name) when is_map(headers) do
    case Map.get(headers, name) do
      [value | _] when is_binary(value) -> value
      value when is_binary(value) -> value
      _ -> nil
    end
  end

  defp header_value(headers, name) when is_list(headers) do
    Enum.find_value(headers, fn
      {key, value} -> if String.downcase(to_string(key)) == name, do: to_string(value)
      _ -> nil
    end)
  end

  defp header_value(_headers, _name), do: nil

  @spec transition_issue_open_state(String.t(), String.t(), :close | :reopen, keyword()) ::
          {:ok, %{state: String.t()}} | {:error, term()}
  def transition_issue_open_state(repo, issue_node_id, action, opts \\ [])
      when is_binary(repo) and is_binary(issue_node_id) and action in [:close, :reopen] do
    with {:ok, {owner, name}} <- RepoSpec.split(repo) do
      with_fallback(
        :transition_issue_open_state,
        fn -> graphql_transition(issue_node_id, action, opts) end,
        fn -> rest_transition(owner, name, action, opts) end
      )
    end
  end

  defp graphql_transition(issue_node_id, action, opts) do
    {mutation, key} =
      case action do
        :close -> {@close_issue_mutation, "closeIssue"}
        :reopen -> {@reopen_issue_mutation, "reopenIssue"}
      end

    case Client.graphql(mutation, %{"issueId" => issue_node_id}, graphql_opts(opts)) do
      {:ok, %{"data" => %{^key => %{"issue" => %{"state" => state}}}}} when is_binary(state) ->
        {:ok, %{state: state}}

      {:ok, _payload} ->
        {:error, :remote_unavailable}

      {:error, _} = error ->
        error
    end
  end

  defp rest_transition(owner, name, action, opts) do
    case Keyword.get(opts, :issue_number) do
      number when is_integer(number) ->
        state = if action == :close, do: "closed", else: "open"
        path = "/repos/#{owner}/#{name}/issues/#{number}"

        case Client.rest_put(path, %{"state" => state}, rest_opts(opts)) do
          {:ok, %{body: %{"state" => rest_state}}} when is_binary(rest_state) ->
            {:ok, %{state: String.upcase(rest_state)}}

          {:ok, _other} ->
            {:error, :remote_unavailable}

          {:error, _} = error ->
            error
        end

      _ ->
        {:error, {:rate_limited, %{reset_at: nil, capability: :needs_issue_number}}}
    end
  end

  defp graphql_add_comment(owner, name, number, body, opts) do
    graphql_opts = graphql_opts(opts)

    with {:ok, node_id} <- fetch_issue_node_id(owner, name, number, graphql_opts),
         {:ok, %{"data" => %{"addComment" => %{"commentEdge" => %{"node" => node}}}}} <-
           Client.graphql(@add_comment_mutation, %{"subjectId" => node_id, "body" => body}, graphql_opts) do
      {:ok, IssueComments.parse_node(node)}
    else
      {:ok, _unexpected} -> {:error, :remote_unavailable}
      {:error, _} = error -> error
    end
  end

  defp fetch_issue_node_id(owner, name, number, graphql_opts) do
    variables = %{"owner" => owner, "name" => name, "number" => number}

    case Client.graphql(@issue_node_query, variables, graphql_opts) do
      {:ok, %{"data" => %{"repository" => %{"issue" => %{"id" => id}}}}} when is_binary(id) -> {:ok, id}
      {:ok, _payload} -> {:error, :issue_not_found}
      {:error, _} = error -> error
    end
  end

  defp rest_add_comment(owner, name, number, body, opts) do
    path = "/repos/#{owner}/#{name}/issues/#{number}/comments"

    case Client.rest_post(path, %{"body" => body}, rest_opts(opts)) do
      {:ok, %{body: raw}} when is_map(raw) -> {:ok, normalize_rest_comment(raw)}
      {:error, _} = error -> error
    end
  end

  defp normalize_rest_comment(raw) do
    IssueComments.parse_node(%{
      "id" => stringify_id(raw["id"]),
      "url" => raw["html_url"],
      "body" => raw["body"],
      "createdAt" => raw["created_at"],
      "updatedAt" => raw["updated_at"],
      "author" => raw["user"]
    })
  end

  # -- Fallback combinator (F1) ----------------------------------------------

  defp with_fallback(op, graphql_fun, rest_fun) do
    case graphql_fun.() do
      {:ok, _} = ok ->
        ok

      {:error, {:rate_limited, info}} ->
        Logger.info("GitHub.Api fallback: op=#{op} transport=rest reason=graphql_rate_limited")

        case rest_fun.() do
          {:ok, _} = ok -> ok
          {:error, {:rate_limited, info2}} -> {:error, {:rate_limited, merge_reset(info, info2)}}
          {:error, _} = error -> error
        end

      {:error, _} = error ->
        error
    end
  end

  defp merge_reset(info, info2) when is_map(info) and is_map(info2) do
    info
    |> Map.merge(info2)
    |> Map.put(:reset_at, later_reset(Map.get(info, :reset_at), Map.get(info2, :reset_at)))
  end

  defp merge_reset(info, _other), do: info

  defp later_reset(%DateTime{} = a, %DateTime{} = b), do: if(DateTime.compare(a, b) == :gt, do: a, else: b)
  defp later_reset(%DateTime{} = a, _b), do: a
  defp later_reset(_a, b), do: b

  # -- shared helpers ---------------------------------------------------------

  defp graphql_opts(opts), do: Keyword.take(opts, [:request_fun, :operation_name])

  defp rest_opts(opts) do
    case Keyword.get(opts, :rest_request_fun) do
      fun when is_function(fun) -> [request_fun: fun]
      _ -> []
    end
  end

  defp stringify_id(id) when is_integer(id), do: Integer.to_string(id)
  defp stringify_id(id) when is_binary(id), do: id
  defp stringify_id(_id), do: nil

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
end
