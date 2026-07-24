defmodule SymphonyElixir.Daemon.Preflight do
  @moduledoc "Validates non-restartable installed-daemon prerequisites."

  alias SymphonyElixir.Daemon.{Listener, Manifest, Paths}

  @spec run(keyword()) :: {:ok, [String.t()]} | {:error, String.t()}
  def run(opts \\ []) do
    env = Keyword.get(opts, :env, System.get_env())
    deps = Map.merge(runtime_deps(env), Map.new(Keyword.get(opts, :deps, %{})))
    service_pid = Keyword.get(opts, :service_pid)
    port = env |> Map.get("SYMPHONY_TRACKER_PORT", "4000") |> String.to_integer()
    listener = deps.listener.(port)

    port_owned_by_service? =
      case listener do
        {:owned, pids} when is_integer(service_pid) -> service_pid in pids
        _ -> false
      end

    checks = [
      {:platform, deps.os_type.() == {:unix, :linux}},
      {:acknowledgement, env["SYMPHONY_UNGUARDED_ACKNOWLEDGED"] == "true"},
      {:systemd_user_manager, deps.systemd_ready.()},
      {:release_manifest, deps.manifest_valid.()},
      {:directories, deps.paths_writable.()},
      {:environment_mode, deps.env_mode.() == 0o600},
      {:database, deps.database_valid.()},
      {:agent_command, deps.agent_available.()},
      {:port, listener == :free or port_owned_by_service?}
    ]

    case Enum.find(checks, fn {_name, passed?} -> not passed? end) do
      nil -> {:ok, deps.optional_warnings.()}
      {name, false} -> {:error, failure_message(name, port, listener)}
    end
  end

  defp runtime_deps(env) do
    paths = Paths.resolve(env)

    %{
      os_type: &:os.type/0,
      systemd_ready: &systemd_ready?/0,
      manifest_valid: fn -> match?({:ok, %{}}, Manifest.read(paths.install_manifest)) end,
      paths_writable: fn ->
        Enum.all?(
          [paths.config_dir, paths.data_dir, paths.state_dir, paths.install_root],
          &File.dir?/1
        )
      end,
      env_mode: fn ->
        case File.stat(paths.env_file) do
          {:ok, stat} -> Bitwise.band(stat.mode, 0o777)
          _ -> 0
        end
      end,
      database_valid: fn -> File.regular?(paths.database) end,
      agent_available: fn ->
        command =
          env["SYMPHONY_CODEX_COMMAND"] ||
            env["SYMPHONY_CLAUDE_COMMAND"] ||
            env["SYMPHONY_CURSOR_COMMAND"] ||
            "codex"

        executable = command |> String.split() |> List.first()
        is_binary(executable) and not is_nil(System.find_executable(executable))
      end,
      listener: &Listener.probe/1,
      optional_warnings: fn -> [] end
    }
  end

  defp systemd_ready? do
    case System.cmd("systemctl", ["--user", "show-environment"], stderr_to_stdout: true) do
      {_output, 0} -> true
      _ -> false
    end
  rescue
    _ -> false
  end

  defp failure_message(:platform, _port, _listener),
    do: "Symphony daemon currently requires Linux"

  defp failure_message(:acknowledgement, _port, _listener),
    do: "guardrails acknowledgement is required for the installed daemon"

  defp failure_message(:systemd_user_manager, _port, _listener),
    do: "systemd user manager is unavailable"

  defp failure_message(:release_manifest, _port, _listener),
    do: "release manifest is missing or invalid"

  defp failure_message(:directories, _port, _listener),
    do: "daemon directories are not writable by the current user"

  defp failure_message(:environment_mode, _port, _listener),
    do: "symphony.env must have mode 0600"

  defp failure_message(:database, _port, _listener),
    do: "tracker database failed readability or integrity checks"

  defp failure_message(:agent_command, _port, _listener),
    do: "configured default agent executable is unavailable"

  defp failure_message(:port, port, listener),
    do: "port #{port} is already owned by #{Kernel.inspect(listener)}"
end
