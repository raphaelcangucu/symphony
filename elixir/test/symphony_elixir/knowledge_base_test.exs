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

  test "docs committed on disk become searchable after the repo tree is loaded" do
    # The seed commits docs to disk without ever calling write_page, so the
    # search index starts empty for this repo (the bug: only UI-authored pages
    # were indexed, leaving Git-committed docs unsearchable).
    assert {:ok, []} = KnowledgeBase.search_project("acme", "Backend", [])

    # Loading the repo tree is what the KB UI does on open; it must reindex the
    # repository's docs from disk so every committed page becomes findable.
    assert {:ok, _tree} = KnowledgeBase.repo_tree("acme", "web")

    assert {:ok, results} = KnowledgeBase.search_project("acme", "Backend", [])
    assert Enum.any?(results, &(&1.path == "architecture/backend.md"))
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

  test "sync helpers are inert no-ops for project KB base checkouts" do
    assert :ok = KnowledgeBase.request_sync("acme", "web")

    assert {:ok, %{status: "idle", last_error: nil, pr_number: nil, pr_url: nil}} =
             KnowledgeBase.sync_status("acme", "web")
  end

  describe "personal KB (@user scope)" do
    @general_repo_slug "@user~symphony-kb"

    setup %{root: root} do
      origin = Path.join(root, "kb-origin")
      File.mkdir_p!(Path.join(origin, "docs"))
      File.write!(Path.join(origin, "docs/keep.md"), "---\ntitle: Keep\n---\n# Keep\n")
      git(origin, ["init", "-q", "-b", "main"])
      git(origin, ["add", "-A"])
      git(origin, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed"])

      deps = [
        ensure_repo: fn ->
          {:ok,
           %{
             full_name: "octocat/symphony-kb",
             clone_url: origin,
             default_branch: "main",
             created: false
           }}
        end,
        clone: fn _clone_url, dest ->
          {_o, 0} = System.cmd("git", ["clone", "-q", origin, dest], stderr_to_stdout: true)
          {:ok, dest}
        end
      ]

      Application.put_env(:symphony_elixir, :kb_general_deps, deps)
      on_exit(fn -> Application.delete_env(:symphony_elixir, :kb_general_deps) end)
      :ok
    end

    test "project_overview reports the synthetic Personal repo, disconnected before connect" do
      assert {:ok, overview} = KnowledgeBase.project_overview("@user")
      assert overview.project.slug == "@user"
      assert [%{repo_slug: @general_repo_slug, docs_present?: false}] = overview.repositories

      assert {:ok, _} = KnowledgeBase.general_connect()

      assert {:ok, connected} = KnowledgeBase.project_overview("@user")
      assert [%{repo_slug: @general_repo_slug, docs_present?: true}] = connected.repositories
    end

    test "repo_tree and read_page resolve against the personal checkout" do
      assert {:ok, _} = KnowledgeBase.general_connect()

      assert {:ok, tree} = KnowledgeBase.repo_tree("@user", @general_repo_slug)
      assert tree.repository.repo_slug == @general_repo_slug
      assert tree.docs_present == true
      assert Enum.any?(tree.tree, &(&1.name == "keep.md"))

      assert {:ok, page} = KnowledgeBase.read_page("@user", @general_repo_slug, ["keep.md"])
      assert page.title == "Keep"
      assert page.repo_slug == @general_repo_slug
    end

    test "a saved personal page is findable via @user search" do
      assert {:ok, _} = KnowledgeBase.general_connect()

      {:ok, _} =
        KnowledgeBase.general_write_page("notes/zebra.md", %{
          frontmatter: %{"title" => "Z"},
          body: "a unique zebra phrase"
        })

      assert {:ok, results} = KnowledgeBase.search_project("@user", "zebra", [])
      assert Enum.any?(results, &(&1.path == "notes/zebra.md"))
    end

    test "sync helpers are inert no-ops for the personal KB" do
      assert :ok = KnowledgeBase.request_sync("@user", @general_repo_slug)
      assert {:ok, %{status: "idle"}} = KnowledgeBase.sync_status("@user", @general_repo_slug)
    end
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
