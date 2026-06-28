defmodule SymphonyElixir.Workspace.FileSearchTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Workspace.FileSearch

  setup do
    root = Path.join(System.tmp_dir!(), "file-search-#{System.unique_integer([:positive])}")
    File.mkdir_p!(Path.join(root, "lib"))
    File.mkdir_p!(Path.join(root, "node_modules"))
    File.write!(Path.join(root, "lib/a.ex"), "a")
    File.write!(Path.join(root, "lib/b.ex"), "b")
    File.write!(Path.join(root, "node_modules/x.js"), "x")
    on_exit(fn -> File.rm_rf(root) end)
    {:ok, root: root}
  end

  test "substring match returns matching relative paths", %{root: root} do
    assert FileSearch.search(root, "a") == ["lib/a.ex"]
  end

  test "rejects path-traversal queries", %{root: root} do
    assert FileSearch.search(root, "..") == []
  end

  test "excludes denylisted directories", %{root: root} do
    refute "node_modules/x.js" in FileSearch.search(root, "x")
  end

  test "case-insensitive and matches nested relative path", %{root: root} do
    assert FileSearch.search(root, "LIB/A") == ["lib/a.ex"]
  end

  test "caps results at the limit", %{root: root} do
    Enum.each(1..10, fn n -> File.write!(Path.join(root, "lib/match#{n}.ex"), "x") end)
    assert length(FileSearch.search(root, "match", limit: 3)) == 3
  end

  test "missing root returns empty (never raises)" do
    assert FileSearch.search("/tmp/does-not-exist-#{System.unique_integer([:positive])}", "a") == []
  end

  test "nil/blank inputs return empty" do
    assert FileSearch.search(nil, "a") == []
    assert FileSearch.search("/tmp", "  ") == []
  end

  test "symlink escaping root is excluded", %{root: root} do
    outside = Path.join(System.tmp_dir!(), "outside-#{System.unique_integer([:positive])}")
    File.mkdir_p!(outside)
    File.write!(Path.join(outside, "secret.ex"), "secret")
    on_exit(fn -> File.rm_rf(outside) end)

    link = Path.join(root, "lib/secret.ex")
    File.ln_s(Path.join(outside, "secret.ex"), link)

    refute "lib/secret.ex" in FileSearch.search(root, "secret")
  end
end
