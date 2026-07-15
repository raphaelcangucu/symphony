defmodule SymphonyElixirWeb.Tracker.EditorController do
  @moduledoc """
  Resolves editor targets for a task workspace: browser VS Code (code-server) and,
  when the Cursor CLI is on PATH, a `cursor://` URL for Cursor Desktop.
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Editor
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerErrors

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    # Do not load the full issue through IssueAdapter here: remote trackers make
    # get_issue hundreds of ms, and the editor URL only needs the workspace path.
    with {:ok, _project} <- Context.get_project(project_slug) do
      render_target(conn, project_slug, identifier)
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  def show(conn, %{"project_slug" => project_slug}) do
    with {:ok, _project} <- Context.get_project(project_slug) do
      render_project_target(conn, project_slug)
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp render_target(conn, project_slug, identifier) do
    browser = editor_payload(Editor.editor_target(project_slug, identifier))
    cursor = editor_payload(Editor.cursor_desktop_target(project_slug, identifier))

    json(conn, %{
      data: %{
        available: browser.available,
        url: browser.url,
        reason: browser.reason,
        cursor_desktop: %{
          available: cursor.available,
          url: cursor.url,
          reason: cursor.reason
        }
      }
    })
  end

  defp render_project_target(conn, project_slug) do
    browser = editor_payload(Editor.project_editor_target(project_slug))
    cursor = editor_payload(Editor.project_cursor_desktop_target(project_slug))

    json(conn, %{
      data: %{
        available: browser.available,
        url: browser.url,
        reason: browser.reason,
        cursor_desktop: %{
          available: cursor.available,
          url: cursor.url,
          reason: cursor.reason
        }
      }
    })
  end

  defp editor_payload({:ok, url}), do: %{available: true, url: url, reason: nil}

  defp editor_payload({:error, reason}),
    do: %{available: false, url: nil, reason: Atom.to_string(reason)}
end
