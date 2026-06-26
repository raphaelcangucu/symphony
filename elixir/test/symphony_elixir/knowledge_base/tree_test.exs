defmodule SymphonyElixir.KnowledgeBase.TreeTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.KnowledgeBase.Tree

  setup do
    root = Path.join(System.tmp_dir!(), "kb-tree-#{System.unique_integer([:positive])}")
    File.mkdir_p!(Path.join(root, "architecture"))
    File.mkdir_p!(Path.join(root, "assets"))
    File.write!(Path.join(root, "index.md"), "---\ntitle: Home\norder: 1\n---\n# Home\n")
    File.write!(Path.join(root, "guide.md"), "# A Guide\n")
    File.write!(Path.join(root, "architecture/backend.md"), "---\ntitle: Backend\n---\nx")
    File.write!(Path.join(root, "assets/logo.png"), "binary")
    on_exit(fn -> File.rm_rf(root) end)
    {:ok, root: root}
  end

  test "returns [] for a missing docs root" do
    assert Tree.build(Path.join(System.tmp_dir!(), "does-not-exist-#{System.unique_integer()}")) == []
  end

  test "builds a nested tree ordered by frontmatter order then title", %{root: root} do
    tree = Tree.build(root)

    names = Enum.map(tree, & &1.name)
    # index.md has order:1 so it sorts before "A Guide" (no order) and the folder
    assert "index.md" == hd(names)
    assert "guide.md" in names
    assert "architecture" in names

    folder = Enum.find(tree, &(&1.name == "architecture"))
    assert folder.type == :folder

    assert [%{type: :page, name: "backend.md", title: "Backend", path: "architecture/backend.md"}] =
             folder.children
  end

  test "includes assets folder with image files in the tree", %{root: root} do
    tree = Tree.build(root)
    names = Enum.map(tree, & &1.name)
    assert "assets" in names

    assets = Enum.find(tree, &(&1.name == "assets"))
    assert assets.type == :folder
    assert Enum.any?(assets.children, &(&1.type == :asset and &1.name == "logo.png"))
  end

  test "includes image files inside nested folders", %{root: root} do
    File.mkdir_p!(Path.join(root, "images"))
    File.write!(Path.join([root, "images", "diagram.png"]), "binary")

    tree = Tree.build(root)
    images = Enum.find(tree, &(&1.name == "images"))
    assert [%{type: :asset, name: "diagram.png", path: "images/diagram.png"}] = images.children
  end

  test "excludes dotfiles from the tree", %{root: root} do
    names = root |> Tree.build() |> Enum.map(& &1.name)
    refute ".hidden" in names
  end

  test "derives page title from frontmatter, H1, then humanized filename", %{root: root} do
    tree = Tree.build(root)
    assert Enum.find(tree, &(&1.name == "index.md")).title == "Home"
    assert Enum.find(tree, &(&1.name == "guide.md")).title == "A Guide"
  end
end
