defmodule SymphonyElixirWeb.Tracker.ProjectController do
  @moduledoc "Project endpoints for the local tracker JSON API."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Config
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.LocalTracker.Projects
  alias SymphonyElixir.Tracker.Sync.Engine, as: SyncEngine
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
        repositories = Context.list_repositories(project.slug)
        setup = Context.get_project_setup(project.slug)
        sync_state = TrackerPresenter.sync_state(SyncEngine.state_for(project))

        data =
          project
          |> TrackerPresenter.project(statuses, repositories, setup)
          |> Map.put(:sync_state, sync_state)

        json(conn, %{data: data})

      {:error, :project_not_found} ->
        TrackerErrors.render(conn, :project_not_found)
    end
  end

  @spec update_setup(Conn.t(), map()) :: Conn.t()
  def update_setup(conn, %{"id" => slug, "setup" => setup}) when is_map(setup) do
    case validate_workflow_markdown(setup) do
      :ok -> upsert_setup(conn, slug, setup)
      {:error, message} -> TrackerErrors.validation(conn, message)
    end
  end

  def update_setup(conn, _params), do: TrackerErrors.validation(conn, "setup is required")

  @spec update_repositories(Conn.t(), map()) :: Conn.t()
  def update_repositories(conn, %{"id" => slug, "repositories" => repositories}) when is_list(repositories) do
    case Context.replace_repositories(slug, repositories) do
      {:ok, _repositories} ->
        {:ok, project} = Context.get_project(slug)
        statuses = Context.list_statuses(slug)
        repositories = Context.list_repositories(slug)
        setup = Context.get_project_setup(slug)
        json(conn, %{data: TrackerPresenter.project(project, statuses, repositories, setup)})

      {:error, :project_not_found} ->
        TrackerErrors.render(conn, :project_not_found)

      {:error, %Ecto.Changeset{} = changeset} ->
        TrackerErrors.render(conn, changeset)
    end
  end

  def update_repositories(conn, _params), do: TrackerErrors.validation(conn, "repositories must be a list")

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

  # SPEC: strictly validate workflow_markdown (YAML front matter + prompt body)
  # against the option schema on save (not just on resolve), rejecting malformed
  # YAML, invalid option values, and process-/connection-owned sections at the
  # API boundary instead of letting them become latent runtime failures.
  defp validate_workflow_markdown(setup) do
    case Map.get(setup, "workflow_markdown") do
      nil ->
        :ok

      markdown when is_binary(markdown) ->
        case Config.parse_workflow_markdown(markdown) do
          {:ok, %{front_matter: _, body: _}} -> :ok
          {:error, reason} -> {:error, "invalid workflow_markdown: " <> reason}
        end

      _other ->
        {:error, "workflow_markdown must be a string"}
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

  @spec export(Conn.t(), map()) :: Conn.t()
  def export(conn, %{"id" => project_slug}) do
    case Projects.export_yaml(project_slug) do
      {:ok, yaml} -> conn |> put_resp_content_type("text/yaml") |> send_resp(200, yaml)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec import_bundle(Conn.t(), map()) :: Conn.t()
  def import_bundle(conn, %{"yaml" => yaml}) when is_binary(yaml) do
    case Projects.import_yaml(yaml) do
      {:ok, project} ->
        statuses = Context.list_statuses(project.slug)
        repositories = Context.list_repositories(project.slug)
        setup = Context.get_project_setup(project.slug)

        conn
        |> put_status(:created)
        |> json(%{data: TrackerPresenter.project(project, statuses, repositories, setup)})

      {:error, :invalid_yaml} ->
        TrackerErrors.validation(conn, "Invalid YAML")

      {:error, {:invalid_workflow_markdown, reason}} ->
        TrackerErrors.validation(conn, "invalid workflow_markdown: " <> reason)

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  def import_bundle(conn, _params), do: TrackerErrors.validation(conn, "yaml is required")

  @spec import_config(Conn.t(), map()) :: Conn.t()
  def import_config(conn, %{"id" => project_slug, "yaml" => yaml}) when is_binary(yaml) do
    case Projects.import_yaml_into(project_slug, yaml) do
      {:ok, project} ->
        statuses = Context.list_statuses(project.slug)
        repositories = Context.list_repositories(project.slug)
        setup = Context.get_project_setup(project.slug)
        json(conn, %{data: TrackerPresenter.project(project, statuses, repositories, setup)})

      {:error, :invalid_yaml} ->
        TrackerErrors.validation(conn, "Invalid YAML")

      {:error, {:invalid_workflow_markdown, reason}} ->
        TrackerErrors.validation(conn, "invalid workflow_markdown: " <> reason)

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  def import_config(conn, _params), do: TrackerErrors.validation(conn, "yaml is required")
end
