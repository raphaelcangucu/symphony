defmodule SymphonyElixirWeb.Tracker.ProjectController do
  @moduledoc "Project endpoints for the local tracker JSON API."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerErrors
  alias SymphonyElixirWeb.TrackerPresenter

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, _params) do
    json(conn, %{data: Enum.map(Context.list_projects(), &TrackerPresenter.project/1)})
  end

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, params) do
    case Context.ensure_project(params) do
      {:ok, project} ->
        statuses = Context.list_statuses(project.slug)

        conn
        |> put_status(:created)
        |> json(%{data: TrackerPresenter.project(project, statuses)})

      {:error, %Ecto.Changeset{} = changeset} ->
        TrackerErrors.render(conn, changeset)
    end
  end

  @spec workspace(Conn.t(), map()) :: Conn.t()
  def workspace(conn, params) do
    case Context.create_workspace_project(params) do
      {:ok, project} ->
        statuses = Context.list_statuses(project.slug)
        repositories = Context.list_repositories(project.slug)
        setup = Context.get_project_setup(project.slug)

        conn
        |> put_status(:created)
        |> json(%{data: TrackerPresenter.project(project, statuses, repositories, setup)})

      {:error, %Ecto.Changeset{} = changeset} ->
        TrackerErrors.render(conn, changeset)
    end
  end

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, %{"id" => project_slug}) do
    case Context.get_project(project_slug) do
      {:ok, project} ->
        statuses = Context.list_statuses(project.slug)
        json(conn, %{data: TrackerPresenter.project(project, statuses)})

      {:error, :project_not_found} ->
        TrackerErrors.render(conn, :project_not_found)
    end
  end
end
