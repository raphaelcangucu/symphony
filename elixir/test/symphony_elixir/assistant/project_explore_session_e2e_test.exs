defmodule SymphonyElixir.Assistant.ProjectExploreSessionE2ETest do
  @moduledoc """
  End-to-end coverage for exploratory project_session turns on the project
  default workspace when the project uses a custom `workspace.root`.
  """
  use ExUnit.Case, async: false

  defmodule GitStub do
    @behaviour SymphonyElixir.LocalTracker.Git

    @impl true
    def clone(_url, dest, opts) do
      assert opts[:branch] in ["main", "pre-release", nil] or is_binary(opts[:branch])
      File.mkdir_p!(dest)
      File.write!(Path.join(dest, "README.md"), "cloned")
      # Minimal git metadata so inventory repo_states can see a repo directory.
      File.mkdir_p!(Path.join(dest, ".git"))
      {:ok, "abc123"}
    end
  end

  alias SymphonyElixir.Assistant.{AgentSession, History, ProjectExploreWorkspace}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workflow
  alias SymphonyElixir.Workspace.{Inventory, PathOwnership}

  @inventory_module_env :workspace_display_name_inventory_module

  setup do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)

    tmp = Path.join(System.tmp_dir!(), "explore-e2e-#{System.unique_integer([:positive])}")
    global_root = Path.join(tmp, "global-workspaces")
    project_root = Path.join(tmp, "project-workspaces")
    File.mkdir_p!(global_root)
    File.mkdir_p!(project_root)

    workflow_file = Path.join(tmp, "WORKFLOW.md")
    SymphonyElixir.TestSupport.write_workflow_file!(workflow_file, tracker_kind: "local", workspace_root: global_root)
    Workflow.set_workflow_file_path(workflow_file)

    previous_inventory = Application.get_env(:symphony_elixir, @inventory_module_env)
    Application.delete_env(:symphony_elixir, @inventory_module_env)

    on_exit(fn ->
      Workflow.clear_workflow_file_path()
      restore_inventory_module(previous_inventory)
      File.rm_rf!(tmp)
    end)

    %{tmp: tmp, global_root: global_root, project_root: project_root}
  end

  test "legacy project_session turn succeeds on custom workspace.root default path", ctx do
    {:ok, project} =
      Context.create_workspace_project(%{
        name: "Advising-like",
        slug: "adv-e2e",
        repositories: [
          %{
            github_full_name: "org/adv",
            clone_url: "https://github.com/org/adv.git",
            default_branch: "main",
            workspace_path: "adv",
            role: "primary"
          }
        ]
      })

    markdown = Workflow.to_markdown(%{"workspace" => %{"root" => ctx.project_root}}, "")
    assert {:ok, _} = Context.upsert_project_setup(project.slug, %{"workflow_markdown" => markdown})

    expected = Path.expand(Path.join(ctx.project_root, project.slug))
    assert ProjectExploreWorkspace.path(project.slug) == expected

    assert {:ok, thread} =
             History.create_project_session_thread(project.slug, %{
               title: "Explore",
               agent_kind: "codex",
               git: GitStub
             })

    assert thread.scope == "project_session"
    assert Path.expand(thread.workspace_path) == expected
    assert File.exists?(Path.join([expected, "adv", "README.md"]))

    assert {:ok, scan} = Inventory.scan(project.slug, executions: [], size_fun: fn _ -> 1 end)
    project_entry = Enum.find(scan.workspaces, &(&1.kind == :project))
    assert project_entry
    assert Path.expand(project_entry.path) == expected
    assert {:ok, _ownership} = PathOwnership.validate(project.slug, thread.workspace_path)

    test_pid = self()
    expected_root = Path.expand(ctx.project_root)

    runner = fn workspace, prompt, _issue, opts ->
      send(
        test_pid,
        {:explore_turn, Path.expand(workspace), prompt, Keyword.get(opts, :workspace_root)}
      )

      {:ok, %{assistant_message: "answered", tool_calls: [], conversation_id: "ct-e2e", run_id: "t-e2e"}}
    end

    assert {:ok, result} =
             AgentSession.send_message_to_project_explore_thread(
               thread,
               "advisor filter question",
               %{},
               runner: runner,
               git: GitStub
             )

    assert result.assistant_message == "answered"
    assert_receive {:explore_turn, ^expected, prompt, ^expected_root}
    assert prompt =~ "advisor filter question"
  end

  defp restore_inventory_module(nil), do: Application.delete_env(:symphony_elixir, @inventory_module_env)

  defp restore_inventory_module(module),
    do: Application.put_env(:symphony_elixir, @inventory_module_env, module)

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
