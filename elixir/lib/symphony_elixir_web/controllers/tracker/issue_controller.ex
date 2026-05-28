defmodule SymphonyElixirWeb.Tracker.IssueController do
  @moduledoc "Issue endpoints for the local tracker JSON API."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerErrors
  alias SymphonyElixirWeb.TrackerPresenter

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug}) do
    case Context.get_project(project_slug) do
      {:ok, _project} ->
        issues = Context.list_issues(project_slug)
        json(conn, %{data: Enum.map(issues, &TrackerPresenter.issue/1)})

      {:error, :project_not_found} ->
        TrackerErrors.render(conn, :project_not_found)
    end
  end

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, %{"project_slug" => project_slug} = params) do
    case Context.create_issue(project_slug, Map.delete(params, "project_slug")) do
      {:ok, issue} ->
        conn
        |> put_status(:created)
        |> json(%{data: TrackerPresenter.issue(issue)})

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, %{"project_slug" => project_slug, "id" => identifier}) do
    case Context.get_issue(project_slug, identifier) do
      {:ok, issue} -> json(conn, %{data: TrackerPresenter.issue(issue)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec update(Conn.t(), map()) :: Conn.t()
  def update(conn, %{"project_slug" => project_slug, "id" => identifier} = params) do
    attrs = Map.drop(params, ["project_slug", "id"])

    case Context.update_issue(project_slug, identifier, attrs) do
      {:ok, issue} -> json(conn, %{data: TrackerPresenter.issue(issue)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec move(Conn.t(), map()) :: Conn.t()
  def move(conn, %{"project_slug" => project_slug, "identifier" => identifier} = params) do
    attrs = Map.drop(params, ["project_slug", "identifier"])

    case Context.move_issue(project_slug, identifier, attrs) do
      {:ok, issue} -> json(conn, %{data: TrackerPresenter.issue(issue)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end
end
