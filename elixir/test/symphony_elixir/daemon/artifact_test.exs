defmodule SymphonyElixir.Daemon.ArtifactTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.{Artifact, Paths}

  test "rejects absolute and parent-traversal tar entries" do
    assert {:error, :unsafe_archive_path} =
             Artifact.validate_entries([~c"../escape", ~c"bin/symphony"])

    assert {:error, :unsafe_archive_path} =
             Artifact.validate_entries([~c"/tmp/escape"])

    assert :ok =
             Artifact.validate_entries([
               ~c"bin/symphony",
               ~c"manifest.json",
               ~c"lib/app/ebin/app.beam"
             ])
  end

  test "staged replacement can restore an existing release" do
    root =
      Path.join(
        System.tmp_dir!(),
        "daemon-artifact-#{System.unique_integer([:positive, :monotonic])}"
      )

    paths =
      Paths.resolve(%{
        "HOME" => Path.join(root, "home"),
        "SYMPHONY_INSTALL_ROOT" => Path.join(root, "lib/symphony")
      })

    existing = Path.join(paths.releases_dir, "0.3.0")
    archive = Path.join(root, "candidate.tar.gz")
    File.mkdir_p!(existing)
    File.write!(Path.join(existing, "sentinel"), "previous")

    manifest =
      Jason.encode!(%{
        "version" => "0.3.0",
        "git_commit" => "candidate-commit",
        "system_architecture" => :erlang.system_info(:system_architecture) |> to_string()
      })

    :ok =
      :erl_tar.create(
        String.to_charlist(archive),
        [
          {~c"release/manifest.json", manifest},
          {~c"release/bin/symphony-daemon", "candidate"}
        ],
        [:compressed]
      )

    on_exit(fn -> File.rm_rf!(root) end)

    assert {:ok, candidate} = Artifact.stage(archive, paths)
    refute File.exists?(Path.join(existing, "sentinel"))
    assert File.exists?(Path.join(existing, "bin/symphony-daemon"))

    assert :ok = Artifact.rollback(candidate)
    assert File.read!(Path.join(existing, "sentinel")) == "previous"
    refute File.exists?(Path.join(existing, "bin/symphony-daemon"))
  end
end
