defmodule SymphonyElixirWeb.Tracker.CommentController do
  @moduledoc "Comment endpoints for the local tracker JSON API."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixirWeb.TrackerErrors
  alias SymphonyElixirWeb.TrackerPresenter

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, comments} <- IssueAdapter.dispatch(project, :list_comments, [identifier]) do
      json(conn, %{data: Enum.map(comments, &TrackerPresenter.comment/1)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, %{"project_slug" => project_slug, "identifier" => identifier, "body" => body} = params)
      when is_binary(body) and body != "" do
    attrs = Map.drop(params, ["project_slug", "identifier", "body"])

    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, comment} <- IssueAdapter.dispatch(project, :add_comment, [identifier, body, attrs]) do
      conn
      |> put_status(:created)
      |> json(%{data: TrackerPresenter.comment(comment)})
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  def create(conn, _params), do: TrackerErrors.validation(conn, "body is required")
end
