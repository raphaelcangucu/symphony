defmodule SymphonyElixir.LocalTracker.Templates do
  @moduledoc "Persistence + operations for workspace templates."

  import Ecto.Query

  alias SymphonyElixir.Config

  alias SymphonyElixir.LocalTracker.{
    CloneJob,
    CloneSupervisor,
    Context,
    Repository,
    TemplateSubstitution,
    TemplateYaml,
    WorkspaceTemplate,
    WorkspaceTemplateRepository
  }

  alias SymphonyElixir.Repo

  @type error :: :template_not_found | :project_not_found | Ecto.Changeset.t()

  @spec list_templates() :: [WorkspaceTemplate.t()]
  def list_templates do
    WorkspaceTemplate
    |> order_by([t], desc: t.inserted_at, desc: t.id)
    |> preload(:repositories)
    |> Repo.all()
  end

  @spec get_template(String.t()) :: {:ok, WorkspaceTemplate.t()} | {:error, :template_not_found}
  def get_template(slug) when is_binary(slug) do
    case Repo.get_by(WorkspaceTemplate, slug: slug) do
      nil -> {:error, :template_not_found}
      template -> {:ok, Repo.preload(template, :repositories)}
    end
  end

  @spec create_template(map()) :: {:ok, WorkspaceTemplate.t()} | {:error, Ecto.Changeset.t()}
  def create_template(attrs) when is_map(attrs) do
    repositories = attr(attrs, :repositories, [])

    Repo.transaction(fn ->
      with {:ok, template} <- insert_template(attrs),
           {:ok, _repos} <- insert_template_repositories(template, repositories) do
        Repo.preload(template, :repositories, force: true)
      else
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  @spec update_template(String.t(), map()) :: {:ok, WorkspaceTemplate.t()} | {:error, error()}
  def update_template(slug, attrs) do
    with {:ok, template} <- get_template(slug) do
      Repo.transaction(fn -> apply_template_update(template, attrs) end)
    end
  end

  defp apply_template_update(template, attrs) do
    with {:ok, updated} <- template |> WorkspaceTemplate.changeset(attrs) |> Repo.update(),
         :ok <- replace_repositories(updated, attr(attrs, :repositories, nil)) do
      Repo.preload(updated, :repositories, force: true)
    else
      {:error, reason} -> Repo.rollback(reason)
    end
  end

  @spec delete_template(String.t()) :: {:ok, WorkspaceTemplate.t()} | {:error, :template_not_found}
  def delete_template(slug) do
    with {:ok, template} <- get_template(slug) do
      Repo.delete(template)
    end
  end

  @spec save_project_as_template(String.t(), map()) ::
          {:ok, WorkspaceTemplate.t()} | {:error, error()}
  def save_project_as_template(project_slug, overrides) when is_map(overrides) do
    with {:ok, project} <- Context.get_project(project_slug) do
      repositories = Context.list_repositories(project_slug)
      setup = Context.get_project_setup(project_slug)
      statuses = Context.list_statuses(project_slug)

      attrs = %{
        "name" => attr(overrides, :name, "#{project.name} (template)"),
        "slug" => attr(overrides, :slug, "#{project.slug}-template"),
        "description" => attr(overrides, :description, project.description),
        "workflow_statuses" => Enum.map(statuses, &status_to_attrs/1),
        "validation_commands" => validation_commands(setup),
        "after_create_hook" => parameterize(setup && setup.after_create_hook, project),
        "prompt_template" => setup && setup.prompt_template,
        "dev_env_markdown" => attr(overrides, :dev_env_markdown, nil),
        "metadata" => %{"source" => "saved_from_project", "source_project_slug" => project_slug},
        "repositories" => Enum.map(repositories, &repo_to_template_attrs(&1, project))
      }

      create_template(attrs)
    end
  end

  @spec import_yaml(binary()) :: {:ok, WorkspaceTemplate.t()} | {:error, :invalid_yaml | Ecto.Changeset.t()}
  def import_yaml(yaml) when is_binary(yaml) do
    with {:ok, attrs} <- TemplateYaml.decode(yaml) do
      create_template(attrs)
    end
  end

  @spec export_yaml(String.t()) :: {:ok, binary()} | {:error, :template_not_found}
  def export_yaml(slug) do
    with {:ok, template} <- get_template(slug) do
      {:ok, TemplateYaml.encode(template)}
    end
  end

  @spec instantiate_template(String.t(), map()) :: {:ok, map()} | {:error, error()}
  def instantiate_template(template_slug, attrs) when is_map(attrs) do
    with {:ok, template} <- get_template(template_slug) do
      vars = substitution_vars(attrs)
      tracker = attr(attrs, :tracker, %{"kind" => "local", "config" => %{}})
      remote? = attr(tracker, :kind, "local") in ["github", "linear"]

      project_attrs = %{
        "name" => attr(attrs, :name),
        "slug" => attr(attrs, :slug),
        "description" => template.description,
        "tracker" => tracker,
        "workflow_statuses" => maybe_statuses(template, remote?),
        "repositories" => template_repositories(template, vars),
        "setup" => maybe_setup(template, vars, remote?)
      }

      with {:ok, project} <- Context.create_workspace_project(project_attrs),
           {:ok, _jobs} <- enqueue_clone_jobs(project) do
        {:ok, project}
      end
    end
  end

  @spec start_clone_jobs(String.t(), (term() -> term())) :: :ok | {:error, :project_not_found}
  def start_clone_jobs(project_slug, starter \\ &CloneSupervisor.start_job/1) do
    with {:ok, _project} <- Context.get_project(project_slug) do
      project_slug
      |> list_clone_jobs()
      |> Enum.each(fn job -> starter.(job.id) end)

      :ok
    end
  end

  @spec list_clone_jobs(String.t()) :: [CloneJob.t()]
  def list_clone_jobs(project_slug) do
    case Context.get_project(project_slug) do
      {:ok, project} ->
        Repo.all(from(j in CloneJob, where: j.project_id == ^project.id, order_by: [asc: j.id], preload: [:repository]))

      _ ->
        []
    end
  end

  defp insert_template(attrs) do
    %WorkspaceTemplate{}
    |> WorkspaceTemplate.changeset(attrs)
    |> Repo.insert()
  end

  defp insert_template_repositories(_template, []), do: {:ok, []}

  defp insert_template_repositories(template, repositories) do
    repositories
    |> Enum.reduce_while({:ok, []}, fn repo_attrs, {:ok, acc} ->
      attrs = repo_attrs |> stringify() |> Map.put("template_id", template.id)

      %WorkspaceTemplateRepository{}
      |> WorkspaceTemplateRepository.changeset(attrs)
      |> Repo.insert()
      |> case do
        {:ok, repo} -> {:cont, {:ok, [repo | acc]}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp replace_repositories(_template, nil), do: :ok

  defp replace_repositories(template, repositories) do
    Repo.delete_all(from(r in WorkspaceTemplateRepository, where: r.template_id == ^template.id))

    case insert_template_repositories(template, repositories) do
      {:ok, _} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp status_to_attrs(status) do
    %{"name" => status.name, "category" => status.category, "position" => status.position, "is_terminal" => status.is_terminal}
  end

  defp validation_commands(nil), do: []

  defp validation_commands(setup) do
    Map.get(setup.validation_commands || %{}, "commands", [])
  end

  defp repo_to_template_attrs(%Repository{} = repo, project) do
    %{
      "github_full_name" => repo.github_full_name,
      "clone_url" => repo.clone_url || "https://github.com/#{repo.github_full_name}.git",
      "default_branch" => repo.default_branch,
      "workspace_path" => parameterize(repo.workspace_path, project),
      "role" => repo.role
    }
  end

  defp parameterize(nil, _project), do: nil

  defp parameterize(value, project) when is_binary(value) do
    String.replace(value, project.slug, "{{slug}}")
  end

  defp stringify(map) do
    Map.new(map, fn {k, v} -> {to_string(k), v} end)
  end

  defp attr(attrs, key), do: attr(attrs, key, nil)

  defp attr(attrs, key, default) do
    Map.get(attrs, key, Map.get(attrs, to_string(key), default))
  end

  defp substitution_vars(attrs) do
    %{slug: attr(attrs, :slug), name: attr(attrs, :name), workspace_root: Config.workspace_root()}
  end

  defp maybe_statuses(_template, true), do: []
  defp maybe_statuses(template, false), do: WorkspaceTemplate.workflow_statuses_list(template)

  defp maybe_setup(_template, _vars, true), do: %{}

  defp maybe_setup(template, vars, false) do
    %{
      "after_create_hook" => TemplateSubstitution.apply(template.after_create_hook, vars),
      "prompt_template" => TemplateSubstitution.apply(template.prompt_template, vars),
      "validation_commands" => WorkspaceTemplate.validation_commands_list(template),
      "workflow_config" => %{},
      "scan_summary" => %{}
    }
  end

  defp template_repositories(template, vars) do
    Enum.map(template.repositories, fn repo ->
      %{
        "github_full_name" => repo.github_full_name,
        "clone_url" => TemplateSubstitution.apply(repo.clone_url, vars),
        "default_branch" => repo.default_branch,
        "selected_branch" => repo.default_branch,
        "workspace_path" => TemplateSubstitution.apply(repo.workspace_path, vars),
        "role" => repo.role,
        "scan_summary" => %{}
      }
    end)
  end

  defp enqueue_clone_jobs(project) do
    repositories = Context.list_repositories(project.slug)

    repositories
    |> Enum.reduce_while({:ok, []}, fn repo, {:ok, acc} ->
      %CloneJob{}
      |> CloneJob.changeset(%{project_id: project.id, repository_id: repo.id, status: "pending"})
      |> Repo.insert()
      |> case do
        {:ok, job} -> {:cont, {:ok, [job | acc]}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end
end
