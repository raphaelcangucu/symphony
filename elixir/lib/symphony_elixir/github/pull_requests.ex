defmodule SymphonyElixir.GitHub.PullRequests do
  @moduledoc """
  Resolves the pull request(s) related to a GitHub issue along with their CI
  pipelines (check suites / workflow runs), individual jobs (check runs), legacy
  commit statuses, and the PR conversation (comments + reviews).

  Linkage is derived at read time via GraphQL — Symphony does not persist PR
  numbers. We first look at `closedByPullRequestsReferences` (PRs that reference
  the issue via closing keywords). When none are found we fall back to matching
  PRs by the issue's linked branch name.
  """

  alias SymphonyElixir.GitHub.{Client, Config, RepoSpec}

  require Logger

  @max_related_prs 10
  @max_branch_prs 5
  @max_contexts 100
  @max_conversation 20

  @pr_fields """
  number
  title
  url
  state
  isDraft
  merged
  mergedAt
  createdAt
  updatedAt
  headRefName
  baseRefName
  author { login }
  commits(last: 1) {
    nodes {
      commit {
        oid
        statusCheckRollup {
          state
          contexts(first: #{@max_contexts}) {
            nodes {
              __typename
              ... on CheckRun {
                name
                status
                conclusion
                detailsUrl
                startedAt
                completedAt
                checkSuite {
                  workflowRun {
                    url
                    workflow { name }
                  }
                }
              }
              ... on StatusContext {
                context
                state
                targetUrl
                description
                createdAt
              }
            }
          }
        }
      }
    }
  }
  comments(last: 10) {
    nodes { author { login } body createdAt }
  }
  reviews(last: 10) {
    nodes { author { login } body state createdAt }
  }
  """

  @issue_query """
  query SymphonyTrackerIssuePullRequests($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        linkedBranches(first: 1) { nodes { ref { name } } }
        closedByPullRequestsReferences(first: #{@max_related_prs}, includeClosedPrs: true) {
          nodes { #{@pr_fields} }
        }
      }
    }
  }
  """

  @branch_query """
  query SymphonyTrackerBranchPullRequests($owner: String!, $name: String!, $branch: String!) {
    repository(owner: $owner, name: $name) {
      pullRequests(headRefName: $branch, first: #{@max_branch_prs}, orderBy: {field: UPDATED_AT, direction: DESC}) {
        nodes { #{@pr_fields} }
      }
    }
  }
  """

  @type pull_request :: %{atom() => term()}

  @doc """
  Fetches related pull requests for the given `repo` ("owner/name") and tracker
  `identifier` (e.g. `"#42"` or `"42"`).

  Returns `{:ok, [pull_request]}` on success, an empty list when nothing is
  linked, or `{:error, reason}` for transport/config failures.
  """
  @spec for_issue(String.t() | nil, String.t() | nil, keyword()) ::
          {:ok, [pull_request()]} | {:error, term()}
  def for_issue(repo, identifier, opts \\ [])

  def for_issue(repo, identifier, opts) when is_binary(repo) and is_binary(identifier) do
    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         {:ok, number} <- parse_issue_number(identifier) do
      fetch_for_issue(owner, name, number, opts)
    end
  end

  def for_issue(_repo, _identifier, _opts), do: {:error, :invalid_arguments}

  defp fetch_for_issue(owner, name, number, opts) do
    client = client_module(opts)
    graphql_opts = Keyword.take(opts, [:request_fun, :operation_name])

    variables = %{"owner" => owner, "name" => name, "number" => number}

    case client.graphql(@issue_query, variables, graphql_opts) do
      {:ok, %{"data" => %{"repository" => %{"issue" => issue}}}} when is_map(issue) ->
        resolve_from_issue(issue, owner, name, opts)

      {:ok, %{"data" => %{"repository" => %{"issue" => nil}}}} ->
        {:ok, []}

      {:ok, payload} ->
        Logger.warning("Unexpected GitHub PR payload: #{inspect(payload)}")
        {:ok, []}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp resolve_from_issue(issue, owner, name, opts) do
    prs =
      issue
      |> Map.get("closedByPullRequestsReferences", %{})
      |> Map.get("nodes", [])
      |> List.wrap()
      |> Enum.map(&parse_pr_node/1)
      |> Enum.reject(&is_nil/1)

    case prs do
      [_ | _] -> {:ok, sort_prs(prs)}
      [] -> fetch_by_branch(extract_branch(issue), owner, name, opts)
    end
  end

  defp fetch_by_branch(nil, _owner, _name, _opts), do: {:ok, []}

  defp fetch_by_branch(branch, owner, name, opts) when is_binary(branch) do
    client = client_module(opts)
    graphql_opts = Keyword.take(opts, [:request_fun, :operation_name])
    variables = %{"owner" => owner, "name" => name, "branch" => branch}

    case client.graphql(@branch_query, variables, graphql_opts) do
      {:ok, %{"data" => %{"repository" => %{"pullRequests" => %{"nodes" => nodes}}}}}
      when is_list(nodes) ->
        prs =
          nodes
          |> Enum.map(&parse_pr_node/1)
          |> Enum.reject(&is_nil/1)

        {:ok, sort_prs(prs)}

      {:ok, _payload} ->
        {:ok, []}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  Pure parser: converts a GraphQL PullRequest node into the JSON-ready map.

  Exposed for unit tests.
  """
  @spec parse_pr_node(map() | nil) :: pull_request() | nil
  def parse_pr_node(%{"number" => number} = node) when is_integer(number) do
    rollup = extract_rollup(node)

    %{
      number: number,
      title: string_or_nil(Map.get(node, "title")),
      url: string_or_nil(Map.get(node, "url")),
      state: derive_state(node),
      raw_state: string_or_nil(Map.get(node, "state")),
      is_draft: Map.get(node, "isDraft") == true,
      merged: Map.get(node, "merged") == true,
      head_ref: string_or_nil(Map.get(node, "headRefName")),
      base_ref: string_or_nil(Map.get(node, "baseRefName")),
      author: extract_author(node),
      created_at: string_or_nil(Map.get(node, "createdAt")),
      updated_at: string_or_nil(Map.get(node, "updatedAt")),
      merged_at: string_or_nil(Map.get(node, "mergedAt")),
      checks_state: string_or_nil(Map.get(rollup, "state")),
      pipelines: build_pipelines(rollup),
      statuses: build_statuses(rollup),
      conversation: build_conversation(node)
    }
  end

  def parse_pr_node(_node), do: nil

  defp extract_rollup(node) do
    node
    |> get_in_safe(["commits", "nodes"])
    |> List.wrap()
    |> List.first()
    |> case do
      %{"commit" => %{"statusCheckRollup" => rollup}} when is_map(rollup) -> rollup
      _ -> %{}
    end
  end

  defp build_pipelines(rollup) do
    rollup
    |> rollup_contexts()
    |> Enum.filter(&check_run?/1)
    |> Enum.group_by(&pipeline_name/1, &check_run_to_job/1)
    |> Enum.map(fn {{name, url}, jobs} ->
      %{name: name, url: url, jobs: jobs}
    end)
    |> Enum.sort_by(& &1.name)
  end

  defp build_statuses(rollup) do
    rollup
    |> rollup_contexts()
    |> Enum.filter(&status_context?/1)
    |> Enum.map(fn ctx ->
      %{
        context: string_or_nil(Map.get(ctx, "context")),
        state: string_or_nil(Map.get(ctx, "state")),
        url: string_or_nil(Map.get(ctx, "targetUrl")),
        description: string_or_nil(Map.get(ctx, "description"))
      }
    end)
  end

  defp rollup_contexts(rollup) do
    rollup
    |> get_in_safe(["contexts", "nodes"])
    |> List.wrap()
    |> Enum.filter(&is_map/1)
  end

  defp check_run?(%{"__typename" => "CheckRun"}), do: true
  defp check_run?(_), do: false

  defp status_context?(%{"__typename" => "StatusContext"}), do: true
  defp status_context?(_), do: false

  defp pipeline_name(check_run) do
    case get_in_safe(check_run, ["checkSuite", "workflowRun"]) do
      %{"workflow" => %{"name" => name}} = run when is_binary(name) and name != "" ->
        {name, string_or_nil(Map.get(run, "url"))}

      _ ->
        {"Checks", nil}
    end
  end

  defp check_run_to_job(check_run) do
    %{
      name: string_or_nil(Map.get(check_run, "name")),
      status: string_or_nil(Map.get(check_run, "status")),
      conclusion: string_or_nil(Map.get(check_run, "conclusion")),
      url: string_or_nil(Map.get(check_run, "detailsUrl")),
      started_at: string_or_nil(Map.get(check_run, "startedAt")),
      completed_at: string_or_nil(Map.get(check_run, "completedAt"))
    }
  end

  defp build_conversation(node) do
    comments =
      node
      |> get_in_safe(["comments", "nodes"])
      |> List.wrap()
      |> Enum.flat_map(&conversation_entry(&1, "comment", nil))

    reviews =
      node
      |> get_in_safe(["reviews", "nodes"])
      |> List.wrap()
      |> Enum.flat_map(fn review ->
        conversation_entry(review, "review", string_or_nil(Map.get(review, "state")))
      end)

    (comments ++ reviews)
    |> Enum.sort_by(& &1.created_at)
    |> Enum.take(-@max_conversation)
  end

  defp conversation_entry(node, kind, review_state) when is_map(node) do
    body = node |> Map.get("body") |> trim_or_nil()

    if is_nil(body) do
      []
    else
      [
        %{
          author: extract_author(node),
          body: body,
          kind: kind,
          review_state: review_state,
          created_at: string_or_nil(Map.get(node, "createdAt"))
        }
      ]
    end
  end

  defp conversation_entry(_node, _kind, _state), do: []

  defp derive_state(node) do
    cond do
      Map.get(node, "merged") == true -> "merged"
      Map.get(node, "isDraft") == true and Map.get(node, "state") == "OPEN" -> "draft"
      Map.get(node, "state") == "OPEN" -> "open"
      Map.get(node, "state") == "CLOSED" -> "closed"
      true -> "unknown"
    end
  end

  defp extract_author(node) do
    case Map.get(node, "author") do
      %{"login" => login} when is_binary(login) and login != "" -> login
      _ -> nil
    end
  end

  defp extract_branch(issue) do
    case get_in_safe(issue, ["linkedBranches", "nodes"]) do
      [%{"ref" => %{"name" => name}} | _] when is_binary(name) and name != "" -> name
      _ -> nil
    end
  end

  defp sort_prs(prs) do
    Enum.sort_by(prs, & &1.updated_at, &>=/2)
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

  defp get_in_safe(map, path) when is_map(map), do: get_in(map, path)
  defp get_in_safe(_map, _path), do: nil

  defp string_or_nil(value) when is_binary(value), do: value
  defp string_or_nil(_value), do: nil

  defp trim_or_nil(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp trim_or_nil(_value), do: nil

  defp client_module(opts) do
    case Keyword.get(opts, :client_module) do
      nil -> Application.get_env(:symphony_elixir, :github_client_module, Client)
      module when is_atom(module) -> module
    end
  end

  @doc false
  @spec resolve_repo(SymphonyElixir.LocalTracker.Project.t()) :: {:ok, String.t()} | {:error, term()}
  def resolve_repo(%SymphonyElixir.LocalTracker.Project{tracker_kind: "github", tracker_config: cfg}) do
    case Map.get(cfg || %{}, "repo") do
      repo when is_binary(repo) ->
        case String.trim(repo) do
          "" -> {:error, :missing_github_repo}
          trimmed -> {:ok, trimmed}
        end

      _ ->
        {:error, :missing_github_repo}
    end
  end

  def resolve_repo(%SymphonyElixir.LocalTracker.Project{tracker_kind: kind}) do
    {:error, {:unsupported_tracker_kind, kind}}
  end

  @doc """
  Returns true when `Config.token/0` is available (PR checks require auth).
  """
  @spec available?() :: boolean()
  def available?, do: is_binary(Config.token())
end
