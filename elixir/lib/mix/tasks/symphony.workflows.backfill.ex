defmodule Mix.Tasks.Symphony.Workflows.Backfill do
  @shortdoc "Import WORKFLOW.<slug>.md files into per-project setups (idempotent)."
  @moduledoc """
  Scans a directory for `WORKFLOW.<slug>.md` files. For each, creates the project
  if missing and imports the workflow front matter + prompt body into the project's
  setup — but never overwrites a project that already has DB-owned setup config.
  """
  use Mix.Task

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Workflow

  @impl Mix.Task
  def run(args) do
    {opts, _, _} = OptionParser.parse(args, switches: [dir: :string])
    ensure_started()
    dir = Keyword.get(opts, :dir, File.cwd!())

    dir
    |> workflow_files()
    |> Enum.each(&import_file/1)
  end

  defp ensure_started do
    if Process.whereis(SymphonyElixir.Repo), do: :ok, else: Mix.Task.run("app.start")
  end

  defp workflow_files(dir) do
    dir
    |> Path.join("WORKFLOW.*.md")
    |> Path.wildcard()
    |> Enum.reject(&String.contains?(Path.basename(&1), ".example."))
  end

  defp import_file(path) do
    slug = path |> Path.basename() |> slug_from_filename()

    with true <- is_binary(slug),
         {:ok, %{config: config, prompt_template: prompt}} <- Workflow.load(path) do
      maybe_create_project(slug, config)

      if needs_setup?(slug) do
        {:ok, _} = Context.upsert_project_setup(slug, %{workflow_config: config, prompt_template: prompt})
        Mix.shell().info("multi_orchestrator: imported project=#{slug}")
      else
        Mix.shell().info("multi_orchestrator: skipped (db-owned) project=#{slug}")
      end
    else
      _ -> Mix.shell().info("multi_orchestrator: skipped (unreadable) path=#{path}")
    end
  end

  defp slug_from_filename(filename) do
    case Regex.run(~r/^WORKFLOW\.(.+)\.md$/, filename) do
      [_, slug] -> slug
      _ -> nil
    end
  end

  defp maybe_create_project(slug, config) do
    case Context.get_project(slug) do
      {:ok, _project} -> :ok
      {:error, :project_not_found} -> Context.ensure_project(project_attrs(slug, config))
    end
  end

  defp project_attrs(slug, config) do
    base = %{name: slug, slug: slug}

    case config do
      %{"github" => %{} = gh} ->
        Map.merge(base, %{tracker_kind: "github", tracker_config: take_github(gh)})

      _ ->
        Map.put(base, :tracker_kind, "local")
    end
  end

  defp take_github(gh) do
    project = Map.get(gh, "project", %{})
    %{"repo" => Map.get(gh, "repo"), "project_id" => Map.get(project, "id")}
  end

  defp needs_setup?(slug) do
    case Context.get_project_setup(slug) do
      nil -> true
      setup -> map_size(setup.workflow_config || %{}) == 0 and is_nil(setup.prompt_template)
    end
  end
end
