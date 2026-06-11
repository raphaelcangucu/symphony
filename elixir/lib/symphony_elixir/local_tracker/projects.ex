defmodule SymphonyElixir.LocalTracker.Projects do
  @moduledoc "Portable import/export for local tracker projects."

  alias SymphonyElixir.Config
  alias SymphonyElixir.LocalTracker.{Context, Project, ProjectYaml, Templates}
  alias SymphonyElixir.Repo

  @type import_error ::
          :invalid_yaml
          | :project_not_found
          | :slug_taken
          | {:invalid_workflow_markdown, String.t()}
          | Ecto.Changeset.t()

  @spec export_yaml(String.t()) :: {:ok, binary()} | {:error, :project_not_found}
  def export_yaml(project_slug) when is_binary(project_slug) do
    with {:ok, project} <- Context.get_project(project_slug) do
      statuses = Context.list_statuses(project_slug)
      repositories = Context.list_repositories(project_slug)
      setup = Context.get_project_setup(project_slug)
      {:ok, ProjectYaml.encode(project, statuses, repositories, setup)}
    end
  end

  @spec import_yaml(binary()) :: {:ok, Project.t()} | {:error, import_error()}
  def import_yaml(yaml) when is_binary(yaml) do
    with {:ok, decoded} <- ProjectYaml.decode(yaml),
         :ok <- validate_bundle(decoded),
         :ok <- ensure_slug_available(decoded),
         {:ok, project} <- Context.create_workspace_project(ProjectYaml.to_project_attrs(decoded)) do
      Templates.start_clone_jobs(project.slug)
      {:ok, project}
    else
      {:error, %Ecto.Changeset{} = changeset} -> {:error, changeset}
      {:error, reason} -> {:error, reason}
    end
  end

  @spec import_yaml_into(String.t(), binary()) :: {:ok, Project.t()} | {:error, import_error()}
  def import_yaml_into(project_slug, yaml) when is_binary(project_slug) and is_binary(yaml) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, decoded} <- ProjectYaml.decode(yaml),
         :ok <- validate_bundle(decoded),
         {:ok, project} <- apply_import(project_slug, ProjectYaml.to_update_attrs(decoded)) do
      {:ok, project}
    else
      {:error, %Ecto.Changeset{} = changeset} -> {:error, changeset}
      {:error, reason} -> {:error, reason}
    end
  end

  defp apply_import(project_slug, attrs) do
    setup = Map.get(attrs, "setup", %{})

    with {:ok, project} <- maybe_update_project(project_slug, attrs),
         {:ok, _repositories} <- maybe_replace_repositories(project_slug, Map.get(attrs, "repositories")),
         {:ok, _setup} <- maybe_upsert_setup(project_slug, setup) do
      Context.get_project(project.slug)
    end
  end

  defp maybe_update_project(project_slug, attrs) do
    update_attrs =
      %{}
      |> put_present("name", Map.get(attrs, "name"))
      |> put_present("description", Map.get(attrs, "description"))
      |> put_present("tracker", Map.get(attrs, "tracker"))

    if update_attrs == %{} do
      Context.get_project(project_slug)
    else
      Context.update_project(project_slug, update_attrs)
    end
  end

  defp maybe_replace_repositories(_project_slug, nil), do: {:ok, []}
  defp maybe_replace_repositories(_project_slug, []), do: {:ok, []}
  defp maybe_replace_repositories(project_slug, repositories) when is_list(repositories), do: Context.replace_repositories(project_slug, repositories)
  defp maybe_replace_repositories(_project_slug, _repositories), do: {:ok, []}

  defp maybe_upsert_setup(_project_slug, setup) when setup in [%{}, nil], do: {:ok, nil}
  defp maybe_upsert_setup(project_slug, setup) when is_map(setup), do: Context.upsert_project_setup(project_slug, setup)

  defp validate_bundle(%{"slug" => slug, "name" => name} = map)
       when is_binary(slug) and slug != "" and is_binary(name) and name != "" do
    validate_setup(Map.get(map, "setup", %{}))
  end

  defp validate_bundle(_map), do: {:error, :invalid_yaml}

  defp validate_setup(setup) when setup in [%{}, nil], do: :ok

  defp validate_setup(%{"workflow_markdown" => markdown}) when is_binary(markdown) do
    case Config.parse_workflow_markdown(markdown) do
      {:ok, _} -> :ok
      {:error, reason} -> {:error, {:invalid_workflow_markdown, reason}}
    end
  end

  defp validate_setup(%{"workflow_markdown" => _other}), do: {:error, :invalid_yaml}
  defp validate_setup(_setup), do: :ok

  defp ensure_slug_available(%{"slug" => slug}) when is_binary(slug) do
    case Repo.get_by(Project, slug: slug) do
      nil -> :ok
      _ -> {:error, :slug_taken}
    end
  end

  defp ensure_slug_available(_map), do: {:error, :invalid_yaml}

  defp put_present(map, _key, nil), do: map
  defp put_present(map, _key, ""), do: map
  defp put_present(map, key, value), do: Map.put(map, key, value)
end
