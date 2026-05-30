defmodule SymphonyElixirWeb.Tracker.PullRequestController do
  @moduledoc """
  Read-only endpoint exposing the pull request(s) related to an issue, including
  CI pipelines, jobs, statuses, and the PR conversation.

  Linkage is only available for GitHub-backed projects. Other tracker kinds
  return an empty, `supported: false` payload so the UI can degrade gracefully.
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.GitHub.PullRequests
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerErrors

  require Logger

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    case Context.get_project(project_slug) do
      {:ok, project} -> respond(conn, project, identifier)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp respond(conn, project, identifier) do
    case PullRequests.resolve_repo(project) do
      {:ok, repo} -> respond_github(conn, repo, identifier)
      {:error, _reason} -> json(conn, %{data: [], supported: false, available: false})
    end
  end

  defp respond_github(conn, repo, identifier) do
    cond do
      not PullRequests.available?() ->
        json(conn, %{data: [], supported: true, available: false})

      true ->
        case PullRequests.for_issue(repo, identifier) do
          {:ok, pull_requests} ->
            json(conn, %{data: pull_requests, supported: true, available: true})

          {:error, reason} ->
            Logger.warning("PR lookup failed for #{identifier}: #{inspect(reason)}")
            json(conn, %{data: [], supported: true, available: true})
        end
    end
  end
end
