defmodule SymphonyElixir.Daemon.Preflight do
  @moduledoc "Validates non-restartable installed-daemon prerequisites."

  alias SymphonyElixir.Daemon.{
    Artifact,
    Configuration,
    Environment,
    Listener,
    Manifest,
    Migration,
    Paths
  }

  @spec run(keyword()) :: {:ok, [String.t()]} | {:error, String.t()}
  def run(opts \\ []) do
    env = Keyword.get(opts, :env, System.get_env())
    deps = Map.merge(runtime_deps(env), Map.new(Keyword.get(opts, :deps, %{})))
    service_pid = Keyword.get(opts, :service_pid)

    with {:ok, %{port: port}} <- Configuration.endpoint(env: env) do
      run_checks(env, deps, service_pid, port)
    end
  end

  defp run_checks(env, deps, service_pid, port) do
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
      {:environment_syntax, deps.environment_valid.()},
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
      manifest_valid: fn -> installed_release_valid?(paths) end,
      paths_writable: fn -> private_paths_valid?(paths) end,
      environment_valid: fn -> match?({:ok, %{}}, Environment.read(paths.env_file)) end,
      env_mode: fn ->
        case File.stat(paths.env_file) do
          {:ok, stat} -> Bitwise.band(stat.mode, 0o777)
          _ -> 0
        end
      end,
      database_valid: fn -> Migration.valid?(paths.database) end,
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

  defp private_paths_valid?(paths) do
    with {:ok, uid} <- current_uid() do
      Enum.all?(
        [paths.config_dir, paths.data_dir, paths.state_dir, paths.install_root],
        fn path ->
          case File.stat(path) do
            {:ok, stat} ->
              stat.type == :directory and stat.uid == uid and stat.access == :read_write and
                Bitwise.band(stat.mode, 0o777) == 0o700

            _ ->
              false
          end
        end
      )
    else
      _ -> false
    end
  end

  defp current_uid do
    case System.cmd("id", ["-u"], stderr_to_stdout: true) do
      {output, 0} ->
        case Integer.parse(String.trim(output)) do
          {uid, ""} when uid >= 0 -> {:ok, uid}
          _ -> {:error, :invalid_uid}
        end

      _ ->
        {:error, :uid_unavailable}
    end
  rescue
    _ -> {:error, :uid_unavailable}
  end

  defp installed_release_valid?(paths) do
    with {:ok, manifest} <- Manifest.read(paths.install_manifest),
         version when is_binary(version) and version != "" <- manifest["version"],
         commit when is_binary(commit) and commit != "" <- manifest["git_commit"],
         digest when is_binary(digest) <- manifest["artifact_sha256"],
         true <- Regex.match?(~r/\A[0-9a-f]{64}\z/, digest),
         {:ok, current} <- File.read_link(paths.current_link),
         true <- current == Path.join(paths.releases_dir, version),
         :ok <- Artifact.validate_release(current) do
      true
    else
      _ -> false
    end
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

  defp failure_message(:environment_syntax, _port, _listener),
    do: "symphony.env contains invalid or unsafe syntax"

  defp failure_message(:database, _port, _listener),
    do: "tracker database failed readability or integrity checks"

  defp failure_message(:agent_command, _port, _listener),
    do: "configured default agent executable is unavailable"

  defp failure_message(:port, port, listener),
    do: "port #{port} is already owned by #{Kernel.inspect(listener)}"
end
