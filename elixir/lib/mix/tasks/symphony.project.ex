defmodule Mix.Tasks.Symphony.Project do
  @shortdoc "Import or export local tracker project configuration bundles"
  @moduledoc """
  Portable project configuration for migrating setups between orchestrators.

      mix symphony.project import path/to/project.yaml
      mix symphony.project import path/to/project.yaml --into gamba
      mix symphony.project export gamba
      mix symphony.project export gamba --output gamba-project.yaml
  """

  use Mix.Task

  alias SymphonyElixir.LocalTracker.Projects

  @impl Mix.Task
  def run(["import", path | rest]) do
    start!()

    yaml =
      path
      |> Path.expand()
      |> File.read!()

    case option_value(rest, "--into") do
      nil -> import_new(yaml, path)
      slug -> import_into(slug, yaml, path)
    end
  end

  def run(["export", slug | rest]) do
    start!()

    case Projects.export_yaml(slug) do
      {:ok, yaml} ->
        output = option_value(rest, "--output") || "#{slug}-project.yaml"

        output
        |> Path.expand()
        |> File.write!(yaml)

        Mix.shell().info("✓  Exported #{slug} → #{output}")

      {:error, :project_not_found} ->
        Mix.raise("✗  Project not found: #{slug}")

      {:error, reason} ->
        Mix.raise("✗  Export failed: #{inspect(reason)}")
    end
  end

  def run(_argv) do
    Mix.raise("""
    Usage:
      mix symphony.project import <file.yaml> [--into <slug>]
      mix symphony.project export <slug> [--output <file.yaml>]
    """)
  end

  defp import_new(yaml, path) do
    case Projects.import_yaml(yaml) do
      {:ok, project} ->
        Mix.shell().info("✓  Imported project #{project.slug} (#{project.name}) from #{path}")

      {:error, :invalid_yaml} ->
        Mix.raise("✗  Invalid project YAML: #{path}")

      {:error, {:invalid_workflow_markdown, reason}} ->
        Mix.raise("✗  Invalid workflow_markdown: #{reason}")

      {:error, %Ecto.Changeset{} = changeset} ->
        Mix.raise("✗  Import failed: #{format_changeset(changeset)}")

      {:error, reason} ->
        Mix.raise("✗  Import failed: #{inspect(reason)}")
    end
  end

  defp import_into(slug, yaml, path) do
    case Projects.import_yaml_into(slug, yaml) do
      {:ok, project} ->
        Mix.shell().info("✓  Applied configuration to #{project.slug} (#{project.name}) from #{path}")

      {:error, :invalid_yaml} ->
        Mix.raise("✗  Invalid project YAML: #{path}")

      {:error, :project_not_found} ->
        Mix.raise("✗  Project not found: #{slug}")

      {:error, {:invalid_workflow_markdown, reason}} ->
        Mix.raise("✗  Invalid workflow_markdown: #{reason}")

      {:error, %Ecto.Changeset{} = changeset} ->
        Mix.raise("✗  Import failed: #{format_changeset(changeset)}")

      {:error, reason} ->
        Mix.raise("✗  Import failed: #{inspect(reason)}")
    end
  end

  defp format_changeset(changeset) do
    changeset
    |> Ecto.Changeset.traverse_errors(fn {message, _opts} -> message end)
    |> inspect()
  end

  defp option_value(argv, flag) do
    case Enum.split_while(argv, &(&1 != flag)) do
      {_, [^flag, value | _]} -> value
      _ -> nil
    end
  end

  @startup_apps [:logger, :telemetry, :phoenix_pubsub, :ecto, :ecto_sql, :db_connection, :jason]

  defp start! do
    load_dotenv!()
    Mix.Task.run("app.config")
    load_application!()
    ensure_startup_apps!()
    ensure_shared_supervisor!()
  end

  defp ensure_startup_apps! do
    Enum.each(@startup_apps, fn app ->
      case Application.ensure_all_started(app) do
        {:ok, _} -> :ok
        {:error, {^app, {:already_started, _}}} -> :ok
        {:error, reason} -> Mix.raise("could not start #{app}: #{inspect(reason)}")
      end
    end)
  end

  defp load_application! do
    case Application.load(:symphony_elixir) do
      :ok -> :ok
      {:error, {:already_loaded, :symphony_elixir}} -> :ok
      {:error, reason} -> Mix.raise("could not load symphony_elixir: #{inspect(reason)}")
    end
  end

  defp ensure_shared_supervisor! do
    case Process.whereis(SymphonyElixir.SharedSupervisor) do
      nil ->
        case SymphonyElixir.SharedSupervisor.start_link() do
          {:ok, _pid} -> :ok
          {:error, {:already_started, _pid}} -> :ok
          {:error, reason} -> Mix.raise("could not start shared supervisor: #{inspect(reason)}")
        end

      _pid ->
        :ok
    end
  end

  defp load_dotenv! do
    env_path = Path.join(File.cwd!(), ".env")

    if File.regular?(env_path) do
      env_path
      |> File.read!()
      |> String.split("\n", trim: false)
      |> Enum.each(&import_env_line/1)
    end
  end

  defp import_env_line(line) do
    line = String.trim(line)

    cond do
      line == "" or String.starts_with?(line, "#") ->
        :ok

      true ->
        case String.split(line, "=", parts: 2) do
          [key, value] -> System.put_env(String.trim(key), String.trim(value))
          _ -> :ok
        end
    end
  end
end
