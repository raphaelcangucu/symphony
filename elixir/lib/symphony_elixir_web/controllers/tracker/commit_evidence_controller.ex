defmodule SymphonyElixirWeb.Tracker.CommitEvidenceController do
  @moduledoc """
  Exposes git commits from an issue workspace as commit evidence (separate from
  test/e2e manifests).
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Evidence.Commits
  alias SymphonyElixir.Issue
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixir.Workspace
  alias SymphonyElixirWeb.TrackerErrors

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    default_branches = Context.repo_default_branches(project_slug)

    with {:ok, workspace} <- issue_workspace(project_slug, identifier),
         {:ok, commits} <- Commits.list(workspace, default_branches: default_branches) do
      json(conn, %{data: commits, workspace: workspace_brief(workspace)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, %{
        "project_slug" => project_slug,
        "identifier" => identifier,
        "sha" => sha,
        "repo" => repo
      }) do
    with {:ok, workspace} <- issue_workspace(project_slug, identifier),
         {:ok, commit} <- Commits.show(workspace, repo, sha) do
      json(conn, %{data: commit})
    else
      {:error, :commit_not_found} -> TrackerErrors.render(conn, :commit_not_found)

      {:error, :repo_not_found} -> TrackerErrors.render(conn, :repo_not_found)

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  defp issue_workspace(project_slug, identifier) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, _issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]) do
      issue = %Issue{identifier: identifier, project_slug: project_slug}
      {:ok, Workspace.path_for_issue(issue)}
    end
  end

  defp workspace_brief(workspace) do
    %{path: workspace, available: File.dir?(workspace)}
  end
end
