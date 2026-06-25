defmodule SymphonyElixir.KnowledgeBaseTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.KnowledgeBase
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    root = configure_isolated_workspace_root()

    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "Acme",
        "slug" => "acme",
        "tracker" => %{"kind" => "local"},
        "repositories" => [
          %{"github_full_name" => "acme/web", "workspace_path" => "web", "role" => "frontend"}
        ],
        "setup" => %{}
      })

    checkout = Path.join([root, "acme", "web"])
    File.mkdir_p!(Path.join(checkout, "docs/architecture"))
    File.write!(Path.join(checkout, "docs/index.md"), "---\ntitle: Home\n---\n# Home\n")

    File.write!(
      Path.join(checkout, "docs/architecture/backend.md"),
      "---\ntitle: Backend\n---\n# B\n\nbody\n"
    )

    File.write!(Path.join(checkout, "docs/broken.md"), "---\n- not\n- a map\n---\nx")
    git(checkout, ["init", "-q", "-b", "main"])
    git(checkout, ["add", "-A"])
    git(checkout, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed docs"])
    {:ok, root: root, checkout: checkout}
  end

  defp git(dir, args), do: {_o, 0} = System.cmd("git", args, cd: dir, stderr_to_stdout: true)

  test "project_overview returns repositories with docs status" do
    assert {:ok, overview} = KnowledgeBase.project_overview("acme")
    assert overview.project.slug == "acme"
    assert [%{repo_slug: "web", docs_present?: true}] = overview.repositories
  end

  test "project_overview returns error for unknown project" do
    assert KnowledgeBase.project_overview("nope") == {:error, :project_not_found}
  end

  test "repo_tree returns the repository summary and tree" do
    assert {:ok, result} = KnowledgeBase.repo_tree("acme", "web")
    assert result.repository.repo_slug == "web"
    assert result.docs_present == true
    assert Enum.any?(result.tree, &(&1.name == "index.md"))
  end

  test "repo_tree errors for unknown repo and project" do
    assert KnowledgeBase.repo_tree("acme", "missing") == {:error, :repo_not_found}
    assert KnowledgeBase.repo_tree("nope", "web") == {:error, :project_not_found}
  end

  test "read_page returns frontmatter, title, body, and content" do
    assert {:ok, page} = KnowledgeBase.read_page("acme", "web", ["architecture", "backend.md"])
    assert page.title == "Backend"
    assert page.path == "architecture/backend.md"
    assert page.frontmatter["title"] == "Backend"
    assert page.body =~ "body"
    assert page.content =~ "# B"
  end

  test "read_page validates path and missing files" do
    assert KnowledgeBase.read_page("acme", "web", ["..", "x.md"]) == {:error, :kb_invalid_path}
    assert KnowledgeBase.read_page("acme", "web", ["nope.md"]) == {:error, :kb_page_not_found}
    assert KnowledgeBase.read_page("acme", "web", ["broken.md"]) == {:error, :kb_frontmatter_invalid}
  end

  test "a saved page is immediately findable via project search" do
    {:ok, _} =
      KnowledgeBase.write_page("acme", "web", "search-me.md", %{
        frontmatter: %{"title" => "Find Me"},
        body: "a unique zebra phrase"
      })

    assert {:ok, results} = KnowledgeBase.search_project("acme", "zebra", [])
    assert Enum.any?(results, &(&1.path == "search-me.md"))
    assert Enum.all?(results, &(&1.repo_slug == "web"))
  end

  test "deleting a saved page removes it from search results" do
    {:ok, _} =
      KnowledgeBase.write_page("acme", "web", "temp.md", %{
        frontmatter: %{"title" => "Temp"},
        body: "ephemeral wombat note"
      })

    assert {:ok, [_ | _]} = KnowledgeBase.search_project("acme", "wombat", [])
    {:ok, _} = KnowledgeBase.delete_page("acme", "web", "temp.md")
    assert {:ok, []} = KnowledgeBase.search_project("acme", "wombat", [])
  end

  test "sync_status returns idle for a never-synced repo" do
    assert {:ok, %{status: "idle"}} = KnowledgeBase.sync_status("acme", "web")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo, do: SymphonyElixir.TestSupport.truncate_tracker!(Repo)

  defp configure_isolated_workspace_root do
    root = Path.join(System.tmp_dir!(), "kb-context-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    workflow = Path.join(root, "WORKFLOW.md")
    SymphonyElixir.TestSupport.write_workflow_file!(workflow, workspace_root: root)
    SymphonyElixir.Workflow.set_workflow_file_path(workflow)

    on_exit(fn ->
      File.rm_rf(root)
      Application.delete_env(:symphony_elixir, :workflow_file_path)
    end)

    root
  end
end
