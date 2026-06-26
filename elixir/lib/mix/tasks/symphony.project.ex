defmodule Mix.Tasks.Symphony.Project do
  @shortdoc "Import or export local tracker project configuration bundles"
  @moduledoc """
  Portable project configuration for migrating setups between orchestrators.

      mix symphony.project import ../projects/gamba.yaml
      mix symphony.project import --url https://gist.github.com/you/abc123
      mix symphony.project import https://gist.githubusercontent.com/you/abc/raw/gamba.yaml --into gamba
      mix symphony.project export gamba
      mix symphony.project export gamba --output ../projects/gamba.yaml
      mix symphony.project share gamba
      mix symphony.project share gamba --gist-id abc123
  """

  use Mix.Task

  alias SymphonyElixir.GitHub.Gist
  alias SymphonyElixir.LocalTracker.{ProjectYamlSource, Projects}

  @impl Mix.Task
  def run(["import" | rest]) do
    start!()

    {source, rest} =
      case option_value(rest, "--url") do
        url when is_binary(url) and url != "" ->
          {url, remove_flag(rest, "--url")}

        _ ->
          case rest do
            [source | tail] -> {source, tail}
            [] -> Mix.raise("Usage: mix symphony.project import <file.yaml|https-url> [--into <slug>]")
          end
      end

    yaml =
      if url_source?(source) do
        case ProjectYamlSource.fetch(source) do
          {:ok, yaml} -> yaml
          {:error, reason} -> Mix.raise("✗  Failed to fetch #{source}: #{inspect(reason)}")
        end
      else
        source |> Path.expand() |> File.read!()
      end

    case option_value(rest, "--into") do
      nil -> import_new(yaml, source)
      slug -> import_into(slug, yaml, source)
    end
  end

  def run(["share", slug | rest]) do
    start!()

    public? = "--public" in rest
    gist_id = option_value(rest, "--gist-id") || read_gist_sidecar(slug)

    with {:ok, yaml} <- Projects.export_yaml(slug),
         {:ok, info} <- Gist.share(slug, yaml, public: public?, gist_id: gist_id) do
      write_gist_sidecar(slug, info.gist_id)
      Mix.shell().info("✓  Shared #{slug} → #{info.html_url}")

      if is_binary(info.raw_url) and info.raw_url != "" do
        Mix.shell().info("   Import URL: #{info.raw_url}")
      end
    else
      {:error, :project_not_found} ->
        Mix.raise("✗  Project not found: #{slug}")

      {:error, :missing_github_token} ->
        Mix.raise("✗  GITHUB_TOKEN is required to share via GitHub Gist")

      {:error, reason} ->
        Mix.raise("✗  Share failed: #{inspect(reason)}")
    end
  end

  def run(["export", slug | rest]) do
    start!()

    case Projects.export_yaml(slug) do
      {:ok, yaml} ->
        output = option_value(rest, "--output") || default_export_path(slug)

        output
        |> Path.expand()
        |> tap(fn path -> path |> Path.dirname() |> File.mkdir_p!() end)
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
      mix symphony.project import <file.yaml|https-url> [--into <slug>]
      mix symphony.project import --url <https-url> [--into <slug>]
      mix symphony.project export <slug> [--output <file.yaml>]
      mix symphony.project share <slug> [--gist-id <id>] [--public]
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

  defp default_export_path(slug) do
    Path.join(["..", "projects", "#{slug}.yaml"])
  end

  defp gist_sidecar_path(slug) do
    Path.join(["..", "projects", "#{slug}.gist"])
  end

  defp read_gist_sidecar(slug) do
    slug
    |> gist_sidecar_path()
    |> Path.expand()
    |> then(fn path ->
      if File.regular?(path), do: path |> File.read!() |> String.trim(), else: nil
    end)
    |> case do
      "" -> nil
      value -> value
    end
  end

  defp write_gist_sidecar(slug, gist_id) when is_binary(gist_id) do
    slug
    |> gist_sidecar_path()
    |> Path.expand()
    |> tap(fn path -> path |> Path.dirname() |> File.mkdir_p!() end)
    |> File.write!(gist_id <> "\n")
  end

  defp write_gist_sidecar(_slug, _gist_id), do: :ok

  defp option_value(argv, flag) do
    case Enum.split_while(argv, &(&1 != flag)) do
      {_, [^flag, value | _]} -> value
      _ -> nil
    end
  end

  defp remove_flag(argv, flag) do
    case Enum.split_while(argv, &(&1 != flag)) do
      {before, [^flag, _value | after_flag]} -> before ++ after_flag
      {before, _} -> before
    end
  end

  defp url_source?(source) when is_binary(source), do: String.match?(source, ~r/^https:\/\//i)

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
