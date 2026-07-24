defmodule SymphonyElixir.Daemon.ManifestTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.Manifest

  test "round-trips a manifest through an atomic JSON write" do
    root = Path.join(System.tmp_dir!(), "daemon-manifest-#{System.unique_integer([:positive])}")
    path = Path.join(root, "install.json")
    on_exit(fn -> File.rm_rf!(root) end)

    manifest = %{
      "version" => "0.3.0",
      "git_commit" => "abc",
      "artifact_sha256" => String.duplicate("0", 64)
    }

    assert :ok = Manifest.write(path, manifest)
    assert {:ok, ^manifest} = Manifest.read(path)
    assert {:error, :missing} = Manifest.read(path <> ".missing")
  end
end
