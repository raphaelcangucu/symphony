defmodule SymphonyElixir.GitHub.PullRequests do
  @moduledoc """
  Resolves the pull request(s) related to a GitHub issue along with their CI
  pipelines (check suites / workflow runs), individual jobs (check runs), legacy
  commit statuses, and the PR conversation (comments + reviews).

  Linkage is derived at read time via GraphQL — Symphony does not persist PR
  numbers. Resolution tries three strategies in order:

  1. `closedByPullRequestsReferences` (PRs that close the issue via closing
     keywords). GitHub only registers these when the PR targets the repo's
     default branch.
  2. PRs matching the issue's linked branch name.
  3. Same-repository cross-referenced PRs from the issue timeline (the relation
     the GitHub Projects board surfaces), which also covers PRs whose closing
     keyword does not register because they target a non-default base branch.
  """

  alias SymphonyElixir.GitHub.{BranchStatus, Client, Config, IssueRepo, RepoSpec}
  alias SymphonyElixir.LocalTracker.{Context, Project}

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
  repository { nameWithOwner }
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
                databaseId
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
        timelineItems(last: #{@max_related_prs}, itemTypes: [CROSS_REFERENCED_EVENT]) {
          nodes {
            ... on CrossReferencedEvent {
              isCrossRepository
              source {
                __typename
                ... on PullRequest { #{@pr_fields} }
              }
            }
          }
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

  @pull_query """
  query SymphonyPullRequestByNumber($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) { #{@pr_fields} }
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
  def for_issue(repo, identifier, opts \\ []) do
    if is_binary(repo) and is_binary(identifier) do
      with {:ok, {owner, name}} <- RepoSpec.split(repo),
           {:ok, number} <- parse_issue_number(identifier),
           {:ok, prs} <- fetch_for_issue(owner, name, number, opts) do
        prs =
          if Keyword.get(opts, :annotate, true) do
            annotate_branch_status(prs, repo, opts)
          else
            prs
          end

        {:ok, prs}
      end
    else
      {:error, :invalid_arguments}
    end
  end

  @doc """
  Fetches related pull requests for a tracker issue in a multi-repo project.

  Resolves the repository that owns the issue (see `GitHub.IssueRepo`), runs the
  standard issue-scoped strategies there, then searches configured workspace
  repositories for open PRs whose head branch matches the issue's linked branch
  or common agent naming patterns (e.g. `codex/3984-*`).
  """
  @spec for_project_issue(Project.t(), String.t(), keyword()) ::
          {:ok, [pull_request()]} | {:error, term()}
  def for_project_issue(%Project{} = project, identifier, opts \\ []) when is_binary(identifier) do
    with {:ok, issue_repo} <- IssueRepo.resolve(project, identifier, opts),
         {:ok, number} <- parse_issue_number(identifier),
         {:ok, issue_prs} <- for_issue(issue_repo, identifier, Keyword.put(opts, :annotate, false)),
         branch_prs <- search_branch_linked_prs(project, identifier, number, opts) do
      merged =
        (issue_prs ++ branch_prs)
        |> dedupe_by_url()
        |> sort_prs()
        |> annotate_branch_status_per_repo(opts)

      {:ok, merged}
    end
  end

  @doc """
  Fetches a single pull request (including its CI rollup) by `repo` ("owner/name")
  and `number`. Used to enrich PRs that issue-scoped discovery cannot surface
  (cross-repo / non-default base branch), so manually-linked PRs still show
  checks.

  Returns `{:ok, pull_request}` when found, `{:ok, nil}` when the PR does not
  exist or is not visible, or `{:error, reason}` on transport/config failures.
  """
  @spec for_pull_request(String.t() | nil, integer() | nil, keyword()) ::
          {:ok, pull_request() | nil} | {:error, term()}
  def for_pull_request(repo, number, opts \\ []) do
    if is_binary(repo) and is_integer(number) and number > 0 do
      with {:ok, {owner, name}} <- RepoSpec.split(repo) do
        fetch_pull_request(owner, name, number, opts)
      end
    else
      {:error, :invalid_arguments}
    end
  end

  defp fetch_pull_request(owner, name, number, opts) do
    client = client_module(opts)
    graphql_opts = Keyword.take(opts, [:request_fun, :operation_name])
    variables = %{"owner" => owner, "name" => name, "number" => number}

    case client.graphql(@pull_query, variables, graphql_opts) do
      {:ok, %{"data" => %{"repository" => %{"pullRequest" => node}}}} when is_map(node) ->
        {:ok, parse_pr_node(node)}

      {:ok, %{"data" => %{"repository" => %{"pullRequest" => nil}}}} ->
        {:ok, nil}

      {:ok, _payload} ->
        {:ok, nil}

      {:error, reason} ->
        {:error, reason}
    end
  end

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
    closing = extract_closing_prs(issue)
    cross_referenced = extract_cross_referenced_prs(issue)

    branch_prs =
      case fetch_by_branch(extract_branch(issue), owner, name, opts) do
        {:ok, prs} -> prs
        {:error, _reason} -> []
      end

    merged =
      (closing ++ branch_prs ++ cross_referenced)
      |> dedupe_by_url()
      |> sort_prs()

    {:ok, merged}
  end

  defp dedupe_by_url(prs) do
    Enum.uniq_by(prs, fn pr -> pr.url || {pr.repo, pr.number} end)
  end

  defp extract_closing_prs(issue) do
    issue
    |> get_in_safe(["closedByPullRequestsReferences", "nodes"])
    |> List.wrap()
    |> Enum.map(&parse_pr_node/1)
    |> Enum.reject(&is_nil/1)
    |> dedupe_by_url()
  end

  defp extract_cross_referenced_prs(issue) do
    issue
    |> get_in_safe(["timelineItems", "nodes"])
    |> List.wrap()
    |> Enum.map(&cross_referenced_pr_node/1)
    |> Enum.map(&parse_pr_node/1)
    |> Enum.reject(&is_nil/1)
    |> dedupe_by_url()
  end

  defp cross_referenced_pr_node(%{"source" => %{"__typename" => "PullRequest"} = pr}), do: pr
  defp cross_referenced_pr_node(_event), do: nil

  defp search_branch_linked_prs(%Project{} = project, identifier, issue_number, opts) do
    branch_name = local_branch_name(project, identifier)
    prefixes = branch_search_prefixes(issue_number, branch_name)

    project
    |> configured_repos()
    |> Enum.flat_map(fn repo ->
      prefixes
      |> Enum.flat_map(&search_prs_by_head_prefix(repo, &1, opts))
      |> Enum.flat_map(&fetch_search_hit/1)
    end)
    |> dedupe_by_url()
  end

  defp configured_repos(%Project{} = project) do
    IssueRepo.candidate_repos(project, "")
  end

  defp local_branch_name(%Project{slug: slug}, identifier) do
    case Context.get_issue(slug, identifier) do
      {:ok, %{branch_name: branch}} when is_binary(branch) and branch != "" -> branch
      _ -> nil
    end
  end

  defp branch_search_prefixes(issue_number, branch_name) do
    agent_prefix = "codex/#{issue_number}"

    []
    |> prepend_string(branch_name)
    |> prepend_string(agent_prefix)
    |> Enum.uniq()
  end

  defp prepend_string(list, value) when is_binary(value) and value != "", do: [value | list]
  defp prepend_string(list, _), do: list

  defp search_prs_by_head_prefix(repo, prefix, opts) do
    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         {:ok, %{body: %{"items" => items}}} <- search_issues("#{owner}/#{name}", prefix, opts),
         true <- is_list(items) do
      items
      |> Enum.filter(&is_map/1)
      |> Enum.filter(&(Map.get(&1, "pull_request") != nil))
      |> Enum.map(fn item ->
        number = Map.get(item, "number")
        if is_integer(number) and number > 0, do: {repo, number}, else: nil
      end)
      |> Enum.reject(&is_nil/1)
    else
      _ -> []
    end
  end

  defp search_issues(repo, head_prefix, opts) do
    query = "repo:#{repo} type:pr head:#{head_prefix}"
    path = "/search/issues?" <> URI.encode_query(%{"q" => query, "per_page" => "5"})
    client = client_module(opts)
    rest_opts = Keyword.take(opts, [:request_fun])

    if function_exported?(client, :rest_get, 2) do
      client.rest_get(path, rest_opts)
    else
      {:error, :rest_unavailable}
    end
  end

  defp fetch_search_hit({repo, number}) do
    case for_pull_request(repo, number, annotate: false) do
      {:ok, pr} when is_map(pr) -> [pr]
      _ -> []
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
      head_sha: extract_head_sha(node),
      head_ref: string_or_nil(Map.get(node, "headRefName")),
      base_ref: string_or_nil(Map.get(node, "baseRefName")),
      author: extract_author(node),
      repo: extract_repo(node),
      created_at: string_or_nil(Map.get(node, "createdAt")),
      updated_at: string_or_nil(Map.get(node, "updatedAt")),
      merged_at: string_or_nil(Map.get(node, "mergedAt")),
      checks_state: string_or_nil(Map.get(rollup, "state")),
      pipelines: build_pipelines(rollup),
      statuses: build_statuses(rollup),
      conversation: build_conversation(node),
      base_behind_by: nil
    }
  end

  def parse_pr_node(_node), do: nil

  @doc """
  Fills `:base_behind_by` for open/draft PRs by comparing each PR's head branch
  against its base via `BranchStatus`. Closed/merged PRs and compare failures are
  left as `nil`. Skipped entirely when the resolved client cannot perform REST
  reads (graphql-only test stubs).
  """
  @spec annotate_branch_status([pull_request()], String.t(), keyword()) :: [pull_request()]
  def annotate_branch_status(prs, repo, opts \\ []) when is_list(prs) and is_binary(repo) do
    annotate_branch_status_per_repo(prs, Keyword.put(opts, :default_repo, repo))
  end

  defp annotate_branch_status_per_repo(prs, opts) when is_list(prs) do
    client = client_module(opts)
    default_repo = Keyword.get(opts, :default_repo)

    if function_exported?(client, :rest_get, 2) do
      branch_opts = build_branch_opts(client, opts)

      Enum.map(prs, fn pr ->
        repo = Map.get(pr, :repo) || default_repo
        behind = if is_binary(repo), do: behind_for(pr, repo, branch_opts), else: nil
        Map.put(pr, :base_behind_by, behind)
      end)
    else
      prs
    end
  end

  defp build_branch_opts(client, opts) do
    base = [client_module: client]

    case Keyword.get(opts, :branch_status_request_fun) do
      fun when is_function(fun, 2) -> Keyword.put(base, :request_fun, fun)
      _ -> base
    end
  end

  defp behind_for(%{state: state, base_ref: base, head_ref: head}, repo, branch_opts)
       when state in ["open", "draft"] and is_binary(base) and is_binary(head) do
    case BranchStatus.behind_by(repo, base, head, branch_opts) do
      {:ok, behind} -> behind
      {:error, _reason} -> nil
    end
  end

  defp behind_for(_pr, _repo, _branch_opts), do: nil

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

  defp extract_head_sha(node) do
    node
    |> get_in_safe(["commits", "nodes"])
    |> List.wrap()
    |> List.first()
    |> case do
      %{"commit" => %{"oid" => oid}} when is_binary(oid) and oid != "" -> oid
      _ -> nil
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
      job_id: positive_integer_or_nil(Map.get(check_run, "databaseId")) || job_id_from_url(check_run),
      status: string_or_nil(Map.get(check_run, "status")),
      conclusion: string_or_nil(Map.get(check_run, "conclusion")),
      url: string_or_nil(Map.get(check_run, "detailsUrl")),
      started_at: string_or_nil(Map.get(check_run, "startedAt")),
      completed_at: string_or_nil(Map.get(check_run, "completedAt"))
    }
  end

  defp positive_integer_or_nil(value) when is_integer(value) and value > 0, do: value
  defp positive_integer_or_nil(_value), do: nil

  defp job_id_from_url(check_run) do
    case string_or_nil(Map.get(check_run, "detailsUrl")) do
      url when is_binary(url) ->
        case Regex.run(~r{/job/(\d+)}, url) do
          [_, captured] -> String.to_integer(captured)
          _ -> nil
        end

      _ ->
        nil
    end
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

  defp extract_repo(node) do
    case get_in_safe(node, ["repository", "nameWithOwner"]) do
      repo when is_binary(repo) and repo != "" -> repo
      _ -> repo_from_url(string_or_nil(Map.get(node, "url")))
    end
  end

  defp repo_from_url(url) when is_binary(url) do
    case Regex.run(~r{github\.com/([^/]+/[^/]+)/pull/\d+}, url) do
      [_, repo] -> repo
      _ -> nil
    end
  end

  defp repo_from_url(_url), do: nil

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
