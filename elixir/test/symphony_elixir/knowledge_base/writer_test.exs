defmodule SymphonyElixir.KnowledgeBase.WriterTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.KnowledgeBase.{Workspace, Writer}

  setup do
    base = Path.join(System.tmp_dir!(), "kb-writer-#{System.unique_integer([:positive])}")
    checkout = Path.join(base, "repo")
    File.mkdir_p!(checkout)
    sh(checkout, ["init", "-q", "-b", "main"])

    sh(checkout, [
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "--allow-empty",
      "-q",
      "-m",
      "init"
    ])

    {:ok, ws} = Workspace.ensure(checkout)
    on_exit(fn -> File.rm_rf(base) end)
    {:ok, ws: ws}
  end

  test "write_page creates a file, commits it, and is readable", %{ws: ws} do
    assert {:ok, result} =
             Writer.write_page(ws, ["guide.md"], %{
               frontmatter: %{"title" => "Guide"},
               body: "# Guide\n"
             })

    assert result.path == "guide.md"
    assert is_binary(result.commit)
    assert File.read!(Path.join(ws.docs_root, "guide.md")) =~ "title: Guide"
    assert {:ok, ""} = SymphonyElixir.KnowledgeBase.Git.status_porcelain(ws.worktree)
  end

  test "write_page with identical content is a successful no-op (no empty commit)", %{ws: ws} do
    page = %{frontmatter: %{"title" => "Guide"}, body: "# Guide\n"}
    assert {:ok, %{commit: first}} = Writer.write_page(ws, ["guide.md"], page)
    assert is_binary(first)

    assert {:ok, %{commit: :unchanged}} = Writer.write_page(ws, ["guide.md"], page)
    assert {:ok, ""} = SymphonyElixir.KnowledgeBase.Git.status_porcelain(ws.worktree)
  end

  test "move_page renames within docs and commits", %{ws: ws} do
    {:ok, _} = Writer.write_page(ws, ["a.md"], %{frontmatter: %{}, body: "x"})
    assert {:ok, result} = Writer.move_page(ws, ["a.md"], ["b", "c.md"])
    assert result.path == "b/c.md"
    refute File.exists?(Path.join(ws.docs_root, "a.md"))
    assert File.exists?(Path.join(ws.docs_root, "b/c.md"))
  end

  test "delete_page removes the file and commits", %{ws: ws} do
    {:ok, _} = Writer.write_page(ws, ["a.md"], %{frontmatter: %{}, body: "x"})
    assert {:ok, _} = Writer.delete_page(ws, ["a.md"])
    refute File.exists?(Path.join(ws.docs_root, "a.md"))
  end

  test "store_asset writes a content-hashed file under assets and returns a relative link", %{
    ws: ws
  } do
    assert {:ok, result} =
             Writer.store_asset(ws, "diagram.png", <<137, 80, 78, 71>>, page_path: "architecture/x.md")

    assert String.starts_with?(result.asset_path, "assets/")
    assert result.markdown_link == "../" <> result.asset_path
    assert File.exists?(Path.join(ws.docs_root, result.asset_path))
  end

  test "store_asset with a friendly name slugs it and reuses identical bytes", %{ws: ws} do
    assert {:ok, %{asset_path: "assets/queue-config.png"}} =
             Writer.store_asset(ws, "whatever.png", <<137, 80, 78, 71>>, name: "Queue Config!")

    # Re-storing identical bytes under the same name is an idempotent no-op.
    assert {:ok, %{asset_path: "assets/queue-config.png", commit: :unchanged}} =
             Writer.store_asset(ws, "whatever.png", <<137, 80, 78, 71>>, name: "queue config")
  end

  test "store_asset appends a suffix when the friendly name collides with other bytes", %{ws: ws} do
    assert {:ok, %{asset_path: "assets/logo.png"}} =
             Writer.store_asset(ws, "a.png", <<1, 2, 3>>, name: "logo")

    assert {:ok, %{asset_path: "assets/logo-2.png"}} =
             Writer.store_asset(ws, "b.png", <<4, 5, 6>>, name: "logo")
  end

  test "rename_asset renames the file and rewrites references in pages", %{ws: ws} do
    {:ok, %{asset_path: asset_path}} =
      Writer.store_asset(ws, "diagram.png", <<137, 80, 78, 71>>, name: "old diagram")

    assert asset_path == "assets/old-diagram.png"

    {:ok, _} =
      Writer.write_page(ws, ["architecture", "page.md"], %{
        frontmatter: %{},
        body: "See ![Diagram](../assets/old-diagram.png) here.\n"
      })

    assert {:ok, result} = Writer.rename_asset(ws, "assets/old-diagram.png", "New Diagram")
    assert result.asset_path == "assets/new-diagram.png"
    assert result.pages == ["architecture/page.md"]

    refute File.exists?(Path.join(ws.docs_root, "assets/old-diagram.png"))
    assert File.exists?(Path.join(ws.docs_root, "assets/new-diagram.png"))

    body = File.read!(Path.join(ws.docs_root, "architecture/page.md"))
    assert body =~ "../assets/new-diagram.png"
    refute body =~ "old-diagram.png"
  end

  test "rename_asset rejects paths outside the assets directory", %{ws: ws} do
    assert {:error, :kb_invalid_path} = Writer.rename_asset(ws, "../../etc/passwd", "evil")
  end

  test "delete_asset removes the asset file and commits", %{ws: ws} do
    {:ok, %{asset_path: asset_path}} =
      Writer.store_asset(ws, "diagram.png", <<137, 80, 78, 71>>, name: "doomed")

    assert asset_path == "assets/doomed.png"
    assert File.exists?(Path.join(ws.docs_root, asset_path))

    assert {:ok, result} = Writer.delete_asset(ws, asset_path)
    assert result.path == asset_path
    assert is_binary(result.commit)
    refute File.exists?(Path.join(ws.docs_root, asset_path))
    assert {:ok, ""} = SymphonyElixir.KnowledgeBase.Git.status_porcelain(ws.worktree)
  end

  test "delete_asset reports a missing file without committing", %{ws: ws} do
    assert {:error, :kb_page_not_found} = Writer.delete_asset(ws, "assets/ghost.png")
  end

  test "delete_asset rejects paths outside the assets directory", %{ws: ws} do
    assert {:error, :kb_invalid_path} = Writer.delete_asset(ws, "../../etc/passwd")
  end

  test "delete_folder removes the directory recursively and reports nested pages", %{ws: ws} do
    {:ok, _} = Writer.write_page(ws, ["guides", "intro.md"], %{frontmatter: %{}, body: "a"})
    {:ok, _} = Writer.write_page(ws, ["guides", "deep", "more.md"], %{frontmatter: %{}, body: "b"})
    {:ok, _} = Writer.store_asset(ws, "x.png", <<137, 80, 78, 71>>, name: "inside")

    assert {:ok, result} = Writer.delete_folder(ws, ["guides"])
    assert result.path == "guides"
    assert Enum.sort(result.pages) == ["guides/deep/more.md", "guides/intro.md"]
    refute File.dir?(Path.join(ws.docs_root, "guides"))
    # Sibling content outside the folder is untouched.
    assert File.exists?(Path.join(ws.docs_root, "assets/inside.png"))
    assert {:ok, ""} = SymphonyElixir.KnowledgeBase.Git.status_porcelain(ws.worktree)
  end

  test "delete_folder reports a missing directory", %{ws: ws} do
    assert {:error, :kb_folder_not_found} = Writer.delete_folder(ws, ["ghost"])
  end

  test "delete_folder rejects path traversal", %{ws: ws} do
    assert {:error, :kb_invalid_path} = Writer.delete_folder(ws, ["..", "etc"])
    assert {:error, :kb_invalid_path} = Writer.delete_folder(ws, [""])
  end

  defp sh(dir, args), do: {_o, 0} = System.cmd("git", args, cd: dir, stderr_to_stdout: true)
end
