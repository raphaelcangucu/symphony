defmodule SymphonyElixir.Assistant.KnowledgeBaseToolsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.KnowledgeBaseTools
  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.KnowledgeBase.Indexer
  alias SymphonyElixir.KnowledgeBaseTestFixtures, as: Fixtures

  setup do
    Fixtures.reset!()
    {:ok, ctx} = Fixtures.seed_single_repo_project("acme", "acme/web")
    on_exit(ctx.cleanup)
    {:ok, ctx: ctx}
  end

  test "tool_specs declares the kb tools with json schemas" do
    names = Enum.map(KnowledgeBaseTools.tool_specs(), & &1["name"])
    assert "kb_search_pages" in names
    assert "kb_create_page" in names

    spec = Enum.find(KnowledgeBaseTools.tool_specs(), &(&1["name"] == "kb_search_pages"))
    assert spec["inputSchema"]["required"] == ["query"]
  end

  test "kb_list_repositories returns the project's linked repos" do
    assert {:ok, result} = KnowledgeBaseTools.execute("acme", "kb_list_repositories", %{}, [])
    assert result.tool == "kb_list_repositories"
    assert Enum.any?(result.data.repositories, &(&1.github_full_name == "acme/web"))
  end

  test "kb_create_page writes a new page in the resolved repository" do
    args = %{"repository" => "acme/web", "path" => "guides/new.md", "title" => "New", "body" => "# New\n\nhello"}
    assert {:ok, result} = KnowledgeBaseTools.execute("acme", "kb_create_page", args, [])
    assert result.data.path == "guides/new.md"

    assert {:ok, page} =
             KnowledgeBaseTools.execute("acme", "kb_read_page", %{"repository" => "acme/web", "path" => "guides/new.md"}, [])

    assert page.data.body =~ "hello"
  end

  test "kb_create_page on an existing page returns an error" do
    args = %{"repository" => "acme/web", "path" => "index.md", "title" => "X", "body" => "y"}
    assert {:error, :kb_page_exists} = KnowledgeBaseTools.execute("acme", "kb_create_page", args, [])
  end

  test "kb_update_page on a missing page returns page_not_found" do
    args = %{"repository" => "acme/web", "path" => "missing.md", "body" => "y"}
    assert {:error, :kb_page_not_found} = KnowledgeBaseTools.execute("acme", "kb_update_page", args, [])
  end

  test "issue-bound read and update target the issue worktree", %{ctx: ctx} do
    issue_root = Path.join(ctx.root, "issue-worktree")
    repo_root = Path.join(issue_root, ctx.workspace_path)
    File.mkdir_p!(Path.join(repo_root, "docs/guides"))
    git!(repo_root, ["init", "-q", "-b", "main"])
    File.write!(Path.join(repo_root, "docs/guides/task.md"), "# Base Task\n")
    git!(repo_root, ["add", "-A"])
    git!(repo_root, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base docs"])
    git!(repo_root, ["checkout", "-q", "-b", "task/acme-1"])
    File.write!(Path.join(repo_root, "docs/guides/task.md"), "# Issue Task\n")

    {:ok, _thread} = History.ensure_issue_thread("acme", "ACME-1", %{workspace_path: issue_root})

    args = %{"repository" => "acme/web", "path" => "guides/task.md"}

    assert {:ok, result} =
             KnowledgeBaseTools.execute("acme", "kb_read_page", args, bound_issue_identifier: "ACME-1")

    assert result.data.body == "# Issue Task\n"

    assert {:ok, result} =
             KnowledgeBaseTools.execute(
               "acme",
               "kb_update_page",
               Map.merge(args, %{"body" => "# Updated From Issue\n"}),
               bound_issue_identifier: "ACME-1"
             )

    assert result.data.commit == :workspace
    assert File.read!(Path.join(repo_root, "docs/guides/task.md")) =~ "Updated From Issue"
    refute File.read!(Path.join(ctx.checkout, "docs/index.md")) =~ "Updated From Issue"
  end

  test "kb_search_pages finds a saved page by body text" do
    KnowledgeBaseTools.execute(
      "acme",
      "kb_create_page",
      %{"repository" => "acme/web", "path" => "z.md", "title" => "Z", "body" => "a unique narwhal phrase"},
      []
    )

    assert {:ok, result} = KnowledgeBaseTools.execute("acme", "kb_search_pages", %{"query" => "narwhal"}, [])
    assert Enum.any?(result.data.results, &(&1.path == "z.md"))
  end

  test "kb_search_pages prunes pages absent from the docs worktree before searching" do
    stale_path = "brainstorming/polymarket-omnibus-execution-flow.md"

    assert {:ok, _record} =
             Indexer.index_page(
               "acme",
               "web",
               stale_path,
               "# Polymarket Omnibus\n\npolymarket omnibus execution flow"
             )

    assert {:ok, result} =
             KnowledgeBaseTools.execute(
               "acme",
               "kb_search_pages",
               %{"query" => "polymarket omnibus", "repository" => "acme/web"},
               []
             )

    refute Enum.any?(result.data.results, &(&1.path == stale_path))
  end

  test "kb_link_task appends an issue reference to the page" do
    args = %{"repository" => "acme/web", "path" => "index.md", "identifier" => "ACME-12"}
    assert {:ok, result} = KnowledgeBaseTools.execute("acme", "kb_link_task", args, [])
    assert result.tool == "kb_link_task"

    assert {:ok, page} =
             KnowledgeBaseTools.execute("acme", "kb_read_page", %{"repository" => "acme/web", "path" => "index.md"}, [])

    assert page.data.body =~ "ACME-12"
  end

  test "omitting repository with multiple repos returns a remediation asking the user" do
    {:ok, _} = Fixtures.add_repo("acme", "acme/api")
    assert {:ok, result} = KnowledgeBaseTools.execute("acme", "kb_read_page", %{"path" => "index.md"}, [])
    assert result.data[:remediation]
    assert result.message =~ "which repository"
  end

  test "missing required arg returns missing_required_field" do
    assert {:error, {:missing_required_field, "query"}} =
             KnowledgeBaseTools.execute("acme", "kb_search_pages", %{}, [])
  end

  test "tool_specs declares the destructive delete tools" do
    names = Enum.map(KnowledgeBaseTools.tool_specs(), & &1["name"])
    assert "kb_delete_page" in names
    assert "kb_delete_asset" in names
    assert "kb_delete_folder" in names
  end

  test "kb_delete_page removes an existing page" do
    KnowledgeBaseTools.execute(
      "acme",
      "kb_create_page",
      %{"repository" => "acme/web", "path" => "guides/tmp.md", "title" => "T", "body" => "x"},
      []
    )

    assert {:ok, result} =
             KnowledgeBaseTools.execute("acme", "kb_delete_page", %{"repository" => "acme/web", "path" => "guides/tmp.md"}, [])

    assert result.tool == "kb_delete_page"

    assert {:error, :kb_page_not_found} =
             KnowledgeBaseTools.execute("acme", "kb_read_page", %{"repository" => "acme/web", "path" => "guides/tmp.md"}, [])
  end

  test "kb_delete_page on a missing page returns page_not_found" do
    assert {:error, :kb_page_not_found} =
             KnowledgeBaseTools.execute("acme", "kb_delete_page", %{"repository" => "acme/web", "path" => "nope.md"}, [])
  end

  test "kb_delete_folder removes a folder and all pages within it" do
    KnowledgeBaseTools.execute(
      "acme",
      "kb_create_page",
      %{"repository" => "acme/web", "path" => "trash/a.md", "title" => "A", "body" => "x"},
      []
    )

    KnowledgeBaseTools.execute(
      "acme",
      "kb_create_page",
      %{"repository" => "acme/web", "path" => "trash/sub/b.md", "title" => "B", "body" => "y"},
      []
    )

    assert {:ok, result} =
             KnowledgeBaseTools.execute("acme", "kb_delete_folder", %{"repository" => "acme/web", "path" => "trash"}, [])

    assert result.tool == "kb_delete_folder"
    assert length(result.data.pages) == 2

    assert {:error, :kb_page_not_found} =
             KnowledgeBaseTools.execute("acme", "kb_read_page", %{"repository" => "acme/web", "path" => "trash/a.md"}, [])
  end

  test "kb_delete_folder on a missing folder returns folder_not_found" do
    assert {:error, :kb_folder_not_found} =
             KnowledgeBaseTools.execute("acme", "kb_delete_folder", %{"repository" => "acme/web", "path" => "ghost"}, [])
  end

  defp git!(dir, args), do: {_out, 0} = System.cmd("git", args, cd: dir, stderr_to_stdout: true)
end
