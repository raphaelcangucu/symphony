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

  test "rejects symlink and other non-file archive entries" do
    assert {:error, :unsafe_archive_path} =
             Artifact.validate_entries([
               {~c"release/link", :symlink, 0, 0, 0, 0, 0}
             ])

    assert :ok =
             Artifact.validate_entries([
               {~c"release/bin/symphony", :regular, 10, 0, 0, 0, 0},
               {~c"release/bin", :directory, 0, 0, 0, 0, 0}
             ])
  end

  test "rejects a manifest version that escapes the releases directory" do
    root =
      Path.join(
        System.tmp_dir!(),
        "daemon-artifact-version-#{System.unique_integer([:positive, :monotonic])}"
      )

    paths =
      Paths.resolve(%{
        "HOME" => Path.join(root, "home"),
        "SYMPHONY_INSTALL_ROOT" => Path.join(root, "lib/symphony")
      })

    artifact = Path.join(root, "candidate.tar.gz")
    File.mkdir_p!(root)

    manifest =
      Jason.encode!(manifest_for(%{"bin/symphony-daemon" => "candidate"}, %{"version" => "../escape"}))

    :ok =
      :erl_tar.create(
        String.to_charlist(artifact),
        [
          {~c"release/manifest.json", manifest},
          {~c"release/bin/symphony-daemon", "candidate"}
        ],
        [:compressed]
      )

    on_exit(fn -> File.rm_rf!(root) end)

    assert {:error, :incompatible_manifest} = Artifact.stage(artifact, paths)
    refute File.exists?(Path.join(paths.install_root, "escape"))
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

    manifest = Jason.encode!(manifest_for(%{"bin/symphony-daemon" => "candidate"}))

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

  test "rejects a file that does not match the release manifest checksum" do
    root =
      Path.join(
        System.tmp_dir!(),
        "daemon-artifact-checksum-#{System.unique_integer([:positive, :monotonic])}"
      )

    paths =
      Paths.resolve(%{
        "HOME" => Path.join(root, "home"),
        "SYMPHONY_INSTALL_ROOT" => Path.join(root, "lib/symphony")
      })

    archive = Path.join(root, "candidate.tar.gz")
    File.mkdir_p!(root)
    manifest = Jason.encode!(manifest_for(%{"bin/symphony-daemon" => "expected"}))

    :ok =
      :erl_tar.create(
        String.to_charlist(archive),
        [
          {~c"release/manifest.json", manifest},
          {~c"release/bin/symphony-daemon", "tampered"}
        ],
        [:compressed]
      )

    on_exit(fn -> File.rm_rf!(root) end)
    assert {:error, :checksum_mismatch} = Artifact.stage(archive, paths)
  end

  defp manifest_for(files, overrides \\ %{}) do
    checksums =
      Map.new(files, fn {path, contents} ->
        digest = contents |> then(&:crypto.hash(:sha256, &1)) |> Base.encode16(case: :lower)
        {path, digest}
      end)

    Map.merge(
      %{
        "version" => "0.3.0",
        "git_commit" => "candidate-commit",
        "target_os" => "linux",
        "system_architecture" => :erlang.system_info(:system_architecture) |> to_string(),
        "checksums" => checksums
      },
      overrides
    )
  end
end
