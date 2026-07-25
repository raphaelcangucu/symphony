defmodule SymphonyElixir.Daemon.InstallTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.{Files, Install, Paths}

  test "failed candidate health restores the previous release and unit" do
    root = tmp_installation()
    previous = Path.join(root.paths.releases_dir, "0.2.0")
    candidate = Path.join(root.paths.releases_dir, "0.3.0")
    File.mkdir_p!(previous)
    File.mkdir_p!(candidate)
    Files.atomic_symlink(previous, root.paths.current_link)
    Files.atomic_write(root.paths.unit_file, "old-unit", 0o644)
    Files.atomic_write(root.paths.env_file, "OLD_ENV=\"true\"\n", 0o600)
    test_pid = self()

    deps = %{
      stage: fn _artifact, _paths -> {:ok, candidate_info(candidate, "0.3.0")} end,
      migrate: fn _opts -> {:ok, %{}} end,
      rollback_migration: fn _migration ->
        send(test_pid, :migration_rolled_back)
        :ok
      end,
      write_environment: fn _ ->
        Files.atomic_write(root.paths.env_file, "NEW_ENV=\"true\"\n", 0o600)
      end,
      write_launcher: fn _ -> :ok end,
      write_unit: fn _ -> Files.atomic_write(root.paths.unit_file, "new-unit", 0o644) end,
      daemon_reload: fn -> :ok end,
      enable_or_restart: fn ->
        send(test_pid, :candidate_started)
        :ok
      end,
      stop_candidate: fn ->
        send(test_pid, :candidate_stopped)
        :ok
      end,
      wait_healthy: fn ->
        if File.read_link!(root.paths.current_link) == candidate,
          do: {:error, :candidate_unhealthy},
          else: {:ok, %{state: :healthy}}
      end
    }

    assert {:error, {:install_failed, :candidate_unhealthy}} =
             Install.run("/tmp/candidate.tgz",
               paths: root.paths,
               acknowledged: true,
               force: true,
               deps: deps
             )

    assert File.read_link!(root.paths.current_link) == previous
    assert File.read!(root.paths.unit_file) == "old-unit"
    assert File.read!(root.paths.env_file) == "OLD_ENV=\"true\"\n"
    assert_received :candidate_started
    assert_received :candidate_stopped
    assert_received :migration_rolled_back
  end

  test "first install reports success only after health" do
    root = tmp_installation()
    test_pid = self()
    deps = successful_deps(root, test_pid)

    assert {:ok, %{version: "0.3.0"}} =
             Install.run("/tmp/candidate.tgz",
               paths: root.paths,
               acknowledged: true,
               deps: deps
             )

    assert_received :health_checked
  end

  test "same-version rejection restores release contents staged for repair" do
    root = tmp_installation()
    target = Path.join(root.paths.releases_dir, "0.3.0")
    replaced = target <> ".replaced"
    File.mkdir_p!(target)
    File.write!(Path.join(target, "sentinel"), "previous")
    Files.atomic_symlink(target, root.paths.current_link)

    Files.atomic_write(
      root.paths.install_manifest,
      Jason.encode!(%{"version" => "0.3.0"}),
      0o644
    )

    File.rename!(target, replaced)
    File.mkdir_p!(target)
    File.write!(Path.join(target, "candidate"), "new")

    candidate =
      candidate_info(target, "0.3.0")
      |> Map.merge(%{replaced_path: replaced, staging_transaction: true})

    deps = %{
      stage: fn _artifact, _paths -> {:ok, candidate} end,
      daemon_reload: fn -> :ok end,
      enable_or_restart: fn -> :ok end
    }

    assert {:error, {:install_failed, :same_version_requires_force}} =
             Install.run("/tmp/candidate.tgz",
               paths: root.paths,
               acknowledged: true,
               deps: deps
             )

    assert File.read!(Path.join(target, "sentinel")) == "previous"
    refute File.exists?(Path.join(target, "candidate"))
  end

  test "same healthy version is an idempotent success" do
    root = tmp_installation()
    target = Path.join(root.paths.releases_dir, "0.3.0")
    replaced = target <> ".replaced"
    File.mkdir_p!(target)
    File.write!(Path.join(target, "sentinel"), "previous")
    Files.atomic_symlink(target, root.paths.current_link)
    Files.atomic_write(root.paths.install_manifest, Jason.encode!(%{"version" => "0.3.0"}), 0o644)

    File.rename!(target, replaced)
    File.mkdir_p!(target)

    candidate =
      candidate_info(target, "0.3.0")
      |> Map.merge(%{replaced_path: replaced, staging_transaction: true})

    deps = %{
      stage: fn _artifact, _paths -> {:ok, candidate} end,
      current_status: fn -> {:ok, %{state: :healthy}} end
    }

    assert {:ok, %{version: "0.3.0", already_installed: true}} =
             Install.run("/tmp/candidate.tgz",
               paths: root.paths,
               acknowledged: true,
               deps: deps
             )

    assert File.read!(Path.join(target, "sentinel")) == "previous"
  end

  test "generated launcher loads the installed environment contract" do
    root = tmp_installation()

    deps =
      successful_deps(root, self())
      |> Map.delete(:write_launcher)
      |> Map.delete(:write_environment)

    assert {:ok, _} =
             Install.run("/tmp/candidate.tgz",
               paths: root.paths,
               acknowledged: true,
               env: %{"HOME" => root.paths.home, "PATH" => "/usr/bin"},
               deps: deps
             )

    launcher = File.read!(root.paths.launcher)
    assert launcher =~ root.paths.env_file
    assert launcher =~ "SYMPHONY_INSTALLED_ENV_FILE="
    refute launcher =~ ~s(. "$env_file")

    installed_env = File.read!(root.paths.env_file)
    assert installed_env =~ "SYMPHONY_DAEMON_UNIT="
    assert installed_env =~ "XDG_DATA_HOME="
  end

  test "installation requires explicit guardrail acknowledgement" do
    root = tmp_installation()

    deps = %{
      stage: fn _artifact, _paths -> flunk("artifact must not be staged") end
    }

    assert {:error, {:preflight, message}} =
             Install.run("/tmp/candidate.tgz", paths: root.paths, deps: deps)

    assert message =~ "guardrails acknowledgement"
  end

  test "enable_linger invokes the host adapter only when requested" do
    root = tmp_installation()
    test_pid = self()

    deps = %{
      enable_linger: fn ->
        send(test_pid, :linger_enabled)
        :ok
      end,
      stage: fn _artifact, _paths -> {:error, :stop_after_linger} end
    }

    assert {:error, {:install_failed, :stop_after_linger}} =
             Install.run("/tmp/candidate.tgz",
               paths: root.paths,
               acknowledged: true,
               enable_linger: true,
               deps: deps
             )

    assert_received :linger_enabled
  end

  defp tmp_installation do
    root =
      Path.join(
        System.tmp_dir!(),
        "daemon-install-#{System.unique_integer([:positive, :monotonic])}"
      )

    paths =
      Paths.resolve(%{
        "HOME" => Path.join(root, "home"),
        "XDG_CONFIG_HOME" => Path.join(root, "config"),
        "XDG_DATA_HOME" => Path.join(root, "data"),
        "XDG_STATE_HOME" => Path.join(root, "state"),
        "SYMPHONY_INSTALL_ROOT" => Path.join(root, "lib/symphony")
      })

    on_exit(fn -> File.rm_rf!(root) end)
    %{root: root, paths: paths}
  end

  defp candidate_info(path, version) do
    %{
      path: path,
      version: version,
      git_commit: "candidate-commit",
      artifact_sha256: String.duplicate("a", 64),
      manifest: %{
        "version" => version,
        "git_commit" => "candidate-commit",
        "system_architecture" => :erlang.system_info(:system_architecture) |> to_string()
      }
    }
  end

  defp successful_deps(root, test_pid) do
    candidate = Path.join(root.paths.releases_dir, "0.3.0")
    File.mkdir_p!(candidate)

    %{
      stage: fn _artifact, _paths ->
        {:ok, candidate_info(candidate, "0.3.0")}
      end,
      migrate: fn _opts -> {:ok, %{source_sha256: nil}} end,
      write_environment: fn _candidate ->
        Files.atomic_write(root.paths.env_file, "SYMPHONY_RUNTIME_MODE=\"installed\"\n", 0o600)
      end,
      write_launcher: fn _candidate ->
        Files.atomic_write(root.paths.launcher, "#!/bin/sh\nexit 0\n", 0o755)
      end,
      write_unit: fn _candidate ->
        Files.atomic_write(root.paths.unit_file, "unit", 0o644)
      end,
      daemon_reload: fn -> :ok end,
      enable_or_restart: fn -> :ok end,
      wait_healthy: fn ->
        manifest = root.paths.install_manifest |> File.read!() |> Jason.decode!()
        assert manifest["version"] == "0.3.0"
        send(test_pid, :health_checked)
        {:ok, %{state: :healthy}}
      end
    }
  end
end
