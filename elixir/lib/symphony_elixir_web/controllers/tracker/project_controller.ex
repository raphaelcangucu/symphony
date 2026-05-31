defmodule SymphonyElixirWeb.Tracker.ProjectController do
  @moduledoc "Project endpoints for the local tracker JSON API."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerErrors
  alias SymphonyElixirWeb.TrackerPresenter

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, params) do
    include_archived? = Map.get(params, "include_archived") == "true"
    projects = Context.list_projects(include_archived: include_archived?)
    json(conn, %{data: Enum.map(projects, &TrackerPresenter.project/1)})
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

  @spec update(Conn.t(), map()) :: Conn.t()
  def update(conn, %{"id" => project_slug} = params) do
    case Context.update_project(project_slug, params) do
      {:ok, project} ->
        statuses = Context.list_statuses(project.slug)
        json(conn, %{data: TrackerPresenter.project(project, statuses)})

      {:error, %Ecto.Changeset{} = changeset} ->
        TrackerErrors.render(conn, changeset)

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
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

  @spec archive(Conn.t(), map()) :: Conn.t()
  def archive(conn, %{"id" => project_slug}) do
    case Context.archive_project(project_slug) do
      {:ok, project} -> json(conn, %{data: TrackerPresenter.project(project)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec restore(Conn.t(), map()) :: Conn.t()
  def restore(conn, %{"id" => project_slug}) do
    case Context.restore_project(project_slug) do
      {:ok, project} -> json(conn, %{data: TrackerPresenter.project(project)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec delete(Conn.t(), map()) :: Conn.t()
  def delete(conn, %{"id" => project_slug}) do
    case Context.delete_project(project_slug) do
      {:ok, _project} -> send_resp(conn, :no_content, "")
      {:error, :project_not_archived} -> TrackerErrors.validation(conn, "Project must be archived before permanent deletion")
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end
end
