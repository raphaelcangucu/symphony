defmodule SymphonyElixirWeb.Tracker.GitHubIssueContextController do
  @moduledoc "GitHub issue source endpoint for Load Context."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.GitHub.{IssueRepo, ProjectIssues, ReadCache}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerErrors

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug} = params) do
    case Context.get_project(project_slug) do
      {:ok, project} ->
        repos = IssueRepo.candidate_repos(project, "")

        if repos == [] do
          json(conn, %{data: [], supported: false})
        else
          state = if Map.get(params, "include_closed") in ["1", "true", true], do: "all", else: "open"

          case ReadCache.fetch({:project_github_issues, project.slug, state}, fn ->
                 {:ok, ProjectIssues.list(repos, state: state)}
               end) do
            {:ok, issues} -> json(conn, %{data: Enum.map(issues, &present/1), supported: true})
            {:error, _reason} -> json(conn, %{data: [], supported: true})
          end
        end

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  defp present(issue) do
    %{
      number: issue.number,
      title: issue.title,
      url: issue.url,
      repo: issue.repo,
      state: issue.state,
      author: issue.author,
      updated_at: issue.updated_at
    }
  end
end
