defmodule SymphonyElixir.WorkflowDiscovery do
  @moduledoc """
  Optional boot-time discovery of `WORKFLOW.<slug>.md` files.

  For each workflow file whose `<slug>` has no matching project, discovery
  creates the project and imports its setup (workflow_config + prompt). Projects
  that already exist are never touched — discovery only fills in *missing*
  projects, so DB-owned config always wins. This is the lighter-weight,
  create-only counterpart to `mix symphony.workflows.backfill`, which also
  back-imports into empty existing setups.
  """

  require Logger

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Workflow

  @example_marker ".example."
  @slug_pattern ~r/^WORKFLOW\.(.+)\.md$/

  @type summary :: %{discovered: [String.t()], skipped: [String.t()]}

  @doc """
  Scans `dir` for `WORKFLOW.<slug>.md` files and creates any missing projects.

  Returns a summary of the slugs that were `:discovered` (created) and those
  `:skipped` (already present, unreadable, or failed to create). Never raises;
  a failure on one file does not abort the rest.
  """
  @spec discover(Path.t()) :: summary()
  def discover(dir) when is_binary(dir) do
    dir
    |> workflow_files()
    |> Enum.reduce(%{discovered: [], skipped: []}, &discover_file/2)
  end

  defp workflow_files(dir) do
    dir
    |> Path.join("WORKFLOW.*.md")
    |> Path.wildcard()
    |> Enum.reject(&String.contains?(Path.basename(&1), @example_marker))
  end

  defp discover_file(path, acc) do
    with slug when is_binary(slug) <- slug_from_filename(Path.basename(path)),
         {:ok, %{config: config, prompt_template: prompt}} <- Workflow.load(path) do
      discover_slug(slug, config, prompt, acc)
    else
      _ ->
        Logger.warning("multi_orchestrator: discovery skipped (unreadable) path=#{path}")
        skipped(acc, path)
    end
  end

  defp discover_slug(slug, config, prompt, acc) do
    case Context.get_project(slug) do
      {:ok, _project} ->
        Logger.debug("multi_orchestrator: discovery skipped (exists) project=#{slug}")
        skipped(acc, slug)

      {:error, :project_not_found} ->
        create_project(slug, config, prompt, acc)
    end
  end

  defp create_project(slug, config, prompt, acc) do
    with {:ok, _project} <- Context.ensure_project(project_attrs(slug, config)),
         {:ok, _setup} <- Context.upsert_project_setup(slug, setup_attrs(config, prompt)) do
      Logger.info("multi_orchestrator: discovered project=#{slug}")
      discovered(acc, slug)
    else
      {:error, reason} ->
        Logger.warning("multi_orchestrator: discovery skipped (create-failed) project=#{slug} reason=#{inspect(reason)}")

        skipped(acc, slug)
    end
  end

  defp setup_attrs(config, prompt) do
    %{
      workflow_config: config,
      prompt_template: prompt,
      after_create_hook: get_in(config, ["hooks", "after_create"])
    }
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

  defp slug_from_filename(filename) do
    case Regex.run(@slug_pattern, filename) do
      [_, slug] -> slug
      _ -> nil
    end
  end

  defp discovered(acc, slug), do: %{acc | discovered: [slug | acc.discovered]}
  defp skipped(acc, slug), do: %{acc | skipped: [slug | acc.skipped]}
end
