defmodule SymphonyElixir.Daemon.FilesTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.Files

  test "atomic_write replaces content and applies the requested mode" do
    root = Path.join(System.tmp_dir!(), "daemon-files-#{System.unique_integer([:positive])}")
    path = Path.join(root, "config/value")
    on_exit(fn -> File.rm_rf!(root) end)

    assert :ok = Files.atomic_write(path, "first", 0o600)
    assert :ok = Files.atomic_write(path, "second", 0o600)
    assert File.read!(path) == "second"
    assert {:ok, %{mode: mode}} = File.stat(path)
    assert Bitwise.band(mode, 0o777) == 0o600
  end

  test "atomic_symlink switches targets without deleting either release" do
    root = Path.join(System.tmp_dir!(), "daemon-link-#{System.unique_integer([:positive])}")
    one = Path.join(root, "one")
    two = Path.join(root, "two")
    link = Path.join(root, "current")
    File.mkdir_p!(one)
    File.mkdir_p!(two)
    on_exit(fn -> File.rm_rf!(root) end)

    assert :ok = Files.atomic_symlink(one, link)
    assert :ok = Files.atomic_symlink(two, link)
    assert File.read_link!(link) == two
    assert File.dir?(one)
    assert File.dir?(two)
  end
end
