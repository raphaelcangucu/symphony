defmodule SymphonyElixir.Daemon.SystemdIntegrationTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Daemon.{Environment, Install, Lifecycle, Paths, Preflight, Status}

  test "install and lifecycle commands work through an isolated systemd runner" do
    root =
      Path.join(
        System.tmp_dir!(),
        "daemon-systemd-integration-#{System.unique_integer([:positive, :monotonic])}"
      )

    paths =
      Paths.resolve(%{
        "HOME" => Path.join(root, "home"),
        "XDG_CONFIG_HOME" => Path.join(root, "config"),
        "XDG_DATA_HOME" => Path.join(root, "data"),
        "XDG_STATE_HOME" => Path.join(root, "state"),
        "SYMPHONY_INSTALL_ROOT" => Path.join(root, "lib/symphony"),
        "SYMPHONY_DAEMON_UNIT" => "symphony-integration.service"
      })

    artifact = create_artifact(root)
    {:ok, systemd} = Agent.start_link(fn -> %{active?: false, enabled?: false, restarts: 0} end)
    runner = fake_systemd_runner(systemd)
    systemd_opts = [runner: runner]
    on_exit(fn -> File.rm_rf!(root) end)

    wait_healthy = fn ->
      composed_status(systemd, paths)
    end

    migrate = fn _opts ->
      :ok = SymphonyElixir.Daemon.Files.ensure_private_dir(Path.dirname(paths.database))
      {:ok, db} = Exqlite.Sqlite3.open(paths.database)
      :ok = Exqlite.Sqlite3.execute(db, "CREATE TABLE schema_migrations (version INTEGER)")
      :ok = Exqlite.Sqlite3.execute(db, "INSERT INTO schema_migrations(version) VALUES (1)")
      :ok = Exqlite.Sqlite3.close(db)
      :ok = SymphonyElixir.Daemon.Migration.integrity(paths.database)
      {:ok, %{source_sha256: nil, previous_backup: nil, database_existed?: false}}
    end

    assert {:ok, %{version: "0.3.0"}} =
             Install.run(artifact,
               paths: paths,
               acknowledged: true,
               env: %{
                 "HOME" => paths.home,
                 "PATH" => "/usr/bin",
                 "LANG" => "C.UTF-8",
                 "SYMPHONY_CODEX_COMMAND" => "true"
               },
               systemd_opts: systemd_opts,
               deps: %{migrate: migrate, wait_healthy: wait_healthy}
             )

    assert {:ok, installed_env} = Environment.read(paths.env_file)

    assert {:ok, []} =
             Preflight.run(
               env: installed_env,
               service_pid: 42,
               deps: %{
                 os_type: fn -> {:unix, :linux} end,
                 systemd_ready: fn -> true end,
                 agent_available: fn -> true end,
                 listener: fn _port -> {:owned, [42]} end,
                 optional_warnings: fn -> [] end
               }
             )

    lifecycle_deps = %{
      status: fn -> composed_status(systemd, paths) end,
      wait_healthy: wait_healthy
    }

    lifecycle_opts = [
      paths: paths,
      systemd_opts: systemd_opts,
      deps: lifecycle_deps
    ]

    assert {:ok, %{state: :healthy}} = Lifecycle.status(lifecycle_opts)
    assert :ok = Lifecycle.stop(lifecycle_opts)
    assert {:ok, %{state: :healthy}} = Lifecycle.start(lifecycle_opts)
    assert {:ok, %{state: :healthy}} = Lifecycle.restart(lifecycle_opts)
    assert :ok = Lifecycle.uninstall(lifecycle_opts)

    assert File.exists?(paths.env_file)
    assert File.exists?(paths.install_manifest)
    assert File.exists?(paths.database)
    assert File.dir?(paths.backup_dir)
    assert File.dir?(paths.releases_dir)
    refute File.exists?(paths.unit_file)
    refute File.exists?(paths.current_link)
  end

  defp create_artifact(root) do
    artifact = Path.join(root, "symphony-0.3.0.tar.gz")
    File.mkdir_p!(root)

    executable = "#!/bin/sh\nexit 0\n"
    digest = executable |> then(&:crypto.hash(:sha256, &1)) |> Base.encode16(case: :lower)

    manifest =
      Jason.encode!(%{
        "version" => "0.3.0",
        "git_commit" => "integration-commit",
        "target_os" => "linux",
        "system_architecture" => :erlang.system_info(:system_architecture) |> to_string(),
        "checksums" => %{"bin/symphony-daemon" => digest}
      })

    :ok =
      :erl_tar.create(
        String.to_charlist(artifact),
        [
          {~c"release/manifest.json", manifest},
          {~c"release/bin/symphony-daemon", executable}
        ],
        [:compressed]
      )

    artifact
  end

  defp fake_systemd_runner(agent) do
    fn "systemctl", args, _opts ->
      case args do
        ["--user", "daemon-reload"] ->
          {"", 0}

        ["--user", "enable", "--now", _unit] ->
          Agent.update(agent, &%{&1 | active?: true, enabled?: true})
          {"", 0}

        ["--user", "start", _unit] ->
          Agent.update(agent, &%{&1 | active?: true})
          {"", 0}

        ["--user", "stop", _unit] ->
          Agent.update(agent, &%{&1 | active?: false})
          {"", 0}

        ["--user", "restart", _unit] ->
          Agent.update(agent, &%{&1 | active?: true, restarts: &1.restarts + 1})
          {"", 0}

        ["--user", "disable", "--now", _unit] ->
          Agent.update(agent, &%{&1 | active?: false, enabled?: false})
          {"", 0}

        _other ->
          {"unsupported fake systemd command: #{inspect(args)}", 1}
      end
    end
  end

  defp composed_status(agent, paths) do
    state = Agent.get(agent, & &1)

    service = fn _unit ->
      {:ok,
       %{
         "LoadState" => if(File.exists?(paths.unit_file), do: "loaded", else: "not-found"),
         "UnitFileState" => if(state.enabled?, do: "enabled", else: "disabled"),
         "ActiveState" => if(state.active?, do: "active", else: "inactive"),
         "MainPID" => if(state.active?, do: "42", else: "0"),
         "NRestarts" => Integer.to_string(state.restarts),
         "Result" => "success"
       }}
    end

    deps = %{
      service: service,
      listener: fn _port -> if(state.active?, do: {:owned, [42]}, else: :free) end,
      health: fn _host, _port ->
        if state.active? do
          {:ok,
           %{
             "status" => "ok",
             "version" => "0.3.0",
             "git_commit" => "integration-commit",
             "tracker_host" => "127.0.0.1",
             "tracker_port" => 4_000
           }}
        else
          {:error, :econnrefused}
        end
      end,
      linger: fn -> {:ok, false} end
    }

    Status.inspect(paths, host: "127.0.0.1", port: 4_000, deps: deps)
  end
end
