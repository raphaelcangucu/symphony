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

  defp sh(dir, args), do: {_o, 0} = System.cmd("git", args, cd: dir, stderr_to_stdout: true)
end
