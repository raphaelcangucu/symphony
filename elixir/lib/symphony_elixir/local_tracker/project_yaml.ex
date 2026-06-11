defmodule SymphonyElixir.LocalTracker.ProjectYaml do
  @moduledoc "Converts local tracker projects to/from portable YAML bundles."

  alias SymphonyElixir.LocalTracker.{Project, ProjectSetup, Repository, TemplateYaml, WorkflowStatus}

  @bundle_kind "symphony_project"
  @bundle_version 2

  @export_keys ~w(
    kind
    version
    slug
    name
    description
    tracker
    workflow_statuses
    repositories
    setup
    dev_env_steps
    metadata
  )

  @spec decode(binary()) :: {:ok, map()} | {:error, :invalid_yaml}
  def decode(yaml) when is_binary(yaml) do
    case YamlElixir.read_from_string(yaml) do
      {:ok, %{} = map} -> {:ok, normalize(map)}
      _ -> {:error, :invalid_yaml}
    end
  end

  @spec encode(Project.t(), [WorkflowStatus.t()], [Repository.t()], ProjectSetup.t() | nil, [map()]) :: binary()
  def encode(%Project{} = project, statuses, repositories, setup, dev_env_steps \\ []) do
    %{
      "kind" => @bundle_kind,
      "version" => @bundle_version,
      "slug" => project.slug,
      "name" => project.name,
      "description" => project.description,
      "tracker" => %{
        "kind" => project.tracker_kind,
        "config" => project.tracker_config || %{}
      },
      "workflow_statuses" => Enum.map(statuses, &status_to_map/1),
      "repositories" => Enum.map(repositories, &repository_to_map/1),
      "setup" => setup_to_map(setup),
      "dev_env_steps" => Enum.map(dev_env_steps, &dev_env_step_to_map/1),
      "metadata" => %{
        "exported_at" => DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601(),
        "source_project_slug" => project.slug
      }
    }
    |> TemplateYaml.encode_map()
  end

  @spec to_project_attrs(map()) :: map()
  def to_project_attrs(map) when is_map(map) do
    setup = Map.get(map, "setup", %{})
    tracker = Map.get(map, "tracker", %{})

    %{
      "name" => Map.get(map, "name"),
      "slug" => Map.get(map, "slug"),
      "description" => Map.get(map, "description"),
      "tracker" => %{
        "kind" => Map.get(tracker, "kind", "local"),
        "config" => Map.get(tracker, "config", %{})
      },
      "workflow_statuses" => Map.get(map, "workflow_statuses", []),
      "repositories" => Map.get(map, "repositories", []),
      "setup" => setup
    }
  end

  @spec to_update_attrs(map()) :: map()
  def to_update_attrs(map) when is_map(map) do
    setup = Map.get(map, "setup", %{})
    tracker = Map.get(map, "tracker", %{})

    %{
      "name" => Map.get(map, "name"),
      "description" => Map.get(map, "description"),
      "tracker" => %{
        "kind" => Map.get(tracker, "kind", "local"),
        "config" => Map.get(tracker, "config", %{})
      },
      "repositories" => Map.get(map, "repositories", []),
      "setup" => setup
    }
  end

  defp normalize(map) do
    map
    |> Map.take(@export_keys)
    |> Map.update("setup", %{}, &normalize_setup/1)
    |> merge_legacy_workflow_markdown()
  end

  defp merge_legacy_workflow_markdown(%{"setup" => setup} = map) when is_map(setup) do
    case Map.get(setup, "workflow_markdown") do
      markdown when is_binary(markdown) and markdown != "" ->
        map

      _ ->
        case Map.get(map, "workflow_markdown") do
          markdown when is_binary(markdown) and markdown != "" ->
            Map.put(map, "setup", Map.put(setup, "workflow_markdown", markdown))

          _ ->
            map
        end
    end
  end

  defp merge_legacy_workflow_markdown(map), do: map

  defp normalize_setup(setup) when is_map(setup), do: setup
  defp normalize_setup(_), do: %{}

  defp status_to_map(%WorkflowStatus{} = status) do
    %{
      "name" => status.name,
      "category" => status.category,
      "position" => status.position,
      "is_terminal" => status.is_terminal
    }
  end

  defp repository_to_map(%Repository{} = repo) do
    %{
      "github_full_name" => repo.github_full_name,
      "clone_url" => repo.clone_url,
      "default_branch" => repo.default_branch,
      "selected_branch" => repo.selected_branch,
      "local_path" => repo.local_path,
      "workspace_path" => repo.workspace_path,
      "role" => repo.role
    }
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new()
  end

  defp setup_to_map(nil), do: %{}

  defp setup_to_map(%ProjectSetup{} = setup) do
    %{
      "workflow_markdown" => setup.workflow_markdown,
      "after_create_hook" => setup.after_create_hook,
      "validation_commands" => validation_commands(setup),
      "scan_summary" => empty_map_to_nil(setup.scan_summary)
    }
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new()
  end

  defp dev_env_step_to_map(step) do
    %{
      "description" => step.description,
      "command" => step.command,
      "working_dir" => step.working_dir,
      "source" => step.source,
      "optional" => step.optional,
      "role" => step.role,
      "port_env" => step.port_env,
      "url_path" => step.url_path,
      "ready_probe" => step.ready_probe,
      "ready_path" => step.ready_path,
      "primary" => step.primary
    }
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new()
  end

  defp empty_map_to_nil(%{} = map) when map_size(map) == 0, do: nil
  defp empty_map_to_nil(map), do: map

  defp validation_commands(%ProjectSetup{validation_commands: %{"commands" => commands}}) when is_list(commands),
    do: commands

  defp validation_commands(_setup), do: []
end
