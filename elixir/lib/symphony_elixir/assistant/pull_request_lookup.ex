defmodule SymphonyElixir.Assistant.PullRequestLookup do
  @moduledoc false

  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.SourceControl
  alias SymphonyElixir.Tracker.Sync.LocalStore
  alias SymphonyElixir.Tracker.Sync.PullRequests, as: SyncPullRequests

  @spec list_for_issue(Project.t(), String.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def list_for_issue(%Project{} = project, identifier, opts \\ []) when is_binary(identifier) do
    identifier = normalize_identifier(identifier)

    if SourceControl.supported?(project) do
      {:ok,
       %{
         supported: true,
         available: SourceControl.available?(),
         pull_requests: list_live(project, identifier, opts)
       }}
    else
      {:ok,
       %{
         supported: false,
         available: false,
         pull_requests: list_persisted(project.slug, identifier)
       }}
    end
  end

  defp list_live(project, identifier, opts) do
    {:ok, pull_requests} = SourceControl.for_project_issue(project, identifier, opts)
    persist_discovered(project, identifier, pull_requests)
    merge(Enum.map(pull_requests, &summarize_live/1), list_persisted(project.slug, identifier))
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

  defp list_persisted(project_slug, identifier) do
    {:ok, prs} = SyncPullRequests.for_issue(project_slug, identifier)
    Enum.map(prs, &summarize_persisted/1)
  end

  defp merge(live, persisted) do
    live_urls = live |> Enum.map(& &1.url) |> Enum.reject(&is_nil/1) |> MapSet.new()

    extras =
      persisted
      |> Enum.reject(fn pr -> pr.url && MapSet.member?(live_urls, pr.url) end)

    live ++ extras
  end

  defp summarize_live(pr) do
    %{
      number: pr[:number],
      title: pr[:title],
      url: pr[:url],
      state: pr[:state],
      repo: pr[:repo],
      origin: Map.get(pr, :origin, "auto"),
      checks_state: pr[:checks_state],
      is_draft: pr[:is_draft],
      merged: pr[:merged]
    }
  end

  defp summarize_persisted(pr) do
    %{
      number: pr.number,
      title: pr.title,
      url: pr.url,
      state: pr.state,
      repo: pr.repo,
      origin: pr.origin,
      checks_state: nil,
      is_draft: nil,
      merged: nil
    }
  end

  defp normalize_identifier(identifier) do
    identifier |> String.trim() |> String.trim_leading("#")
  end
end
