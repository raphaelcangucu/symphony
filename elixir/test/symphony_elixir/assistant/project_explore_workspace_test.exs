defmodule SymphonyElixir.Assistant.ProjectExploreWorkspaceTest do
  use ExUnit.Case, async: false

  defmodule GitStub do
    @behaviour SymphonyElixir.LocalTracker.Git

    @impl true
    def clone(_url, dest, opts) do
      assert opts[:branch] == "main"
      File.mkdir_p!(dest)
      File.write!(Path.join(dest, "README.md"), "cloned")
      {:ok, "abc123"}
    end
  end

  alias SymphonyElixir.Assistant.ProjectExploreWorkspace
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workflow

  setup do
    migrate_repo()
    clean_repo()

    tmp_dir = Path.join(System.tmp_dir!(), "symphony-explore-workspaces-#{System.unique_integer([:positive])}")
    File.rm_rf!(tmp_dir)
    File.mkdir_p!(tmp_dir)

    workflow_file = Path.join(tmp_dir, "WORKFLOW.md")
    SymphonyElixir.TestSupport.write_workflow_file!(workflow_file, tracker_kind: "local", workspace_root: tmp_dir)
    Workflow.set_workflow_file_path(workflow_file)

    on_exit(fn ->
      Workflow.clear_workflow_file_path()
      File.rm_rf!(tmp_dir)
    end)

    %{workspace_root: tmp_dir}
  end

  test "ensure/1 clones configured repositories on default branches", %{workspace_root: workspace_root} do
    {:ok, project} =
      Context.create_workspace_project(%{
        name: "Explore",
        slug: "explore-proj",
        repositories: [
          %{
            github_full_name: "org/api",
            clone_url: "https://github.com/org/api.git",
            default_branch: "main",
            workspace_path: "api",
            role: "backend"
          }
        ]
      })

    assert {:ok, workspace} = ProjectExploreWorkspace.ensure(project.slug, git: GitStub)
    assert workspace == Path.join(workspace_root, "explore-proj")
    assert File.exists?(Path.join(Path.join(workspace, "api"), "README.md"))
  end

  test "path/1 and ensure/2 use the project's custom workspace.root segment", %{workspace_root: global_root} do
    # Sibling of the process workspace root (not nested under it), matching
    # advising's ~/code/advising-workspaces vs ~/code/workspaces split.
    project_root =
      Path.join(Path.dirname(global_root), "custom-root-#{System.unique_integer([:positive])}")

    File.mkdir_p!(project_root)
    on_exit(fn -> File.rm_rf!(project_root) end)

    {:ok, project} =
      Context.create_workspace_project(%{
        name: "Custom Root Explore",
        slug: "custom-explore",
        repositories: [
          %{
            github_full_name: "org/api",
            clone_url: "https://github.com/org/api.git",
            default_branch: "main",
            workspace_path: "api",
            role: "backend"
          }
        ]
      })

    markdown = Workflow.to_markdown(%{"workspace" => %{"root" => project_root}}, "")
    assert {:ok, _} = Context.upsert_project_setup(project.slug, %{"workflow_markdown" => markdown})

    expected = Path.expand(Path.join(project_root, project.slug))
    assert ProjectExploreWorkspace.path(project.slug) == expected

    assert {:ok, workspace} = ProjectExploreWorkspace.ensure(project.slug, git: GitStub)
    assert workspace == expected
    assert File.exists?(Path.join([workspace, "api", "README.md"]))
    refute String.starts_with?(workspace <> "/", Path.expand(global_root) <> "/")
  end

  test "ensure/1 rejects blank project slug" do
    assert {:error, {:missing_required_field, :project_slug}} = ProjectExploreWorkspace.ensure("  ")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    for table <- [
          "assistant_messages",
          "assistant_threads",
          "local_tracker_project_setups",
          "local_tracker_repositories",
          "local_tracker_projects"
        ] do
      Ecto.Adapters.SQL.query!(Repo, "DELETE FROM #{table}", [])
    end
  end
end
