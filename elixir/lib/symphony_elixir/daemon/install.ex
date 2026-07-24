defmodule SymphonyElixir.Daemon.Install do
  @moduledoc "Transactional installed-release activation with health rollback."

  alias SymphonyElixir.Daemon.{
    Artifact,
    Configuration,
    Environment,
    Files,
    HealthProbe,
    Manifest,
    Migration,
    Paths,
    Status,
    Systemd,
    Systemd.Unit
  }

  @spec run(Path.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def run(artifact, opts \\ []) do
    paths = Keyword.get_lazy(opts, :paths, &Paths.resolve/0)
    force? = Keyword.get(opts, :force, false)
    previous = capture(paths)
    deps = Map.merge(default_deps(paths, opts), Map.new(Keyword.get(opts, :deps, %{})))

    with :ok <- require_acknowledgement(opts),
         :ok <- maybe_enable_linger(opts, deps) do
      case deps.stage.(artifact, paths) do
        {:ok, candidate} ->
          install_candidate(candidate, previous, paths, force?, opts, deps)

        {:error, reason} ->
          {:error, {:install_failed, reason}}
      end
    end
  end

  defp install_candidate(candidate, previous, paths, force?, opts, deps) do
    with :ok <- validate_same_version(candidate, previous, force?, deps) do
      case deps.migrate.(opts) do
        {:ok, migration} ->
          activate_candidate(candidate, migration, previous, paths, deps)

        {:error, reason} ->
          rollback_staged_failure(reason, candidate, deps)
      end
    else
      {:already_installed, status} ->
        complete_idempotent_install(candidate, status, deps)

      {:error, reason} ->
        rollback_staged_failure(reason, candidate, deps)
    end
  end

  defp activate_candidate(candidate, migration, previous, paths, deps) do
    result =
      with :ok <- deps.prepare_directories.(),
           :ok <- deps.write_environment.(candidate),
           :ok <- deps.write_launcher.(candidate),
           :ok <- deps.write_unit.(candidate),
           :ok <- write_install_manifest(paths, candidate, migration),
           :ok <- deps.daemon_reload.(),
           :ok <- Files.atomic_symlink(candidate.path, paths.current_link),
           :ok <- deps.enable_or_restart.(),
           {:ok, _status} <- deps.wait_healthy.() do
        {:ok, %{version: candidate.version, path: candidate.path}}
      end

    case result do
      {:ok, _installed} = success ->
        _ = deps.finalize_candidate.(candidate)
        success

      {:error, reason} ->
        rollback_failure(reason, candidate, migration, previous, paths, deps)
    end
  end

  defp default_deps(paths, opts) do
    source_env = Keyword.get(opts, :env, System.get_env())
    systemd_opts = Keyword.get(opts, :systemd_opts, [])

    %{
      stage: &Artifact.stage/2,
      finalize_candidate: &Artifact.finalize/1,
      rollback_candidate: &Artifact.rollback/1,
      rollback_migration: &Migration.restore(paths.database, &1),
      migrate: fn install_opts -> migrate_state(paths, install_opts) end,
      prepare_directories: fn -> prepare_directories(paths) end,
      write_environment: fn candidate ->
        write_environment(paths, candidate, source_env)
      end,
      write_launcher: fn _candidate ->
        Files.atomic_write(paths.launcher, render_launcher(paths), 0o755)
      end,
      write_unit: fn _candidate -> Files.atomic_write(paths.unit_file, Unit.render(paths), 0o644) end,
      daemon_reload: fn -> Systemd.daemon_reload(systemd_opts) end,
      enable_or_restart: fn -> Systemd.enable_now(paths.unit_name, systemd_opts) end,
      stop_candidate: fn -> Systemd.stop(paths.unit_name, systemd_opts) end,
      disable_candidate: fn -> Systemd.disable_now(paths.unit_name, systemd_opts) end,
      enable_linger: fn ->
        Systemd.enable_linger(source_env["USER"] || System.get_env("USER") || "", systemd_opts)
      end,
      current_status: fn -> Status.inspect(paths, env: source_env) end,
      wait_healthy: fn -> wait_healthy(paths, Keyword.put(opts, :env, source_env)) end
    }
  end

  defp require_acknowledgement(opts) do
    if Keyword.get(opts, :acknowledged, false) do
      :ok
    else
      {:error, {:preflight, "guardrails acknowledgement is required for the installed daemon"}}
    end
  end

  defp maybe_enable_linger(opts, deps) do
    if Keyword.get(opts, :enable_linger, false), do: deps.enable_linger.(), else: :ok
  end

  defp migrate_state(paths, opts) do
    case Keyword.get(opts, :migrate_from) do
      source when is_binary(source) and source != "" ->
        source = if File.dir?(source), do: Path.join(source, ".symphony/tracker.sqlite3"), else: source

        Migration.migrate(source, paths.database,
          backup_dir: paths.backup_dir,
          force: Keyword.get(opts, :force, false)
        )

      _ ->
        Migration.migrate_in_place(paths.database, paths.backup_dir)
    end
  end

  defp prepare_directories(paths) do
    [
      paths.config_dir,
      paths.data_dir,
      paths.backup_dir,
      paths.state_dir,
      paths.log_dir,
      paths.install_root,
      paths.releases_dir
    ]
    |> Enum.reduce_while(:ok, fn path, :ok ->
      case Files.ensure_private_dir(path) do
        :ok -> {:cont, :ok}
        {:error, _reason} = error -> {:halt, error}
      end
    end)
  end

  defp write_environment(paths, candidate, source_env) do
    installed = %{
      "HOME" => paths.home,
      "PATH" => source_env["PATH"],
      "LANG" => source_env["LANG"] || "C.UTF-8",
      "SYMPHONY_RUNTIME_MODE" => "installed",
      "SYMPHONY_UNGUARDED_ACKNOWLEDGED" => "true",
      "SYMPHONY_INSTALL_ROOT" => paths.install_root,
      "SYMPHONY_CONFIG_DIR" => paths.config_dir,
      "SYMPHONY_SYSTEMD_USER_DIR" => Path.dirname(paths.unit_file),
      "SYMPHONY_LAUNCHER_PATH" => paths.launcher,
      "SYMPHONY_DAEMON_UNIT" => paths.unit_name,
      "SYMPHONY_LOCAL_TRACKER_DATABASE" => paths.database,
      "SYMPHONY_BACKUP_DIR" => paths.backup_dir,
      "SYMPHONY_BUILD_COMMIT" => candidate.git_commit,
      "XDG_CONFIG_HOME" => Path.dirname(paths.config_dir),
      "XDG_DATA_HOME" => Path.dirname(paths.data_dir),
      "XDG_STATE_HOME" => Path.dirname(paths.state_dir)
    }

    allowed_source =
      Map.filter(source_env, fn {key, _value} ->
        key in [
          "PATH",
          "HOME",
          "LANG",
          "LC_ALL",
          "XDG_CONFIG_HOME",
          "XDG_DATA_HOME",
          "XDG_STATE_HOME"
        ] or String.starts_with?(key, "SYMPHONY_")
      end)

    rendered = allowed_source |> Map.merge(installed) |> Environment.render()
    Files.atomic_write(paths.env_file, rendered, 0o600)
  end

  defp wait_healthy(paths, opts) do
    deadline = System.monotonic_time(:millisecond) + 30_000
    do_wait_healthy(paths, opts, deadline)
  end

  defp do_wait_healthy(paths, opts, deadline) do
    with {:ok, %{host: host, port: port}} <- Configuration.endpoint(opts) do
      case HealthProbe.get(host, port) do
        {:ok, %{"status" => "ok"}} ->
          Status.inspect(paths, host: host, port: port)

        _ ->
          if System.monotonic_time(:millisecond) >= deadline do
            {:error, :candidate_unhealthy}
          else
            Process.sleep(250)
            do_wait_healthy(paths, opts, deadline)
          end
      end
    end
  end

  defp validate_same_version(candidate, previous, force?, deps) do
    previous_version =
      case previous.manifest do
        body when is_binary(body) ->
          case Jason.decode(body) do
            {:ok, manifest} -> manifest["version"]
            _ -> nil
          end

        _ ->
          nil
      end

    if previous_version == candidate.version and not force? do
      case deps.current_status.() do
        {:ok, %{state: :healthy} = status} -> {:already_installed, status}
        _ -> {:error, :same_version_requires_force}
      end
    else
      :ok
    end
  end

  defp complete_idempotent_install(candidate, status, deps) do
    case deps.rollback_candidate.(candidate) do
      :ok -> {:ok, %{version: candidate.version, path: candidate.path, already_installed: true, status: status}}
      error -> {:error, {:install_failed, {:idempotent_cleanup_failed, error}}}
    end
  end

  defp render_launcher(paths) do
    env_file = shell_single_quote(paths.env_file)

    """
    #!/bin/sh
    set -eu
    SYMPHONY_INSTALLED_ENV_FILE=#{env_file}
    export SYMPHONY_INSTALLED_ENV_FILE
    install_root="${SYMPHONY_INSTALL_ROOT:-$HOME/.local/lib/symphony}"
    exec "$install_root/current/bin/symphony-daemon" "$@"
    """
  end

  defp shell_single_quote(value) do
    "'" <> String.replace(value, "'", "'\"'\"'") <> "'"
  end

  defp write_install_manifest(paths, candidate, migration) do
    Manifest.write(paths.install_manifest, %{
      "version" => candidate.version,
      "git_commit" => candidate.git_commit,
      "artifact_sha256" => candidate.artifact_sha256,
      "installed_at" => DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601(),
      "migration" => stringify_keys(migration)
    })
  end

  defp stringify_keys(%{} = map), do: Map.new(map, fn {key, value} -> {to_string(key), value} end)
  defp stringify_keys(_value), do: %{}

  defp capture(paths) do
    %{
      link: read_link_or_nil(paths.current_link),
      unit: read_file_or_nil(paths.unit_file),
      launcher: read_file_or_nil(paths.launcher),
      environment: read_file_or_nil(paths.env_file),
      manifest: read_file_or_nil(paths.install_manifest)
    }
  end

  defp rollback_failure(reason, candidate, migration, previous, paths, deps) do
    results =
      []
      |> add_rollback_result(:stop_candidate, deps.stop_candidate.())
      |> maybe_disable_candidate(previous, deps)
      |> add_rollback_result(:release, deps.rollback_candidate.(candidate))
      |> maybe_rollback_migration(migration, deps)
      |> add_rollback_result(:link, restore_link(paths.current_link, previous.link))
      |> add_rollback_result(:unit, restore_file(paths.unit_file, previous.unit, 0o644))
      |> add_rollback_result(:launcher, restore_file(paths.launcher, previous.launcher, 0o755))
      |> add_rollback_result(
        :environment,
        restore_file(paths.env_file, previous.environment, 0o600)
      )
      |> add_rollback_result(
        :manifest,
        restore_file(paths.install_manifest, previous.manifest, 0o644)
      )
      |> add_rollback_result(:daemon_reload, deps.daemon_reload.())
      |> maybe_restart_previous(previous, deps)

    case results do
      [] -> {:error, {:install_failed, reason}}
      failures -> {:error, {:install_failed, reason, {:rollback_failed, Enum.reverse(failures)}}}
    end
  end

  defp rollback_staged_failure(reason, candidate, deps) do
    case deps.rollback_candidate.(candidate) do
      :ok -> {:error, {:install_failed, reason}}
      error -> {:error, {:install_failed, reason, {:rollback_failed, [{:release, error}]}}}
    end
  end

  defp maybe_disable_candidate(results, %{link: nil}, deps) do
    add_rollback_result(results, :disable_candidate, deps.disable_candidate.())
  end

  defp maybe_disable_candidate(results, _previous, _deps), do: results

  defp maybe_rollback_migration(results, nil, _deps), do: results

  defp maybe_rollback_migration(results, migration, deps) do
    add_rollback_result(results, :database, deps.rollback_migration.(migration))
  end

  defp maybe_restart_previous(results, %{link: nil}, _deps), do: results

  defp maybe_restart_previous(results, _previous, deps) do
    results
    |> add_rollback_result(:restart_previous, deps.enable_or_restart.())
    |> add_rollback_health(deps)
  end

  defp add_rollback_health([], deps) do
    case deps.wait_healthy.() do
      {:ok, _status} -> []
      {:error, reason} -> [{:rollback_health, reason}]
    end
  end

  defp add_rollback_health(results, _deps), do: results

  defp add_rollback_result(results, _step, :ok), do: results
  defp add_rollback_result(results, _step, {:ok, _value}), do: results
  defp add_rollback_result(results, step, error), do: [{step, error} | results]

  defp restore_link(path, nil), do: File.rm(path) |> ignore_missing()
  defp restore_link(path, target), do: Files.atomic_symlink(target, path)

  defp restore_file(path, nil, _mode), do: File.rm(path) |> ignore_missing()
  defp restore_file(path, contents, mode), do: Files.atomic_write(path, contents, mode)

  defp ignore_missing(:ok), do: :ok
  defp ignore_missing({:error, :enoent}), do: :ok
  defp ignore_missing(error), do: error

  defp read_link_or_nil(path) do
    case File.read_link(path) do
      {:ok, target} -> target
      _ -> nil
    end
  end

  defp read_file_or_nil(path) do
    case File.read(path) do
      {:ok, contents} -> contents
      _ -> nil
    end
  end
end
