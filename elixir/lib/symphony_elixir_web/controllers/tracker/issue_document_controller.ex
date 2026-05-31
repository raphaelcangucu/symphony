defmodule SymphonyElixirWeb.Tracker.IssueDocumentController do
  @moduledoc "Read access to superpowers documents in an issue working tree."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Assistant.IssueDocuments
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixirWeb.TrackerErrors

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    with_valid_issue(conn, project_slug, identifier, fn ->
      json(conn, %{data: IssueDocuments.list(identifier)})
    end)
  end

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, %{"project_slug" => project_slug, "identifier" => identifier, "path" => path_segments}) do
    with_valid_issue(conn, project_slug, identifier, fn ->
      rel = Enum.join(List.wrap(path_segments), "/")

      case IssueDocuments.read(identifier, rel) do
        {:ok, content} -> json(conn, %{data: %{path: rel, content: content}})
        {:error, reason} -> TrackerErrors.render(conn, reason)
      end
    end)
  end

  defp with_valid_issue(conn, project_slug, identifier, render) when is_function(render, 0) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, _issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]) do
      render.()
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end
end
