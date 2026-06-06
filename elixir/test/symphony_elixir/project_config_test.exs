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
        workflow_markdown: Workflow.to_markdown(workflow_config, prompt || ""),
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

  test "falls back to code-default states when setup omits a key and to nil prompt when blank" do
    {:ok, project} = Context.ensure_project(%{name: "beta", slug: "beta", tracker_kind: "local"})
    project = SymphonyElixir.Repo.preload(project, :setup)

    config = ProjectConfig.resolve(project)

    assert config.active_states == ["Todo", "In Progress"]
    assert config.prompt_template == nil
    assert config.tracker_kind == "local"
  end

  test "resolve/1 uses code defaults, not the loaded global workflow's states" do
    SymphonyElixir.TestSupport.write_workflow_file!(Workflow.workflow_file_path(),
      tracker_kind: "local",
      tracker_active_states: ["GlobalOnly"]
    )

    {:ok, project} = Context.ensure_project(%{name: "eps", slug: "eps", tracker_kind: "local"})
    project = Repo.preload(project, :setup)

    config = ProjectConfig.resolve(project)

    refute config.active_states == ["GlobalOnly"]
    assert config.active_states == ["Todo", "In Progress"]
  end

  test "resolve_runnable/1 returns {:ok, cfg} for a project with prompt and tracker identity" do
    project = project_with_setup("zeta", %{}, "Zeta prompt")

    assert {:ok, %ProjectConfig{prompt_template: "Zeta prompt"}} =
             ProjectConfig.resolve_runnable(project)
  end

  test "resolve_runnable/1 skips a project without a prompt" do
    {:ok, project} = Context.ensure_project(%{name: "eta", slug: "eta", tracker_kind: "local"})
    project = Repo.preload(project, :setup)

    assert {:skip, "no prompt configured"} = ProjectConfig.resolve_runnable(project)
  end

  test "resolve_runnable/1 skips a project with no tracker identity" do
    project = %Project{id: nil, slug: "no-kind", tracker_kind: nil, tracker_config: %{}, setup: nil}

    assert {:skip, "no tracker identity"} = ProjectConfig.resolve_runnable(project)
  end

  test "resolves per-project agent_kind from the project's own agent section" do
    project = project_with_setup("gamma", %{"claude" => %{}}, "Gamma prompt")

    config = ProjectConfig.resolve(project)

    assert config.agent_kind == "claude"
  end

  test "returns nil (inherit) for agent_kind when the project declares none" do
    {:ok, project} = Context.ensure_project(%{name: "delta", slug: "delta", tracker_kind: "local"})
    project = SymphonyElixir.Repo.preload(project, :setup)

    config = ProjectConfig.resolve(project)

    assert config.agent_kind == nil
  end

  test "dev_server_auto_start_on/1 returns [] when auto_start_on is omitted" do
    project = project_with_setup("manual-preview", %{"dev_server" => %{"enabled" => true}}, "prompt")
    config = ProjectConfig.resolve(project)

    assert ProjectConfig.dev_server_auto_start_on(config) == []
  end

  test "dev_server_auto_start_on/1 parses configured triggers from workflow markdown" do
    project =
      project_with_setup(
        "auto-preview",
        %{"dev_server" => %{"enabled" => true, "auto_start_on" => "pull_request,human_review"}},
        "prompt"
      )

    config = ProjectConfig.resolve(project)

    assert ProjectConfig.dev_server_auto_start_on(config) == ["pull_request", "human_review"]
  end

  test "resolve/1 exposes repo from tracker_config for github projects" do
    {:ok, project} =
      Context.ensure_project(%{
        name: "dm",
        slug: "dm",
        tracker_kind: "github",
        tracker_config: %{"repo" => "clouapp/distributionmachine", "project_id" => "PVT_x"}
      })

    config = ProjectConfig.resolve(project)

    assert config.repo == "clouapp/distributionmachine"
  end

  test "resolve/1 leaves repo nil for non-github projects" do
    {:ok, project} = Context.ensure_project(%{name: "loc", slug: "loc", tracker_kind: "local"})

    config = ProjectConfig.resolve(project)

    assert config.repo == nil
  end

  test "resolve/1 expands a leading tilde in the per-project workspace root" do
    project =
      project_with_setup(
        "tilde",
        %{"workspace" => %{"root" => "~/code/distributionmachine-workspaces"}},
        "prompt"
      )

    config = ProjectConfig.resolve(project)

    assert config.workspace_root == Path.expand("~/code/distributionmachine-workspaces")
    assert String.starts_with?(config.workspace_root, "/")
    refute String.contains?(config.workspace_root, "~")
  end

  test "resolve/1 leaves workspace_root nil when the project sets no root (inherits global)" do
    project = project_with_setup("noroot", %{}, "prompt")

    config = ProjectConfig.resolve(project)

    assert config.workspace_root == nil
  end

  test "resolve/1 reads after_create_hook from workflow_config.hooks when no column value" do
    project =
      github_project_with_setup("dm2", "clouapp/x", %{
        "hooks" => %{"after_create" => "gh repo clone clouapp/x . -- --depth 1"}
      })

    config = ProjectConfig.resolve(project)

    assert config.after_create_hook == "gh repo clone clouapp/x . -- --depth 1"
  end

  test "resolve/1 prefers the ProjectSetup.after_create_hook column when present" do
    project =
      github_project_with_setup(
        "dm3",
        "clouapp/z",
        %{"hooks" => %{"after_create" => "echo front-matter-loses"}},
        "echo column-wins"
      )

    config = ProjectConfig.resolve(project)

    assert config.after_create_hook == "echo column-wins"
  end

  test "resolves states, prompt, agent_kind and agent limits from workflow_markdown" do
    {:ok, project} = Context.ensure_project(%{name: "md", slug: "md", tracker_kind: "local"})

    md = """
    ---
    tracker:
      active_states: [Todo, In Progress]
      terminal_states: [Done]
      wait_states: [Human Review]
    agent:
      max_turns: 7
      completion_transitions:
        In Progress: Human Review
    codex: {}
    ---

    Do {{ issue.identifier }}
    """

    {:ok, _} = Context.upsert_project_setup("md", %{"workflow_markdown" => md})
    config = ProjectConfig.resolve(Repo.get!(Project, project.id) |> Repo.preload(:setup))

    assert config.active_states == ["Todo", "In Progress"]
    assert config.terminal_states == ["Done"]
    assert config.wait_states == ["Human Review"]
    assert config.prompt_template =~ "Do {{ issue.identifier }}"
    assert config.max_turns == 7
    assert config.completion_transitions == %{"In Progress" => "Human Review"}
    assert config.agent_kind == "codex"
    assert config.codex == %{}
  end

  defp github_project_with_setup(slug, repo, workflow_config, after_create_hook \\ nil) do
    {:ok, project} =
      Context.ensure_project(%{
        name: slug,
        slug: slug,
        tracker_kind: "github",
        tracker_config: %{"repo" => repo, "project_id" => "PVT_#{slug}"}
      })

    {:ok, _setup} =
      %ProjectSetup{}
      |> ProjectSetup.changeset(%{
        project_id: project.id,
        workflow_markdown: Workflow.to_markdown(workflow_config, ""),
        after_create_hook: after_create_hook,
        validation_commands: %{"commands" => []},
        scan_summary: %{}
      })
      |> Repo.insert()

    Repo.get!(Project, project.id) |> Repo.preload(:setup)
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
