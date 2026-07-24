defmodule SymphonyElixir.Daemon.PreflightTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.Preflight

  test "missing acknowledgement is a non-restartable error" do
    assert {:error, message} =
             Preflight.run(
               env: %{"HOME" => "/home/alice"},
               deps: permissive_deps()
             )

    assert message =~ "guardrails"
  end

  test "foreign port ownership fails without killing the process" do
    deps = %{permissive_deps() | listener: fn _ -> {:owned, [999]} end}

    assert {:error, message} =
             Preflight.run(
               env: acknowledged_env(),
               service_pid: nil,
               deps: deps
             )

    assert message =~ "port 4000"
    assert message =~ "999"
  end

  test "malformed port is a controlled non-restartable error" do
    env = Map.put(acknowledged_env(), "SYMPHONY_TRACKER_PORT", "not-a-port")

    assert {:error, message} =
             Preflight.run(
               env: env,
               deps: permissive_deps()
             )

    assert message =~ "SYMPHONY_TRACKER_PORT"
  end

  test "private daemon directories must be owned and mode 0700" do
    root = Path.join(System.tmp_dir!(), "daemon-preflight-modes-#{System.unique_integer([:positive])}")
    on_exit(fn -> File.rm_rf!(root) end)

    env =
      acknowledged_env()
      |> Map.merge(%{
        "HOME" => root,
        "XDG_CONFIG_HOME" => Path.join(root, "config"),
        "XDG_DATA_HOME" => Path.join(root, "data"),
        "XDG_STATE_HOME" => Path.join(root, "state"),
        "SYMPHONY_INSTALL_ROOT" => Path.join(root, "install")
      })

    paths = SymphonyElixir.Daemon.Paths.resolve(env)

    Enum.each([paths.config_dir, paths.data_dir, paths.state_dir, paths.install_root], fn path ->
      File.mkdir_p!(path)
      File.chmod!(path, 0o755)
    end)

    deps = Map.delete(permissive_deps(), :paths_writable)
    assert {:error, message} = Preflight.run(env: env, deps: deps)
    assert message =~ "directories"
  end

  defp acknowledged_env do
    %{
      "HOME" => "/home/alice",
      "SYMPHONY_RUNTIME_MODE" => "installed",
      "SYMPHONY_UNGUARDED_ACKNOWLEDGED" => "true",
      "SYMPHONY_TRACKER_PORT" => "4000"
    }
  end

  defp permissive_deps do
    %{
      os_type: fn -> {:unix, :linux} end,
      systemd_ready: fn -> true end,
      manifest_valid: fn -> true end,
      paths_writable: fn -> true end,
      environment_valid: fn -> true end,
      env_mode: fn -> 0o600 end,
      database_valid: fn -> true end,
      agent_available: fn -> true end,
      listener: fn _port -> :free end,
      optional_warnings: fn -> [] end
    }
  end
end
