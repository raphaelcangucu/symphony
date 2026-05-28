defmodule SymphonyElixirWeb.Tracker.CommentController do
  @moduledoc "Comment endpoints for the local tracker JSON API."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerErrors
  alias SymphonyElixirWeb.TrackerPresenter

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    case Context.list_comments(project_slug, identifier) do
      {:ok, comments} ->
        json(conn, %{data: Enum.map(comments, &TrackerPresenter.comment/1)})

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, %{"project_slug" => project_slug, "identifier" => identifier, "body" => body} = params)
      when is_binary(body) and body != "" do
    attrs = Map.drop(params, ["project_slug", "identifier", "body"])

    case Context.add_comment(project_slug, identifier, body, attrs) do
      {:ok, comment} ->
        conn
        |> put_status(:created)
        |> json(%{data: TrackerPresenter.comment(comment)})

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  def create(conn, _params), do: TrackerErrors.validation(conn, "body is required")
end
