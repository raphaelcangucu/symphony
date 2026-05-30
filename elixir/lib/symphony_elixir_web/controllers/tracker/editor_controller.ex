defmodule SymphonyElixirWeb.Tracker.EditorController do
  @moduledoc "Resolves the browser VS Code (code-server) URL for a task workspace."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Editor
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixirWeb.TrackerErrors

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, _issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]) do
      render_target(conn, project_slug, identifier)
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp render_target(conn, project_slug, identifier) do
    case Editor.editor_target(project_slug, identifier) do
      {:ok, url} -> json(conn, %{data: %{available: true, url: url}})
      {:error, reason} -> json(conn, %{data: %{available: false, reason: Atom.to_string(reason)}})
    end
  end
end
