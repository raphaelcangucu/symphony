defmodule SymphonyElixir.ProjectConfigTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixir.LocalTracker.{Context, ProjectSetup, Project}
  alias SymphonyElixir.{Repo, Workflow}

  setup do
    migrate_repo()
    clean_repo()

    workflow_root =
      Path.join(System.tmp_dir!(), "symphony-project-config-#{System.unique_integer([:positive])}")

    File.mkdir_p!(workflow_root)
    workflow_file = Path.join(workflow_root, "WORKFLOW.md")

    SymphonyElixir.TestSupport.write_workflow_file!(workflow_file,
      tracker_kind: "local",
      workspace_root: workflow_root
    )

    Workflow.set_workflow_file_path(workflow_file)
    if Process.whereis(SymphonyElixir.WorkflowStore), do: SymphonyElixir.WorkflowStore.force_reload()

    on_exit(fn ->
      Workflow.clear_workflow_file_path()
      File.rm_rf!(workflow_root)
    end)

    :ok
  end

  defp project_with_setup(slug, workflow_config, prompt) do
    {:ok, project} = Context.ensure_project(%{name: slug, slug: slug, tracker_kind: "local"})

    {:ok, _setup} =
      %ProjectSetup{}
      |> ProjectSetup.changeset(%{
        project_id: project.id,
        workflow_config: workflow_config,
        prompt_template: prompt,
        validation_commands: %{"commands" => []},
        scan_summary: %{}
      })
      |> Repo.insert()

    Repo.get!(Project, project.id) |> Repo.preload(:setup)
  end

  test "resolves per-project states from setup workflow_config" do
    project =
      project_with_setup(
        "alpha",
        %{"tracker" => %{"active_states" => ["Doing"], "terminal_states" => ["Shipped"]}},
        "Alpha prompt"
      )

    config = ProjectConfig.resolve(project)

    assert config.project_slug == "alpha"
    assert config.active_states == ["Doing"]
    assert config.terminal_states == ["Shipped"]
    assert config.prompt_template == "Alpha prompt"
  end

  test "falls back to global defaults when setup omits a key and to default prompt when blank" do
    {:ok, project} = Context.ensure_project(%{name: "beta", slug: "beta", tracker_kind: "local"})
    project = SymphonyElixir.Repo.preload(project, :setup)

    config = ProjectConfig.resolve(project)

    assert config.active_states == SymphonyElixir.Config.active_states()
    assert config.prompt_template == SymphonyElixir.Config.workflow_prompt()
    assert config.tracker_kind == "local"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
