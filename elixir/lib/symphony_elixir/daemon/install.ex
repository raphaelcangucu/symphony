defmodule SymphonyElixir.Daemon.Install do
  @moduledoc "Transactional installed-release activation with health rollback."

  alias SymphonyElixir.Daemon.{
    Artifact,
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

  @launcher """
  #!/bin/sh
  set -eu
  install_root="${SYMPHONY_INSTALL_ROOT:-$HOME/.local/lib/symphony}"
  exec "$install_root/current/bin/symphony-daemon" "$@"
  """

  @spec run(Path.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def run(artifact, opts \\ []) do
    paths = Keyword.get_lazy(opts, :paths, &Paths.resolve/0)
    force? = Keyword.get(opts, :force, false)
    previous = capture(paths)
    deps = Map.merge(default_deps(paths, opts), Map.new(Keyword.get(opts, :deps, %{})))

    case deps.stage.(artifact, paths) do
      {:ok, candidate} ->
        install_candidate(candidate, previous, paths, force?, opts, deps)

      {:error, reason} ->
        {:error, {:install_failed, reason}}
    end
  end

  defp install_candidate(candidate, previous, paths, force?, opts, deps) do
    result =
      with :ok <- validate_same_version(candidate, previous, force?),
           {:ok, migration} <- deps.migrate.(opts),
           :ok <- deps.write_environment.(candidate),
           :ok <- deps.write_launcher.(candidate),
           :ok <- deps.write_unit.(candidate),
           :ok <- deps.daemon_reload.(),
           :ok <- Files.atomic_symlink(candidate.path, paths.current_link),
           :ok <- deps.enable_or_restart.(),
           {:ok, _status} <- deps.wait_healthy.(),
           :ok <- write_install_manifest(paths, candidate, migration) do
        {:ok, %{version: candidate.version, path: candidate.path}}
      end

    case result do
      {:ok, _installed} = success ->
        _ = deps.finalize_candidate.(candidate)
        success

      {:error, reason} ->
        _ = deps.rollback_candidate.(candidate)
        rollback(previous, paths, deps)
        {:error, {:install_failed, reason}}
    end
  end

  defp default_deps(paths, opts) do
    source_env = Keyword.get(opts, :env, System.get_env())
    systemd_opts = Keyword.get(opts, :systemd_opts, [])

    %{
      stage: &Artifact.stage/2,
      finalize_candidate: &Artifact.finalize/1,
      rollback_candidate: &Artifact.rollback/1,
      migrate: fn install_opts -> migrate_state(paths, install_opts) end,
      write_environment: fn candidate ->
        write_environment(paths, candidate, source_env)
      end,
      write_launcher: fn _candidate -> Files.atomic_write(paths.launcher, @launcher, 0o755) end,
      write_unit: fn _candidate -> Files.atomic_write(paths.unit_file, Unit.render(paths), 0o644) end,
      daemon_reload: fn -> Systemd.daemon_reload(systemd_opts) end,
      enable_or_restart: fn -> Systemd.enable_now(paths.unit_name, systemd_opts) end,
      wait_healthy: fn -> wait_healthy(paths, opts) end
    }
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
        :ok = File.mkdir_p(Path.dirname(paths.database))

        with :ok <- Migration.migrate_release(paths.database) do
          {:ok, %{source_sha256: nil, previous_backup: nil}}
        end
    end
  end

  defp write_environment(paths, candidate, source_env) do
    installed = %{
      "HOME" => paths.home,
      "PATH" => source_env["PATH"],
      "LANG" => source_env["LANG"] || "C.UTF-8",
      "SYMPHONY_RUNTIME_MODE" => "installed",
      "SYMPHONY_UNGUARDED_ACKNOWLEDGED" => "true",
      "SYMPHONY_INSTALL_ROOT" => paths.install_root,
      "SYMPHONY_LOCAL_TRACKER_DATABASE" => paths.database,
      "SYMPHONY_BACKUP_DIR" => paths.backup_dir,
      "SYMPHONY_BUILD_COMMIT" => candidate.git_commit
    }

    allowed_source =
      Map.filter(source_env, fn {key, _value} ->
        key in ["PATH", "HOME", "LANG", "LC_ALL"] or String.starts_with?(key, "SYMPHONY_")
      end)

    rendered = allowed_source |> Map.merge(installed) |> Environment.render()
    Files.atomic_write(paths.env_file, rendered, 0o600)
  end

  defp wait_healthy(paths, opts) do
    deadline = System.monotonic_time(:millisecond) + 30_000
    do_wait_healthy(paths, opts, deadline)
  end

  defp do_wait_healthy(paths, opts, deadline) do
    host = Keyword.get(opts, :host, "127.0.0.1")
    port = Keyword.get(opts, :port, 4_000)

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

  defp validate_same_version(candidate, previous, force?) do
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

    if previous_version == candidate.version and not force?,
      do: {:error, :same_version_requires_force},
      else: :ok
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
      manifest: read_file_or_nil(paths.install_manifest)
    }
  end

  defp rollback(previous, paths, deps) do
    restore_link(paths.current_link, previous.link)
    restore_file(paths.unit_file, previous.unit, 0o644)
    restore_file(paths.launcher, previous.launcher, 0o755)
    restore_file(paths.install_manifest, previous.manifest, 0o644)
    _ = deps.daemon_reload.()
    if previous.link, do: deps.enable_or_restart.()
    :ok
  end

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
