defmodule SymphonyElixirWeb.Tracker.PullRequestController do
  @moduledoc """
  Endpoint exposing the pull request(s) related to an issue.

  `index` merges live GitHub discovery (CI pipelines, jobs, statuses,
  conversation) with PRs persisted in `tracker_pull_requests` (manual links and
  previously discovered rows), deduped by URL. Persisted-only PRs (which issue
  discovery cannot surface, e.g. cross-repo or a non-default base branch) are
  enriched with a direct per-PR checks lookup so their CI status still shows.
  `link`/`unlink` manage manual cross-repo associations that live discovery
  cannot find (e.g. no App access).

  Persisted associations are keyed by `(project_id, issue_identifier)`, so the
  feature works in live tracker mode where `local_tracker_issues` is empty.
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.GitHub.{Api, PullRequests, PullRequestUrl}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.Sync.LocalStore
  alias SymphonyElixir.Tracker.Sync.PullRequests, as: SyncPullRequests
  alias SymphonyElixirWeb.TrackerErrors

  require Logger

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    case Context.get_project(project_slug) do
      {:ok, project} -> respond(conn, project, identifier)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec link(Conn.t(), map()) :: Conn.t()
  def link(conn, %{"project_slug" => project_slug, "identifier" => identifier, "url" => url}) do
    with {:ok, parsed} <- PullRequestUrl.parse(url),
         {:ok, project} <- Context.get_project(project_slug),
         {:ok, pr} <-
           LocalStore.link_manual_pull_request(project.id, identifier, %{
             url: url,
             repo: parsed.repo,
             number: parsed.number
           }) do
      json(conn, %{
        data: %{url: pr.url, number: pr.number, repo: pr.repo, state: pr.state, origin: pr.origin}
      })
    else
      {:error, :invalid_pr_url} -> error(conn, 422, "Invalid GitHub pull request URL.")
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  def link(conn, _params), do: error(conn, 422, "A pull request URL is required.")

  @spec unlink(Conn.t(), map()) :: Conn.t()
  def unlink(conn, %{"project_slug" => project_slug, "identifier" => identifier, "url" => url}) do
    with {:ok, project} <- Context.get_project(project_slug),
         :ok <- LocalStore.unlink_pull_request(project.id, identifier, url) do
      json(conn, %{data: %{unlinked: true}})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  def unlink(conn, _params), do: error(conn, 422, "A pull request URL is required.")

  defp respond(conn, project, identifier) do
    case PullRequests.resolve_repo(project) do
      {:ok, repo} ->
        respond_github(conn, project, repo, identifier)

      {:error, _reason} ->
        json(conn, %{data: persisted(project.slug, identifier), supported: false, available: false})
    end
  end

  defp respond_github(conn, project, repo, identifier) do
    if PullRequests.available?() do
      live = discover_live(project, repo, identifier)
      data = merge(live, persisted(project.slug, identifier))
      json(conn, %{data: data, supported: true, available: true})
    else
      json(conn, %{data: persisted(project.slug, identifier), supported: true, available: false})
    end
  end

  defp discover_live(project, repo, identifier) do
    case PullRequests.for_issue(repo, identifier) do
      {:ok, prs} ->
        persist_discovered(project, identifier, prs)
        Enum.map(prs, fn pr -> Map.put_new(pr, :origin, "auto") end)

      # Local-first identifiers (e.g. "DIS-1") are not GitHub issue numbers, so live
      # issue-scoped discovery does not apply. Persisted/manually-linked PRs still merge.
      {:error, {:invalid_issue_identifier, _}} ->
        []

      {:error, reason} ->
        Logger.warning("PR lookup failed for #{identifier}: #{inspect(reason)}")
        []
    end
  end

  defp persist_discovered(project, identifier, prs) do
    records =
      prs
      |> Enum.filter(&is_binary(&1[:url]))
      |> Enum.map(fn pr ->
        %{
          remote_id: pr.url,
          number: pr[:number],
          url: pr.url,
          title: pr[:title],
          state: pr[:state] || "unknown",
          repo: pr[:repo],
          origin: "auto"
        }
      end)

    LocalStore.upsert_discovered_pull_requests(project.id, identifier, records)
  end

  defp persisted(project_slug, identifier) do
    {:ok, prs} = SyncPullRequests.for_issue(project_slug, identifier)
    Enum.map(prs, &persisted_to_pr_map/1)
  end

  defp persisted_to_pr_map(pr) do
    %{
      number: pr.number,
      title: pr.title,
      url: pr.url,
      state: pr.state,
      repo: pr.repo,
      origin: pr.origin,
      pipelines: [],
      statuses: [],
      conversation: [],
      base_behind_by: nil
    }
  end

  defp merge(live, persisted) do
    live_urls = live |> Enum.map(& &1[:url]) |> Enum.reject(&is_nil/1) |> MapSet.new()

    extras =
      persisted
      |> Enum.reject(fn pr -> pr.url && MapSet.member?(live_urls, pr.url) end)
      |> Enum.map(&enrich_with_live_checks/1)

    live ++ extras
  end

  # Issue-scoped discovery only surfaces PRs in the issue's own repo, so a
  # manually-linked cross-repo PR (e.g. `clouapp/back#277` on a `clouapp/front`
  # issue, or one targeting a non-default base branch) arrives here without CI
  # data. Fetch its rollup directly by repo+number via `GitHub.Api` (GraphQL with
  # a REST check-runs fallback under rate limit). Best-effort: keep the persisted
  # fields when the PR is unreachable (no App access / both transports limited).
  defp enrich_with_live_checks(%{repo: repo, number: number} = pr)
       when is_binary(repo) and is_integer(number) do
    case Api.pull_request_detail(repo, number) do
      {:ok, live_pr} when is_map(live_pr) ->
        Map.merge(pr, %{
          title: live_pr[:title] || pr.title,
          state: live_pr[:state] || pr.state,
          checks_state: live_pr[:checks_state],
          pipelines: live_pr[:pipelines] || [],
          statuses: live_pr[:statuses] || [],
          conversation: live_pr[:conversation] || [],
          base_behind_by: live_pr[:base_behind_by]
        })

      _ ->
        pr
    end
  end

  defp enrich_with_live_checks(pr), do: pr

  defp error(conn, status, message) do
    conn
    |> put_status(status)
    |> json(%{error: %{message: message}})
  end
end
