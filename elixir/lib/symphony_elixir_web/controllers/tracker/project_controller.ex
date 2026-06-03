defmodule SymphonyElixirWeb.Tracker.ProjectController do
  @moduledoc "Project endpoints for the local tracker JSON API."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Config
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixirWeb.TrackerErrors
  alias SymphonyElixirWeb.TrackerPresenter

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, params) do
    include_archived? = Map.get(params, "include_archived") == "true"
    projects = Context.list_projects(include_archived: include_archived?)
    counts = Context.count_issues_by_project_ids(Enum.map(projects, & &1.id))

    data =
      Enum.map(projects, fn project ->
        project
        |> TrackerPresenter.project()
        |> Map.put(:issue_count, Map.get(counts, project.id, 0))
      end)

    json(conn, %{data: data})
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

  @spec update_setup(Conn.t(), map()) :: Conn.t()
  def update_setup(conn, %{"id" => slug, "setup" => setup}) when is_map(setup) do
    case validate_workflow_config(setup) do
      :ok -> upsert_setup(conn, slug, setup)
      {:error, message} -> TrackerErrors.validation(conn, message)
    end
  end

  def update_setup(conn, _params), do: TrackerErrors.validation(conn, "setup is required")

  defp upsert_setup(conn, slug, setup) do
    case Context.upsert_project_setup(slug, setup) do
      {:ok, _setup} ->
        {:ok, project} = Context.get_project(slug)
        statuses = Context.list_statuses(slug)
        repositories = Context.list_repositories(slug)
        setup_dto = Context.get_project_setup(slug)
        json(conn, %{data: TrackerPresenter.project(project, statuses, repositories, setup_dto)})

      {:error, :project_not_found} ->
        TrackerErrors.render(conn, :project_not_found)

      {:error, %Ecto.Changeset{} = changeset} ->
        TrackerErrors.render(conn, changeset)
    end
  end

  # SPEC: strictly validate workflow_config against the option schema on save (not
  # just on resolve) so a malformed config is rejected at the API boundary
  # instead of being silently coerced or becoming a latent failure when the
  # orchestrator resolves it.
  defp validate_workflow_config(setup) do
    case Map.get(setup, "workflow_config") do
      nil ->
        :ok

      config ->
        case Config.validate_workflow_config(config) do
          :ok -> :ok
          {:error, issues} -> {:error, "invalid workflow_config: " <> Enum.join(issues, "; ")}
        end
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
