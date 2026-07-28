defmodule SymphonyElixir.AgentLifecycle.Installer do
  @moduledoc """
  Installs versioned provider CLIs under Symphony-owned paths.

  Downloads are checksummed before extraction. A release is built under a
  staging directory, made executable, and probed before it is renamed into the
  immutable versions directory. Activation is a separate atomic manifest swap
  and is deferred while a provider has active runtime leases.
  """

  alias SymphonyElixir.AgentLifecycle.{Catalog, Paths, Probe, ReleaseSource, RuntimeRegistry}

  @spec install(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def install(agent, release, options \\ []) when is_binary(agent) and is_map(release) do
    with {:ok, catalog} <- Catalog.fetch(agent),
         {:ok, version} <- required(release, :version),
         {:ok, url} <- required(release, :url),
         :ok <- prepare_roots(agent),
         {:ok, artifact} <- download(url, options),
         {:ok, checksum, checksum_verified?} <-
           verify_checksum(artifact, value(release, :checksum)) do
      effective_version = effective_version(version, checksum)

      install_artifact(
        agent,
        catalog,
        release,
        artifact,
        effective_version,
        checksum,
        checksum_verified?,
        options
      )
    else
      :error -> {:error, :unknown_agent}
      {:error, _reason} = error -> error
    end
  end

  @spec install_latest(String.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def install_latest(agent, options \\ []) do
    source_options = Keyword.get(options, :release_options, [])
    source = Keyword.get(options, :release_source, &ReleaseSource.latest/2)

    with {:ok, release} <- source.(agent, source_options) do
      install(agent, release, Keyword.drop(options, [:release_options, :release_source]))
    end
  end

  @spec current(String.t()) :: {:ok, map()} | {:error, :not_installed | :invalid_manifest}
  def current(agent), do: read_manifest(Paths.current_manifest(agent), :not_installed)

  @spec pending(String.t()) :: {:ok, map()} | {:error, :none | :invalid_manifest}
  def pending(agent), do: read_manifest(Paths.pending_manifest(agent), :none)

  @spec activate_pending(String.t()) :: {:ok, map()} | {:error, term()}
  def activate_pending(agent) do
    cond do
      RuntimeRegistry.active?(agent) ->
        {:error, :active_sessions}

      true ->
        with {:ok, manifest} <- pending(agent),
             :ok <- atomic_manifest(Paths.current_manifest(agent), manifest),
             :ok <- remove_if_exists(Paths.pending_manifest(agent)) do
          {:ok, result(manifest, :activated)}
        end
    end
  end

  defp install_artifact(
         agent,
         catalog,
         release,
         artifact,
         version,
         checksum,
         checksum_verified?,
         options
       ) do
    staging = Paths.version_root(agent, version) <> ".staging"
    target = Paths.version_root(agent, version)
    executable = Path.join(staging, catalog.executable)
    final_executable = Path.join(target, catalog.executable)
    binary_entry = value(release, :binary_entry) || catalog.executable

    extract =
      Keyword.get(options, :extract, fn contents, format, destination, executable_name ->
        default_extract(
          contents,
          format,
          destination,
          binary_entry,
          executable_name
        )
      end)

    probe = Keyword.get(options, :probe, &Probe.executable/2)

    File.rm_rf(staging)

    result =
      with :ok <- File.mkdir_p(staging),
           :ok <- extract.(artifact, Map.get(release, :format, :raw), staging, catalog.executable),
           :ok <- File.chmod(executable, 0o755),
           {:ok, probed} <- normalize_probe(probe.(agent, executable)),
           :ok <- publish_version(staging, target) do
        manifest = %{
          "agent" => agent,
          "version" => version,
          "executable_path" => final_executable,
          "checksum" => checksum,
          "checksum_verified" => checksum_verified?,
          "installed_at" => System.system_time(:millisecond),
          "probed_version" => fetch_version(probed)
        }

        activate_or_defer(agent, manifest)
      end

    case result do
      {:ok, _value} = ok ->
        ok

      {:error, reason} ->
        File.rm_rf(staging)
        {:error, normalize_install_error(reason)}
    end
  end

  defp activate_or_defer(agent, manifest) do
    if RuntimeRegistry.active?(agent) do
      with :ok <- atomic_manifest(Paths.pending_manifest(agent), manifest) do
        {:ok, result(manifest, :deferred)}
      end
    else
      with :ok <- atomic_manifest(Paths.current_manifest(agent), manifest),
           :ok <- remove_if_exists(Paths.pending_manifest(agent)) do
        {:ok, result(manifest, :activated)}
      end
    end
  end

  defp publish_version(staging, target) do
    case File.stat(target) do
      {:ok, _stat} ->
        File.rm_rf(staging)
        :ok

      {:error, :enoent} ->
        File.rename(staging, target)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp default_extract(artifact, :raw, staging, _binary_entry, executable) do
    File.write(Path.join(staging, executable), artifact, [:binary])
  end

  defp default_extract(artifact, :tar_gz, staging, binary_entry, executable) do
    with {:ok, files} <- :erl_tar.extract({:binary, artifact}, [:compressed, :memory]),
         {:ok, contents} <- archive_entry(files, binary_entry) do
      File.write(Path.join(staging, executable), contents, [:binary])
    end
  end

  defp default_extract(artifact, :zip, staging, binary_entry, executable) do
    with {:ok, files} <- :zip.extract({:binary, artifact}, [:memory]),
         {:ok, contents} <- archive_entry(files, binary_entry) do
      File.write(Path.join(staging, executable), contents, [:binary])
    end
  end

  defp default_extract(artifact, :installer, staging, _binary_entry, executable) do
    home = Path.join(staging, "installer-home")
    script = Path.join(staging, "install.sh")

    with :ok <- File.mkdir_p(home),
         :ok <- File.write(script, artifact, [:binary]),
         :ok <- File.chmod(script, 0o700),
         {:ok, shell} <- executable_path("sh"),
         {_output, 0} <-
           System.cmd(shell, [script],
             stderr_to_stdout: true,
             env: [
               {"HOME", home},
               {"XDG_CONFIG_HOME", Path.join(home, ".config")},
               {"XDG_DATA_HOME", Path.join(home, ".local/share")},
               {"XDG_CACHE_HOME", Path.join(home, ".cache")}
             ]
           ),
         {:ok, installed} <- find_cursor_installer_binary(home) do
      File.cp(installed, Path.join(staging, executable))
    else
      {_output, exit_code} when is_integer(exit_code) -> {:error, {:installer_exit, exit_code}}
      {:error, _reason} = error -> error
    end
  end

  defp default_extract(_artifact, format, _staging, _binary_entry, _executable),
    do: {:error, {:unsupported_archive, format}}

  defp download(url, options) do
    downloader = Keyword.get(options, :download, &download_with_req/1)
    downloader.(url)
  end

  defp download_with_req(url) do
    case Req.get(url, headers: [{"user-agent", "symphony"}]) do
      {:ok, %Req.Response{status: status, body: body}} when status in 200..299 and is_binary(body) ->
        {:ok, body}

      {:ok, %Req.Response{status: status}} ->
        {:error, {:http_status, status}}

      {:error, reason} ->
        {:error, {:download_failed, reason}}
    end
  end

  defp verify_checksum(data, expected) when is_binary(data) and is_binary(expected) do
    actual = :crypto.hash(:sha256, data) |> Base.encode16(case: :lower)

    if actual == String.downcase(expected),
      do: {:ok, actual, true},
      else: {:error, :checksum_mismatch}
  end

  defp verify_checksum(data, nil) when is_binary(data) do
    actual = :crypto.hash(:sha256, data) |> Base.encode16(case: :lower)
    {:ok, actual, false}
  end

  defp normalize_probe({:ok, result}), do: {:ok, result}
  defp normalize_probe({:error, reason}), do: {:error, {:probe_failed, reason}}

  defp normalize_install_error({:probe_failed, _reason} = error), do: error
  defp normalize_install_error(reason), do: reason

  defp prepare_roots(agent), do: File.mkdir_p(Paths.versions_root(agent))

  defp atomic_manifest(path, manifest) do
    :ok = File.mkdir_p(Path.dirname(path))
    temporary = path <> ".tmp-#{System.unique_integer([:positive])}"

    with :ok <- File.write(temporary, Jason.encode!(manifest)),
         :ok <- File.rename(temporary, path) do
      :ok
    else
      {:error, reason} ->
        File.rm(temporary)
        {:error, reason}
    end
  end

  defp read_manifest(path, missing) do
    with {:ok, contents} <- File.read(path),
         {:ok, manifest} when is_map(manifest) <- Jason.decode(contents) do
      {:ok, manifest}
    else
      {:error, :enoent} -> {:error, missing}
      _ -> {:error, :invalid_manifest}
    end
  end

  defp remove_if_exists(path) do
    case File.rm(path) do
      :ok -> :ok
      {:error, :enoent} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp required(map, key) do
    case value(map, key) do
      value when is_binary(value) and value != "" -> {:ok, value}
      _ -> {:error, {:invalid_release, key}}
    end
  end

  defp value(map, key), do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp result(manifest, status) do
    %{
      status: status,
      version: manifest["version"],
      executable_path: manifest["executable_path"]
    }
  end

  defp fetch_version(%{version: version}), do: version
  defp fetch_version(%{"version" => version}), do: version
  defp fetch_version(_result), do: nil

  defp effective_version("latest", checksum), do: "latest-" <> String.slice(checksum, 0, 12)
  defp effective_version(version, _checksum), do: version

  defp archive_entry(files, expected) do
    case Enum.find(files, fn {name, _contents} ->
           name |> List.to_string() |> Path.basename() == Path.basename(expected)
         end) do
      {_name, contents} -> {:ok, contents}
      nil -> {:error, {:archive_entry_missing, expected}}
    end
  end

  defp executable_path(name) do
    case System.find_executable(name) do
      nil -> {:error, {:executable_missing, name}}
      path -> {:ok, path}
    end
  end

  defp find_cursor_installer_binary(home) do
    candidates = [
      Path.join([home, ".local", "bin", "cursor-agent"]),
      Path.join([home, ".local", "bin", "agent"])
    ]

    case Enum.find(candidates, &File.regular?/1) do
      nil -> {:error, :cursor_installer_binary_missing}
      path -> {:ok, path}
    end
  end
end
