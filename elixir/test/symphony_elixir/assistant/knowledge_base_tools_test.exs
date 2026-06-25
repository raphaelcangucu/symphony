defmodule SymphonyElixir.Assistant.KnowledgeBaseToolsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.KnowledgeBaseTools
  alias SymphonyElixir.KnowledgeBaseTestFixtures, as: Fixtures

  setup do
    Fixtures.reset!()
    {:ok, ctx} = Fixtures.seed_single_repo_project("acme", "acme/web")
    on_exit(ctx.cleanup)
    :ok
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
end
