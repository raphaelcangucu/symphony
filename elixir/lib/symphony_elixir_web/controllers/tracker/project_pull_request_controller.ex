defmodule SymphonyElixirWeb.Tracker.ProjectPullRequestController do
  @moduledoc "Project-scoped open pull request list for the Quick-Open launcher."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.GitHub.{IssueRepo, ProjectPullRequests, ReadCache}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixirWeb.TrackerErrors

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug} = params) do
    case Context.get_project(project_slug) do
      {:ok, project} ->
        repos = IssueRepo.candidate_repos(project, "")

        if repos == [] do
          json(conn, %{data: [], supported: false})
        else
          query = normalize_query(Map.get(params, "q"))
          cache_key = {:project_open_prs, project.slug, query || :all}

          case ReadCache.fetch(cache_key, fn ->
                 {:ok,
                  ProjectPullRequests.list_open(repos,
                    marker_key: marker_key(project),
                    q: query
                  )}
               end) do
            {:ok, data} ->
              json(conn, %{data: Enum.map(data, &present/1), supported: true})

            {:error, _reason} ->
              json(conn, %{data: [], supported: true})
          end
        end

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  defp normalize_query(query) when is_binary(query) do
    case String.trim(query) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_query(_), do: nil

  defp present(pr) do
    %{
      number: pr.number,
      title: pr.title,
      url: pr.url,
      repo: pr.repo,
      author: pr.author,
      updated_at: pr.updated_at,
      issue_identifier: pr.issue_identifier
    }
  end

  defp marker_key(project) do
    project
    |> ProjectConfig.resolve()
    |> ProjectConfig.source_control_issue_marker_key()
  rescue
    _ -> SymphonyElixir.GitHub.IssueMarker.default_key()
  end
end
