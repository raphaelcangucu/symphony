defmodule SymphonyElixirWeb.Tracker.WorkspaceFileController do
  @moduledoc """
  Read-only, scoped file search within an issue's workspace tree, powering the
  execution composer's `@file:` mentions. Resolves the issue exactly like
  `EditorController` (project → issue → workspace path), then delegates to
  `SymphonyElixir.Workspace.FileSearch`, which sandboxes results to the tree.
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixir.Workspace
  alias SymphonyElixir.Workspace.FileSearch
  alias SymphonyElixirWeb.TrackerErrors

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug, "identifier" => identifier} = params) do
    query = Map.get(params, "q", "")

    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]) do
      root = Workspace.path_for_issue(issue)
      json(conn, %{data: FileSearch.search(root, query)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end
end
