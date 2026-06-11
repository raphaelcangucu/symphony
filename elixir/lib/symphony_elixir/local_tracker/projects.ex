defmodule SymphonyElixir.LocalTracker.Projects do
  @moduledoc "Portable import/export for local tracker projects."

  alias SymphonyElixir.Config
  alias SymphonyElixir.LocalTracker.{Context, DevEnv, Project, ProjectYaml, Templates}

  @type import_error ::
          :invalid_yaml
          | :project_not_found
          | {:invalid_workflow_markdown, String.t()}
          | Ecto.Changeset.t()

  @spec export_yaml(String.t()) :: {:ok, binary()} | {:error, :project_not_found}
  def export_yaml(project_slug) when is_binary(project_slug) do
    with {:ok, project} <- Context.get_project(project_slug) do
      statuses = Context.list_statuses(project_slug)
      repositories = Context.list_repositories(project_slug)
      setup = Context.get_project_setup(project_slug)
      dev_env_steps = DevEnv.list_steps(project_slug)
      {:ok, ProjectYaml.encode(project, statuses, repositories, setup, dev_env_steps)}
    end
  end

  @spec import_yaml(binary()) :: {:ok, Project.t()} | {:error, import_error()}
  def import_yaml(yaml) when is_binary(yaml) do
    with {:ok, decoded} <- ProjectYaml.decode(yaml),
         :ok <- validate_bundle(decoded),
         {:ok, project} <- apply_bundle(decoded, nil) do
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
         {:ok, project} <- apply_bundle(decoded, project_slug) do
      Templates.start_clone_jobs(project.slug)
      {:ok, project}
    else
      {:error, %Ecto.Changeset{} = changeset} -> {:error, changeset}
      {:error, reason} -> {:error, reason}
    end
  end

  defp apply_bundle(decoded, target_slug) do
    slug = target_slug || Map.fetch!(decoded, "slug")

    with {:ok, project} <- ensure_project(slug, decoded),
         :ok <- apply_configuration(project.slug, decoded),
         {:ok, refreshed} <- Context.get_project(project.slug) do
      {:ok, refreshed}
    end
  end

  defp ensure_project(slug, decoded) do
    case Context.get_project(slug) do
      {:ok, _existing} ->
        Context.update_project(slug, ProjectYaml.to_update_attrs(decoded))

      {:error, :project_not_found} ->
        Context.create_workspace_project(ProjectYaml.to_project_attrs(decoded))
    end
  end

  defp apply_configuration(project_slug, decoded) do
    setup = Map.get(decoded, "setup", %{})
    statuses = Map.get(decoded, "workflow_statuses", [])
    repositories = Map.get(decoded, "repositories")
    dev_env_steps = Map.get(decoded, "dev_env_steps") || []

    with {:ok, _} <- apply_setup(project_slug, setup),
         {:ok, _} <- apply_statuses(project_slug, statuses),
         {:ok, _} <- apply_repositories(project_slug, repositories),
         {:ok, _} <- apply_dev_env_steps(project_slug, dev_env_steps) do
      :ok
    end
  end

  defp apply_setup(_project_slug, setup) when setup in [%{}, nil], do: {:ok, nil}

  defp apply_setup(project_slug, setup) when is_map(setup) do
    case Context.upsert_project_setup(project_slug, setup) do
      {:ok, _setup} -> {:ok, nil}
      {:error, reason} -> {:error, reason}
    end
  end

  defp apply_statuses(_project_slug, []), do: {:ok, []}

  defp apply_statuses(project_slug, statuses) when is_list(statuses) do
    Context.import_workflow_statuses(project_slug, statuses)
  end

  defp apply_repositories(_project_slug, nil), do: {:ok, []}

  defp apply_repositories(project_slug, repositories) when is_list(repositories) do
    Context.replace_repositories(project_slug, repositories)
  end

  defp apply_dev_env_steps(_project_slug, steps) when steps in [[], nil], do: {:ok, []}

  defp apply_dev_env_steps(project_slug, steps) when is_list(steps) do
    steps
    |> Enum.map(&normalize_dev_env_step/1)
    |> then(&DevEnv.save_steps(project_slug, &1))
  end

  defp normalize_dev_env_step(step) when is_map(step) do
    step
    |> Map.new(fn {key, value} -> {to_string(key), value} end)
    |> then(fn map ->
      case {Map.get(map, "ready"), Map.get(map, "ready_probe")} do
        {ready, probe} when is_binary(ready) and probe in [nil, ""] ->
          map |> Map.put("ready_probe", ready) |> Map.delete("ready")

        _ ->
          Map.delete(map, "ready")
      end
    end)
  end

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
end
